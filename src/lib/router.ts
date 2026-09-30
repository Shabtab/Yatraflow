// ============ The router's URL seam (#426, slice 2) ============
// The app's routes live in `location.pathname` on the web now — real paths,
// served by the one catch-all rewrite in `vercel.json` — while the native
// shell keeps its hash route until slice 4 rewires the Capacitor edges. Every
// difference between the two addressing schemes is confined to this module:
// pages read their address through the helpers here, never off
// `location.hash` directly, so a later slice can flip the native half without
// touching a single page.
//
// Old hash addresses still arrive: bookmarks copied out of the address bar in
// the hash era, the `/i/<id>` and `/c/<id>` card handlers' browser hand-offs
// (they replace() into `/#/pub/<id>` form), and a native share intent opened
// on web. The bridge promotes them to the path form once, before the first
// render reads the route, by identity onto the segments the router actually
// answers (`ROUTED_SEGMENTS`) — so `#/trip/<id>` becomes `/trip/<id>` and a
// typo'd scheme is left alone rather than invented into a path.
import { Capacitor } from '@capacitor/core'
import { ROUTED_SEGMENTS } from './routes'

type Listener = () => void

const listeners = new Set<Listener>()

/** Test seam: the Capacitor check is environment reality, but the router's
 *  native mode is a behaviour both tests and the shell need to pin. Null
 *  restores the real check. */
let forcedNative: boolean | null = null

function nativeRouting(): boolean {
  if (forcedNative !== null) return forcedNative
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** The route the app should render right now. Query strings ride along —
 *  pages read their own params through `currentQuery()`, never by splitting
 *  the route string. */
export function currentRoute(): string {
  if (nativeRouting()) return location.hash.replace(/^#/, '') || '/'
  // The native WebView (and any static host that serves the file directly)
  // names the document `/index.html`; the route it carries is the bare root.
  const path = location.pathname === '/index.html' ? '/' : location.pathname
  return path + location.search
}

/** The query parameters of the current address, wherever they live. */
export function currentQuery(): URLSearchParams {
  if (nativeRouting()) return new URLSearchParams(location.hash.split('?')[1] ?? '')
  return new URLSearchParams(location.search)
}

/** Move to another route in the same document. On the web this is history
 *  routing: one `pushState` and the subscribers re-render — the browser's own
 *  address bar does the navigating, so Back behaves like Back. The native
 *  shell keeps its hash history until slice 4. */
export function navigate(to: string): void {
  if (nativeRouting()) {
    location.hash = to
    return
  }
  history.pushState(history.state, '', to)
  for (const listener of listeners) listener()
}

/** Rewrite the address for the CURRENT route without adding a history entry —
 *  a view preference (the workspace's tab, Explore's filters) must not make
 *  Back cycle through states. Native form is the hash. */
export function replaceRoute(to: string): void {
  if (nativeRouting()) {
    history.replaceState(null, '', `#${to}`)
    return
  }
  history.replaceState(history.state, '', to)
}

/** Subscribe to route changes: real navigations (this module's `navigate`) and
 *  browser Back/Forward alike. Returns the unsubscribe. */
export function onRouteChange(listener: Listener): () => void {
  listeners.add(listener)
  const event = nativeRouting() ? 'hashchange' : 'popstate'
  window.addEventListener(event, listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener(event, listener)
  }
}

/** The href an in-app link carries: the path itself on the web, the fragment
 *  form on the native shell. */
export function routeHref(route: string, native = nativeRouting(), protocol = 'https:'): string {
  if (!native && /^https?:$/.test(protocol)) return route
  return route.startsWith('#') ? route : `#${route}`
}

/** The path an old in-app hash address should become, or null when the hash
 *  names nothing the router answers — a hash this app never routed is left
 *  alone rather than invented into a path.
 *
 *  Identity mapping, deliberately: `#/creator/<id>` becomes `/creator/<id>`,
 *  the page the router itself serves — NOT `/c/<id>`, which is the crawler
 *  card's server path and would hand a browser to `api/c.js` and back again
 *  in a loop. The `/c` ↔ `/creator` reconciliation is slice 3's (crawler
 *  redo); until then both addresses work, the card by hand-off, the app page
 *  by the switch's own `creator` case.
 *
 *  The query rides through untouched, exactly as `legacyRedirectPath` reads
 *  it: the hash is already percent-encoded by whoever built the link, and
 *  re-encoding it here is how `%2F` becomes `%252F` on the second hop. */
export function legacyHashRoute(hash: string): string | null {
  const route = hash.replace(/^#/, '')
  const queryAt = route.indexOf('?')
  const pathPart = queryAt >= 0 ? route.slice(0, queryAt) : route
  const queryPart = queryAt >= 0 ? route.slice(queryAt) : ''
  const [head, ...rest] = pathPart.split('/').filter(Boolean)
  if (!head || !ROUTED_SEGMENTS.includes(head)) return null
  return `/${[head, ...rest].join('/')}${queryPart}`
}

/** Web boot bridge: an address that still carries its route in the hash is
 *  promoted to the path form once, before the first render reads the route.
 *  Returns the route to render after settling, or null when there was nothing
 *  to settle (no hash, native, or a hash the bridge does not own).
 *
 *  `replaceState`, never `pushState` — this is one address under its modern
 *  name, not a navigation step, and Back must not double up on it. A query the
 *  URL already carries survives the promotion (the card hand-off's `?ref=…`
 *  is the attribution fact about how the reader arrived), and a query carried
 *  in the hash itself wins per key. */
export function settleLegacyHash(): string | null {
  if (nativeRouting() || !location.hash) return null
  const target = legacyHashRoute(location.hash)
  if (!target) return null
  const params = new URLSearchParams(location.search)
  const hashQuery = target.slice(target.indexOf('?'))
  if (hashQuery.startsWith('?')) {
    for (const [key, value] of new URLSearchParams(hashQuery)) params.set(key, value)
  }
  const path = hashQuery.startsWith('?') ? target.slice(0, target.indexOf('?')) : target
  const query = params.toString()
  const merged = query ? `${path}?${query}` : path
  history.replaceState(history.state, '', merged)
  return merged
}

/** Test seam only — see `forcedNative`. */
export function forceNativeRouting(value: boolean | null): void {
  forcedNative = value
}
