/**
 * Searchit - Background Service Worker
 * Handles extension installation events.
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Searchit] Extension installed successfully.');
    chrome.storage.local.set({
      theme: 'light',
      recentSearches: [],
    });
  } else if (details.reason === 'update') {
    console.log(
      '[Searchit] Extension updated to version',
      chrome.runtime.getManifest().version
    );
  }
});
