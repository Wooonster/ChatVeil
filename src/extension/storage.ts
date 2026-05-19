import { SETTINGS_KEY } from '../core/constants';
import { normalizeSettings } from '../core/settings';
import type { MaskSettings, SettingsStorage } from '../core/types';

function extensionContextError(error: unknown): Error {
  if (error instanceof Error && /Extension context invalidated/i.test(error.message)) return error;
  return new Error('Extension context invalidated.');
}

function storageAreaAvailable(area: chrome.storage.StorageArea | undefined): area is chrome.storage.StorageArea {
  return Boolean(area);
}

function chromeGet<T>(area: chrome.storage.StorageArea, keys: string | string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      area.get(keys, (items) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(items as T);
      });
    } catch (error) {
      reject(extensionContextError(error));
    }
  });
}

function chromeSet(area: chrome.storage.StorageArea, items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      area.set(items, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    } catch (error) {
      reject(extensionContextError(error));
    }
  });
}

function chromeRemove(area: chrome.storage.StorageArea, keys: string | string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      area.remove(keys, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    } catch (error) {
      reject(extensionContextError(error));
    }
  });
}

export const extensionStorage: SettingsStorage = {
  async getSettings(): Promise<MaskSettings> {
    if (!storageAreaAvailable(chrome.storage?.local) || !storageAreaAvailable(chrome.storage?.sync)) {
      throw extensionContextError(undefined);
    }
    const [localItems, syncItems] = await Promise.all([
      chromeGet<Record<string, unknown>>(chrome.storage.local, SETTINGS_KEY),
      chromeGet<Record<string, unknown>>(chrome.storage.sync, SETTINGS_KEY),
    ]);
    const localHasSettings = Object.hasOwn(localItems, SETTINGS_KEY);
    const local = normalizeSettings(localItems[SETTINGS_KEY]);
    const synced = normalizeSettings(syncItems[SETTINGS_KEY]);
    if (!localHasSettings && synced.syncEnabled) {
      await chromeSet(chrome.storage.local, { [SETTINGS_KEY]: synced });
      return synced;
    }
    return local;
  },
  async setSettings(settings: MaskSettings): Promise<void> {
    if (!storageAreaAvailable(chrome.storage?.local) || !storageAreaAvailable(chrome.storage?.sync)) {
      throw extensionContextError(undefined);
    }
    const normalized = normalizeSettings(settings);
    await chromeSet(chrome.storage.local, {
      [SETTINGS_KEY]: normalized,
    });
    if (normalized.syncEnabled) {
      await chromeSet(chrome.storage.sync, {
        [SETTINGS_KEY]: normalized,
      });
    } else {
      await chromeRemove(chrome.storage.sync, SETTINGS_KEY);
    }
  },
};

export async function updateExtensionSettings(updater: (settings: MaskSettings) => MaskSettings): Promise<MaskSettings> {
  const current = await extensionStorage.getSettings();
  const next = normalizeSettings(updater(current));
  await extensionStorage.setSettings(next);
  return next;
}
