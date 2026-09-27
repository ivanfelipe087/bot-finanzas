const CACHE_NAME = 'finanzas-pwa-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Estrategia Network First para datos siempre frescos
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
