const CACHE_NAME = 'bnapp-v3-5';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        '/ZZZZ/',
        '/ZZZZ/index.html',
        '/ZZZZ/styles.css',
        '/ZZZZ/app.js',
        '/ZZZZ/firebase-config.js',
        '/ZZZZ/manifest.webmanifest',
        '/ZZZZ/icon-192.png',
        '/ZZZZ/icon-512.png'
      ])
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, copy);
          });
          return response;
        })
      );
    })
  );
});
