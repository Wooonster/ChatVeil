# ChatVeil Ralph Loop

This file tracks small implementation PRDs derived from `PLAN.md`. A PRD is marked done only after its files exist and the relevant verification passes.

## PRD-1 Project Scaffold And Shared Core

Status: Done

Deliverables:

- TypeScript project scaffold with WXT extension build and Vite userscript build.
- Shared masking core under `src/core`.
- No text rewriting; masking uses `data-chatveil-*` attributes and CSS.

Evidence:

- `package.json`, `tsconfig.json`, `wxt.config.ts`, `vite.userscript.config.ts`
- `src/core/engine.ts`, `src/core/adapters.ts`, `src/core/settings.ts`, `src/core/hash.ts`

## PRD-2 Site Adapters And Permission Model

Status: Done

Deliverables:

- First-class ChatGPT, Claude, and Qwen adapters.
- Conservative generic sidebar adapter.
- Static host permissions for known chatbot domains.
- Optional single-origin custom site flow through popup.

Evidence:

- `src/core/adapters.ts`
- `wxt.config.ts`
- `entrypoints/background.ts`
- `entrypoints/popup/main.ts`
- `src/extension/storage.ts`

## PRD-3 Extension UX

Status: Done

Deliverables:

- Content script starts the engine on supported sites.
- Popup can enable or disable current site, show all temporarily, reset unlocks, choose mask style, and manage custom sites.
- Popup can enable or disable Chrome sync for settings, custom hosts, and hashed unlock keys.

Evidence:

- `entrypoints/content.ts`
- `entrypoints/popup/index.html`
- `entrypoints/popup/main.ts`
- `entrypoints/popup/style.css`
- `src/extension/storage.ts`

## PRD-4 Userscript Build

Status: Done

Deliverables:

- Tampermonkey userscript with the same shared masking core.
- Uses `GM_getValue`, `GM_setValue`, `GM_registerMenuCommand`.
- Includes lightweight in-page control panel.

Evidence:

- `src/userscript/main.ts`
- `vite.userscript.config.ts`

## PRD-5 Store-Ready Materials

Status: Done

Deliverables:

- README with development, artifacts, and manual acceptance.
- Privacy policy.
- Permission justification.
- Store listing draft.
- Icons generated into `public/icons`.

Evidence:

- `README.md`
- `PRIVACY.md`
- `PERMISSIONS.md`
- `STORE_LISTING.md`
- `scripts/generate-icons.mjs`

## PRD-6 Verification Gates

Status: Done

Deliverables:

- `npm run lint`
- `npm run test`
- `npm run build:extension`
- `npm run build:userscript`
- Final completion audit mapping `PLAN.md` requirements to artifacts and command output.

Evidence:

- `npm run lint`: passed.
- `npm run test`: passed, 4 test files and 10 tests.
- `npm run typecheck`: passed.
- `npm run test:smoke`: passed, browser-level masking, current-title, hover reveal, and character-mode smoke.
- `npm run build:extension`: passed, produced `.output/chrome-mv3/` and `.output/chatveil-0.1.0-chrome.zip`.
- `npm run build:userscript`: passed, produced `dist/userscript/chatveil.user.js`.
- Packaged MV3 manifest inspected at `.output/chrome-mv3/manifest.json`.
