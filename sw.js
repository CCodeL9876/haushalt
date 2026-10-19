// Service Worker: macht die App ohne Netz nutzbar und zeigt Push-Mitteilungen an (unten).
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

// Push-Mitteilungen (verschickt von der Supabase-Funktion „push“, eingeschaltet in js/push.js)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Haushalt', {
    body: data.body || '',
    icon: 'assets/icon-180.png',
    badge: 'assets/icon-180.png',
    tag: data.tag || undefined,
    data: { url: data.url || '' },
  }));
});

// Antippen: App öffnen (oder die offene nach vorne holen) und den passenden Bereich zeigen, z. B. #kuehlschrank
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      return win.navigate(target).catch(() => {});
    }
    return self.clients.openWindow(target);
  })());
});
