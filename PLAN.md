# ChatVeil Plan

## English

### Summary

Build a store-ready privacy tool that masks non-current chatbot conversation titles by default, with dynamic dissolve reveal, per-title triple-click unlock, popup global controls, and a Tampermonkey userscript build sharing the same masking core.

Initial first-class adapters: ChatGPT on `chatgpt.com`, Claude on `claude.ai`, and Qwen on `qwen.ai` / `chat.qwen.ai`. Other chatbot sites are supported through optional per-site permission plus a conservative generic sidebar heuristic.

### Key Changes

- Scaffold a TypeScript project using WXT for the Manifest V3 Chrome extension and a separate userscript bundle that imports the same core masking engine.
- Implement a DOM-safe mask engine that never rewrites title text; it applies namespaced `data-*` markers and CSS/SVG overlays.
- Default mask style: dynamic dissolve particles with optional skeleton, custom-character, and blur modes in settings. The dissolve layer is ephemeral SVG, not canvas, and does not copy raw titles into storage or `data-*`.
- Long-list performance: dissolve uses a shared animation scheduler, pauses offscreen particle layers, and keeps full-priority motion for hover/focus transitions.
- Reveal behavior:
  - Current conversation title remains visible.
  - Non-current titles are masked by default.
  - Pointer hover/focus starts a dissolve reveal: particles scatter first, then the real title becomes visible.
  - Pointer leave/focus out starts a dissolve remask: particles gather back before the title returns to masked state.
  - Triple-click on a title permanently toggles that title visible for the current site.
  - Popup can enable/disable current site, show all temporarily, reset unlocked titles, choose mask style, and manage custom sites.
- Permission model:
  - Static host permissions only for known chatbot domains.
  - Unknown chatbot support uses optional single-site authorization from the popup, not default all-sites access.
  - No network calls, telemetry, remote code, or title uploads.

### Interfaces And Data

- Core adapter interface:
  - `matches(location): boolean`
  - `findHistoryItems(root): HistoryItem[]`
  - `isCurrent(item, location): boolean`
  - `getStableKey(item): string`
- `HistoryItem` contains the clickable/history row element, title text element, current-state metadata, and a stable key derived from URL or DOM identity.
- Storage uses `chrome.storage.local` by default; optional sync can copy preferences, host allowlist, and hashed unlock keys only.
- Userscript uses `GM_getValue` / `GM_setValue`, `GM_registerMenuCommand`, and a small in-page control panel instead of Chrome popup APIs.
- Chrome Web Store package includes icons, README, privacy policy, permission justifications, and store listing text.

### Test Plan

- Unit tests for adapter matching, current-conversation detection, stable key hashing, triple-click unlock logic, and storage migration.
- DOM fixture tests for ChatGPT, Claude, Qwen, and generic sidebar layouts using jsdom or Playwright static pages.
- Playwright smoke tests verify masked text is visually hidden, the default dissolve particle layer renders, hover reveal and remask transitions work, current conversation is unmasked, userscript style switching works, and custom-character mode renders cleanly.
- Build checks:
  - `npm run lint`
  - `npm run test`
  - `npm run build:extension`
  - `npm run build:userscript`
- Manual acceptance: load unpacked MV3 extension in Chrome, install generated userscript in Tampermonkey, and verify at least ChatGPT, Claude, Qwen, plus one manually authorized chatbot site.

### Assumptions And References

- The repo now contains the WXT extension, userscript bundle, shared core, tests, and store-support documents.
- Store-ready means Chrome Web Store compliance work is included, but actual developer-account submission is out of scope.
- Chrome MV3 constraints drive the design: content scripts, local packaged code, and narrow permissions.
- Current main target domains:
  - ChatGPT: `chatgpt.com`
  - Claude: `claude.ai`
  - Qwen: `qwen.ai` / `chat.qwen.ai`

---

## 中文

### 概要

开发一个可用于 Chrome Web Store 分发的隐私保护工具：开启后默认遮盖非当前 web chatbot 会话历史标题；鼠标或指针悬浮时通过动态 dissolve 粒子效果显示；单条标题可通过三击永久取消遮盖；popup 提供全局控制；同时输出一个共享同一套遮盖核心逻辑的 Tampermonkey 用户脚本版本。

