// Hand-rolled per the spec: the export's /_expo/static/* chunks are
// content-hashed (immutable) → cache-first; the HTML shell is
// network-first with cached fallback. Bump VERSION to invalidate.
const VERSION = 'v2';
const CACHE = `roebel-${VERSION}`;
const PRECACHE = ['/', '/offline.html', '/manifest.json'];

/**
 * The shell's <script src> entries, which are content-hashed and change with
 * every deploy. Caching '/' alone is not enough for an offline cold load: the
 * scripts load before this worker ever activates, so nothing else would put
 * them in the cache and an offline reload would render an empty shell.
 */
function entryScripts(html) {
  return [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((src) => src.startsWith('/_expo/'));
}

async function cacheEntryScripts(cache, html) {
  await Promise.all(
    entryScripts(html).map(async (src) => {
      if (await cache.match(src)) return; // hashed URL — already current
      try {
        const res = await fetch(src);
        if (res.ok) await cache.put(src, res);
      } catch {
        // Best effort: a missing entry script only costs the offline boot,
        // which the navigate handler detects and falls back for.
      }
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      const shell = await cache.match('/');
      if (shell) await cacheEntryScripts(cache, await shell.text());
      await self.skipWaiting();
    })()
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
            const type = res.headers.get('content-type') || '';
            if (res.ok && !type.includes('text/html')) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          }).catch(() => Response.error())
      )
    );
    return;
  }

  // App navigations: network-first → cached shell → offline page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            const forScripts = res.clone();
            // Keep the offline boot in step with the deploy just served.
            caches
              .open(CACHE)
              .then(async (c) => {
                await c.put('/', copy);
                await cacheEntryScripts(c, await forScripts.text());
              })
              .catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          const shell = await cache.match('/');
          if (shell) {
            // Only serve the shell when the scripts that boot it are cached
            // too — otherwise the user gets a blank page instead of the
            // honest "Keine Verbindung" screen.
            const html = await shell.clone().text();
            const cached = await Promise.all(entryScripts(html).map((src) => cache.match(src)));
            if (cached.every(Boolean)) return shell;
          }
          return (await cache.match('/offline.html')) || Response.error();
        })
    );
  }
});
