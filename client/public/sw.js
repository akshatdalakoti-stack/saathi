// Saathi's service worker: keeps the app itself on the phone, so the elder's
// screen still opens with no internet. Data comes from the app's own saved copy.
const CACHE = 'saathi-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/favicon.svg', '/manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never cache the API or the one-tap email pages: they must always be fresh.
  if (url.origin === location.origin && (url.pathname.startsWith('/api') || url.pathname.startsWith('/act') || url.pathname.startsWith('/card'))) return;

  // Pages: try the network, fall back to the saved app.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  // Scripts, styles and fonts: use the saved copy, and save new ones as they arrive.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok && (url.origin === location.origin || url.hostname.includes('fonts.g'))) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return res;
    })),
  );
});