首版内置重点适配 ChatGPT (`chatgpt.com`)、Claude (`claude.ai`) 和 Qwen (`qwen.ai` / `chat.qwen.ai`)。其他 chatbot 网站通过用户在 popup 中对当前站点单独授权，再配合保守的通用侧边栏识别逻辑支持。

### 关键改动

- 从零搭建 TypeScript 项目，用 WXT 构建 Manifest V3 Chrome 扩展，并额外生成一个独立的 userscript bundle。
- 实现 DOM 安全的遮盖引擎：不改写标题原文，只添加命名空间隔离的 `data-*` 标记和 CSS/SVG overlay。
- 默认遮盖样式使用动态 dissolve 粒子效果；设置中保留 skeleton / 隐藏条、自定义字符遮盖和模糊模式。Dissolve 使用短生命周期 SVG 粒子层，不使用 canvas，也不把原始标题复制到 storage 或 `data-*`。
- 长列表性能保护：dissolve 使用全局动画调度器，暂停视口外粒子层；hover/focus 的 reveal/remask 保持高优先级动效。
- 显示与解锁行为：
  - 当前会话标题保持可见。
  - 非当前会话标题默认遮盖。
  - 鼠标悬浮或键盘 focus 时，粒子先散开，随后真实标题显示。
  - 鼠标移走或 focus 结束时，粒子从散开方向收回，再恢复遮盖。
  - 三击某条标题后，该标题在当前站点永久显示；再次操作可恢复遮盖。
  - popup 支持启用/停用当前站点、临时显示全部、重置已解锁标题、选择遮盖样式、管理自定义站点。
- 权限模型：
  - 仅对已知 chatbot 域名声明静态 host permissions。
  - 未知 chatbot 站点通过 popup 对当前单站点可选授权，不默认申请全站权限。
  - 不做网络请求、不做 telemetry、不加载远程代码、不上传标题。

### 接口与数据

- 核心 adapter 接口：
  - `matches(location): boolean`
  - `findHistoryItems(root): HistoryItem[]`
  - `isCurrent(item, location): boolean`
  - `getStableKey(item): string`
- `HistoryItem` 包含历史记录行元素、标题文本元素、当前会话状态信息，以及从 URL 或 DOM 身份派生出的稳定 key。
- 默认使用 `chrome.storage.local` 保存设置；可选同步模式只同步偏好、站点 allowlist 和 hash 后的解锁 key。
- userscript 版本使用 `GM_getValue` / `GM_setValue`、`GM_registerMenuCommand` 和一个轻量页面内控制面板替代 Chrome popup API。
- Chrome Web Store 交付包包含图标、README、隐私政策、权限说明和商店 listing 文案。

### 测试计划

- 单元测试覆盖 adapter 匹配、当前会话识别、稳定 key hash、三击解锁逻辑、storage migration。
- 使用 jsdom 或 Playwright 静态页面 fixture 测试 ChatGPT、Claude、Qwen 和通用侧边栏布局。
- Playwright 冒烟测试验证标题视觉上确实被隐藏、默认 dissolve 粒子层渲染、悬浮显示与回遮过渡、当前会话不被遮盖、userscript 样式切换、自定义字符模式渲染正常。
- 构建检查：
  - `npm run lint`
  - `npm run test`
  - `npm run build:extension`
  - `npm run build:userscript`
- 手动验收：在 Chrome 中加载 unpacked MV3 扩展，在 Tampermonkey 中安装生成的 userscript，并至少验证 ChatGPT、Claude、Qwen，以及一个手动授权的其他 chatbot 站点。

### 假设与参考

- 当前 repo 已包含 WXT 扩展、userscript bundle、共享 core、测试和商店分发辅助文档。
- “商店就绪”包含 Chrome Web Store 合规材料准备，但不包含实际开发者账号提交。
- 设计受 Chrome MV3 约束：content scripts、本地打包代码、窄权限模型。
- 当前主要目标域名：
  - ChatGPT: `chatgpt.com`
  - Claude: `claude.ai`
  - Qwen: `qwen.ai` / `chat.qwen.ai`
