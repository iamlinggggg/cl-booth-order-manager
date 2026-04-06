import React, { useState, useRef, useMemo } from 'react';
import { Order } from '../types';
import { OrderCard } from './OrderCard';

interface Props {
  orders: Order[];
  loading: boolean;
  error: string | null;
  onDelete: (id: number) => void;
}

type FilterType = 'all' | 'scraped' | 'manual';

export const OrderList: React.FC<Props> = ({ orders, loading, error, onDelete }) => {
  const [inputValue, setInputValue] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const isComposing = useRef(false);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (filter === 'scraped' && o.isManual) return false;
      if (filter === 'manual' && !o.isManual) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          o.itemName.toLowerCase().includes(q) ||
          o.shopName.toLowerCase().includes(q) ||
          o.downloadLabels.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [orders, search, filter]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-booth-pink border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-400">
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 検索・フィルター */}
      <div className="px-6 py-3 border-b border-gray-700 flex gap-3 items-center">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (!isComposing.current) setSearch(e.target.value);
            }}
            onCompositionStart={() => { isComposing.current = true; }}
            onCompositionEnd={(e) => {
              isComposing.current = false;
              setSearch((e.target as HTMLInputElement).value);
            }}
            placeholder="商品名・ショップ名・ファイル名で検索..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2
                       text-white text-sm placeholder-gray-500 focus:outline-none focus:border-gray-500"
          />
        </div>

        {/* フィルタータブ */}
        <div className="flex bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          {([['all', 'すべて'], ['scraped', '自動取得'], ['manual', '手動']] as [FilterType, string][]).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setFilter(val)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                filter === val
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 件数表示 */}
      <div className="px-6 py-2 text-xs text-gray-500">
        {filtered.length}件 / 合計 {orders.length}件
      </div>

      {/* 商品リスト */}
      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <svg className="w-12 h-12 text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
            <p className="text-gray-400 text-sm">
              {orders.length === 0
                ? 'データがありません。ログインするか手動で商品を追加してください。'
                : '検索条件に一致する商品がありません'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {filtered.map((order) => (
              <OrderCard key={order.id} order={order} onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
