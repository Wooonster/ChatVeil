# Chrome Web Store Listing Draft

## Name

ChatVeil

## Short Description

Mask chatbot conversation titles by default and reveal them only when needed.

## Detailed Description

ChatVeil protects privacy in chatbot sidebars by hiding non-current conversation titles. The current conversation remains visible. Other titles are masked with a soft skeleton bar by default, reveal while hovered or keyboard-focused, and can be permanently unlocked per title from supported chat menus or with a triple-click.

Supported known sites include ChatGPT, Claude, Qwen, MiniMax/Hailuo, DeepSeek, Kimi, Doubao, Tencent Yuanbao, Tongyi, ERNIE/Yiyan, Gemini, Copilot, Perplexity, Poe, Mistral, and Grok. Other chatbot sites can be enabled from the popup with a single-site optional permission request.

Privacy commitments:

- No network calls.
- No telemetry.
- No remote code.
- No title uploads.
- Raw titles are not stored.

## Permission Summary

ChatVeil uses storage for local settings, activeTab and scripting to refresh the current page after popup changes, and narrow static host permissions for supported chatbot domains. Optional host access is requested only for a user-enabled custom site.
