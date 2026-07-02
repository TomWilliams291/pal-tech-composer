// PAL Tech Composer - service worker.
//
// Caches the app shell so opening the bookmark with zero network shows
// the UI immediately.  Network-only for everything else (Google Sheets
// CSV, Gmail compose URL).  Bump CACHE_NAME any time the app shell
// asset list or any cached asset's content changes.

const CACHE_NAME = 'pal-tech-composer-shell-v8';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './favicon.ico',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only intercept same-origin requests.  Cross-origin (Google Sheets
  // CSV, Gmail compose URL) goes straight to the network — those must
  // not be cached, and the browser's normal failure path is what
  // triggers the outbox fallback in the page script.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
