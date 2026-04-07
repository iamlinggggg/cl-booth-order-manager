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

export interface SyncProgress {
  section: 'library' | 'gifts';
  page: number;
  itemsFetched: number;
}

export interface SyncStatus {
  isSyncing: boolean;
  lastSyncedAt: number;   // Unix timestamp
  nextSyncAt: number;     // Unix timestamp
  secondsUntilNext: number;
  isLoggedIn: boolean;
  autoSyncEnabled: boolean;
  syncProgress: SyncProgress | null;
}

export interface SyncSettings {
  autoSyncEnabled: boolean;
  syncIntervalHours: number;
}

export type ViewMode = 'list' | 'grid';

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

export interface UpdateInfo {
  version: string;
  releaseUrl: string;
  releaseNotes: string;
  downloadUrl: string | null;
}

// Electron IPC API (window.electronAPI)
export interface ElectronAPI {
  getClPort: () => Promise<number | null>;
  getBackendError: () => Promise<string | null>;
  openLoginWindow: () => Promise<{ ok: boolean; error?: string }>;
  openExternal: (url: string) => Promise<void>;
  showInFolder: (path: string) => Promise<void>;
  selectFolder: () => Promise<string[]>;
  getUpdateInfo: () => Promise<UpdateInfo | null>;
  downloadUpdate: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  onLoginSuccess: (callback: () => void) => () => void;
  onBackendReady: (callback: (port: number) => void) => () => void;
  onBackendError: (callback: (err: string) => void) => () => void;
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  onDownloadProgress: (callback: (p: { downloaded: number; total: number }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
