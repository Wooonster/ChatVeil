import { SETTINGS_KEY } from '../core/constants';
import { MaskEngine } from '../core/engine';
import {
  addCustomHost,
  getSiteStatus,
  normalizeSettings,
  removeCustomHost,
  updateHostEnabled,
} from '../core/settings';
import type { MaskSettings, SettingsStorage } from '../core/types';

const PANEL_ID = 'gptlm-userscript-panel';

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const userscriptStorage: SettingsStorage = {
  async getSettings(): Promise<MaskSettings> {
    return normalizeSettings(GM_getValue<unknown>(SETTINGS_KEY, undefined));
  },
  async setSettings(settings: MaskSettings): Promise<void> {
    GM_setValue(SETTINGS_KEY, normalizeSettings(settings));
  },
};

const engine = new MaskEngine({
  root: document,
  location: window.location,
  storage: userscriptStorage,
});

function renderPanel(settings: MaskSettings): HTMLElement {
  const site = getSiteStatus(settings, window.location.hostname);
  const panel = document.createElement('form');
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <style>
      #${PANEL_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: grid;
        gap: 8px;
        width: 236px;
        padding: 12px;
        border: 1px solid rgba(100, 116, 139, 0.32);
        border-radius: 8px;
        color: #172033;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 16px 38px rgba(15, 23, 42, 0.22);
        font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #${PANEL_ID} select,
      #${PANEL_ID} input[type="number"],
      #${PANEL_ID} input[type="text"] {
        width: 112px;
      }
      #${PANEL_ID} button {
        min-height: 30px;
      }
      #${PANEL_ID} .row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      @media (prefers-color-scheme: dark) {
        #${PANEL_ID} {
          color: #e6eef7;
          background: rgba(17, 24, 39, 0.96);
        }
      }
    </style>
    <strong>GPT List Mask</strong>
    <label>Enabled <input name="enabled" type="checkbox" ${site.enabled ? 'checked' : ''}></label>
    <label>
      Style
      <select name="style">
        <option value="skeleton" ${settings.maskStyle === 'skeleton' ? 'selected' : ''}>Skeleton</option>
        <option value="characters" ${settings.maskStyle === 'characters' ? 'selected' : ''}>Characters</option>
        <option value="blur" ${settings.maskStyle === 'blur' ? 'selected' : ''}>Blur</option>
      </select>
    </label>
    <label>Character <input name="char" type="text" maxlength="120" value="${escapeAttribute(settings.customMaskChar)}"></label>
    <div class="row">
      <button name="show" type="button">Show 10m</button>
      <button name="reset" type="button">Reset</button>
    </div>
    <button name="close" type="button">Close</button>
  `;
  return panel;
}

async function showPanel(): Promise<void> {
  document.getElementById(PANEL_ID)?.remove();
  const settings = await userscriptStorage.getSettings();
  const panel = renderPanel(settings);
  document.body.append(panel);

  panel.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const form = new FormData(panel as HTMLFormElement);
    const enabled = form.get('enabled') === 'on';
    const next = normalizeSettings({
      ...settings,
      maskStyle: form.get('style'),
      customMaskChar: form.get('char'),
    });
    const withHost = enabled
      ? addCustomHost(next, window.location.hostname)
      : updateHostEnabled(removeCustomHost(next, window.location.hostname), window.location.hostname, false);
    await userscriptStorage.setSettings(withHost);
    await engine.refresh();
  });

  panel.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const current = await userscriptStorage.getSettings();
    if (target.name === 'close') {
      panel.remove();
      return;
    }
    if (target.name === 'show') {
      await userscriptStorage.setSettings(
        normalizeSettings({
          ...current,
          showAllUntilByHost: {
            ...current.showAllUntilByHost,
            [window.location.hostname]: Date.now() + 10 * 60 * 1000,
          },
        }),
      );
    }
    if (target.name === 'reset') {
      await userscriptStorage.setSettings(
        normalizeSettings({
          ...current,
          unlockedKeysByHost: {
            ...current.unlockedKeysByHost,
            [window.location.hostname]: [],
          },
        }),
      );
    }
    await engine.refresh();
  });
}

GM_registerMenuCommand('Open GPT List Mask controls', () => {
  void showPanel();
});

void engine.start();
