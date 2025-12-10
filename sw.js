self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('bnapp-v3-5').then((cache) =>
      cache.addAll([
        '/',
        '/index.html',
        '/styles.css',
        '/app.js',
        '/firebase-config.js',
        '/manifest.webmanifest'
      ])
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open('bnapp-v3-5').then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
    })
  );
});
