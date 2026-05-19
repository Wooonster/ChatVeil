import { MESSAGE_REFRESH } from '../../src/core/constants';
import {
  addCustomHost,
  getSiteStatus,
  normalizeSettings,
  removeCustomHost,
  updateHostEnabled,
} from '../../src/core/settings';
import type { MaskSettings, MaskStyle, SiteStatus } from '../../src/core/types';
import { extensionStorage } from '../../src/extension/storage';

interface PopupState {
  tabId?: number;
  url?: URL;
  settings: MaskSettings;
  site: SiteStatus;
}

const elements = {
  siteLabel: document.querySelector<HTMLParagraphElement>('#site-label'),
  siteKind: document.querySelector<HTMLSpanElement>('#site-kind'),
  enabled: document.querySelector<HTMLInputElement>('#enabled'),
  permissionNote: document.querySelector<HTMLElement>('#permission-note'),
  showAll: document.querySelector<HTMLButtonElement>('#show-all'),
  resetUnlocks: document.querySelector<HTMLButtonElement>('#reset-unlocks'),
  syncEnabled: document.querySelector<HTMLInputElement>('#sync-enabled'),
  maskStyle: document.querySelector<HTMLSelectElement>('#mask-style'),
  maskChar: document.querySelector<HTMLInputElement>('#mask-char'),
  customSection: document.querySelector<HTMLElement>('#custom-section'),
  removeCustom: document.querySelector<HTMLButtonElement>('#remove-custom'),
  status: document.querySelector<HTMLParagraphElement>('#status'),
};

let state: PopupState | undefined;

function requireElement<T extends Element>(element: T | null, name: string): T {
  if (!element) throw new Error(`Missing popup element: ${name}`);
  return element;
}

for (const [name, element] of Object.entries(elements)) {
  requireElement(element, name);
}

function setStatus(message: string): void {
  elements.status!.textContent = message;
}

function originPermission(url: URL): string {
  return `${url.protocol}//${url.hostname}/*`;
}

function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]);
    });
  });
}

function requestOrigins(origins: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins }, (granted) => {
      resolve(Boolean(granted));
    });
  });
}

function removeOrigins(origins: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.remove({ origins }, (removed) => {
      resolve(Boolean(removed));
    });
  });
}

async function persist(next: MaskSettings): Promise<void> {
  state = state ? { ...state, settings: next, site: getSiteStatus(next, state.site.host) } : state;
  await extensionStorage.setSettings(next);
  render();
  await notifyActiveTab();
}

async function notifyActiveTab(): Promise<void> {
  if (!state?.tabId) return;
  try {
    await chrome.tabs.sendMessage(state.tabId, { type: MESSAGE_REFRESH });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: state.tabId },
        files: ['content-scripts/content.js'],
      });
    } catch {
      // The active page may not permit injection.
    }
  }
}

function render(): void {
  if (!state?.url) {
    elements.siteLabel!.textContent = 'No web page selected';
    elements.siteKind!.textContent = 'Unavailable';
    elements.enabled!.disabled = true;
    elements.showAll!.disabled = true;
    elements.resetUnlocks!.disabled = true;
    setStatus('');
    return;
  }

  const { settings, site, url } = state;
  elements.siteLabel!.textContent = url.hostname;
  elements.siteKind!.textContent = site.known ? 'Known' : site.custom ? 'Custom' : 'Not enabled';
  elements.enabled!.checked = site.enabled;
  elements.enabled!.disabled = false;
  elements.permissionNote!.textContent = site.known
    ? 'Known chatbot sites are enabled by default.'
    : site.custom
      ? 'This site has optional host authorization.'
      : 'Enabling requests permission for this site only.';
  elements.showAll!.disabled = !site.enabled;
  elements.resetUnlocks!.disabled = !site.enabled || (settings.unlockedKeysByHost[site.host]?.length ?? 0) === 0;
  elements.syncEnabled!.checked = settings.syncEnabled;
  elements.maskStyle!.value = settings.maskStyle;
  elements.maskChar!.value = settings.customMaskChar;
  elements.maskChar!.disabled = settings.maskStyle !== 'characters';
  elements.customSection!.hidden = site.known || !site.custom;
}

async function init(): Promise<void> {
  const tab = await queryActiveTab();
  const url = tab?.url ? new URL(tab.url) : undefined;
  const settings = normalizeSettings(await extensionStorage.getSettings());
  const site = getSiteStatus(settings, url?.hostname ?? '');
  state = {
    tabId: tab?.id,
    url,
    settings,
    site,
  };
  render();
}

elements.enabled!.addEventListener('change', async () => {
  if (!state?.url) return;
  const shouldEnable = elements.enabled!.checked;
  let next = state.settings;
  if (shouldEnable && !state.site.known && !state.site.custom) {
    const granted = await requestOrigins([originPermission(state.url)]);
    if (!granted) {
      elements.enabled!.checked = false;
      setStatus('Permission was not granted.');
      return;
    }
    next = addCustomHost(next, state.url.hostname);
  } else {
    next = updateHostEnabled(next, state.url.hostname, shouldEnable);
  }
  await persist(next);
  setStatus(shouldEnable ? 'Masking enabled.' : 'Masking disabled.');
});

elements.showAll!.addEventListener('click', async () => {
  if (!state?.url) return;
  await persist(
    normalizeSettings({
      ...state.settings,
      showAllUntilByHost: {
        ...state.settings.showAllUntilByHost,
        [state.site.host]: Date.now() + 10 * 60 * 1000,
      },
    }),
  );
  setStatus('Titles are visible for 10 minutes.');
});

elements.resetUnlocks!.addEventListener('click', async () => {
  if (!state?.url) return;
  await persist(
    normalizeSettings({
      ...state.settings,
      unlockedKeysByHost: {
        ...state.settings.unlockedKeysByHost,
        [state.site.host]: [],
      },
    }),
  );
  setStatus('Unlocked titles reset.');
});

elements.syncEnabled!.addEventListener('change', async () => {
  if (!state) return;
  await persist(normalizeSettings({ ...state.settings, syncEnabled: elements.syncEnabled!.checked }));
  setStatus(elements.syncEnabled!.checked ? 'Settings sync enabled.' : 'Settings sync disabled.');
});

elements.maskStyle!.addEventListener('change', async () => {
  const maskStyle = elements.maskStyle!.value as MaskStyle;
  if (!state) return;
  await persist(normalizeSettings({ ...state.settings, maskStyle }));
  setStatus('Mask style updated.');
});

elements.maskChar!.addEventListener('change', async () => {
  if (!state) return;
  await persist(normalizeSettings({ ...state.settings, customMaskChar: elements.maskChar!.value }));
  setStatus('Mask character updated.');
});

elements.removeCustom!.addEventListener('click', async () => {
  if (!state?.url) return;
  const pattern = originPermission(state.url);
  const next = removeCustomHost(state.settings, state.url.hostname);
  await removeOrigins([pattern]);
  await persist(next);
  setStatus('Custom site removed.');
});

void init();
