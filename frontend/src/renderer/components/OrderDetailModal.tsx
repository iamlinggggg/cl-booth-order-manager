import React, { useEffect } from 'react';
import { Order } from '../types';
import { useDownloadLinks } from '../hooks/useOrders';
import { useApi } from '../hooks/useApi';

interface Props {
  order: Order;
  onClose: () => void;
  onEdit: (order: Order) => void;
  onDelete: (id: number) => void;
}

export const OrderDetailModal: React.FC<Props> = ({ order, onClose, onEdit, onDelete }) => {
  const { links, loading } = useDownloadLinks(order.id);
  const { port } = useApi();
  const thumbnailSrc = port
    ? `http://localhost:${port}/api/thumbnails/${order.id}`
    : order.thumbnailUrl;

  // Esc キーで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const isLocalPath = (url: string) =>
    !url.startsWith('http://') && !url.startsWith('https://');

  const handleOpenLink = (url: string) => {
    if (isLocalPath(url)) {
      window.electronAPI.showInFolder(url);
    } else {
      window.electronAPI.openExternal(url);
    }
  };

  const formatPrice = (price: number, currency: string) => {
    if (!price) return '';
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: currency || 'JPY',
    }).format(price);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-xl w-full max-w-md flex flex-col max-h-[85vh] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* サムネイル */}
        <div className="relative flex-shrink-0 bg-gray-700 rounded-t-xl overflow-hidden" style={{ height: '220px' }}>
          {thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt={order.itemName}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
              </svg>
            </div>
          )}
          {/* 閉じるボタン */}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-black/70 rounded-full
                       flex items-center justify-center text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* 手動登録バッジ */}
          {order.isManual && (
            <span className="absolute top-2 left-2 text-xs bg-gray-700/80 text-gray-300 px-2 py-0.5 rounded">
              手動
            </span>
          )}
        </div>

        {/* 商品情報 */}
        <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-gray-700">
          <h2 className="text-white font-semibold text-base leading-snug">
            {order.itemName || '(商品名なし)'}
          </h2>
          {order.shopName && (
            <p className="text-gray-400 text-sm mt-1">{order.shopName}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-sm">
            {order.price > 0 && (
              <span className="text-booth-pink font-medium">
                {formatPrice(order.price, order.currency)}
              </span>
            )}
            {order.purchasedAt && (
              <span className="text-gray-500 text-xs">{formatDate(order.purchasedAt)}</span>
            )}
          </div>
        </div>

        {/* ダウンロードリンク */}
        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
          {loading ? (
            <p className="text-gray-500 text-sm">読み込み中...</p>
          ) : links.length === 0 ? (
            <p className="text-gray-500 text-sm">ダウンロードリンクなし</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500 mb-2">ダウンロード ({links.length}件)</p>
              {links.map((link) => (
                <button
                  key={link.id}
                  onClick={() => handleOpenLink(link.url)}
                  className="flex items-center gap-2.5 w-full text-left hover:bg-gray-700 rounded-lg px-3 py-2.5 transition-colors group"
                >
                  <svg
                    className="w-4 h-4 text-gray-500 group-hover:text-booth-pink flex-shrink-0 transition-colors"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="text-sm text-gray-300 group-hover:text-white transition-colors truncate">
                    {link.label || 'ダウンロード'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* フッター: アクション */}
        <div className="flex-shrink-0 flex items-center gap-2 px-5 py-3 border-t border-gray-700">
          {order.itemUrl && (
            <button
              onClick={() => handleOpenLink(order.itemUrl)}
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              商品ページ →
            </button>
          )}
          <div className="flex-1" />
          {order.isManual && (
            <>
              <button
                onClick={() => { onEdit(order); onClose(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300
                           hover:bg-gray-700 rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                編集
              </button>
              <button
                onClick={() => { onDelete(order.id); onClose(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400
                           hover:bg-red-900/30 rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                削除
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
