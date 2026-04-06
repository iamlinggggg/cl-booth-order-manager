import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
} from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// CL backend process management
// ---------------------------------------------------------------------------

let clProcess: ChildProcess | null = null;
let clPort: number | null = null;
let mainWindow: BrowserWindow | null = null;

// プロセス終了時に必ずSBCLを強制終了する (SIGKILLされても動作)
function forceKillBackend() {
  if (clProcess && clProcess.pid) {
    try {
      process.kill(clProcess.pid, 'SIGKILL');
    } catch (_) {}
    clProcess = null;
  }
}
process.on('exit', forceKillBackend);
process.on('SIGINT', () => { forceKillBackend(); process.exit(0); });
process.on('SIGTERM', () => { forceKillBackend(); process.exit(0); });

function getBackendPath(): string {
  if (app.isPackaged) {
    // パッケージ済み: resourcesPath/cl-backend/booth-backend.exe
    return path.join(process.resourcesPath, 'cl-backend', 'booth-backend.exe');
  } else {
    // 開発時: リポジトリルートの dist-cl/booth-backend.exe
    // または sbcl で直接起動するスクリプト
    const exePath = path.join(__dirname, '..', '..', '..', 'dist-cl', 'booth-backend.exe');
    if (fs.existsSync(exePath)) return exePath;

    // フォールバック: sbcl スクリプト起動
    return 'sbcl';
  }
}

function getBackendArgs(backendPath: string): string[] {
  if (backendPath === 'sbcl') {
    // 開発時: quicklisp経由で起動
    // __dirname = dist/main/ → 3つ上がるとリポジトリルート
    const projectRoot = path.resolve(__dirname, '..', '..', '..');
    return [
      '--eval', '(load (merge-pathnames "quicklisp/setup.lisp" (user-homedir-pathname)))',
      '--eval', `(push #p"${projectRoot}/" ql:*local-project-directories*)`,
      '--eval', '(ql:quickload :cl-booth-library-manager :silent t)',
      '--eval', '(cl-booth-library-manager:main)',
    ];
  }
  return [];
}

function startBackend(): Promise<number> {
  return new Promise((resolve, reject) => {
    const backendPath = getBackendPath();
    const args = getBackendArgs(backendPath);

    console.log('[main] Starting backend:', backendPath);

    clProcess = spawn(backendPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        BOOTH_PORT: '57284',
      },
    });

    // stdoutで "READY:<port>" を待機
    const timeout = setTimeout(() => {
      settle(new Error('Backend startup timeout (30s)'));
    }, 30000);

    let settled = false;
    function settle(err: Error | null, port?: number) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err) reject(err);
      else resolve(port!);
    }

    clProcess.stdout!.on('data', (data: Buffer) => {
      const text = data.toString();
      console.log('[backend]', text.trim());

      const match = text.match(/READY:(\d+)/);
      if (match) {
        clPort = parseInt(match[1], 10);
        settle(null, clPort);
      }
    });

    clProcess.stderr!.on('data', (data: Buffer) => {
      console.error('[backend stderr]', data.toString().trim());
    });

    clProcess.on('exit', (code) => {
      console.log('[main] Backend exited with code:', code);
      settle(new Error(`Backend exited with code: ${code}`));
      clProcess = null;
      clPort = null;
    });

    clProcess.on('error', (err) => {
      settle(err);
    });
  });
}

function stopBackend() {
  if (clProcess) {
    clProcess.kill('SIGTERM');
    clProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1a1a2e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
    title: 'BOOTH Library Manager',
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 外部リンクをデフォルトブラウザで開く
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// BOOTH Login WebView window
// ---------------------------------------------------------------------------

function openLoginWindow(): Promise<void> {
  return new Promise((resolve, reject) => {
    const loginWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'BOOTHにログイン',
      webPreferences: {
        partition: 'persist:booth-login',
        nodeIntegration: false,
        contextIsolation: true,
      },
      parent: mainWindow ?? undefined,
      modal: true,
    });

    loginWin.loadURL('https://booth.pm/users/sign_in');

    loginWin.webContents.on('did-finish-load', async () => {
      const url = loginWin.webContents.getURL();
      console.log('[login] Page loaded:', url);

      const isLoginComplete =
        (url.startsWith('https://booth.pm') || url.startsWith('https://accounts.booth.pm')) &&
        !url.includes('pixiv.net') &&
        !url.includes('/login') &&
        !url.includes('sign_in') &&
        !url.includes('/signup');

      if (!isLoginComplete) return;
      try {
        const hasLoginLink = await loginWin.webContents.executeJavaScript(
          `!!document.querySelector('a[href*="sign_in"]') || !!document.querySelector('a[href*="/login"]')`
        );
        if (hasLoginLink) {
          console.log('[login] ログインリンクを検出したため待機します...');
          return; // まだログインしていないので処理を中断して待つ
        }
      } catch (e) {
        // DOMアクセスエラー時はスルー
      }

      // セッションCookieが存在するかチェック
      const boothCookies = await loginWin.webContents.session.cookies.get({ domain: '.booth.pm' });
      const hasSessionCookie = boothCookies.some(
        (c) => c.name.includes('session') || c.name.includes('_plaza') || c.name.includes('login')
      );

      if (!hasSessionCookie) {
        console.log('[login] No session cookie found, waiting for login...');
        return;
      }

      try {
        await extractAndSendCookies(loginWin.webContents.session);
        loginWin.close();
        resolve();
      } catch (err) {
        console.error('[login] Cookie extraction failed:', err);
      }
    });

    loginWin.on('closed', () => {
      resolve(); // キャンセルされた場合も正常終了
    });
  });
}

async function extractAndSendCookies(sess: Electron.Session) {
  // BOOTH と pixiv のCookieを取得
  const boothCookies = await sess.cookies.get({ domain: '.booth.pm' });
  const accountsCookies = await sess.cookies.get({ domain: '.accounts.booth.pm' });
  const pixivCookies = await sess.cookies.get({ domain: '.pixiv.net' });

  const allCookies = [...boothCookies, ...accountsCookies, ...pixivCookies];
  console.log('[login] Extracted cookies:', allCookies.length);

  if (allCookies.length === 0) {
    throw new Error('Cookieが取得できませんでした');
  }

  // CLバックエンドへ送信
  const response = await fetch(`http://localhost:${clPort}/api/cookies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies: allCookies }),
  });

  if (!response.ok) {
    throw new Error('Cookieの送信に失敗しました');
  }

  // レンダラーに通知
  mainWindow?.webContents.send('login-success');
  console.log('[login] Cookies sent to backend successfully');
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('get-cl-port', () => clPort);

ipcMain.handle('open-login-window', async () => {
  try {
    await openLoginWindow();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('open-external', (_event, url: string) => {
  shell.openExternal(url);
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

async function init() {
  // ウィンドウを先に作成してバックエンド起動を待たない
  createMainWindow();

  try {
    await startBackend();
    console.log('[main] Backend ready on port:', clPort);
    mainWindow?.webContents.send('backend-ready', clPort);
  } catch (err) {
    console.error('[main] Failed to start backend:', err);
    mainWindow?.webContents.send('backend-error', String(err));
  }
}

app.whenReady().then(init);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
