const CACHE = 'm-track-v2';
const PRECACHE = ['/', '/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

// Handle share target — POST from Android share sheet
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname === '/share-target' && e.request.method === 'POST') {
    e.respondWith(
      e.request.formData().then(data => {
        const text = data.get('text') ?? data.get('title') ?? '';
        const redirectUrl = `/?text=${encodeURIComponent(text.toString())}`;
        return Response.redirect(redirectUrl, 303);
      })
    );
  }
});