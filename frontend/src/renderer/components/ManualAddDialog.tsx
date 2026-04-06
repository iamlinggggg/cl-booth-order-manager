import React, { useState } from 'react';
import { ItemInfo, ManualOrderInput } from '../types';
import { useApi } from '../hooks/useApi';

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

interface DLEntry {
  id: number;
  label: string;
  url: string;
  type: 'url' | 'local';
}

export const ManualAddDialog: React.FC<Props> = ({ onClose, onAdded }) => {
  const { get, post } = useApi();

  const [itemUrl, setItemUrl] = useState('');
  const [itemName, setItemName] = useState('');
  const [shopName, setShopName] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [price, setPrice] = useState('');
  const [dlEntries, setDlEntries] = useState<DLEntry[]>([{ id: 1, label: '', url: '', type: 'url' }]);
  const [preview, setPreview] = useState<ItemInfo | null>(null);
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URLから商品情報を自動取得
  const fetchItemInfo = async () => {
    if (!itemUrl.trim()) return;
    setFetchingInfo(true);
    setError(null);
    try {
      const info = await post<ItemInfo>('/api/item-info', { url: itemUrl.trim() });
      setPreview(info);
      if (info.itemName) setItemName(info.itemName);
      if (info.shopName) setShopName(info.shopName);
      if (info.thumbnailUrl) setThumbnailUrl(info.thumbnailUrl);
      if (info.price) setPrice(info.price);
    } catch (e) {
      setError(`商品情報の取得に失敗しました: ${e}`);
    } finally {
      setFetchingInfo(false);
    }
  };

  const addDlEntry = () => {
    setDlEntries((prev) => [
      ...prev,
      { id: Date.now(), label: '', url: '', type: 'url' },
    ]);
  };

  const removeDlEntry = (id: number) => {
    setDlEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const updateDlEntry = (id: number, field: 'label' | 'url' | 'type', value: string) => {
    setDlEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  const selectFolder = async (id: number) => {
    const path = await window.electronAPI.selectFolder();
    if (path) updateDlEntry(id, 'url', path);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) {
      setError('商品名は必須です');
      return;
    }

    const validLinks = dlEntries.filter((e) => e.url.trim());
    setSubmitting(true);
    setError(null);

    try {
      const input: ManualOrderInput = {
        itemUrl: itemUrl.trim() || undefined,
        itemName: itemName.trim(),
        shopName: shopName.trim() || undefined,
        thumbnailUrl: thumbnailUrl.trim() || undefined,
        price: price ? parseInt(price.replace(/[^0-9]/g, ''), 10) : undefined,
        downloadLinks: validLinks.map((e) => ({
          label: e.label.trim() || 'download',
          url: e.url.trim(),
        })),
      };
      await post('/api/orders', input);
      onAdded();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">商品を手動登録</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 商品URL (任意) */}
          <div>
            <label className="block text-sm text-gray-300 mb-1">商品URL (省略可)</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={itemUrl}
                onChange={(e) => setItemUrl(e.target.value)}
                placeholder="https://booth.pm/ja/items/..."
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2
                           text-white text-sm placeholder-gray-500 focus:outline-none focus:border-booth-pink"
              />
              <button
                type="button"
                onClick={fetchItemInfo}
                disabled={fetchingInfo || !itemUrl.trim()}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600
                           text-gray-300 text-sm rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {fetchingInfo ? '取得中...' : '情報取得'}
              </button>
            </div>
          </div>

          {/* サムネイルプレビュー */}
          {(preview?.thumbnailUrl || thumbnailUrl) && (
            <div className="flex gap-3 items-center bg-gray-700/50 rounded-lg p-3">
              <img
                src={preview?.thumbnailUrl ?? thumbnailUrl}
                alt=""
                className="w-16 h-16 object-cover rounded"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="text-sm">
                <p className="text-white font-medium">{preview?.itemName ?? itemName}</p>
                <p className="text-gray-400">{preview?.shopName ?? shopName}</p>
                <p className="text-booth-pink">{preview?.price ?? price}</p>
              </div>
            </div>
          )}

          {/* 商品名 */}
          <div>
            <label className="block text-sm text-gray-300 mb-1">商品名 <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              required
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2
                         text-white text-sm focus:outline-none focus:border-booth-pink"
            />
          </div>

          {/* ショップ名 */}
          <div>
            <label className="block text-sm text-gray-300 mb-1">ショップ名</label>
            <input
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2
                         text-white text-sm focus:outline-none focus:border-booth-pink"
            />
          </div>

          {/* ダウンロードリンク */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-gray-300">ダウンロードリンク</label>
              <button
                type="button"
                onClick={addDlEntry}
                className="text-xs text-booth-pink hover:text-booth-pink/80 transition-colors"
              >
                + 追加
              </button>
            </div>
            <div className="space-y-2">
              {dlEntries.map((entry) => (
                <div key={entry.id} className="space-y-1">
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={entry.label}
                      onChange={(e) => updateDlEntry(entry.id, 'label', e.target.value)}
                      placeholder="ラベル"
                      className="w-24 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5
                                 text-white text-sm focus:outline-none focus:border-booth-pink"
                    />
                    {/* URL / ローカル トグル */}
                    <div className="flex rounded-lg overflow-hidden border border-gray-600 text-xs flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => updateDlEntry(entry.id, 'type', 'url')}
                        className={`px-2 py-1.5 transition-colors ${entry.type === 'url' ? 'bg-gray-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'}`}
                      >
                        URL
                      </button>
                      <button
                        type="button"
                        onClick={() => updateDlEntry(entry.id, 'type', 'local')}
                        className={`px-2 py-1.5 transition-colors ${entry.type === 'local' ? 'bg-gray-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-gray-200'}`}
                      >
                        ローカル
                      </button>
                    </div>
                    {dlEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDlEntry(entry.id)}
                        className="text-gray-500 hover:text-red-400 transition-colors ml-auto"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {entry.type === 'url' ? (
                    <input
                      type="url"
                      value={entry.url}
                      onChange={(e) => updateDlEntry(entry.id, 'url', e.target.value)}
                      placeholder="https://..."
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5
                                 text-white text-sm focus:outline-none focus:border-booth-pink"
                    />
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={entry.url}
                        onChange={(e) => updateDlEntry(entry.id, 'url', e.target.value)}
                        placeholder="/home/user/downloads/item  または  C:\Downloads\item"
                        className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5
                                   text-white text-sm focus:outline-none focus:border-booth-pink font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => selectFolder(entry.id)}
                        className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600
                                   text-gray-300 text-xs rounded-lg transition-colors whitespace-nowrap"
                      >
                        参照...
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-600 text-gray-300
                         rounded-lg hover:bg-gray-700 transition-colors text-sm"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-booth-pink hover:bg-booth-pink/80
                         text-white rounded-lg disabled:opacity-50 transition-colors text-sm font-medium"
            >
              {submitting ? '登録中...' : '登録する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
