# Privacy Policy

ChatVeil is local-only privacy software.

## Data Collection

The extension and userscript do not collect, transmit, sell, share, or remotely process personal data.

## Local Storage

Settings are stored locally in the browser:

- Enabled or disabled site preferences.
- Optional custom host allowlist entries.
- Mask style and custom mask character.
- Hashed unlock keys for titles the user triple-clicked.

Raw conversation titles are not stored. The extension derives stable keys from page links or DOM identity and stores only hashed unlock keys. Dynamic mask styles render temporary SVG particles on the page; they do not upload titles or copy raw titles into persistent storage, `data-*` attributes, canvas buffers, or generated assets.

## Network

ChatVeil makes no network requests and loads no remote code.

## Permissions

Static host permissions are limited to supported chatbot domains. Optional custom-site permissions are requested only when the user enables masking for the current unknown site in the popup.
