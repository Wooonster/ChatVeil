import { defineConfig } from 'wxt';
import { CONTENT_SCRIPT_MATCHES } from './src/core/constants';

export default defineConfig({
  manifest: {
    name: 'ChatVeil',
    short_name: 'ChatVeil',
    version: '0.1.0',
    description:
      'Mask non-current chatbot conversation titles by default, with hover reveal and per-title unlocks.',
    permissions: ['activeTab', 'scripting', 'storage'],
    host_permissions: CONTENT_SCRIPT_MATCHES,
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    action: {
      default_title: 'ChatVeil',
      default_popup: 'popup.html',
      default_icon: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
      },
    },
  },
});
