const CACHE_NAME = 'bnapp-v3-5-1';

self.addEventListener('install', (event) => {
  self.skipWaiting(); // ⬅️ חובה

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        '/',
        '/index.html',
        '/styles.css',
        '/app.js',
        '/firebase-config.js',
        '/manifest.webmanifest',
        '/icon-192.png',
        '/icon-512.png'
      ])
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // ⛔ לא מקאש 404
        if (!response || response.status !== 200) {
          return response;
        }

        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, copy);
        });

        return response;
      });
    })
  );
});const CACHE_NAME = 'bnapp-v3-5-1';

self.addEventListener('install', (event) => {
  self.skipWaiting(); // ⬅️ חובה

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        '/',
        '/index.html',
        '/styles.css',
        '/app.js',
        '/firebase-config.js',
        '/manifest.webmanifest',
        '/icon-192.png',
        '/icon-512.png'
      ])
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // ⛔ לא מקאש 404
        if (!response || response.status !== 200) {
          return response;
        }

        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, copy);
        });

        return response;
      });
    })
  );
});
