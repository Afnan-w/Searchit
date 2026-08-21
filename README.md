# Searchit - Chrome Extension

A Chrome Extension (Manifest V3) that searches **Bikroy** and **Rokomari** and shows product results directly in the popup.

## Features

- **Inline product results**: See product cards (image, title, price, link) right in the popup
- **Dual-site search**: Searches Bikroy and Rokomari simultaneously
- **Bilingual support**: English and Bengali (বাংলা) queries
- **Modern UI**: Dark/light mode, clean card layout, responsive design
- **Recent searches**: Last 8 queries saved for quick re-search
- **Open Both**: Opens both search result pages in new tabs

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `project101` folder (containing `manifest.json`)
5. The Searchit icon appears in your toolbar

## Usage

1. Click the Searchit icon in the toolbar
2. Type a product name (English or Bengali)
3. Press **Enter** or click **Search**
4. Product results from both sites appear as cards in the popup
5. Click any product to open it on the source site
6. Click "Open full search" to see all results on the site

## How It Works

| Site | Method | Notes |
|------|--------|-------|
| **Bikroy** | Server-side rendered HTML (Nuxt.js) | Extracts listing cards via `fetch()` + `DOMParser` |
| **Rokomari** | Server-side rendered HTML (Next.js) | Extracts product cards via `fetch()` + `DOMParser` |

When inline extraction isn't possible, the extension shows a "View all results" button that links directly to the search page.

## Project Structure

```
project101/
├── manifest.json       # Manifest V3 config
├── popup.html          # Popup UI
├── popup.css           # Styles (dark/light themes)
├── popup.js            # Search logic + product extraction
├── background.js       # Service worker
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Interact with current tab |
| `tabs` | Open search pages in new tabs |
| `storage` | Save recent searches and theme preference |
| `bikroy.com` | Fetch Bikroy search pages |
| `rokomari.com` | Fetch Rokomari search pages |

## Replacing Icons

The included icons are indigo-to-purple rounded squares with a white **"S"**. To replace:

1. Create PNG files at 16x16, 48x48, and 128x128 pixels
2. Save them as `icon16.png`, `icon48.png`, `icon128.png` in the `icons/` folder
3. Reload the extension at `chrome://extensions/`

## License

**Proprietary — All Rights Reserved.**

This project is **not open source**. The source code is made viewable for reference only. See [LICENSE](LICENSE) for full terms.

If you distribute Searchit to end users, you must include the accompanying [EULA.txt](EULA.txt), which grants users a license to run the software only — no source-code access, modification, or resale.

Copyright (c) 2026 Afnan ([@Afnan-w](https://github.com/Afnan-w)). No use, copying, modification, or distribution is permitted without prior written permission from the owner.
