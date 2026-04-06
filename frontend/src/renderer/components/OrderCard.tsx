import React, { useState } from 'react';
import { Order } from '../types';
import { useDownloadLinks } from '../hooks/useOrders';

interface Props {
  order: Order;
  onDelete: (id: number) => void;
}

export const OrderCard: React.FC<Props> = ({ order, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const { links, loading } = useDownloadLinks(expanded ? order.id : null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 hover:border-gray-600 transition-colors">
      {/* カードヘッダー */}
      <div className="flex gap-4 p-4">
        {/* サムネイル */}
        <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-gray-700">
          {order.thumbnailUrl ? (
            <img
              src={order.thumbnailUrl}
              alt={order.itemName}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '';
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
              </svg>
            </div>
          )}
        </div>

        {/* 商品情報 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-white font-medium text-sm leading-tight truncate">
                {order.itemName || '(商品名なし)'}
              </h3>
              {order.shopName && (
                <p className="text-gray-400 text-xs mt-0.5 truncate">{order.shopName}</p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {order.isManual && (
                <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">手動</span>
              )}
              {/* 削除ボタン */}
              {confirmDelete ? (
                <div className="flex gap-1">
                  <button
                    onClick={() => onDelete(order.id)}
                    className="text-xs text-red-400 hover:text-red-300 px-1.5 py-0.5 bg-red-900/30 rounded"
                  >
                    削除
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs text-gray-400 hover:text-gray-300"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-gray-600 hover:text-gray-400 transition-colors p-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-2">
            <span className="text-booth-pink text-sm font-medium">
              {formatPrice(order.price, order.currency)}
            </span>
            {order.purchasedAt && (
              <span className="text-gray-500 text-xs">{formatDate(order.purchasedAt)}</span>
            )}
            {order.downloadCount > 0 && (
              <span className="text-gray-500 text-xs">{order.downloadCount}件のDL</span>
            )}
          </div>

          {/* アクションリンク */}
          <div className="flex gap-3 mt-2">
            {order.itemUrl && (
              <button
                onClick={() => handleOpenLink(order.itemUrl)}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                商品ページ →
              </button>
            )}
            {order.downloadCount > 0 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-booth-pink hover:text-booth-pink/80 transition-colors"
              >
                {expanded ? 'DLリンクを閉じる ▲' : `DLリンク(${order.downloadCount}) ▼`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ダウンロードリンク (展開時) */}
      {expanded && (
        <div className="border-t border-gray-700 px-4 py-3 bg-gray-800/50">
          {loading ? (
            <p className="text-gray-500 text-xs">読み込み中...</p>
          ) : links.length === 0 ? (
            <p className="text-gray-500 text-xs">ダウンロードリンクなし</p>
          ) : (
            <div className="space-y-1.5">
              {links.map((link) => (
                <button
                  key={link.id}
                  onClick={() => handleOpenLink(link.url)}
                  className="flex items-center gap-2 w-full text-left hover:bg-gray-700 rounded-lg px-3 py-2 transition-colors group"
                >
                  <svg className="w-4 h-4 text-gray-500 group-hover:text-booth-pink flex-shrink-0 transition-colors"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
      )}
    </div>
  );
};
