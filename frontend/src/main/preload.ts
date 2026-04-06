import { contextBridge, ipcRenderer } from 'electron';

// レンダラープロセスに安全なAPIを公開
contextBridge.exposeInMainWorld('electronAPI', {
  // バックエンドのポート番号を取得
  getClPort: (): Promise<number | null> =>
    ipcRenderer.invoke('get-cl-port'),

  // BOOTHログインウィンドウを開く
  openLoginWindow: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('open-login-window'),

  // 外部URLをデフォルトブラウザで開く
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  // ログイン成功イベントのリスナー
  onLoginSuccess: (callback: () => void) => {
    ipcRenderer.on('login-success', callback);
    // クリーンアップ関数を返す
    return () => ipcRenderer.removeListener('login-success', callback);
  },

  // バックエンド起動完了イベントのリスナー
  onBackendReady: (callback: (port: number) => void) => {
    const handler = (_: unknown, port: number) => callback(port);
    ipcRenderer.on('backend-ready', handler);
    return () => ipcRenderer.removeListener('backend-ready', handler);
  },

  // バックエンド起動失敗イベントのリスナー
  onBackendError: (callback: (err: string) => void) => {
    const handler = (_: unknown, err: string) => callback(err);
    ipcRenderer.on('backend-error', handler);
    return () => ipcRenderer.removeListener('backend-error', handler);
  },
});
