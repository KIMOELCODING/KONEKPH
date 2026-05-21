// Konek.PH broker app service worker
// Strategy:
//   - Cache-first for app shell + CDN assets
//   - Bypass cache for Supabase API (auth/data must stay fresh)
//   - Bypass cache for /admin/* (admin app is its own world)

const VERSION = 'konek-v1';
const SHELL = [
  '/',
  '/Draft%2028.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const IS_DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

self.addEventListener('install', (event) => {
  // DEV: don't pre-cache anything. The fetch handler also bypasses localhost,
  // and the activate handler will self-unregister so this SW disappears.
  if (IS_DEV) { self.skipWaiting(); return; }
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  if (IS_DEV) {
    // Wipe every cache this origin created and remove ourselves entirely so
    // future dev sessions never see a stale shell. One-shot — after this, dev
    // navigation goes straight to the network with no SW in the middle.
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((c) => c.navigate(c.url)))
        .catch(() => {})
    );
    return;
  }
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // DEV: never cache on localhost / 127.0.0.1 so iterating in dev doesn't get
  // stuck on stale asset filenames after rebuilds. Production hostnames are
  // unaffected, so the cache-first strategy still applies in prod.
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

  // Bypass: Supabase API, admin app, and same-origin config
  if (url.hostname.endsWith('.supabase.co')) return;
  if (url.pathname.startsWith('/admin')) return;
  if (url.pathname.endsWith('/config.js')) return;

  // Cache-first with network fallback (and lazy fill for CDN assets)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (!res || res.status !== 200 || res.type === 'opaqueredirect') return res;
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/Draft%2028.html'));
    })
  );
});
