# GPT List Mask

GPT List Mask is a local-only privacy tool for chatbot sidebars. It masks non-current conversation titles by default, keeps the current conversation visible, reveals masked titles while hovered or keyboard-focused, and lets users pin individual titles visible with a triple-click.

The project ships the same TypeScript masking core in two forms:

- A Chrome Manifest V3 extension built with WXT.
- A Tampermonkey userscript built with Vite.

## What It Does

- Masks chat history titles without rewriting the original page text.
- Reveals a title temporarily on hover or focus.
- Keeps the active conversation title readable.
- Stores per-title unlocks as hashed keys instead of raw titles.
- Supports a default skeleton mask, a character mask, and a blur mode.
- Lets users enable unknown chatbot sites one origin at a time from the popup.

## Supported Sites

First-class adapters are included for:

- ChatGPT: `chatgpt.com`
- Claude: `claude.ai`
- Qwen: `qwen.ai` and `chat.qwen.ai`

The generic adapter also supports known chatbot hosts such as Z.ai, Xiaomi XiaoAI/MiMo, MiniMax/Hailuo, DeepSeek, Kimi, Doubao, Tencent Yuanbao, ChatGLM, Tongyi, ERNIE/Yiyan, Gemini, Copilot, Perplexity, Poe, Mistral, and Grok. Other chatbot sites can be enabled manually from the extension popup with a single-origin permission request.

## Privacy Model

GPT List Mask is designed to stay on the page and in the browser:

- No network calls.
- No telemetry.
- No remote code.
- No title uploads.
- No raw conversation-title storage.
- No destructive text replacement.

The content script adds namespaced `data-gptlm-*` attributes and CSS overlays to mask titles visually. Settings, custom hosts, temporary show-all state, and hashed unlock keys are stored through browser storage or userscript storage.

## Project Layout

- `src/core/`: shared adapter, settings, hashing, and masking engine logic.
- `entrypoints/`: WXT extension entry points for content script, background script, and popup UI.
- `src/extension/`: Chrome storage bridge.
- `src/userscript/`: Tampermonkey entry point and in-page controls.
- `tests/`: Vitest coverage for hashing, settings, adapters, and engine behavior.
- `scripts/`: icon generation and Playwright smoke checks.
- `PRIVACY.md`, `PERMISSIONS.md`, `STORE_LISTING.md`: Chrome Web Store support material.
- `PLAN.md`, `PRD_LOOP.md`, `COMPLETION_AUDIT.md`: implementation plan, loop tracking, and completion evidence.

## Quick Start

```bash
npm install
npm run generate:icons
npm run lint
npm run test
npm run build
```

Useful development commands:

```bash
npm run dev
npm run typecheck
npm run test:smoke
npm run build:extension
npm run build:userscript
```

## Build Artifacts

- Extension zip: `.output/*-chrome.zip`
- Unpacked extension: `.output/chrome-mv3/`
- Userscript: `dist/userscript/gpt-list-mask.user.js`

Build artifacts are generated locally and ignored by git.

## Manual Acceptance

1. Run `npm run build:extension`.
2. Open `chrome://extensions`, enable Developer Mode, and load `.output/chrome-mv3` as an unpacked extension.
3. Visit ChatGPT, Claude, and Qwen.
4. Confirm the current conversation title remains visible while non-current titles are masked.
5. Hover or focus a masked title and confirm it reveals briefly.
6. Triple-click a masked title and confirm it stays visible after refresh.
7. Open the popup, disable and re-enable the current site, use `Show All 10m`, reset unlocks, and switch mask styles.
8. For a custom chatbot site, enable it from the popup and confirm the optional single-origin permission request appears.
9. Run `npm run build:userscript`, install `dist/userscript/gpt-list-mask.user.js` in Tampermonkey, and repeat the known-site checks.

## License

MIT
