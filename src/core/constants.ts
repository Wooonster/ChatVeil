import type { MaskSettings } from './types';

export const SETTINGS_KEY = 'chatVeilSettings';
export const DATA_PREFIX = 'chatveil';
export const STYLE_ID = 'chatveil-mask-style';
export const MAX_CUSTOM_MASK_LENGTH = 120;

export const KNOWN_HOSTS = [
  'chatgpt.com',
  'claude.ai',
  'qwen.ai',
  'chat.qwen.ai',
  'minimax.io',
  'chat.minimax.io',
  'agent.minimax.com',
  'agent.minimaxi.com',
  'hailuo.ai',
  'hailuoai.video',
  'chat.deepseek.com',
  'kimi.moonshot.cn',
  'doubao.com',
  'www.doubao.com',
  'yuanbao.tencent.com',
  'tongyi.com',
  'www.tongyi.com',
  'tongyi.aliyun.com',
  'yiyan.baidu.com',
  'gemini.google.com',
  'copilot.microsoft.com',
  'perplexity.ai',
  'poe.com',
  'chat.mistral.ai',
  'grok.com',
] as const;

export const DEFAULT_SETTINGS: MaskSettings = {
  version: 1,
  enabledHosts: {},
  customHosts: [],
  maskStyle: 'dissolve',
  customMaskChar: '•',
  showAllUntilByHost: {},
  unlockedKeysByHost: {},
  syncEnabled: false,
};

export const CONTENT_SCRIPT_MATCHES = Array.from(
  new Set(KNOWN_HOSTS.flatMap((host) => [`https://${host}/*`, `https://*.${host}/*`])),
);

export const MESSAGE_REFRESH = 'chatveil:refresh';
export const MESSAGE_INJECT_CUSTOM_SITE = 'chatveil:inject-custom-site';
