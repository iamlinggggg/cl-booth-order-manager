import React, { useState, useEffect, useCallback } from 'react';
import { SyncSettings, ViewMode } from '../types';
import { useApi } from '../hooks/useApi';

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export const SettingsPanel: React.FC<Props> = ({ viewMode, onViewModeChange }) => {
  const { get, put } = useApi();
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await get<SyncSettings>('/api/settings');
      setSettings(data);
    } catch (_) {}
  }, [get]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const updateSetting = async (patch: Partial<SyncSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      await put('/api/settings', {
        autoSyncEnabled: next.autoSyncEnabled,
        syncIntervalHours: next.syncIntervalHours,
      });
    } catch (_) {
      // 失敗時は元に戻す
      setSettings(settings);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-2xl">

      {/* 同期設定 */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          同期設定
        </h2>
        <div className="bg-gray-800 rounded-xl border border-gray-700 divide-y divide-gray-700">

          {/* 自動同期トグル */}
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm text-white font-medium">自動同期</p>
              <p className="text-xs text-gray-400 mt-0.5">
                BOOTHライブラリを定期的に自動取得します
              </p>
            </div>
            <button
              onClick={() => settings && updateSetting({ autoSyncEnabled: !settings.autoSyncEnabled })}
              disabled={!settings || saving}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
                settings?.autoSyncEnabled ? 'bg-booth-pink' : 'bg-gray-600'
              } disabled:opacity-50`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                  settings?.autoSyncEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* 同期間隔 */}
          {settings?.autoSyncEnabled && (
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm text-white font-medium">同期間隔</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  自動同期を実行する間隔（最小: 1時間）
                </p>
              </div>
              <div className="flex items-center gap-1 bg-gray-700 rounded-lg border border-gray-600 overflow-hidden flex-shrink-0">
                {[1, 2, 3, 4, 5, 6].map((h) => (
                  <button
                    key={h}
                    onClick={() => updateSetting({ syncIntervalHours: h })}
                    disabled={saving}
                    className={`px-3 py-1.5 text-xs transition-colors ${
                      settings?.syncIntervalHours === h
                        ? 'bg-booth-pink text-white'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      </section>

      {/* 表示設定 */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          表示設定
        </h2>
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm text-white font-medium">アイテム表示形式</p>
              <p className="text-xs text-gray-400 mt-0.5">
                ライブラリの一覧表示形式を切り替えます
              </p>
            </div>
            <div className="flex items-center bg-gray-700 rounded-lg border border-gray-600 overflow-hidden flex-shrink-0">
              <button
                onClick={() => onViewModeChange('list')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                  viewMode === 'list' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                リスト
              </button>
              <button
                onClick={() => onViewModeChange('grid')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                  viewMode === 'grid' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
                グリッド
              </button>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};
