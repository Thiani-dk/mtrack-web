/*
 * M-Track service worker.
 *
 * Caching strategy is deliberate — a stale index.html served cache-first is
 * what once put a blank white screen in production (the cached HTML named
 * hashed bundles from an older build; those 404'd against the new deployment
 * and React never mounted).
 *
 *   navigation / index.html   -> NETWORK-FIRST. The HTML names every hashed
 *       asset, so it must never be stale while online. Falls back to the last
 *       good cached copy only when the network is unreachable, and to a small
 *       built-in "try refreshing" page when there is no cache either.
 *
 *   /assets/* (hashed bundles) -> CACHE-FIRST. Vite puts a content hash in
 *       every filename, so a new build is a new URL — a cache hit is never a
 *       stale old file. Safe to keep indefinitely.
 *
 *   everything else, same-origin -> NETWORK-FIRST with a cache fallback.
 *
 * On activate, every cache belonging to a previous version is deleted.
 *
 * This worker never calls skipWaiting() on its own. A new version sits in
 * "waiting" until the page's update banner tells it to take over
 * (SKIP_WAITING message), so an open session is never swapped out mid-task.
 */

const VERSION = 'v3';
const PRECACHE = `m-track-precache-${VERSION}`;
const RUNTIME = `m-track-runtime-${VERSION}`;
const CURRENT_CACHES = new Set([PRECACHE, RUNTIME]);

// The shell, for a fully offline first navigation. NOT the hashed bundles —
// those change every build and populate the runtime cache on first use.
const SHELL_URLS = ['/', '/index.html', '/manifest.json'];

// A dependency-free error page for when index.html cannot be fetched or found
// in any cache. Better than a blank tab or a raw browser error.
const FALLBACK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>M-Track</title>
<style>html{color-scheme:light dark}body{margin:0;min-height:100vh;display:flex;
align-items:center;justify-content:center;padding:24px;
font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
background:#f7f7f5;color:#1a1a1a}@media(prefers-color-scheme:dark){body{background:#111;color:#f5f5f5}}
.b{max-width:20rem;text-align:center}h1{font-size:1.05rem;margin:0 0 .4rem}
p{margin:0 0 1.25rem;opacity:.7}button{font:inherit;font-weight:600;border:0;cursor:pointer;
border-radius:.6rem;padding:.7rem 1.5rem;background:#E8850A;color:#fff}</style></head>
<body><div class="b"><h1>Something didn't load right</h1>
<p>Check your connection, then try again.</p>
<button onclick="location.reload()">Refresh</button></div></body></html>`;

function fallbackResponse() {
    return new Response(FALLBACK_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

// Vite emits every build asset under /assets/ with a content hash in the name.
function isHashedAsset(url) {
    return url.pathname.startsWith('/assets/');
}

async function notifyClients(message) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    for (const client of clients) client.postMessage(message);
}

async function shellFromCache() {
    return (await caches.match('/index.html')) || (await caches.match('/')) || null;
}

// Network-first: try the network, cache a good response, and only reach for a
// cached copy (or the fallback page) when the network can't deliver.
async function networkFirst(request, { navigation = false } = {}) {
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME).then(c => c.put(request, copy));
            return response;
        }
        // Server returned 4xx/5xx: a good cached copy beats an error.
        const cached = await caches.match(request);
        if (cached) return cached;
        if (navigation) return (await shellFromCache()) || fallbackResponse();
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (navigation) return (await shellFromCache()) || fallbackResponse();
        throw err;
    }
}

// Cache-first: a hashed filename can't go stale, so serve it from cache the
// moment we have it. If it isn't cached and the network 404s, tell the page so
// it can show its own fallback instead of failing silently.
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME).then(c => c.put(request, copy));
            return response;
        }
        notifyClients({ type: 'ASSET_LOAD_FAILED', url: request.url, status: response ? response.status : 0 });
        return response;
    } catch (err) {
        notifyClients({ type: 'ASSET_LOAD_FAILED', url: request.url, status: 0 });
        throw err;
    }
}

self.addEventListener('install', (event) => {
    // No skipWaiting() — the page's update banner drives activation.
    // allSettled, not addAll: one temporarily-missing shell URL must never
    // block the new worker from installing and replacing a broken old one.
    event.waitUntil(
        caches.open(PRECACHE).then(cache => Promise.allSettled(SHELL_URLS.map(u => cache.add(u))))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => !CURRENT_CACHES.has(key)).map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;   // let cross-origin through untouched
    if (url.pathname === '/sw.js') return;             // never intercept the worker itself

    // Navigations (and any direct index.html hit): always try the network so
    // the HTML that comes back names the CURRENT hashed bundles.
    if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
        event.respondWith(networkFirst(request, { navigation: true }));
        return;
    }

    // Hashed build assets: cache-first.
    if (isHashedAsset(url)) {
        event.respondWith(cacheFirst(request));
        return;
    }

    // Icons, manifest, favicon, anything else same-origin: fresh when possible.
    event.respondWith(networkFirst(request));
});
