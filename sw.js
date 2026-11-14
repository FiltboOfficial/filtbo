/* ==========================================================================
   FILTBO SERVICE WORKER
   • Opens the app with NO internet (the app page is saved after the first online visit).
   • Keeps newer versions arriving automatically when there is a connection.
   • Remembers Bible chapters it has fetched (Bible API cache).
   • Shows push notifications, always with the Filtbo F.
   Live services (server functions, Firebase, payments, AI) are never touched.
   ========================================================================== */
const VERSION = 'filtbo-v3';
const SHELL   = 'filtbo-shell-' + VERSION;      // the app page + icons
const BIBLE   = 'filtbo-bible-filtbo-v2';       // unchanged name, so chapters people already saved are kept
const RUNTIME = 'filtbo-runtime-v1';            // Google Fonts
const BIBLE_HOSTS = ['bible-api.com', 'api.getbible.net'];
const NAV_TIMEOUT_MS = 3500;                    // slow connection? open the saved copy instead of waiting

const SHELL_FILES = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/badge-96.png', '/apple-touch-icon.png', '/favicon.ico'];

/* ---------- install: save the app page + icons ---------- */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch('/', { cache: 'reload' });
      if (res && res.ok) { await cache.put('/', res.clone()); await cache.put('/index.html', res); }
    } catch (err) { /* will save it on the next online visit */ }
    await Promise.all(SHELL_FILES.map(async (f) => {      // best effort: a missing icon never blocks installing
      try { const r = await fetch(f, { cache: 'reload' }); if (r && r.ok) await cache.put(f, r); } catch (err) {}
    }));
    await self.skipWaiting();
  })());
});

/* ---------- activate: remove old copies, take control right away ---------- */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== BIBLE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---------- helpers ---------- */
const wait = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

async function savedApp() {
  const c = await caches.open(SHELL);
  return (await c.match('/index.html', { ignoreSearch: true })) || (await c.match('/', { ignoreSearch: true }));
}

// The app page: network first so updates show up, but never leave anyone waiting or on an error page.
async function appPage(e) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(e.request), wait(NAV_TIMEOUT_MS)]);
    if (res && res.ok) {
      const copy = res.clone();
      e.waitUntil(Promise.all([cache.put('/index.html', copy.clone()), cache.put('/', copy)]).catch(() => {}));
      return res;
    }
    return (await savedApp()) || res;
  } catch (err) {
    const saved = await savedApp();
    if (saved) return saved;
    try { return await fetch(e.request); } catch (err2) {}
    return new Response(
      '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Filtbo</title>' +
      '<body style="font-family:system-ui;background:#000;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:32px">' +
      '<div><h2>Filtbo needs to open once online</h2><p style="opacity:.75">Connect to the internet one time so Filtbo can save itself to your phone. After that it opens without data.</p></div>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// Files: show the saved copy instantly, refresh it quietly in the background.
async function fastThenRefresh(e, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(e.request);
  const net = fetch(e.request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (hit) { e.waitUntil(net); return hit; }
  return (await net) || new Response('', { status: 504, statusText: 'Offline' });
}

/* ---------- fetch ---------- */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameSite = url.origin === location.origin;

  // Never touch server functions or Google/Firebase/payment traffic.
  if (sameSite && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/'))) return;
  // Whole-Bible files are saved by the app itself, so the worker leaves them alone.
  if (sameSite && url.pathname.startsWith('/bibles/')) return;
  if (sameSite && url.pathname === '/sw.js') return;

  // Public pages (Bible Library, About, Terms...) are normal web pages: straight to the network,
  // and they never replace the saved app page.
  if (req.mode === 'navigate' && sameSite && url.pathname !== '/' && url.pathname !== '/index.html') return;

  // The app page itself (also covers an installed app's start_url such as /?source=pwa).
  if (req.mode === 'navigate' || (sameSite && (url.pathname === '/' || url.pathname === '/index.html'))) {
    e.respondWith(appPage(e));
    return;
  }

  // Bible text: use the network, remember it, serve the saved copy when offline.
  if (BIBLE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(BIBLE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || new Response('', { status: 504, statusText: 'Offline' })))
    );
    return;
  }

  // Google Fonts: save once, so the app keeps its look offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(fastThenRefresh(e, RUNTIME));
    return;
  }

  // Same-site files (icons, manifest...): saved copy first, refreshed in the background.
  if (sameSite) { e.respondWith(fastThenRefresh(e, SHELL)); }
});

/* ---------- messages from the page ---------- */
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'skip-waiting') self.skipWaiting();
  if (d.type === 'filtbo-cache-shell') {          // the page asks us to refresh the saved copy (only when online)
    e.waitUntil((async () => {
      try {
        const res = await fetch('/', { cache: 'reload' });
        if (res.ok) { const c = await caches.open(SHELL); await c.put('/', res.clone()); await c.put('/index.html', res); }
      } catch (err) {}
    })());
  }
});

/* ---------- push notifications (always the Filtbo F) ---------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  const show = () => self.registration.showNotification(d.title || 'Filtbo', {
    body: d.body || '',
    icon: '/icons/icon-512.png',
    badge: '/icons/badge-96.png',
    tag: d.tag || 'filtbo',
    data: { url: d.url || '/' },
    // "Audio" reminders behave like an alarm: they stay on screen until dismissed and vibrate in a long pattern.
    ...(d.style === 'audio' ? { requireInteraction: true, renotify: true, vibrate: [500, 250, 500, 250, 500, 250, 800] } : {})
  });
  // An AI-reply push is pointless if the app is already open and visible.
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
