import React, { useState, useEffect } from 'react';
import { UpdateInfo } from '../types';

interface Props {
  info: UpdateInfo;
  onDismiss: () => void;
}

type UpdateState = 'idle' | 'downloading' | 'ready' | 'error';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 簡易 Markdown → React 要素変換 (ヘッダー・リスト・太字のみ対応)
function renderReleaseNotes(text: string): React.ReactNode {
  return text.split('\n').map((line, i) => {
    const h2 = line.match(/^##\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    const li = line.match(/^[-*]\s+(.*)/);
    const content = line.replace(/\*\*(.*?)\*\*/g, '$1');

    if (h2) return <p key={i} className="font-bold text-white mt-3 mb-1">{h2[1]}</p>;
    if (h3) return <p key={i} className="font-semibold text-gray-200 mt-2 mb-0.5">{h3[1]}</p>;
    if (li)  return (
      <p key={i} className="text-gray-300 pl-3 before:content-['·'] before:mr-2 before:text-booth-pink">
        {li[1].replace(/\*\*(.*?)\*\*/g, '$1')}
      </p>
    );
    if (content.trim() === '') return <div key={i} className="h-1" />;
    return <p key={i} className="text-gray-300">{content}</p>;
  });
}

export const UpdateDialog: React.FC<Props> = ({ info, onDismiss }) => {
  const [state, setState] = useState<UpdateState>('idle');
  const [progress, setProgress] = useState({ downloaded: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const unsub = window.electronAPI.onDownloadProgress(setProgress);
    return unsub;
  }, []);

  const handleDownload = async () => {
    setState('downloading');
    setProgress({ downloaded: 0, total: 0 });
    try {
      await window.electronAPI.downloadUpdate();
      setState('ready');
    } catch (e) {
      setState('error');
      setErrorMsg(String(e));
    }
  };

  const handleApply = async () => {
    try {
      await window.electronAPI.applyUpdate();
    } catch (e) {
      setState('error');
      setErrorMsg(String(e));
    }
  };

  const percent = progress.total > 0
    ? Math.round((progress.downloaded / progress.total) * 100)
    : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-lg flex flex-col max-h-[85vh]">
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-white">アップデートが利用可能</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              バージョン <span className="text-booth-pink font-medium">{info.version}</span> がリリースされました
            </p>
          </div>
          {state !== 'downloading' && (
            <button onClick={onDismiss} className="text-gray-400 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* リリースノート */}
        <div className="flex-1 overflow-y-auto p-5 text-sm space-y-0.5 min-h-0">
          {info.releaseNotes.trim()
            ? renderReleaseNotes(info.releaseNotes)
            : <p className="text-gray-500">リリースノートがありません</p>
          }
        </div>

        {/* フッター */}
        <div className="p-5 border-t border-gray-700 flex-shrink-0 space-y-3">
          {/* ダウンロード進捗 */}
          {state === 'downloading' && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-gray-400">
                <span>ダウンロード中...</span>
                <span>
                  {percent !== null
                    ? `${percent}% (${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)})`
                    : formatBytes(progress.downloaded)
                  }
                </span>
              </div>
              <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-booth-pink rounded-full transition-all duration-200"
                  style={{ width: percent !== null ? `${percent}%` : '100%' }}
                />
              </div>
            </div>
          )}

          {/* ready メッセージ */}
          {state === 'ready' && (
            <p className="text-xs text-green-400">
              ダウンロード完了。「再起動して適用」をクリックするとアプリが再起動し、アップデートが適用されます。
            </p>
          )}

          {/* エラー */}
          {state === 'error' && (
            <p className="text-xs text-red-400">{errorMsg}</p>
          )}

          <div className="flex gap-3">
            {/* GitHub で開く (常に表示) */}
            <button
              onClick={() => window.electronAPI.openExternal(info.releaseUrl)}
              className="px-3 py-2 border border-gray-600 text-gray-300 hover:bg-gray-700
                         rounded-lg text-sm transition-colors"
            >
              GitHub で開く
            </button>

            <div className="flex-1" />

            {state === 'idle' && (
              info.downloadUrl ? (
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 bg-booth-pink hover:bg-booth-pink/80 text-white
                             rounded-lg text-sm font-medium transition-colors"
                >
                  ダウンロード
                </button>
              ) : (
                <span className="text-xs text-gray-500 self-center">
                  自動ダウンロード非対応 (GitHub から手動でダウンロードしてください)
                </span>
              )
            )}

            {state === 'downloading' && (
              <button
                disabled
                className="px-4 py-2 bg-booth-pink/50 text-white/50 rounded-lg text-sm font-medium cursor-not-allowed"
              >
                ダウンロード中...
              </button>
            )}

            {(state === 'ready' || state === 'error') && (
              <>
                {state === 'error' && (
                  <button
                    onClick={handleDownload}
                    className="px-3 py-2 border border-gray-600 text-gray-300 hover:bg-gray-700
                               rounded-lg text-sm transition-colors"
                  >
                    再試行
                  </button>
                )}
                {state === 'ready' && (
                  <button
                    onClick={handleApply}
                    className="px-4 py-2 bg-booth-pink hover:bg-booth-pink/80 text-white
                               rounded-lg text-sm font-medium transition-colors"
                  >
                    再起動して適用
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
