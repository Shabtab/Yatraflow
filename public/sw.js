// ============ Service worker — the offline shell (PWA) ============
// Hand-rolled rather than a workbox/vite-plugin-pwa build step: no new
// dependency, no generated manifest of hashed files to drift, and the whole
// policy fits in one readable file. Three rules, in order of the fetch below:
//
//   1. Navigations -> network-first, with the cached shell as the offline
//      fallback. The app is one HTML document (hash routing), so a single
//      cached shell serves every route.
//   2. Hashed build assets (/assets/*) and icons -> cache-first. Vite hashes
//      the filename, so a cache hit is always the right bytes for that URL.
//      (A MISS is guarded: the host's catch-all rewrite answers a vanished
//      chunk with 200 + the HTML shell, and caching that would poison the URL.)
//   3. Everything else -> straight to the network, uncached. `/api/*`, the
//      `/i/<id>` crawler preview, `sitemap.xml` and the Mappls proxy are in
//      the NEVER list below; cross-origin (Supabase, tiles, fonts, Wikimedia)
//      is left alone here — a cached auth/rest response is a correctness bug,
//      and phase 2 decides deliberately which cross-origin data may be kept.
//
// The cached shell is refreshed on every successful navigation, and any cache
// that is not this version's is dropped on activate — so a deploy rolls the
// offline copy forward without a version bump. Bump SW_VERSION only to force a
// full drop (e.g. when the caching policy itself changes).
const SW_VERSION = 'v2'
const CACHE = `yatraflow-${SW_VERSION}`
const SHELL = '/'
const SHELL_ASSETS = [SHELL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

/** Paths that must never be cached or served from cache. `/i/` and `/c/` are
 *  the tag-bearing card endpoints: a navigation to one must reach the network
 *  even in the installed app, because a successful card answer would otherwise
 *  be cached under the SHELL key — offline navigations would then open card
 *  HTML at every address (#426 slice 4). */
const NEVER = ['/api/', '/i/', '/c/', '/sitemap.xml', '/mappls/']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL_ASSETS)))
  // Deliberately NO skipWaiting(): a new worker takes over on the next full
  // load, so a running session never has its shell swapped underneath it. The
  // app's own stale-chunk auto-reload covers the mid-session deploy case.
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

/** True when this request must be answered by the network alone. */
function networkOnly(url) {
  if (url.origin !== self.location.origin) return true
  return NEVER.some(prefix => url.pathname.startsWith(prefix))
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (networkOnly(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then(cache => cache.put(SHELL, copy))
          }
          return response
        })
        .catch(() => caches.match(SHELL).then(hit => hit ?? Response.error())),
    )
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        hit =>
          hit ??
          fetch(request)
            .then(response => {
              // The host's catch-all rewrite answers a MISSING asset with 200
              // + the HTML shell. Caching that would file markup under a .js
              // URL and serve it cache-first forever, so only a real asset may
              // enter the cache; a rewritten answer fails like the 404 it
              // hides, and the app's stale-chunk boundary owns the recovery.
              const type = response.headers.get('content-type') ?? ''
              if (!response.ok || type.includes('text/html')) return Response.error()
              const copy = response.clone()
              caches.open(CACHE).then(cache => cache.put(request, copy))
              return response
            })
            // An offline miss resolves as a network error — a rejected
            // respondWith surfaces as an unhandled failure, not a clean miss.
            .catch(() => Response.error()),
      ),
    )
  }
})
