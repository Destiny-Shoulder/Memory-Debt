const CACHE_NAME = "debt-of-memory-shell-v9";
const RUNTIME_CACHE = "debt-of-memory-runtime-v9";

const APP_SHELL = [
  "./",
  "./index.html",
  "./config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2",
  "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
  "https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/sql-wasm.min.js",
  "https://cdn.jsdelivr.net/npm/sql.js@1.14.2/dist/sql-wasm.wasm",
  "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(APP_SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => ![CACHE_NAME, RUNTIME_CACHE].includes(k))
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Supabase API/Storage requests should never be replaced with stale HTTP responses.
  if (url.hostname.endsWith(".supabase.co")) return;

  // Navigation: network first, cached app fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(async () => {
          return (await caches.match(req))
            || (await caches.match("./index.html"))
            || (await caches.match("./"));
        })
    );
    return;
  }

  // App assets/CDN: cache first, then network and cache.
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
