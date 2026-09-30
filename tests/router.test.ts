// ============ the router's URL seam (#426, slice 2) ============
// The web reads the pathname; the native shell keeps its hash until slice 4.
// Everything else — pages, links, filters — goes through lib/router, so what
// is pinned here is the seam itself: which address is read, what navigation
// writes, who gets told, and what the boot bridge does to an address that
// still carries its route in a fragment.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  currentQuery,
  currentRoute,
  forceNativeRouting,
  legacyHashRoute,
  navigate,
  onRouteChange,
  replaceRoute,
  routeHref,
  settleLegacyHash,
} from '../src/lib/router'

function stubAddress(url: string) {
  const address = new URL(url)
  vi.stubGlobal('location', address)
  return address
}

/** Node env: no window. A minimal registry — captures what the router
 *  subscribes to and fires it by hand, the way the browser would. */
function stubWindow() {
  const listeners: Record<string, Array<() => void>> = {}
  const window = {
    addEventListener: (event: string, listener: () => void) => {
      ;(listeners[event] ??= []).push(listener)
    },
    removeEventListener: (event: string, listener: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter(l => l !== listener)
    },
    dispatch: (event: string) => { for (const l of listeners[event] ?? []) l() },
    scrollTo: () => {},
  }
  vi.stubGlobal('window', window)
  return window
}

/** A history that mutates the stubbed address the way the real one does —
 *  pushState/replaceState update the URL the router then reads. */
function stubHistory(address?: URL) {
  const pushes: string[] = []
  const replaces: string[] = []
  const apply = (url: string) => {
    if (!address) return
    const resolved = new URL(url, address)
    address.pathname = resolved.pathname
    address.search = resolved.search
    address.hash = resolved.hash
  }
  vi.stubGlobal('history', {
    state: { restored: true },
    pushState: (_s: unknown, _t: string, url: string) => { pushes.push(url); apply(url) },
    replaceState: (_s: unknown, _t: string, url: string) => { replaces.push(url); apply(url) },
  })
  return { pushes, replaces }
}

beforeEach(() => forceNativeRouting(false))
afterEach(() => { forceNativeRouting(null); vi.unstubAllGlobals() })

describe('currentRoute (web)', () => {
  it('reads the pathname, with the query riding along', () => {
    stubAddress('https://app.example.test/pub/kerala-trip_1?ref=copy')
    expect(currentRoute()).toBe('/pub/kerala-trip_1?ref=copy')
  })

  it('normalizes a document-served path to the bare root', () => {
    // The native WebView and static hosts name the document /index.html; the
    // route it carries is /.
    stubAddress('https://app.example.test/index.html')
    expect(currentRoute()).toBe('/')
  })

  it('hands the query to pages through currentQuery, wherever it lives', () => {
    stubAddress('https://app.example.test/explore?q=goa&sort=newest')
    expect(currentQuery().get('q')).toBe('goa')
    expect(currentQuery().get('sort')).toBe('newest')
  })
})

describe('currentRoute (native)', () => {
  it('reads the hash — the shell keeps fragment addressing until slice 4', () => {
    forceNativeRouting(true)
    stubAddress('https://localhost/index.html#/trip/abc/timeline')
    expect(currentRoute()).toBe('/trip/abc/timeline')
    expect(currentQuery().get('next')).toBeNull()
  })

  it('reads a query that rides the native hash', () => {
    forceNativeRouting(true)
    stubAddress('https://localhost/index.html#/auth?mode=signup')
    expect(currentQuery().get('mode')).toBe('signup')
  })
})

describe('navigate and replaceRoute (web)', () => {
  it('navigate pushes one history entry and notifies the subscribers', () => {
    stubWindow()
    const address = stubAddress('https://app.example.test/trips')
    const { pushes } = stubHistory(address)
    const seen: string[] = []
    const off = onRouteChange(() => seen.push(currentRoute()))
    navigate('/explore?style=beach')
    expect(pushes).toEqual(['/explore?style=beach'])
    expect(seen).toEqual(['/explore?style=beach'])
    off()
  })

  it('replaceRoute rewrites without a history entry and notifies nobody', () => {
    stubWindow()
    const address = stubAddress('https://app.example.test/trip/abc/overview')
    const { pushes, replaces } = stubHistory(address)
    const seen: string[] = []
    const off = onRouteChange(() => seen.push(currentRoute()))
    replaceRoute('/trip/abc/budget')
    expect(pushes).toEqual([])
    expect(replaces).toEqual(['/trip/abc/budget'])
    // A view preference is not a navigation step: no subscriber runs.
    expect(seen).toEqual([])
    off()
  })

  it('the browser speaking (popstate) notifies the subscribers', () => {
    const win = stubWindow()
    stubAddress('https://app.example.test/explore')
    stubHistory()
    const seen: string[] = []
    const off = onRouteChange(() => seen.push(currentRoute()))
    // Back/Forward: the browser rewrites the address and dispatches the event.
    win.dispatch('popstate')
    expect(seen).toEqual(['/explore'])
    off()
    win.dispatch('popstate')
    expect(seen).toEqual(['/explore'])
  })

  it('the unsubscribe really unsubscribes', () => {
    stubWindow()
    const address = stubAddress('https://app.example.test/trips')
    stubHistory(address)
    let calls = 0
    const off = onRouteChange(() => { calls += 1 })
    navigate('/explore')
    off()
    navigate('/explore')
    expect(calls).toBe(1)
  })
})

describe('navigate (native)', () => {
  it('writes the hash — the WebView fires the hashchange, no history entry', () => {
    forceNativeRouting(true)
    const win = stubWindow()
    const address = stubAddress('https://localhost/index.html')
    const push = vi.fn()
    vi.stubGlobal('history', { state: null, pushState: push, replaceState: () => {} })
    const fired = vi.fn()
    const off = onRouteChange(fired)
    // The shell (or a page) sets the hash; the WebView answers with hashchange.
    address.hash = '#/trips'
    win.dispatch('hashchange')
    expect(push).not.toHaveBeenCalled()
    expect(address.hash).toBe('#/trips')
    expect(fired).toHaveBeenCalledOnce()
    off()
  })
})

describe('routeHref', () => {
  it('is the path on the web', () => {
    expect(routeHref('/trips')).toBe('/trips')
  })

  it('is the fragment on native and non-http documents', () => {
    expect(routeHref('/trips', true)).toBe('#/trips')
    expect(routeHref('/trips', false, 'file:')).toBe('#/trips')
  })
})

describe('settleLegacyHash (web)', () => {
  it('promotes and returns the settled route, replaceState not pushState', () => {
    stubAddress('https://app.example.test/?ref=copy#/join/GOA4X2')
    const { pushes, replaces } = stubHistory()
    const settled = settleLegacyHash()
    expect(settled).toBe('/join/GOA4X2?ref=copy')
    expect(replaces).toEqual(['/join/GOA4X2?ref=copy'])
    expect(pushes).toEqual([])
  })

  it('is null when there is no hash or nothing routable in it', () => {
    stubAddress('https://app.example.test/explore')
    stubHistory()
    expect(settleLegacyHash()).toBeNull()
    stubAddress('https://app.example.test/#/not-a-segment')
    expect(settleLegacyHash()).toBeNull()
  })

  it('delegates the mapping to legacyHashRoute — one parse, both callers', () => {
    expect(legacyHashRoute('#/trip/abc')).toBe('/trip/abc')
    expect(legacyHashRoute('#/garbage')).toBeNull()
  })
})
