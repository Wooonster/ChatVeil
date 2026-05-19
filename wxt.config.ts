import { defineConfig } from 'wxt';
import { CONTENT_SCRIPT_MATCHES } from './src/core/constants';

export default defineConfig({
  manifest: {
    name: 'GPT List Mask',
    short_name: 'List Mask',
    version: '0.1.0',
    description:
      'Mask non-current chatbot conversation titles by default, with hover reveal and per-title unlocks.',
    permissions: ['activeTab', 'scripting', 'storage'],
    host_permissions: CONTENT_SCRIPT_MATCHES,
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_title: 'GPT List Mask',
      default_popup: 'popup.html',
    },
  },
});
