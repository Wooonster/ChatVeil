# Completion Audit

Objective: read `PLAN.md` and implement GPT List Mask until the extension and userscript plugin are deployable.

## Checklist

| Requirement | Evidence |
| --- | --- |
| WXT TypeScript MV3 extension scaffold | `package.json`, `wxt.config.ts`, `entrypoints/content.ts`, `entrypoints/background.ts`, `.output/chrome-mv3/manifest.json` |
| Separate userscript bundle sharing the same core | `vite.userscript.config.ts`, `src/userscript/main.ts`, `dist/userscript/gpt-list-mask.user.js` |
| DOM-safe engine that does not rewrite title text | `src/core/engine.ts` uses `data-gptlm-*` markers and CSS states; tests assert source title text is preserved |
| Default skeleton mask plus character and blur modes | `src/core/constants.ts`, `src/core/engine.ts`, `entrypoints/popup/index.html` |
| Current conversation visible, non-current masked | `src/core/engine.ts`, `tests/engine.test.ts` |
| Hover/focus reveal only while pointer or focus is on the row, masking immediately on leave/blur | `src/core/engine.ts`, `tests/engine.test.ts`, `scripts/smoke-playwright.mjs` |
| Triple-click per-title unlock | `src/core/engine.ts`, `tests/engine.test.ts` |
| Popup controls for enable/disable, show all, reset unlocks, style, custom sites | `entrypoints/popup/index.html`, `entrypoints/popup/main.ts` |
| Static host permissions only for known chatbot domains | `wxt.config.ts`, `.output/chrome-mv3/manifest.json` |
| Optional per-site custom chatbot support | `wxt.config.ts`, `entrypoints/popup/main.ts`, `entrypoints/background.ts`, `src/core/adapters.ts` |
| No network calls, telemetry, remote code, or title uploads | No fetch/XHR usage in `src` or `entrypoints`; privacy policy documents local-only behavior |
| Adapter interface and `HistoryItem` shape | `src/core/types.ts` |
| ChatGPT, Claude, Qwen, additional known chatbot hosts, and generic adapters | `src/core/constants.ts`, `src/core/adapters.ts`, `tests/adapters.test.ts`, `tests/settings.test.ts` |
| Local storage and optional sync for preferences/custom hosts/hashed unlocks | `src/extension/storage.ts`, `src/core/settings.ts`, `entrypoints/popup/main.ts` |
| Userscript GM APIs and in-page panel | `src/userscript/main.ts`, `vite.userscript.config.ts` |
| Store-ready docs and icons | `README.md`, `PRIVACY.md`, `PERMISSIONS.md`, `STORE_LISTING.md`, `public/icons/*` |
| Browser smoke checks for visual masking behavior | `scripts/smoke-playwright.mjs`, `npm run test:smoke` |
| Ralph-loop PRD tracking | `PRD_LOOP.md` |

## Verification

- `npm run lint`: passed.
- `npm run test`: passed, 4 files and 10 tests.
- `npm run typecheck`: passed.
- `npm run test:smoke`: passed, browser-level masking/current/hover/character-mode smoke.
- `npm run build`: passed.
- Extension artifact: `.output/gpt-list-mask-0.1.0-chrome.zip`.
- Unpacked extension: `.output/chrome-mv3/`.
- Userscript artifact: `dist/userscript/gpt-list-mask.user.js`.

## Manual Boundary

Chrome Web Store account submission and live manual checks on ChatGPT, Claude, Qwen, and a custom chatbot site remain outside automated verification. The repository includes the manual acceptance checklist in `README.md`.
