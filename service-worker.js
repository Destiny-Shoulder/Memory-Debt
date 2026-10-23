/* Debt of Memory: update-safe offline app shell (v18).
 * Keeps Anki libraries and icons available offline.
 * Never clears IndexedDB snapshots, media blobs, or pending review queue.
 */
const SHELL_CACHE = 'debt-of-memory-shell-v18';
const RUNTIME_CACHE = 'debt-of-memory-runtime-v18';
const OLD_CACHE_PREFIXES = [
  'debt-of-memory-shell-',
  'debt-of-memory-runtime-',
  'debt-memory-shell-'
];

const APP_SHELL = [
  './',
  './index.html',
  './config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/sql-wasm.min.js',
  'https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/sql-wasm.wasm',
  'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js'
];
const INDEX_URL = new URL('./index.html', self.registration.scope).href;
const ROOT_URL = new URL('./', self.registration.scope).href;
const SCOPE_URL = new URL(self.registration.scope);
const CACHED_EXTERNAL_URLS = new Set(
  APP_SHELL.filter(path => path.startsWith('https://')).map(path => new URL(path).href)
);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Require an actual fresh HTML page before activating the replacement worker.
    // If this fails, the current worker remains installed for offline use.
    await cache.add(new Request(INDEX_URL, {cache: 'reload'}));
    // Optional static assets and pinned dependencies should not block the update.
    await Promise.allSettled(APP_SHELL.filter(path => path !== './index.html').map(async path => {
      const url = new URL(path, self.registration.scope).href;
      const response = await fetch(new Request(url, {cache: 'reload'}));
      if (!response.ok && response.type !== 'opaque') return;
      await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(name =>
      name !== SHELL_CACHE && name !== RUNTIME_CACHE &&
      OLD_CACHE_PREFIXES.some(prefix => name.startsWith(prefix))
    ).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

function keepCaching(event, promise) {
  event.waitUntil(promise.catch(err => console.warn('Debt of Memory cache write failed', err)));
}

async function networkFirst(request, event, fallbackToIndex = false) {
  try {
    // Bypass browser HTTP cache to avoid an outdated GitHub Pages page or config.
    const response = await fetch(request, {cache: 'no-store'});
    if (response.ok) {
      const responseCopy = response.clone();
      const key = fallbackToIndex ? INDEX_URL : request;
      keepCaching(event, caches.open(SHELL_CACHE).then(cache => cache.put(key, responseCopy)));
    }
    return response;
  } catch (err) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request) || (fallbackToIndex &&
      (await cache.match(INDEX_URL) || await cache.match(ROOT_URL)));
    if (cached) return cached;
    return new Response('オフライン用の画面がまだ保存されていません。オンラインで一度開いてください。', {
      status: 503,
      headers: {'Content-Type': 'text/plain; charset=utf-8'}
    });
  }
}

async function cacheFirst(request, event) {
  const shell = await caches.open(SHELL_CACHE);
  const existing = await shell.match(request);
  if (existing) return existing;
  const runtime = await caches.open(RUNTIME_CACHE);
  const runtimeResponse = await runtime.match(request);
  if (runtimeResponse) return runtimeResponse;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    const copy = response.clone();
    keepCaching(event, runtime.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const inAppScope = url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_URL.pathname);
  // Don't cache unrelated CDN/other-site traffic, authenticated API calls or Storage.
  if (!inAppScope && !CACHED_EXTERNAL_URLS.has(url.href)) return;

  if (request.mode === 'navigate' || (inAppScope &&
    (url.pathname.endsWith('/config.js') || url.pathname.endsWith('/index.html')))) {
    event.respondWith(networkFirst(request, event, request.mode === 'navigate'));
  } else {
    event.respondWith(cacheFirst(request, event));
  }
});
