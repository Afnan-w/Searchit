# Searchit - Chrome Extension

A Chrome Extension (Manifest V3) that searches **Rokomari** and shows product results directly in the popup.

## Features

- **Inline product results**: See product cards (image, title, price, link) right in the popup
- **Bilingual support**: English and Bengali (বাংলা) queries
- **Modern UI**: Dark/light mode, clean card layout, responsive design
- **Recent searches**: Last 8 queries saved for quick re-search
- **Rokomari affiliate links**: Every product link includes your Rokomari affiliate referral tags

> **Not on the Chrome Web Store.** See [Download & Install Locally](#download--install-locally-step-by-step) below to get it running in your browser.

## Download & Install Locally (Step-by-Step)

> **Searchit is not on the Chrome Web Store.** Follow these steps to install it manually — it takes less than 2 minutes.

### Step 1 — Download the Code

**Option A: Download as ZIP (easiest)**

1. Go to the repository: [https://github.com/Afnan-w/Searchit](https://github.com/Afnan-w/Searchit)
2. Click the green **Code** button
3. Click **Download ZIP**
4. Find the downloaded file (`Searchit-main.zip`) in your Downloads folder
5. **Right-click** the ZIP file and click **Extract All** (Windows) or **Double-click** to unzip (Mac)
6. You will get a folder called `Searchit-main` — open it and you should see `manifest.json` inside. **Remember this folder's location.**

**Option B: Using Git (if you have Git installed)**

Open a terminal/command prompt and run:
```
git clone https://github.com/Afnan-w/Searchit.git
```

### Step 2 — Load It in Chrome

1. Open **Google Chrome**
2. In the address bar, type `chrome://extensions/` and press **Enter**
3. Turn on **Developer mode** — toggle the switch in the **top-right corner**

   ![Developer mode location](https://developer.chrome.com/static/docs/extensions/get-started/image/developer-mode-toggle-8e4cb3db09141.png)

4. Click the **Load unpacked** button (top-left)
5. In the file picker, select the **Searchit-main** folder (the one that contains `manifest.json`)
6. Click **Select Folder** / **Open**

### Step 3 — Pin the Extension

1. The Searchit icon now appears in your extensions list
2. Click the **puzzle piece icon** 🧩 in Chrome's top-right toolbar
3. Find **Searchit** and click the **pin icon** next to it
4. The Searchit icon is now always visible in your toolbar

### Step 4 — Use It!

1. Click the **Searchit** icon in your toolbar
2. Type a product name (in English or Bengali)
3. Press **Enter** or click **Search**
4. See results from Rokomari directly in the popup

---

### Troubleshooting

| Problem | Fix |
|---------|-----|
| "Load unpacked" button is greyed out | Turn on **Developer mode** (top-right toggle) |
| Extension doesn't show up after loading | Make sure you selected the folder that contains `manifest.json`, not its parent |
| Search doesn't return results | Check your internet connection — Searchit needs to fetch live data from Rokomari |
| Extension icon is missing | Make sure the `icons/` folder with `icon16.png`, `icon48.png`, and `icon128.png` is inside the loaded folder |
| Extension stopped working after update | Go to `chrome://extensions/` and click the **refresh button** 🔄 on the Searchit card |

> **Note:** This extension will stay installed as long as Developer mode is turned on. If you turn it off, the extension will be disabled until you turn it back on.

## How It Works

| Site | Method | Notes |
|------|--------|-------|
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
| `rokomari.com` | Fetch Rokomari search pages |

## Replacing Icons

The included icons are indigo-to-purple rounded squares with a white **"S"**. To replace:

1. Create PNG files at 16x16, 48x48, and 128x128 pixels
2. Save them as `icon16.png`, `icon48.png`, `icon128.png` in the `icons/` folder
3. Reload the extension at `chrome://extensions/`

## License

**Free to use. No modification. No monetization.**

You are free to download and use Searchit for personal or commercial purposes at no cost. You may NOT modify the code, reverse engineer it, or use it to make money (selling, reselling, embedding in paid products, etc.). See [LICENSE](LICENSE) for full terms and [EULA.txt](EULA.txt) for the end-user agreement.

Copyright (c) 2026 Afnan ([@Afnan-w](https://github.com/Afnan-w)). All intellectual property rights reserved.
