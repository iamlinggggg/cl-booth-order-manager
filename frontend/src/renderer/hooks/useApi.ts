import { useState, useEffect, useCallback } from 'react';

// CLバックエンドのベースURLを管理するフック
let cachedPort: number | null = null;
let portPromise: Promise<number | null> | null = null;

async function resolvePort(): Promise<number | null> {
  if (cachedPort) return cachedPort;
  if (portPromise) return portPromise;

  portPromise = window.electronAPI.getClPort().then((port) => {
    cachedPort = port;
    return port;
  });
  return portPromise;
}

function getBaseUrl(port: number): string {
  return `http://localhost:${port}`;
}

export function useApi() {
  const [port, setPort] = useState<number | null>(cachedPort);
  const [isReady, setIsReady] = useState(cachedPort !== null);

  useEffect(() => {
    if (cachedPort) return;

    let cancelled = false;

    // ポーリング: getClPort() が null を返す間は繰り返す
    (async () => {
      while (!cancelled) {
        const p = await window.electronAPI.getClPort();
        if (p) {
          cachedPort = p;
          portPromise = null;
          setPort(p);
          setIsReady(true);
          return;
        }
        await new Promise<void>((r) => setTimeout(r, 500));
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const get = useCallback(
    async <T>(path: string): Promise<T> => {
      const p = port ?? (await resolvePort());
      if (!p) throw new Error('Backend not available');
      const res = await fetch(`${getBaseUrl(p)}${path}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'API error');
      return data.data as T;
    },
    [port]
  );

  const post = useCallback(
    async <T>(path: string, body?: unknown): Promise<T> => {
      const p = port ?? (await resolvePort());
      if (!p) throw new Error('Backend not available');
      const res = await fetch(`${getBaseUrl(p)}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'API error');
      return data.data as T;
    },
    [port]
  );

  const del = useCallback(
    async <T>(path: string): Promise<T> => {
      const p = port ?? (await resolvePort());
      if (!p) throw new Error('Backend not available');
      const res = await fetch(`${getBaseUrl(p)}${path}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'API error');
      return data.data as T;
    },
    [port]
  );

  return { get, post, del, port, isReady };
}
