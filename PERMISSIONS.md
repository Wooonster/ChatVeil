# Permission Justification

## `storage`

Stores local settings, custom host choices, temporary show-all timestamps, and hashed unlock keys.

## `activeTab`

Lets the popup inspect and refresh the currently active tab after the user opens the extension UI.

## `scripting`

Injects the content script into a user-authorized custom chatbot site after optional host permission is granted.

## Static Host Permissions

- ChatGPT, Claude, Qwen
- Z.ai
- Xiaomi XiaoAI, MiMo, and HyperOS AI web surfaces
- MiniMax and Hailuo
- DeepSeek, Kimi, Doubao, Tencent Yuanbao, ChatGLM, Tongyi, ERNIE/Yiyan
- Gemini, Copilot, Perplexity, Poe, Mistral, Grok

These are required for automatic masking on known chatbot sites without asking for broad all-sites access.

## Optional Host Permissions

- `https://*/*`
- `http://*/*`

These are not granted by default. They are used only when the user enables the current unknown chatbot site from the popup, and the request is made for that specific origin.
