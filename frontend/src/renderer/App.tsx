import React, { useState, useEffect, useCallback } from 'react';
import { Order } from './types';
import { OrderList } from './components/OrderList';
import { LoginPanel } from './components/LoginPanel';
import { ManualAddDialog } from './components/ManualAddDialog';
import { StatusBar } from './components/StatusBar';
import { SyncProgressOverlay } from './components/SyncProgressOverlay';
import { UpdateDialog } from './components/UpdateDialog';
import { SettingsPanel } from './components/SettingsPanel';
import { useOrders } from './hooks/useOrders';
import { ViewMode } from './types';
import { useSyncStatus } from './hooks/useSyncStatus';
import { useApi } from './hooks/useApi';

export const App: React.FC = () => {
  const { post, get, put, isReady, backendError } = useApi();
  const { orders, loading, error, refetch, deleteOrder } = useOrders();
  const { status, error: statusError, refetch: refetchStatus } = useSyncStatus();
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [loginChecked, setLoginChecked] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<import('./types').UpdateInfo | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<'library' | 'settings'>('library');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // ログイン状態はsyncStatusから取得
  const isLoggedIn = status?.isLoggedIn ?? false;

  // バックエンドの準備ができたらデータ取得
  useEffect(() => {
    if (isReady) {
      setLoginChecked(true);
    }
  }, [isReady]);

  // バックエンドから viewMode を復元
  useEffect(() => {
    if (!isReady) return;
    get<import('./types').SyncSettings>('/api/settings').then((s) => {
      if (s?.viewMode) setViewMode(s.viewMode);
    }).catch(() => {});
  }, [isReady, get]);

  // アップデートチェック: 起動時に確認済みの結果を取得 + リアルタイム通知を購読
  useEffect(() => {
    window.electronAPI.getUpdateInfo().then((info) => {
      if (info) setUpdateInfo(info);
    });
    const unsub = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info);
    });
    return unsub;
  }, []);

  // 同期完了時にオーダーリストを自動更新
  const prevIsSyncing = React.useRef<boolean | null>(null);
  useEffect(() => {
    const isSyncing = status?.isSyncing ?? false;
    if (prevIsSyncing.current === true && !isSyncing) {
      refetch();
    }
    prevIsSyncing.current = isSyncing;
  }, [status?.isSyncing, refetch]);

  const handleLoginSuccess = useCallback(() => {
    refetchStatus();
    // 少し待ってからデータ再取得 (同期が始まるまで時間がかかる)
    setTimeout(refetch, 3000);
  }, [refetch, refetchStatus]);

  const handleLogout = useCallback(async () => {
    try {
      await post('/api/logout');
      await refetchStatus();
    } catch (e) {
      console.error('Logout failed:', e);
      alert(`ログアウトに失敗しました: ${e}`);
    }
  }, [post, refetchStatus]);

  const handleOrderAdded = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    put('/api/settings', { viewMode: mode }).catch(() => {});
  }, [put]);

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white select-none">
      {/* ヘッダー */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-700 bg-gray-900 app-drag">
        <div className="flex items-center gap-3 no-drag">
          <div className="w-8 h-8 rounded-lg bg-booth-pink/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-booth-pink" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
          </div>
          <h1 className="font-bold text-white">BOOTH Library Manager</h1>
        </div>

        <div className="flex items-center gap-3 no-drag">
          {/* ログイン状態 */}
          {loginChecked && (
            <LoginPanel
              isLoggedIn={isLoggedIn}
              onLoginSuccess={handleLoginSuccess}
              onLogout={handleLogout}
            />
          )}

          {/* 手動追加ボタン */}
          <button
            onClick={() => setShowManualAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600
                       rounded-lg text-sm text-gray-300 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            手動登録
          </button>
        </div>
      </header>

      {/* アップデート通知バナー */}
      {updateInfo && !showUpdateDialog && (
        <div className="flex items-center justify-between px-4 py-2 bg-booth-pink/20 border-b border-booth-pink/40 text-sm">
          <span className="text-booth-pink">
            新しいバージョン <strong>{updateInfo.version}</strong> が利用可能です
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowUpdateDialog(true)}
              className="px-3 py-1 bg-booth-pink hover:bg-booth-pink/80 text-white rounded text-xs font-medium transition-colors"
            >
              詳細を見る
            </button>
            <button
              onClick={() => setUpdateInfo(null)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* タブナビゲーション */}
      {isReady && (
        <div className="flex border-b border-gray-700 bg-gray-900 px-6">
          {([['library', 'ライブラリ'], ['settings', '設定']] as const).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab
                  ? 'border-booth-pink text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* メインコンテンツ */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {!isReady ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-lg px-6">
              {backendError ? (
                <>
                  <p className="text-red-400 font-semibold mb-2">バックエンドの起動に失敗しました</p>
                  <p className="text-gray-500 text-sm mb-4">{backendError}</p>
                  <p className="text-gray-600 text-xs">
                    詳細は <code className="text-gray-400">%APPDATA%\BOOTH Library Manager\backend-error.log</code> を確認してください
                  </p>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 border-2 border-booth-pink border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-gray-400">バックエンドに接続中...</p>
                </>
              )}
            </div>
          </div>
        ) : activeTab === 'settings' ? (
          <SettingsPanel
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
          />
        ) : status?.isSyncing && orders.length === 0 ? (
          /* 初回同期: フルオーバーレイ */
          <SyncProgressOverlay progress={status.syncProgress} />
        ) : (
          <>
            {/* 同期中バナー (既存データあり) */}
            {status?.isSyncing && (
              <div className="flex items-center gap-3 px-6 py-2 bg-yellow-900/30 border-b border-yellow-700/40 text-yellow-300 text-xs">
                <div className="w-3 h-3 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin flex-shrink-0" />
                <span>
                  同期中
                  {status.syncProgress && (
                    <>
                      &nbsp;·&nbsp;
                      {status.syncProgress.section === 'library' ? 'ライブラリ' : 'ギフト'}
                      &nbsp;{status.syncProgress.page} ページ目
                      &nbsp;·&nbsp;
                      {status.syncProgress.itemsFetched} 件取得済み
                    </>
                  )}
                </span>
              </div>
            )}
            <OrderList
              orders={orders}
              loading={loading}
              error={error}
              onDelete={deleteOrder}
              onEdit={setEditingOrder}
              viewMode={viewMode}
            />
          </>
        )}
      </main>

      {/* ステータスバー */}
      <StatusBar status={status} error={statusError} onSyncTriggered={refetchStatus} />

      {/* 手動追加ダイアログ */}
      {showManualAdd && (
        <ManualAddDialog
          onClose={() => setShowManualAdd(false)}
          onAdded={handleOrderAdded}
        />
      )}

      {/* 編集ダイアログ */}
      {editingOrder && (
        <ManualAddDialog
          editOrder={editingOrder}
          onClose={() => setEditingOrder(null)}
          onAdded={handleOrderAdded}
        />
      )}

      {/* アップデートダイアログ */}
      {showUpdateDialog && updateInfo && (
        <UpdateDialog
          info={updateInfo}
          onDismiss={() => setShowUpdateDialog(false)}
        />
      )}
    </div>
  );
};
