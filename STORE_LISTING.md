# Chrome Web Store Listing Draft

## Name

ChatVeil

## Short Description

Mask chatbot conversation titles by default and reveal them only when needed.

## Detailed Description

ChatVeil protects privacy in chatbot sidebars by hiding non-current conversation titles. The current conversation remains visible. Other titles use a dynamic dissolve mask by default: dense particles lightly move while idle, scatter on hover or keyboard focus, and gather back when the title is masked again. Users can also choose Constellation, Ripple, or Ember dynamic masks, or switch to static skeleton, character, and blur modes. Titles can be permanently unlocked per title from supported chat menus or with a triple-click.

Supported known sites include ChatGPT, Claude, Qwen, MiniMax/Hailuo, DeepSeek, Kimi, Doubao, Tencent Yuanbao, Tongyi, ERNIE/Yiyan, Gemini, Copilot, Perplexity, Poe, Mistral, and Grok. Other chatbot sites can be enabled from the popup with a single-site optional permission request.

Privacy commitments:

- No network calls.
- No telemetry.
- No remote code.
- No title uploads.
- Raw titles are not stored.
- Dynamic mask effects use temporary on-page SVG particles, not canvas or remote assets.

## Permission Summary

ChatVeil uses storage for local settings, activeTab and scripting to refresh the current page after popup changes, and narrow static host permissions for supported chatbot domains. Optional host access is requested only for a user-enabled custom site.
