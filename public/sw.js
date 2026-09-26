/* PomoVNO service worker: offline-first app shell for a single-page Next.js app.
 *
 * Strategy
 * - App shell ("/"): cache-first so the app opens instantly with no network.
 *   The shell is refreshed in the background, and a new HTML page is only
 *   swapped in after every JS/CSS file it references is cached, so the cached
 *   page can never point at scripts that are missing offline.
 * - /_next/static/*: cache-first (file names are content-hashed / immutable).
 * - Other same-origin GETs (icons, manifest): stale-while-revalidate.
 */

const VERSION = 'v3';
const SHELL_CACHE = `pomovno-shell-${VERSION}`;
const RUNTIME_CACHE = `pomovno-runtime-${VERSION}`;
const SHELL_URL = '/';
const OFFLINE_URL = '/offline.html';
const CORE_ASSETS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
];
const SHELL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let lastShellRefresh = 0;
let shellRefreshInFlight = null;

/** Collects every build asset the HTML (including the inline RSC payload) references. */
function extractAssetUrls(html) {
  const urls = new Set();
  for (const match of html.matchAll(/\/_next\/static\/[^"'\\\s)<>]+/g)) {
    urls.add(match[0]);
  }
  // Chunks referenced from the flight payload are written without the /_next prefix.
  for (const match of html.matchAll(/["'\s(,]static\/(?:chunks|css|media)\/[^"'\\\s)<>]+/g)) {
    urls.add(`/_next/${match[0].slice(1)}`);
  }
  return [...urls];
}

async function cacheShell() {
  const response = await fetch(SHELL_URL, { cache: 'no-cache', credentials: 'same-origin' });
  if (!response.ok || response.redirected) throw new Error(`Shell request failed: ${response.status}`);

  const html = await response.clone().text();
  const assets = extractAssetUrls(html);
  const cache = await caches.open(SHELL_CACHE);
  const previous = await cache.match(SHELL_URL);
  const previousAssets = previous ? extractAssetUrls(await previous.text()).sort().join() : null;

  await Promise.all(
    assets.map(async (url) => {
      if (await cache.match(url)) return;
      const assetResponse = await fetch(url, { credentials: 'same-origin' });
      if (!assetResponse.ok) throw new Error(`Asset request failed: ${url}`);
      await cache.put(url, assetResponse);
    })
  );
  await cache.put(SHELL_URL, response);
  lastShellRefresh = Date.now();

  if (previousAssets !== null && previousAssets !== [...assets].sort().join()) {
    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach((client) => client.postMessage({ type: 'SHELL_UPDATED' }));
  }

  // Drop build assets from previous deployments.
  const keep = new Set([SHELL_URL, ...assets].map((url) => new URL(url, self.location.origin).href));
  const requests = await cache.keys();
  await Promise.all(requests.filter((request) => !keep.has(request.url)).map((request) => cache.delete(request)));
}

function refreshShell({ force = false } = {}) {
  if (shellRefreshInFlight) return shellRefreshInFlight;
  if (!force && Date.now() - lastShellRefresh < SHELL_REFRESH_INTERVAL_MS) return Promise.resolve();
  shellRefreshInFlight = cacheShell()
    .catch(() => {
      // Offline or mid-deploy: keep the last good shell.
    })
    .finally(() => {
      shellRefreshInFlight = null;
    });
  return shellRefreshInFlight;
}

async function putInRuntimeCache(request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const cache = await caches.open(RUNTIME_CACHE);
  await cache.put(request, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      await Promise.all(
        CORE_ASSETS.map((url) =>
          fetch(url, { cache: 'no-cache' })
            .then((response) => (response.ok ? cache.put(url, response) : undefined))
            .catch(() => undefined)
        )
      );
      // A complete shell is required for offline use, so a failed install is retried later.
      await cacheShell();
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('pomovno-') || key.startsWith('app-shell-') || key.startsWith('runtime-'))
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // React Server Component fetches: let the network handle them; the client falls back gracefully.
  if (url.searchParams.has('_rsc') || request.headers.get('RSC')) return;

  if (request.mode === 'navigate') {
    if (url.pathname === SHELL_URL) {
      event.respondWith(
        (async () => {
          const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
          if (cached) {
            event.waitUntil(refreshShell());
            return cached;
          }
          try {
            const response = await fetch(request);
            event.waitUntil(refreshShell({ force: true }));
            return response;
          } catch {
            return (await caches.match(OFFLINE_URL)) ?? Response.error();
          }
        })()
      );
      return;
    }

    event.respondWith(
      fetch(request).catch(
        async () => (await caches.match(SHELL_URL, { cacheName: SHELL_CACHE })) ?? (await caches.match(OFFLINE_URL)) ?? Response.error()
      )
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        event.waitUntil(putInRuntimeCache(request, response.clone()));
        return response;
      })()
    );
    return;
  }

  if (url.pathname.startsWith('/_next/')) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: url.pathname === '/manifest.webmanifest' });
      const network = fetch(request)
        .then((response) => {
          event.waitUntil(putInRuntimeCache(request, response.clone()));
          return response;
        })
        .catch(() => undefined);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return (await network) ?? Response.error();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'CACHE_URLS' && Array.isArray(data.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        await Promise.all(
          data.urls
            .filter((href) => typeof href === 'string')
            .map((href) => new URL(href, self.location.origin))
            .filter((url) => url.origin === self.location.origin && url.pathname.startsWith('/_next/static/'))
            .map(async (url) => {
              if (await caches.match(url.href)) return;
              const response = await fetch(url.href).catch(() => undefined);
              await putInRuntimeCache(url.href, response);
            })
        );
      })()
    );
  } else if (data.type === 'REFRESH_SHELL') {
    event.waitUntil(refreshShell({ force: true }));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) return existing.focus();
      return self.clients.openWindow(SHELL_URL);
    })()
  );
});
