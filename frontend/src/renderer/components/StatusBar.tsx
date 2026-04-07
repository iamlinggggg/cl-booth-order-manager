import React, { useState } from 'react';
import { SyncStatus } from '../types';
import { useApi } from '../hooks/useApi';

interface Props {
  status: SyncStatus | null;
  error: string | null;
  onSyncTriggered?: () => void;
}

function formatRelativeTime(unixTs: number): string {
  if (!unixTs) return '未実行';
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  return `${Math.floor(diff / 3600)}時間前`;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '間もなく';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}時間${m}分${s}秒後`;
  return m > 0 ? `${m}分${s}秒後` : `${s}秒後`;
}

export const StatusBar: React.FC<Props> = ({ status, error, onSyncTriggered }) => {
  const { post } = useApi();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleManualSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      await post('/api/sync');
      onSyncTriggered?.();
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, '');
      setSyncError(msg);
      setTimeout(() => setSyncError(null), 5000);
    } finally {
      setSyncing(false);
    }
  };

  if (error) {
    return (
      <div className="h-8 bg-red-900/50 border-t border-red-700 flex items-center px-4">
        <span className="text-red-300 text-xs">{error}</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="h-8 bg-gray-900 border-t border-gray-700 flex items-center px-4">
        <span className="text-gray-500 text-xs">接続中...</span>
      </div>
    );
  }

  const showManualSync =
    status.isLoggedIn === true &&
    status.isSyncing !== true &&
    status.autoSyncEnabled === false;

  return (
    <div className="h-8 bg-gray-900 border-t border-gray-700 flex items-center px-4 gap-4">
      {/* 同期ステータスインジケーター */}
      <div className="flex items-center gap-1.5">
        {status.isSyncing === true ? (
          <>
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-yellow-400 text-xs">同期中...</span>
          </>
        ) : status.isLoggedIn === true ? (
          <>
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-green-400 text-xs">ログイン済み</span>
          </>
        ) : (
          <>
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            <span className="text-gray-400 text-xs">未ログイン</span>
          </>
        )}
      </div>

      {/* 最終同期時刻 */}
      <span className="text-gray-500 text-xs">
        最終取得: {formatRelativeTime(status.lastSyncedAt)}
      </span>

      {/* 次回同期まで (自動同期有効時のみ) */}
      {status.isLoggedIn === true && status.isSyncing !== true && status.autoSyncEnabled === true && (
        <span className="text-gray-500 text-xs">
          次回: {formatCountdown(status.secondsUntilNext)}
        </span>
      )}

      {/* 手動同期ボタン (自動同期無効時) */}
      {showManualSync && (
        <div className="flex items-center gap-2 ml-auto">
          {syncError && (
            <span className="text-red-400 text-xs">{syncError}</span>
          )}
          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="px-2.5 py-0.5 bg-gray-700 hover:bg-gray-600 border border-gray-600
                       text-gray-300 text-xs rounded transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {syncing ? '同期中...' : '今すぐ同期'}
          </button>
        </div>
      )}
    </div>
  );
};