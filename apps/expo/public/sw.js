// Hand-rolled per the spec: the export's /_expo/static/* chunks are
// content-hashed (immutable) → cache-first; the HTML shell is
// network-first with cached fallback. Bump VERSION to invalidate.
const VERSION = 'v1';
const CACHE = `roebel-${VERSION}`;
const PRECACHE = ['/', '/offline.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Immutable, content-hashed build artifacts: cache-first.
  if (url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          })
      )
    );
    return;
  }

  // App navigations: network-first → cached shell → offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(async () => (await caches.match('/')) || (await caches.match('/offline.html')))
    );
  }
});
