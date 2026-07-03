/* Service worker for Pocket Agent.
 *
 * 1. Precaches the app shell so the installed app opens with no network.
 * 2. Injects COOP/COEP headers on document responses. GitHub Pages cannot
 *    send these headers itself; with them the page becomes cross-origin
 *    isolated, SharedArrayBuffer is available, and llama.cpp runs
 *    multi-threaded instead of single-threaded.
 *
 * Model files are NOT handled here — wllama caches them in the Cache API
 * on its own (see allowOffline in src/llm.ts).
 *
 * The three self.__* placeholders are replaced at build time by the
 * sw-manifest plugin in vite.config.ts.
 */

const PRECACHE = ["/mobileLlm/assets/emscripten-module.browser-XIKQQPVU-DwyR6UY1.js","/mobileLlm/assets/ffi-Boa1QuFa.js","/mobileLlm/assets/index-BQ9577P_.css","/mobileLlm/assets/index-lDEGeQKR.js","/mobileLlm/assets/module-ES6BEMUI-DtDrHF3o.js","/mobileLlm/assets/wllama-CCF-NsFP.wasm","/mobileLlm/assets/wllama-_zt-pXcw.wasm","/mobileLlm/icons/apple-touch-icon.png","/mobileLlm/icons/icon-192.png","/mobileLlm/icons/icon-512.png","/mobileLlm/icons/icon-maskable-512.png","/mobileLlm/index.html","/mobileLlm/manifest.webmanifest"];
const BUILD_ID = "mr585ztq";
const BASE_URL = "/mobileLlm/";
const CACHE_NAME = `pocket-agent-${BUILD_ID}`;

function withCoiHeaders(response) {
  if (response.status === 0) return response; // opaque
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('pocket-agent-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Leave cross-origin requests (model downloads etc.) alone.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // App shell: cached index first so the installed app opens instantly
    // and offline; fall back to the network for anything uncached.
    event.respondWith(
      caches
        .match(BASE_URL + 'index.html')
        .then((cached) => cached || fetch(request))
        .then(withCoiHeaders)
    );
    return;
  }

  // Static assets are content-hashed: cache-first, backfill from network.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
