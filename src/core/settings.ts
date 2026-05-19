import { DEFAULT_SETTINGS, KNOWN_HOSTS, MAX_CUSTOM_MASK_LENGTH } from './constants';
import type { MaskSettings, MaskStyle, SiteStatus } from './types';

const maskStyles: MaskStyle[] = ['skeleton', 'characters', 'blur'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

export function isKnownHost(hostname: string): boolean {
  const host = cleanHost(hostname);
  return KNOWN_HOSTS.some((knownHost) => host === knownHost || host.endsWith(`.${knownHost}`));
}

export function normalizeHostList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((host): host is string => typeof host === 'string')
        .map(cleanHost)
        .filter(Boolean),
    ),
  ).sort();
}

function normalizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const output: Record<string, boolean> = {};
  for (const [host, enabled] of Object.entries(value)) {
    const clean = cleanHost(host);
    if (!clean || typeof enabled !== 'boolean') continue;
    output[clean] = enabled;
  }
  return output;
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const output: Record<string, number> = {};
  for (const [host, timestamp] of Object.entries(value)) {
    const clean = cleanHost(host);
    if (!clean || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue;
    output[clean] = Math.max(0, timestamp);
  }
  return output;
}

function normalizeStringArrayRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  const output: Record<string, string[]> = {};
  for (const [host, keys] of Object.entries(value)) {
    const clean = cleanHost(host);
    if (!clean || !Array.isArray(keys)) continue;
    output[clean] = Array.from(
      new Set(keys.filter((key): key is string => typeof key === 'string' && key.startsWith('sha256:'))),
    ).sort();
  }
  return output;
}

export function normalizeSettings(value: unknown): MaskSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
  const maskStyle = maskStyles.includes(value.maskStyle as MaskStyle)
    ? (value.maskStyle as MaskStyle)
    : DEFAULT_SETTINGS.maskStyle;
  const customMaskChar =
    typeof value.customMaskChar === 'string' && value.customMaskChar.trim()
      ? Array.from(value.customMaskChar.trim()).slice(0, MAX_CUSTOM_MASK_LENGTH).join('')
      : DEFAULT_SETTINGS.customMaskChar;
  return {
    version: 1,
    enabledHosts: normalizeBooleanRecord(value.enabledHosts),
    customHosts: normalizeHostList(value.customHosts),
    maskStyle,
    customMaskChar,
    showAllUntilByHost: normalizeNumberRecord(value.showAllUntilByHost),
    unlockedKeysByHost: normalizeStringArrayRecord(value.unlockedKeysByHost),
    syncEnabled: typeof value.syncEnabled === 'boolean' ? value.syncEnabled : DEFAULT_SETTINGS.syncEnabled,
  };
}

export function getSiteStatus(settings: MaskSettings, hostname: string): SiteStatus {
  const host = cleanHost(hostname);
  const known = isKnownHost(host);
  const custom = settings.customHosts.includes(host);
  const explicit = settings.enabledHosts[host];
  return {
    host,
    known,
    custom,
    enabled: explicit ?? (known || custom),
  };
}

export function canRunOnHost(settings: MaskSettings, hostname: string): boolean {
  return getSiteStatus(settings, hostname).enabled;
}

export function updateHostEnabled(settings: MaskSettings, hostname: string, enabled: boolean): MaskSettings {
  const host = cleanHost(hostname);
  return normalizeSettings({
    ...settings,
    enabledHosts: {
      ...settings.enabledHosts,
      [host]: enabled,
    },
  });
}

export function addCustomHost(settings: MaskSettings, hostname: string): MaskSettings {
  const host = cleanHost(hostname);
  return normalizeSettings({
    ...settings,
    customHosts: [...settings.customHosts, host],
    enabledHosts: {
      ...settings.enabledHosts,
      [host]: true,
    },
  });
}

export function removeCustomHost(settings: MaskSettings, hostname: string): MaskSettings {
  const host = cleanHost(hostname);
  const { [host]: _removedEnabled, ...enabledHosts } = settings.enabledHosts;
  const { [host]: _removedShowAll, ...showAllUntilByHost } = settings.showAllUntilByHost;
  const { [host]: _removedUnlocked, ...unlockedKeysByHost } = settings.unlockedKeysByHost;
  return normalizeSettings({
    ...settings,
    customHosts: settings.customHosts.filter((customHost) => customHost !== host),
    enabledHosts,
    showAllUntilByHost,
    unlockedKeysByHost,
  });
}

export function setUnlockedKey(settings: MaskSettings, hostname: string, key: string, unlocked: boolean): MaskSettings {
  const host = cleanHost(hostname);
  const current = new Set(settings.unlockedKeysByHost[host] ?? []);
  if (unlocked) current.add(key);
  else current.delete(key);
  return normalizeSettings({
    ...settings,
    unlockedKeysByHost: {
      ...settings.unlockedKeysByHost,
      [host]: Array.from(current),
    },
  });
}
