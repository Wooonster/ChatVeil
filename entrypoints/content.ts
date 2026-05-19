import { CONTENT_SCRIPT_MATCHES, MESSAGE_REFRESH } from '../src/core/constants';
import { MaskEngine } from '../src/core/engine';
import { extensionStorage } from '../src/extension/storage';

declare global {
  interface Window {
    __chatVeilEngine?: MaskEngine;
  }
}

function isExtensionContextInvalidated(error: unknown): boolean {
  return error instanceof Error && /Extension context invalidated/i.test(error.message);
}

export default defineContentScript({
  matches: CONTENT_SCRIPT_MATCHES,
  runAt: 'document_idle',
  main() {
    if (window.__chatVeilEngine) return;
    const engine = new MaskEngine({
      root: document,
      location: window.location,
      storage: extensionStorage,
      onError(error) {
        if (isExtensionContextInvalidated(error)) {
          engine.stop();
          if (window.__chatVeilEngine === engine) {
            delete window.__chatVeilEngine;
          }
          return;
        }
        throw error;
      },
    });
    window.__chatVeilEngine = engine;
    void engine.start();

    chrome.runtime.onMessage.addListener((message: unknown) => {
      if (typeof message === 'object' && message !== null && 'type' in message && message.type === MESSAGE_REFRESH) {
        void engine.refresh();
      }
    });
  },
});
