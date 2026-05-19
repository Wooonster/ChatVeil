import { MESSAGE_INJECT_CUSTOM_SITE, MESSAGE_REFRESH } from '../src/core/constants';
import { canRunOnHost, isKnownHost, normalizeSettings } from '../src/core/settings';
import { extensionStorage } from '../src/extension/storage';

const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function originPattern(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return undefined;
  }
}

async function hasOriginPermission(url: string): Promise<boolean> {
  const pattern = originPattern(url);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}

async function injectIfAllowed(tabId: number, url: string | undefined): Promise<void> {
  const host = hostFromUrl(url);
  if (!host || !url || isKnownHost(host)) return;
  const settings = await extensionStorage.getSettings();
  if (!canRunOnHost(settings, host)) return;
  if (!(await hasOriginPermission(url))) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
    await chrome.tabs.sendMessage(tabId, { type: MESSAGE_REFRESH }).catch(() => undefined);
  } catch {
    // Some pages block extension injection; keeping this silent avoids user-facing noise.
  }
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => {
    const settings = normalizeSettings(await extensionStorage.getSettings());
    await extensionStorage.setSettings(settings);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    void injectIfAllowed(tabId, tab.url);
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return false;
    if (message.type !== MESSAGE_INJECT_CUSTOM_SITE) return false;
    const tabId = sender.tab?.id;
    const url = sender.tab?.url;
    if (typeof tabId !== 'number') return false;
    void injectIfAllowed(tabId, url).then(() => sendResponse({ ok: true }));
    return true;
  });
});
