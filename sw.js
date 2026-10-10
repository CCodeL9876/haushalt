// Service Worker: macht die App ohne Netz nutzbar.
// Jede Datei zuerst aus dem Netz (so kommt jede neue Version sofort an), ohne Netz aus dem Speicher.
// Die Daten selbst liegen im localStorage (js/store.js) und brauchen kein Netz.

const CACHE = 'haushalt-app-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('haushalt-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-store' });
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const cached = (await caches.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' && (await caches.match('./')));
      return cached || Response.error();
    }
  })());
});
