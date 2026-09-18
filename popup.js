/**
 * Searchit - Popup Script
 * Searches Bikroy and Rokomari, extracts product results inline.
 *
 * Extraction strategy:
 * - Bikroy: parses the embedded Nuxt payload (`__NUXT_DATA__`) first because it
 *   is schema-stable; falls back to the stable `.qa-*` CSS hooks.
 * - Rokomari: Next.js App Router streams its payload as RSC flight chunks
 *   (`self.__next_f`), which are not reliably parseable, so extraction uses
 *   hashed-class substrings (`[class*="productGridItem"]`, ...) which have
 *   proven stable across rebuilds.
 */

(function () {
  'use strict';

  // ============================================
  // Constants
  // ============================================
  const BIKROY_BASE_URL = 'https://bikroy.com';
  const ROKOMARI_BASE_URL = 'https://www.rokomari.com';
  const DARAZ_BASE_URL = 'https://www.daraz.com.bd';
  const BIKROY_SEARCH_URL = BIKROY_BASE_URL + '/search?query=';
  const ROKOMARI_SEARCH_URL = ROKOMARI_BASE_URL + '/search?term=';
  const DARAZ_SEARCH_URL = DARAZ_BASE_URL + '/catalog/?q=';
  const ROKOMARI_AFF_PARAMS = 'affId=I7oR67409R00i0R&affs=73726&cma=604800';
  const MAX_RECENT = 8;
  const MAX_PRODUCTS = 6;
  const MAX_OFFERS = 5;
  const FETCH_TIMEOUT_MS = 8000;
  const CACHE_KEY = 'searchCache';
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const CACHE_MAX_ENTRIES = 20;
  const STORAGE_KEY = 'recentSearches';
  const THEME_KEY = 'theme';

  // ============================================
  // DOM Elements
  // ============================================
  const $ = (sel) => document.querySelector(sel);
  const searchInput = $('#search-input');
  const searchBtn = $('#search-btn');
  const openBothBtn = $('#open-both-btn');
  const clearBtn = $('#clear-btn');
  const themeToggle = $('#theme-toggle');
  const recentSection = $('#recent-section');
  const recentList = $('#recent-list');
  const clearRecentBtn = $('#clear-recent-btn');
  const loadingEl = $('#loading');
  const errorEl = $('#error');
  const errorMessage = $('#error-message');
  const emptyState = $('#empty-state');
  const resultsEl = $('#results');
  const cacheIndicator = $('#cache-indicator');
  const rokomariLink = $('#rokomari-link');
  const rokomariProducts = $('#rokomari-products');
  const bikroyLink = $('#bikroy-link');
  const bikroyProducts = $('#bikroy-products');
  const darazLink = $('#daraz-link');
  const darazProducts = $('#daraz-products');
  const offersContent = $('#offers-content');

  // ============================================
  // Theme Management
  // ============================================
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function getPreferredTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function loadTheme() {
    chrome.storage.local.get([THEME_KEY], (result) => {
      applyTheme(result[THEME_KEY] || getPreferredTheme());
    });
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ [THEME_KEY]: next });
  }

  // ============================================
  // Recent Searches
  // ============================================
  function loadRecentSearches() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve(result[STORAGE_KEY] || []);
      });
    });
  }

  async function addRecentSearch(query) {
    if (!query.trim()) return;
    let recent = await loadRecentSearches();
    recent = recent.filter((q) => q.toLowerCase() !== query.toLowerCase());
    recent.unshift(query);
    recent = recent.slice(0, MAX_RECENT);
    chrome.storage.local.set({ [STORAGE_KEY]: recent });
    renderRecentSearches(recent);
  }

  async function clearRecentSearches() {
    chrome.storage.local.remove([STORAGE_KEY]);
    renderRecentSearches([]);
  }

  function renderRecentSearches(searches) {
    if (!searches.length) {
      recentSection.classList.add('hidden');
      return;
    }
    recentSection.classList.remove('hidden');
    recentList.innerHTML = searches
      .map(
        (q) =>
          `<button class="recent-chip" data-query="${escapeHtml(q)}" title="${escapeHtml(q)}">${escapeHtml(q)}</button>`
      )
      .join('');
  }

  // ============================================
  // Pure helpers (testable - no browser APIs)
  // ============================================

  /**
   * Escape a value for safe interpolation into HTML text and into
   * double/single-quoted attributes.
   */
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildSearchUrl(base, query) {
    return base + encodeURIComponent(query);
  }

  /**
   * Extract a discount percentage from arbitrary badge text.
   * Handles "-25%", "25%", "25", "Save 25%" etc.; returns 0 when absent.
   */
  function normalizeDiscount(text) {
    if (text == null) return 0;
    const match = String(text).match(/\d+(?:\.\d+)?/);
    if (!match) return 0;
    const pct = parseFloat(match[0]);
    return Number.isFinite(pct) ? pct : 0;
  }

  /**
   * Extract and JSON-parse the Nuxt 3 devalue payload from `__NUXT_DATA__`.
   * Returns the resolved value tree, or null when absent/corrupt.
   */
  function parseNuxtPayload(html) {
    const marker = 'id="__NUXT_DATA__"';
    const start = html.indexOf(marker);
    if (start === -1) return null;
    const open = html.indexOf('>', start);
    const close = html.indexOf('</script>', open);
    if (open === -1 || close === -1) return null;
    let flat;
    try {
      flat = JSON.parse(html.slice(open + 1, close));
    } catch (err) {
      return null;
    }
    if (!Array.isArray(flat)) return null;

    const seen = new Map();
    function walk(index) {
      if (seen.has(index)) return seen.get(index);
      const value = flat[index];
      if (typeof value === 'number' || typeof value === 'string') return value;
      if (value === null || value === undefined) return value;
      if (Array.isArray(value)) {
        const tag = value[0];
        if (tag === 'Object' || tag === 'Pojo') {
          const obj = {};
          seen.set(index, obj);
          for (let i = 1; i < value.length; i += 2) {
            obj[value[i]] = walk(value[i + 1]);
          }
          return obj;
        }
        if (tag === 'Arr') {
          const out = [];
          seen.set(index, out);
          for (let i = 1; i < value.length; i++) out.push(walk(value[i]));
          return out;
        }
        if (tag === 'Map') {
          const map = new Map();
          seen.set(index, map);
          for (let i = 1; i < value.length; i += 2) map.set(walk(value[i]), walk(value[i + 1]));
          return map;
        }
        if (tag === 'Set') {
          const set = new Set();
          seen.set(index, set);
          for (let i = 1; i < value.length; i++) set.add(walk(value[i]));
          return set;
        }
        if (tag === 'Date') return new Date(value[1]);
        if (tag === 'null') return null;
        if (tag === 'undefined') return undefined;
        if (tag === 'NaN') return NaN;
        if (tag === 'Infinity') return Infinity;
        if (tag === '-Infinity') return -Infinity;
        if (tag === '+0') return 0;
        if (tag === '-0') return -0;
        if (tag === 'ShallowReactive' || tag === 'ShallowRef' || tag === 'Ref') {
          return walk(value[1]);
        }
        return value.map((entry) => (typeof entry === 'number' ? walk(entry) : entry));
      }
      const obj = {};
      seen.set(index, obj);
      for (const key of Object.keys(value)) obj[key] = walk(value[key]);
      return obj;
    }
    return walk(0);
  }

  /**
   * Locate the adverts array inside a resolved Nuxt payload without relying
   * on the route key (which differs between categories and searches).
   */
  function findBikroyAdverts(payload) {
    const pages = payload && payload.data;
    if (!pages || typeof pages !== 'object') return null;
    for (const key of Object.keys(pages)) {
      const page = pages[key];
      const adverts =
        page &&
        page.listing &&
        page.listing.adverts_list &&
        page.listing.adverts_list.adverts;
      if (Array.isArray(adverts) && adverts.length > 0) return adverts;
    }
    return null;
  }

  /**
   * Map one Bikroy advert record to the product shape used by the UI.
   * Returns null when required fields (title, link) are missing.
   */
  function mapBikroyAdvert(advert) {
    if (!advert || typeof advert !== 'object') return null;
    const title = String(advert.title || '').trim().substring(0, 120);
    const link = typeof advert.url === 'string' ? advert.url : '';
    if (!title || !link) return null;
    const image =
      (advert.image_obj && typeof advert.image_obj.url === 'string' && advert.image_obj.url) ||
      (Array.isArray(advert.images) && advert.images[0] && advert.images[0].url) ||
      '';
    return {
      title,
      price:
        (advert.price_obj && advert.price_obj.view) ||
        (typeof advert.price_title === 'string' ? advert.price_title : ''),
      image,
      link: link.startsWith('/') ? BIKROY_BASE_URL + link : link,
      location: typeof advert.region === 'string' ? advert.region : '',
      description: typeof advert.details === 'string' ? advert.details.trim() : '',
    };
  }

  /**
   * Extract Bikroy products from the embedded Nuxt payload.
   * Returns an array (possibly empty) when the payload parsed, or null when
   * the caller should fall back to CSS extraction.
   */
  function extractBikroyFromJson(html) {
    const payload = parseNuxtPayload(html);
    if (!payload) return null;
    const adverts = findBikroyAdverts(payload);
    if (!adverts) return null;
    const items = [];
    for (const advert of adverts) {
      if (items.length >= MAX_PRODUCTS) break;
      const mapped = mapBikroyAdvert(advert);
      if (mapped) items.push(mapped);
    }
    return items;
  }

  // ============================================
  // End pure helpers
  // ============================================

  // ============================================
  // Network
  // ============================================

  /**
   * Fetch a page as text with a hard timeout so the spinner can never hang.
   */
  async function fetchHtml(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  // ============================================
  // Product Extraction - Bikroy (JSON -> CSS fallback)
  // ============================================

  async function extractBikroyProducts(query) {
    const url = buildSearchUrl(BIKROY_SEARCH_URL, query);
    try {
      const html = await fetchHtml(url);
      const fromJson = extractBikroyFromJson(html);
      if (fromJson !== null) return fromJson;
      return extractBikroyFromCss(html);
    } catch (err) {
      console.warn('[Searchit] Bikroy extraction failed:', err.message);
      return null;
    }
  }

  /**
   * Fallback: scrape listing cards via the stable `.qa-*` test hooks.
   */
  function extractBikroyFromCss(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = [];
    const cards = doc.querySelectorAll('.b-list-advert-base.qa-advert-list-item');
    const limit = Math.min(cards.length, MAX_PRODUCTS);

    for (let i = 0; i < limit; i++) {
      const card = cards[i];

      const titleEl = card.querySelector('.qa-advert-title');
      if (!titleEl) continue;

      const link = card.getAttribute('href') || '';
      const fullLink = link.startsWith('/') ? BIKROY_BASE_URL + link : link;

      const priceEl = card.querySelector('.qa-advert-price');
      const price = priceEl ? priceEl.textContent.trim() : '';

      const imgEl = card.querySelector('picture img');
      let image = '';
      if (imgEl) {
        image = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
      }

      const locationEl = card.querySelector('.b-list-advert__region__text');
      const location = locationEl ? locationEl.textContent.trim() : '';

      const descEl = card.querySelector('.b-list-advert-base__description-text');
      const description = descEl ? descEl.textContent.trim() : '';

      items.push({
        title: titleEl.textContent.trim().substring(0, 120),
        price,
        image,
        link: fullLink,
        location,
        description,
      });
    }

    return items.length > 0 ? items : [];
  }

  // ============================================
  // Product Extraction - Rokomari (SSR HTML)
  // ============================================

  /**
   * Fetch Rokomari search page and extract product cards via hashed-class
   * substring selectors (see header note for why there is no JSON path).
   */
  async function extractRokomariProducts(query) {
    const url = buildSearchUrl(ROKOMARI_SEARCH_URL, query);
    try {
      const html = await fetchHtml(url);
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const items = [];
      const cards = doc.querySelectorAll('[class*="productGridItem"]');
      const limit = Math.min(cards.length, MAX_PRODUCTS);

      for (let i = 0; i < limit; i++) {
        const card = cards[i];

        // Title
        const titleEl = card.querySelector('[class*="productTitle"]');
        if (!titleEl) continue;

        // Link - the card itself is an <a> or contains one
        const linkEl =
          card.querySelector('a[class*="productDetailsBody"]') || card.querySelector('a[href]');
        const link = linkEl ? linkEl.getAttribute('href') : '';
        let fullLink = link.startsWith('/') ? ROKOMARI_BASE_URL + link : link;
        if (fullLink) {
          fullLink += (fullLink.includes('?') ? '&' : '?') + ROKOMARI_AFF_PARAMS;
        }

        // Price (current price <p>, not the strikethrough <del> inside productPricePart)
        const priceEl = card.querySelector('[class*="productPrice"]');
        const price = priceEl ? priceEl.textContent.trim() : '';

        // Original price (strikethrough)
        const origPriceEl = card.querySelector('[class*="productPricePart"] del');
        const origPrice = origPriceEl ? origPriceEl.textContent.trim() : '';

        // Image - use data-src for lazy-loaded images
        const imgEl = card.querySelector('[class*="bookImage"] img');
        let image = '';
        if (imgEl) {
          image = imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '';
          if (image.includes('placeholder')) image = '';
        }

        // Brand/author
        const brandEl = card.querySelector('[class*="productAuthor"]');
        const brand = brandEl ? brandEl.textContent.trim() : '';

        // Discount badge (bare percentage number, e.g. "12")
        const badgeEl = card.querySelector('[class*="commonBadages"] span');
        const discount = badgeEl ? badgeEl.textContent.trim() : '';

        items.push({
          title: titleEl.textContent.trim().substring(0, 120),
          price,
          origPrice,
          image,
          link: fullLink,
          brand,
          discount,
        });
      }

      return items;
    } catch (err) {
      console.warn('[Searchit] Rokomari extraction failed:', err.message);
      return null;
    }
  }

  // ============================================
  // Product Extraction - Daraz (HTML + embedded data)
  // ============================================

  /**
   * Fetch Daraz search page and extract product data.
   * Daraz is a React SPA (Alibaba/Lazada stack) so plain DOM selectors
   * on server-rendered HTML won't find product cards. Instead we look for
   * embedded JSON data in <script> tags that the SSR injector places,
   * then fall back to CSS selectors on whatever the server does send.
   */
  async function extractDarazProducts(query) {
    const url = buildSearchUrl(DARAZ_SEARCH_URL, query);
    try {
      const html = await fetchHtml(url);

      // --- Strategy 1: look for embedded product JSON in script tags ---
      const fromJson = extractDarazFromScripts(html);
      if (fromJson !== null && fromJson.length > 0) return fromJson;

      // --- Strategy 2: CSS selectors on server-rendered cards ---
      return extractDarazFromCss(html);
    } catch (err) {
      console.warn('[Searchit] Daraz extraction failed:', err.message);
      return null;
    }
  }

  /**
   * Daraz SSR injects product data inside <script> tags as JS variable
   * assignments or JSON blobs. We scan for common patterns:
   *   - window.__moduleData__ = {...}
   *   - window.pageData = {...}
   *   - "listItem" or "mods" keys containing product arrays
   */
  function extractDarazFromScripts(html) {
    // Patterns that Daraz uses to embed search result JSON
    const patterns = [
      /window\.__moduleData__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/,
      /window\.pageData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/,
      /"listItem"\s*:\s*(\[[\s\S]*?\])\s*[,}]/,
      /"mods"\s*:\s*(\{[\s\S]*?"listItems"[\s\S]*?\})\s*[,}]/
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match) continue;
      try {
        const data = JSON.parse(match[1]);
        const items = parseDarazProductData(data);
        if (items && items.length > 0) return items.slice(0, MAX_PRODUCTS);
      } catch (_) {
        // not valid JSON, try next pattern
      }
    }

    // Broader approach: find any large JSON blob with product-like structure
    const jsonBlobPattern = /(?:window\.\w+\s*=\s*|>)(\{[\s\S]{500,}?\})\s*(?:;<\/script>|<\/script>)/g;
    let blobMatch;
    while ((blobMatch = jsonBlobPattern.exec(html)) !== null) {
      try {
        const data = JSON.parse(blobMatch[1]);
        const items = parseDarazProductData(data);
        if (items && items.length > 0) return items.slice(0, MAX_PRODUCTS);
      } catch (_) {
        // skip
      }
    }

    return null;
  }

  /**
   * Recursively search a parsed JSON structure for arrays of product-like
   * objects (must have name/title + price + either imageUrl or itemUrl).
   */
  function parseDarazProductData(data, depth) {
    if (depth === undefined) depth = 0;
    if (depth > 6 || !data) return null;

    // Direct array of product objects
    if (Array.isArray(data)) {
      const products = data.filter(isDarazProduct).slice(0, MAX_PRODUCTS);
      if (products.length > 0) {
        return products.map(mapDarazProduct);
      }
    }

    // Object with a "listItems" key (common Daraz pattern)
    if (typeof data === 'object') {
      if (Array.isArray(data.listItems)) {
        const products = data.listItems.filter(isDarazProduct).slice(0, MAX_PRODUCTS);
        if (products.length > 0) return products.map(mapDarazProduct);
      }
      if (data.mods && Array.isArray(data.mods.listItems)) {
        const products = data.mods.listItems.filter(isDarazProduct).slice(0, MAX_PRODUCTS);
        if (products.length > 0) return products.map(mapDarazProduct);
      }
      // Recurse into values
      for (const key of Object.keys(data)) {
        const result = parseDarazProductData(data[key], depth + 1);
        if (result) return result;
      }
    }

    return null;
  }

  function isDarazProduct(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const hasName = typeof obj.name === 'string' || typeof obj.title === 'string';
    const hasPrice = obj.price !== undefined || obj.priceShow !== undefined || obj.originalPrice !== undefined;
    return hasName && hasPrice;
  }

  function mapDarazProduct(item) {
    const title = String(item.name || item.title || '').trim().substring(0, 120);

    // Price: Daraz may use price (number/string), priceShow, priceMin, etc.
    let price = '';
    if (typeof item.priceShow === 'string') price = item.priceShow;
    else if (item.price != null) price = '৳' + String(item.price);
    else if (item.priceMin != null) price = '৳' + String(item.priceMin);

    // Original / strikethrough price
    let origPrice = '';
    if (typeof item.originalPriceShow === 'string') origPrice = item.originalPriceShow;
    else if (item.originalPrice != null) origPrice = '৳' + String(item.originalPrice);

    // Discount
    let discount = '';
    if (item.discount) discount = String(item.discount);

    // Image: imageUrl, image, img, etc.
    const image = item.imageUrl || item.image || item.img || '';

    // Link
    let link = item.itemUrl || item.url || item.link || '';
    if (link && !link.startsWith('http')) link = DARAZ_BASE_URL + link;

    // Location / seller
    const brand = item.brandName || item.sellerName || item.location || '';

    return { title, price, origPrice, image, link, brand, discount };
  }

  /**
   * Fallback: try to find product cards via CSS selectors.
   * Daraz's server-rendered HTML is sparse, but some product elements
   * may be present with data attributes or specific class patterns.
   */
  function extractDarazFromCss(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = [];

    // Try common Daraz card selectors
    const selectors = [
      '[data-tracking="product-card"]',
      '.gridItem',
      '.edi-product',
      '[class*="product-card"]',
      '[class*="gridProduct"]'
    ];

    let cards = [];
    for (const sel of selectors) {
      cards = doc.querySelectorAll(sel);
      if (cards.length > 0) break;
    }

    const limit = Math.min(cards.length, MAX_PRODUCTS);
    for (let i = 0; i < limit; i++) {
      const card = cards[i];

      // Title
      const titleEl =
        card.querySelector('[class*="title"]') ||
        card.querySelector('[class*="name"]') ||
        card.querySelector('a[title]');
      if (!titleEl) continue;
      const title = (titleEl.getAttribute('title') || titleEl.textContent || '').trim().substring(0, 120);
      if (!title) continue;

      // Link
      const linkEl = card.querySelector('a[href]') || card.closest('a[href]');
      let link = linkEl ? linkEl.getAttribute('href') : '';
      if (link && !link.startsWith('http')) link = DARAZ_BASE_URL + link;

      // Price
      const priceEl =
        card.querySelector('[class*="price"]') ||
        card.querySelector('[class*="Price"]');
      const price = priceEl ? priceEl.textContent.trim() : '';

      // Original price
      const origPriceEl = card.querySelector('[class*="original"] del, [class*="origin"] s, del');
      const origPrice = origPriceEl ? origPriceEl.textContent.trim() : '';

      // Image
      const imgEl = card.querySelector('img[src]');
      const image = imgEl ? imgEl.getAttribute('src') : '';

      // Discount badge
      const badgeEl =
        card.querySelector('[class*="discount"]') ||
        card.querySelector('[class*="badge"]');
      const discount = badgeEl ? badgeEl.textContent.trim() : '';

      items.push({ title, price, origPrice, image, link, brand: '', discount });
    }

    return items.length > 0 ? items : [];
  }

  // ============================================
  // Result Caching (session-scoped)
  // ============================================

  async function readCachedSearch(query) {
    try {
      const result = await chrome.storage.session.get([CACHE_KEY]);
      const cache = result && result[CACHE_KEY];
      if (!cache || typeof cache !== 'object') return null;
      const entry = cache[query.toLowerCase()];
      if (!entry || typeof entry.ts !== 'number') return null;
      if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
      return entry;
    } catch (err) {
      return null; // storage.session unavailable or read failed
    }
  }

  async function writeCachedSearch(query, bikroyItems, rokomariItems, darazItems) {
    // Never cache partial failures - all sites must have extracted cleanly.
    if (!Array.isArray(bikroyItems) || !Array.isArray(rokomariItems) || !Array.isArray(darazItems)) return;
    try {
      const result = await chrome.storage.session.get([CACHE_KEY]);
      const cache = (result && result[CACHE_KEY]) || {};
      cache[query.toLowerCase()] = { bikroyItems, rokomariItems, darazItems, ts: Date.now() };
      const keys = Object.keys(cache);
      if (keys.length > CACHE_MAX_ENTRIES) {
        keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
        for (const key of keys.slice(0, keys.length - CACHE_MAX_ENTRIES)) delete cache[key];
      }
      await chrome.storage.session.set({ [CACHE_KEY]: cache });
    } catch (err) {
      /* caching is best-effort */
    }
  }

  function showCacheIndicator(show) {
    cacheIndicator.classList.toggle('hidden', !show);
  }

  // ============================================
  // UI State Management
  // ============================================
  function setState(state) {
    emptyState.classList.add('hidden');
    loadingEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    resultsEl.classList.add('hidden');

    switch (state) {
      case 'empty':
        emptyState.classList.remove('hidden');
        break;
      case 'loading':
        loadingEl.classList.remove('hidden');
        break;
      case 'error':
        errorEl.classList.remove('hidden');
        break;
      case 'results':
        resultsEl.classList.remove('hidden');
        break;
    }
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    setState('error');
  }

  function updateClearButton() {
    clearBtn.classList.toggle('visible', searchInput.value.length > 0);
  }

  // ============================================
  // Rendering
  // ============================================

  /**
   * Replace broken product images with the placeholder tile (CSP-safe,
   * no inline event handlers).
   */
  function attachImageFallbacks(container) {
    container.querySelectorAll('img.product-image').forEach((img) => {
      img.addEventListener(
        'error',
        () => {
          const ph = document.createElement('div');
          ph.className = 'product-no-image';
          ph.textContent = 'No img';
          img.replaceWith(ph);
        },
        { once: true }
      );
    });
  }

  /**
   * Render product list or fallback message into a container.
   * @param {HTMLElement} container
   * @param {Array|null} products - extracted products, or null if extraction failed
   * @param {string} siteName - "Bikroy" or "Rokomari"
   * @param {string} searchUrl - full search URL for fallback link
   */
  function renderProductList(container, products, siteName, searchUrl) {
    if (!products) {
      container.innerHTML = `
        <div class="product-fallback">
          <p class="product-fallback-msg">Could not load products inline.</p>
          <a href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener noreferrer" class="product-fallback-link">
            View all results on ${escapeHtml(siteName)} &rarr;
          </a>
        </div>`;
      return;
    }

    if (products.length === 0) {
      container.innerHTML = '<div class="product-no-results">No products found for this query.</div>';
      return;
    }

    container.innerHTML = products
      .map((p) => {
        const imageHtml = p.image
          ? `<img src="${escapeHtml(p.image)}" alt="" class="product-image" />`
          : '<div class="product-no-image">No img</div>';

        const brandHtml = p.brand
          ? `<div class="product-brand">${escapeHtml(p.brand)}</div>`
          : '';

        const locationHtml = p.location
          ? `<div class="product-brand">${escapeHtml(p.location)}</div>`
          : '';

        const priceHtml = p.price
          ? `<div class="product-price">${escapeHtml(p.price)}${
              p.origPrice
                ? `<span class="product-original-price">${escapeHtml(p.origPrice)}</span>`
                : ''
            }</div>`
          : '';

        return `
        <a href="${escapeHtml(p.link)}" target="_blank" rel="noopener noreferrer" class="product-item" title="${escapeHtml(p.title)}">
          ${imageHtml}
          <div class="product-info">
            <div class="product-title">${escapeHtml(p.title)}</div>
            ${brandHtml}
            ${locationHtml}
            ${priceHtml}
          </div>
        </a>`;
      })
      .join('');

    attachImageFallbacks(container);
  }

  // ============================================
  // Offers & Deals Rendering
  // ============================================

  /**
   * Render discounted products from Rokomari + Daraz + direct deals links.
   */
  function renderOffers(rokomariItems, darazItems, query) {
    const discounted = [];
    if (Array.isArray(rokomariItems)) {
      for (const item of rokomariItems) {
        const pct = normalizeDiscount(item.discount);
        if (pct > 0) discounted.push({ ...item, site: 'Rokomari', pct });
      }
    }
    if (Array.isArray(darazItems)) {
      for (const item of darazItems) {
        const pct = normalizeDiscount(item.discount);
        if (pct > 0) discounted.push({ ...item, site: 'Daraz', pct });
      }
    }

    discounted.sort((a, b) => b.pct - a.pct);
    const topOffers = discounted.slice(0, MAX_OFFERS);

    let html = '';

    if (topOffers.length > 0) {
      html += '<div class="offers-section-label">Discounted Products</div>';
      html += topOffers
        .map((item) => {
          const title = escapeHtml(item.title);
          const priceHtml = item.price
            ? `<span class="offer-sale-price">${escapeHtml(item.price)}</span>`
            : '';
          const origHtml = item.origPrice
            ? `<span class="offer-original-price">${escapeHtml(item.origPrice)}</span>`
            : '';
          const siteClass = item.site.toLowerCase();

          return `
          <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="offer-item" title="${title}">
            <span class="offer-badge">-${item.pct}%</span>
            <div class="offer-info">
              <div class="offer-title">${title}</div>
              <div class="offer-price-row">
                ${priceHtml}
                ${origHtml}
              </div>
            </div>
            <span class="offer-site-tag ${siteClass}">${escapeHtml(item.site)}</span>
          </a>`;
        })
        .join('');
    }

    html += `
      <div class="offers-link-section">
        <div class="offers-link-row">
          <a href="${escapeHtml(buildSearchUrl(BIKROY_SEARCH_URL, query))}" target="_blank" rel="noopener noreferrer" class="offers-link bikroy-link">
            Bikroy Deals
          </a>
          <a href="${escapeHtml(buildSearchUrl(ROKOMARI_SEARCH_URL, query))}" target="_blank" rel="noopener noreferrer" class="offers-link rokomari-link">
            Rokomari Offers
          </a>
          <a href="${escapeHtml(buildSearchUrl(DARAZ_SEARCH_URL, query))}" target="_blank" rel="noopener noreferrer" class="offers-link daraz-link">
            Daraz Deals
          </a>
        </div>
      </div>`;

    if (topOffers.length === 0) {
      html = `
        <div class="offers-empty">No discounted products found for this search.</div>
        ${html}`;
    }

    offersContent.innerHTML = html;
  }

  // ============================================
  // Core Search Logic
  // ============================================
  let searchSeq = 0;

  async function performSearch(query) {
    query = (query || '').trim();
    if (!query) {
      setState('empty');
      return;
    }
    const seq = ++searchSeq;

    const bikroyUrl = buildSearchUrl(BIKROY_SEARCH_URL, query);
    const rokomariUrl = buildSearchUrl(ROKOMARI_SEARCH_URL, query);
    const darazUrl = buildSearchUrl(DARAZ_SEARCH_URL, query);

    bikroyLink.href = bikroyUrl;
    rokomariLink.href = rokomariUrl;
    darazLink.href = darazUrl;

    addRecentSearch(query);

    const cached = await readCachedSearch(query);
    if (seq !== searchSeq) return; // superseded by a newer search

    if (cached) {
      renderProductList(bikroyProducts, cached.bikroyItems, 'Bikroy', bikroyUrl);
      renderProductList(rokomariProducts, cached.rokomariItems, 'Rokomari', rokomariUrl);
      renderProductList(darazProducts, cached.darazItems, 'Daraz', darazUrl);
      renderOffers(cached.rokomariItems, cached.darazItems, query);
      showCacheIndicator(true);
      setState('results');
      return;
    }
    showCacheIndicator(false);

    setState('loading');

    const [bikroyItems, rokomariItems, darazItems] = await Promise.all([
      extractBikroyProducts(query),
      extractRokomariProducts(query),
      extractDarazProducts(query),
    ]);
    if (seq !== searchSeq) return; // superseded by a newer search

    writeCachedSearch(query, bikroyItems, rokomariItems, darazItems);
    renderProductList(bikroyProducts, bikroyItems, 'Bikroy', bikroyUrl);
    renderProductList(rokomariProducts, rokomariItems, 'Rokomari', rokomariUrl);
    renderProductList(darazProducts, darazItems, 'Daraz', darazUrl);
    renderOffers(rokomariItems, darazItems, query);
    setState('results');
  }

  // ============================================
  // Open Both Sites
  // ============================================
  function openAllSites(query) {
    query = (query || searchInput.value).trim();
    if (!query) {
      showError('Please enter a search term first.');
      return;
    }
    addRecentSearch(query);
    chrome.tabs.create({ url: buildSearchUrl(BIKROY_SEARCH_URL, query) });
    chrome.tabs.create({ url: buildSearchUrl(ROKOMARI_SEARCH_URL, query) });
    chrome.tabs.create({ url: buildSearchUrl(DARAZ_SEARCH_URL, query) });
  }

  // ============================================
  // Event Listeners
  // ============================================
  searchBtn.addEventListener('click', () => performSearch(searchInput.value));

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performSearch(searchInput.value);
    }
  });

  searchInput.addEventListener('input', updateClearButton);

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    updateClearButton();
    searchInput.focus();
    setState('empty');
  });

  openBothBtn.addEventListener('click', () => openAllSites(searchInput.value));

  themeToggle.addEventListener('click', toggleTheme);

  clearRecentBtn.addEventListener('click', clearRecentSearches);

  recentList.addEventListener('click', (e) => {
    const chip = e.target.closest('.recent-chip');
    if (chip) {
      const query = chip.getAttribute('data-query');
      searchInput.value = query;
      updateClearButton();
      performSearch(query);
    }
  });

  // ============================================
  // Initialization
  // ============================================
  loadTheme();
  loadRecentSearches().then(renderRecentSearches);
  searchInput.focus();
})();
