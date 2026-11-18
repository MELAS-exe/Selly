// Selly dashboard service worker (architecture.md 3.4, apps/web/AGENTS.md).
// Rule: cache hashed static assets and one offline page only. Never cache server-component payloads (RSC) or API
// responses: a worker that caches those can leave an installed app on a blank screen after a deploy.
const VERSION = 'selly-v1';
const OFFLINE = '/app-offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll([OFFLINE, '/icons/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Hashed build assets never change under the same URL: cache first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Dashboard pages: always the network; the offline page only when there is none. RSC fetches are not navigations,
  // and the API is not touched at all.
  if (req.mode === 'navigate' && url.pathname.startsWith('/app')) {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
  }
});

// Core sends { title, body, url, tag }, already in French.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Selly', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Selly', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/app' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/app', self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).pathname.startsWith('/app'));
      if (open) return open.focus().then((w) => w.navigate(target.href));
      return self.clients.openWindow(target.href);
    }),
  );
});
