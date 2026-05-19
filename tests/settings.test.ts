import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/constants';
import { addCustomHost, getSiteStatus, normalizeSettings, removeCustomHost } from '../src/core/settings';

describe('settings normalization', () => {
  it('migrates empty or malformed storage into defaults', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({
        maskStyle: 'unknown',
        customMaskChar: 'x'.repeat(121),
        customHosts: [' Example.com ', 'example.com'],
        unlockedKeysByHost: {
          'Example.com': ['raw-key', 'sha256:abc'],
        },
      }),
    ).toMatchObject({
      maskStyle: 'skeleton',
      customMaskChar: 'x'.repeat(120),
      customHosts: ['example.com'],
      unlockedKeysByHost: {
        'example.com': ['sha256:abc'],
      },
    });
  });

  it('enables known hosts by default and custom hosts only after authorization', () => {
    const settings = normalizeSettings(undefined);
    expect(getSiteStatus(settings, 'chatgpt.com')).toMatchObject({ known: true, enabled: true });
    expect(getSiteStatus(settings, 'chat.minimax.io')).toMatchObject({ known: true, enabled: true });
    expect(getSiteStatus(settings, 'agent.minimax.com')).toMatchObject({ known: true, enabled: true });
    expect(getSiteStatus(settings, 'agent.minimaxi.com')).toMatchObject({ known: true, enabled: true });
    expect(getSiteStatus(settings, 'chat.z.ai')).toMatchObject({ known: false, enabled: false });
    expect(getSiteStatus(settings, 'xiaoai.mi.com')).toMatchObject({ known: false, enabled: false });
    expect(getSiteStatus(settings, 'aistudio.xiaomimimo.com')).toMatchObject({ known: false, enabled: false });
    expect(getSiteStatus(settings, 'example.com')).toMatchObject({ known: false, custom: false, enabled: false });

    const custom = addCustomHost(settings, 'example.com');
    expect(getSiteStatus(custom, 'example.com')).toMatchObject({ custom: true, enabled: true });
    expect(getSiteStatus(removeCustomHost(custom, 'example.com'), 'example.com')).toMatchObject({
      custom: false,
      enabled: false,
    });
  });
});
