import React, { useState } from 'react';

interface Props {
  isLoggedIn: boolean;
  onLoginSuccess: () => void;
  onLogout: () => void;
}

export const LoginPanel: React.FC<Props> = ({ isLoggedIn, onLoginSuccess, onLogout }) => {
  const [loading, setLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.openLoginWindow();
      if (result.ok) {
        onLoginSuccess();
      } else {
        setError(result.error ?? 'ログインに失敗しました');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  if (isLoggedIn) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-green-400 text-sm">● ログイン済み</span>
        <button
          onClick={async () => {
            setLogoutLoading(true);
            try {
              await onLogout();
            } finally {
              setLogoutLoading(false);
            }
          }}
          disabled={logoutLoading}
          className="text-xs text-gray-400 hover:text-red-400 disabled:opacity-50 transition-colors underline cursor-pointer"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {logoutLoading ? '処理中...' : 'ログアウト'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-400 text-sm">未ログイン</span>
      {error && (
        <span className="text-red-400 text-xs">{error}</span>
      )}
      <button
        onClick={handleLogin}
        disabled={loading}
        className="px-3 py-1.5 bg-booth-pink hover:bg-booth-pink/80 disabled:opacity-50
                   text-white rounded-lg text-sm font-medium transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {loading ? 'ログイン中...' : 'ブラウザでログイン'}
      </button>
    </div>
  );
};
