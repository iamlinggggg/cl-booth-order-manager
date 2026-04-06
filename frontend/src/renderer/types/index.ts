export interface Order {
  id: number;
  boothOrderId: string;
  itemId: string | null;
  itemName: string;
  shopName: string;
  itemUrl: string;
  thumbnailUrl: string;
  price: number;
  currency: string;
  purchasedAt: string;
  isManual: boolean;
  downloadCount: number;
  downloadLabels: string;
}

export interface DownloadLink {
  id: number;
  label: string;
  url: string;
}

export interface SyncStatus {
  isSyncing: boolean;
  lastSyncedAt: number;   // Unix timestamp
  nextSyncAt: number;     // Unix timestamp
  secondsUntilNext: number;
  isLoggedIn: boolean;
}

export interface ItemInfo {
  itemName: string;
  shopName: string;
  thumbnailUrl: string;
  price: string;
  description: string;
}

export interface ManualOrderInput {
  itemUrl?: string;
  itemName: string;
  shopName?: string;
  thumbnailUrl?: string;
  price?: number;
  currency?: string;
  downloadLinks: { label: string; url: string }[];
}

// Electron IPC API (window.electronAPI)
export interface ElectronAPI {
  getClPort: () => Promise<number | null>;
  getBackendError: () => Promise<string | null>;
  openLoginWindow: () => Promise<{ ok: boolean; error?: string }>;
  openExternal: (url: string) => Promise<void>;
  showInFolder: (path: string) => Promise<void>;
  selectFolder: () => Promise<string | null>;
  onLoginSuccess: (callback: () => void) => () => void;
  onBackendReady: (callback: (port: number) => void) => () => void;
  onBackendError: (callback: (err: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
