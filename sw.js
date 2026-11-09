/* Filtbo service worker: keeps the app opening offline, caches Bible chapters you have read, and shows push notifications. */
const VERSION = 'filtbo-v2';
const SHELL = 'filtbo-shell-' + VERSION;
const BIBLE = 'filtbo-bible-' + VERSION;
const BIBLE_HOSTS = ['bible-api.com', 'api.getbible.net'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/index.html'])).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== BIBLE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never touch server functions or Google/Firebase/payment traffic.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  // Whole-Bible files are saved by the app itself, so the worker leaves them alone.
  if (url.pathname.startsWith('/bibles/')) return;

  // Public pages (Bible Library, About, Terms...) are normal web pages: go straight to the network and never replace the saved app page.
  if (req.mode === 'navigate' && url.origin === location.origin && url.pathname !== '/' && url.pathname !== '/index.html') return;

  // The app page: always try the network first so updates show up, fall back to the saved copy offline.
  if (req.mode === 'navigate' || (url.origin === location.origin && (url.pathname === '/' || url.pathname === '/index.html'))) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/index.html', copy)); }
        return res;
      }).catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Bible text: use the network, remember it, and serve the saved copy when offline.
  if (BIBLE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(BIBLE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Same-site files (icons etc.): saved copy first, refreshed in the background.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});

// ---- push notifications ----
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  // An AI-reply push is pointless if the app is already open and visible.
  const show = () => self.registration.showNotification(d.title || 'Filtbo', {
    body: d.body || '',
    icon: d.tag === 'filtbo-ai-reply' ? '/icons/geelko-ai.png' : '/icons/icon-512.png',
    badge: '/icons/badge-96.png',
    tag: d.tag || 'filtbo',
    data: { url: d.url || '/' },
    // "Audio" reminders behave like an alarm: they stay on screen until dismissed and vibrate in a long pattern.
    ...(d.style === 'audio' ? { requireInteraction: true, renotify: true, vibrate: [500, 250, 500, 250, 500, 250, 800] } : {})
  });
  if (d.tag === 'filtbo-ai-reply') {
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.some((c) => c.visibilityState === 'visible')) return;
      return show();
    }));
  } else {
    e.waitUntil(show());
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  // Opening the app also clears the other Filtbo notifications from the phone's top bar.
  e.waitUntil(self.registration.getNotifications().then((list) => list.forEach((n) => n.close())).catch(() => {}));
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate && c.navigate(target); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
