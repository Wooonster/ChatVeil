export type MaskStyle = 'dissolve' | 'skeleton' | 'characters' | 'blur';

export interface HistoryItem {
  row: HTMLElement;
  title: HTMLElement;
  href?: string;
  source?: string;
}

export interface ChatbotAdapter {
  id: string;
  name: string;
  matches(location: Pick<Location, 'hostname' | 'href' | 'pathname'>): boolean;
  findHistoryItems(root: ParentNode): HistoryItem[];
  isCurrent(item: HistoryItem, location: Pick<Location, 'href' | 'pathname' | 'origin'>): boolean;
  getStableKey(
    item: HistoryItem,
    location: Pick<Location, 'href' | 'origin' | 'pathname' | 'hostname'>,
    index: number,
  ): string;
}

export interface MaskSettings {
  version: 1;
  enabledHosts: Record<string, boolean>;
  customHosts: string[];
  maskStyle: MaskStyle;
  customMaskChar: string;
  showAllUntilByHost: Record<string, number>;
  unlockedKeysByHost: Record<string, string[]>;
  syncEnabled: boolean;
}

export interface SettingsStorage {
  getSettings(): Promise<MaskSettings>;
  setSettings(settings: MaskSettings): Promise<void>;
}

export interface EngineOptions {
  root: Document | HTMLElement;
  location: Pick<Location, 'href' | 'origin' | 'hostname' | 'pathname'>;
  storage: SettingsStorage;
  adapters?: ChatbotAdapter[];
  clock?: () => number;
  onError?: (error: unknown) => void;
}

export interface SiteStatus {
  host: string;
  known: boolean;
  custom: boolean;
  enabled: boolean;
}
