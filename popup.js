/**
 * Searchit - Popup Script
 * Searches Bikroy and Rokomari, extracts product results inline.
 */

(function () {
  'use strict';

  // ============================================
  // Constants
  // ============================================
  const BIKROY_SEARCH_URL = 'https://bikroy.com/search?query=';
  const ROKOMARI_SEARCH_URL = 'https://www.rokomari.com/search?term=';
  const MAX_RECENT = 8;
  const MAX_PRODUCTS = 6;
  const MAX_OFFERS = 5;
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
  const rokomariLink = $('#rokomari-link');
  const rokomariProducts = $('#rokomari-products');
  const bikroyLink = $('#bikroy-link');
  const bikroyProducts = $('#bikroy-products');
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
  // URL Helpers
  // ============================================
  function buildSearchUrl(base, query) {
    return base + encodeURIComponent(query);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
  // Product Extraction - Rokomari (SSR)
  // ============================================

  /**
   * Fetch Rokomari search page and extract product cards.
   * Rokomari uses Next.js with SSR, so product data is in the raw HTML.
   */
  async function extractRokomariProducts(query) {
    const url = buildSearchUrl(ROKOMARI_SEARCH_URL, query);
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const items = [];
      // Rokomari product grid items use hashed class names with stable substrings
      const cards = doc.querySelectorAll('[class*="productGridItem"]');
      const limit = Math.min(cards.length, MAX_PRODUCTS);

      for (let i = 0; i < limit; i++) {
        const card = cards[i];

        // Title
        const titleEl = card.querySelector('[class*="productTitle"]');
        if (!titleEl) continue;

        // Link - the card itself is an <a> or contains one
        const linkEl = card.querySelector('a[class*="productDetailsBody"]') || card.querySelector('a[href]');
        const link = linkEl ? linkEl.getAttribute('href') : '';
        const fullLink = link.startsWith('/') ? 'https://www.rokomari.com' + link : link;

        // Price (current price, not the strikethrough original)
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
          // Skip placeholder images
          if (image.includes('placeholder')) image = '';
        }

        // Brand/author
        const brandEl = card.querySelector('[class*="productAuthor"]');
        const brand = brandEl ? brandEl.textContent.trim() : '';

        // Discount badge percentage
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

      return items.length > 0 ? items : null;
    } catch (err) {
      console.warn('[Searchit] Rokomari extraction failed:', err.message);
      return null;
    }
  }

  // ============================================
  // Product Extraction - Bikroy (SSR)
  // ============================================

  /**
   * Fetch Bikroy search page and extract listing cards.
   * Bikroy uses Nuxt.js with SSR, so listing data is in the raw HTML.
   */
  async function extractBikroyProducts(query) {
    const url = buildSearchUrl(BIKROY_SEARCH_URL, query);
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      const items = [];
      const cards = doc.querySelectorAll('.b-list-advert-base.qa-advert-list-item');
      const limit = Math.min(cards.length, MAX_PRODUCTS);

      for (let i = 0; i < limit; i++) {
        const card = cards[i];

        const titleEl = card.querySelector('.qa-advert-title');
        if (!titleEl) continue;

        const link = card.getAttribute('href') || '';
        const fullLink = link.startsWith('/') ? 'https://bikroy.com' + link : link;

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

      return items.length > 0 ? items : null;
    } catch (err) {
      console.warn('[Searchit] Bikroy extraction failed:', err.message);
      return null;
    }
  }

  // ============================================
  // Rendering
  // ============================================

  /**
   * Render product list or fallback message into a container.
   * @param {HTMLElement} container
   * @param {Array|null} products - extracted products, or null if extraction failed
   * @param {string} siteName - "Bikroy" or "Rokomari"
   * @param {string} searchUrl - full search URL for fallback link
   */
  function renderProductList(container, products, siteName, searchUrl) {
    if (!products) {
      // Extraction failed - show a helpful fallback with a link
      container.innerHTML = `
        <div class="product-fallback">
          <p class="product-fallback-msg">Could not load products inline.</p>
          <a href="${escapeHtml(searchUrl)}" target="_blank" class="product-fallback-link">
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
          ? `<img src="${escapeHtml(p.image)}" alt="" class="product-image" onerror="this.outerHTML='<div class=\\'product-no-image\\'>No img</div>'" />`
          : '<div class="product-no-image">No img</div>';

        const brandHtml = p.brand
          ? `<div class="product-brand">${escapeHtml(p.brand)}</div>`
          : '';

        const priceHtml = p.price
          ? `<div class="product-price">${escapeHtml(p.price)}${
              p.origPrice
                ? `<span class="product-original-price">${escapeHtml(p.origPrice)}</span>`
                : ''
            }</div>`
          : '';

        return `
        <a href="${escapeHtml(p.link)}" target="_blank" class="product-item" title="${escapeHtml(p.title)}">
          ${imageHtml}
          <div class="product-info">
            <div class="product-title">${escapeHtml(p.title)}</div>
            ${brandHtml}
            ${priceHtml}
          </div>
        </a>`;
      })
      .join('');
  }

  // ============================================
  // Offers & Deals Rendering
  // ============================================

  /**
   * Render discounted products from Rokomari + Bikroy deals link.
   * Only products matching the search query are shown.
   */
  function renderOffers(rokomariItems, query) {
    const discounted = [];
    if (rokomariItems) {
      for (const item of rokomariItems) {
        if (item.discount && parseInt(item.discount) > 0) {
          discounted.push({ ...item, site: 'Rokomari' });
        }
      }
    }

    discounted.sort((a, b) => parseInt(b.discount) - parseInt(a.discount));
    const topOffers = discounted.slice(0, MAX_OFFERS);

    let html = '';

    if (topOffers.length > 0) {
      html += '<div class="offers-section-label">Discounted Products</div>';
      html += topOffers
        .map((item) => {
          const title = escapeHtml(item.title);
          const discountPct = parseInt(item.discount);
          const priceHtml = item.price
            ? `<span class="offer-sale-price">${escapeHtml(item.price)}</span>`
            : '';
          const origHtml = item.origPrice
            ? `<span class="offer-original-price">${escapeHtml(item.origPrice)}</span>`
            : '';
          const siteClass = item.site.toLowerCase();

          return `
          <a href="${escapeHtml(item.link)}" target="_blank" class="offer-item" title="${title}">
            <span class="offer-badge">-${discountPct}%</span>
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

    const bikroySearchUrl = buildSearchUrl(BIKROY_SEARCH_URL, query);
    html += `
      <div class="offers-link-section">
        <div class="offers-link-row">
          <a href="${escapeHtml(bikroySearchUrl)}" target="_blank" class="offers-link bikroy-link">
            Bikroy Deals
          </a>
          <a href="${escapeHtml(buildSearchUrl(ROKOMARI_SEARCH_URL, query))}" target="_blank" class="offers-link rokomari-link">
            Rokomari Offers
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
  async function performSearch(query) {
    query = query.trim();
    if (!query) {
      setState('empty');
      return;
    }

    const bikroyUrl = buildSearchUrl(BIKROY_SEARCH_URL, query);
    const rokomariUrl = buildSearchUrl(ROKOMARI_SEARCH_URL, query);

    bikroyLink.href = bikroyUrl;
    rokomariLink.href = rokomariUrl;

    addRecentSearch(query);
    setState('loading');

    const [bikroyItems, rokomariItems] = await Promise.all([
      extractBikroyProducts(query),
      extractRokomariProducts(query),
    ]);

    renderProductList(bikroyProducts, bikroyItems, 'Bikroy', bikroyUrl);
    renderProductList(rokomariProducts, rokomariItems, 'Rokomari', rokomariUrl);
    renderOffers(rokomariItems, query);
    setState('results');
  }

  // ============================================
  // Open Both Sites
  // ============================================
  function openBothSites(query) {
    query = (query || searchInput.value).trim();
    if (!query) {
      showError('Please enter a search term first.');
      return;
    }
    addRecentSearch(query);
    chrome.tabs.create({ url: buildSearchUrl(BIKROY_SEARCH_URL, query) });
    chrome.tabs.create({ url: buildSearchUrl(ROKOMARI_SEARCH_URL, query) });
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

  openBothBtn.addEventListener('click', () => openBothSites(searchInput.value));

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
