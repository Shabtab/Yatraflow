// ============ Snapshot transport privacy (#805) ============
// A snapshot payload is the whole trip in reversible base64 — compression is not
// encryption. It must never ride an HTTP path, a query string, or any other part
// of a request a server, a proxy, a CDN or an analytics collector can read.
//
// These tests drive the REAL encoder, the REAL link builder and the REAL router
// over a real trip, then read the resulting URL the way a server reads a request
// line: the path plus the query. The fragment is never part of that, which is
// the whole point of the fix.
//
// The links made before this fix carried the payload in the path. They still
// have to render, and they can never be un-exposed: the first request for one
// already happened. So the tests pin BOTH halves — new links are clean, old
// links still open — because a fix that broke old links would just move people
// onto links that need fixing later.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeTripSnapshot, encodeTripSnapshot, redactSnapshotUrl, snapshotUrl } from '../src/lib/snapshot'
import { currentRoute, forceNativeRouting, legacyHashRoute, settleLegacyHash } from '../src/lib/router'
import { pageTitle, routeParts } from '../src/lib/pageTitle'
import { seedData } from '../src/data/seed'
import { readFileSync } from 'node:fs'

const ORIGIN = 'https://app.example.test'
/** A trip whose own text names the trip, so a leak is legible rather than
 *  merely detectable by comparing tokens. */
const CANARY = 'CANARY-RAJASTHAN-HOLIDAY-PLAN'

function canaryTrip() {
  return { ...structuredClone(seedData.trips[0]), name: CANARY }
}

/** The part of an address that reaches a server: the request target. A browser
 *  sends `pathname + search` and nothing else; the fragment stays in the client. */
function requestTarget(url: URL | string): string {
  const parsed = typeof url === 'string' ? new URL(url) : url
  return parsed.pathname + parsed.search
}

/** An address stand-in. Node env has no window, so `location` is a URL object
 *  exactly as in tests/router.test.ts. */
function stubAddress(url: string) {
  const address = new URL(url)
  vi.stubGlobal('location', address)
  return address
}

/** A history that records what the router tried to write, and mutates the
 *  address the way the browser's own does. */
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

describe('a new snapshot link keeps the payload out of the request target', () => {
  it('puts the payload in the fragment and nowhere else', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/trips`)
    const url = new URL(snapshotUrl(trip, payload))
    expect(url.hash).toBe(`#/share/${payload}`)
    expect(requestTarget(url)).not.toContain(payload)
  })

  it("never sends the trip's own text to a server", async () => {
    // The payload is opaque base64, so comparing tokens proves the encoding is
    // out of the path — not that the trip is. This names the trip instead.
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/trips`)
    const target = requestTarget(snapshotUrl(trip, payload))
    expect(target).not.toContain(CANARY)
    expect(target).not.toContain('yf1_')
  })

  it('roots the link at the origin, so a reader is sent to this deployment', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/trips`)
    expect(new URL(snapshotUrl(trip, payload)).origin).toBe(ORIGIN)
  })
})

describe('the boot bridge does not promote a payload into a path', () => {
  it('leaves the address in the fragment and still names the route', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    const address = stubAddress(`${ORIGIN}/#/share/${payload}`)
    const { pushes, replaces } = stubHistory(address)
    const settled = settleLegacyHash()
    // The bridge used to rewrite this address to /share/<payload>, which is the
    // exact promotion this file exists to stop.
    expect(replaces).toEqual([])
    expect(pushes).toEqual([])
    expect(address.pathname).toBe('/')
    expect(address.hash).toBe(`#/share/${payload}`)
    // Still answers with the route the reader has to render.
    expect(settled).toBe(`/share/${payload}`)
  })

  it('never writes the payload into the path or query, whatever the URL already carried', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    const address = stubAddress(`${ORIGIN}/?ref=copy#/share/${payload}`)
    stubHistory(address)
    settleLegacyHash()
    // The fragment is the only place the payload may sit. The path and query
    // are the request target, so a query the URL already carried must survive
    // without ever picking the trip up.
    expect(address.pathname + address.search).not.toContain(payload)
    expect(address.pathname).toBe('/')
    expect(address.search).toBe('?ref=copy')
    expect(address.hash).toBe(`#/share/${payload}`)
  })

  it('resolves the fragment share on every later read, so Back keeps working', async () => {
    // Back restores the address and re-reads the route; if only the boot bridge
    // could see the fragment, leaving the reader and coming back would land on
    // the landing page instead of the snapshot.
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/#/share/${payload}`)
    stubHistory()
    expect(currentRoute()).toBe(`/share/${payload}`)
  })

  it('leaves a real path in charge of the route, fragment or not', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/trips#/share/${payload}`)
    stubHistory()
    expect(currentRoute()).toBe('/trips')
  })

  it('still promotes every other legacy segment', async () => {
    // The bridge is not the defect. Narrowing it to snapshots only.
    for (const [hash, promoted] of [
      ['#/pub/two%20words', '/pub/two%20words'],
      ['#/trip/abc123', '/trip/abc123'],
      ['#/join/GOA4X2', '/join/GOA4X2'],
      ['#/invite/u_9', '/invite/u_9'],
      ['#/creator/u_9', '/creator/u_9'],
      ['#/trips', '/trips'],
    ] as const) {
      const address = stubAddress(`${ORIGIN}/${hash}`)
      const { replaces } = stubHistory(address)
      expect(settleLegacyHash(), hash).toBe(promoted)
      expect(replaces, hash).toEqual([promoted])
    }
  })

  it('treats a bare /share as an ordinary route, since it carries no payload', async () => {
    const address = stubAddress(`${ORIGIN}/#/share`)
    const { replaces } = stubHistory(address)
    expect(settleLegacyHash()).toBe('/share')
    expect(replaces).toEqual(['/share'])
  })

  it('keeps the share segment in the routed list the integrity test pins', async () => {
    // tests/route-integrity.test.ts needs `share` to be bridged. The router
    // still resolves /share/<payload> for old links, so the segment stays.
    expect(legacyHashRoute('#/share/yf1_abc')).toBe('/share/yf1_abc')
  })
})

describe('links made before the fix still render', () => {
  it('reads a legacy path link straight from the pathname', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    // What a link copied out of the address bar before this fix looks like.
    stubAddress(`${ORIGIN}/share/${payload}`)
    stubHistory()
    expect(currentRoute()).toBe(`/share/${payload}`)
    // And it still decodes: old links are readable, not merely routed.
    expect((await decodeTripSnapshot(payload)).name).toBe(CANARY)
  })

  it('keeps a legacy hash-era snapshot link readable too', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/#/share/${payload}`)
    stubHistory()
    expect(currentRoute()).toBe(`/share/${payload}`)
  })

  it('never names the payload in the browser tab title', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/#/share/${payload}`)
    stubHistory()
    const title = pageTitle(routeParts(currentRoute()))
    expect(title).not.toContain(payload)
    expect(title).not.toContain(CANARY)
  })
})

describe('startup and later reads apply one precedence rule', () => {
  /** App.tsx's own route initializer. The boot bridge gets the first word and
   *  the route reader answers every read after it. If the two disagree, the
   *  page the reader lands on depends on whether they arrived or pressed Back. */
  const startupRoute = (): string => settleLegacyHash() ?? currentRoute()

  it('is the expression App starts the route from', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('settleLegacyHash() ?? currentRoute()')
  })

  it('agrees on a real path that carries a snapshot fragment', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    const address = stubAddress(`${ORIGIN}/trips#/share/${payload}`)
    const { replaces } = stubHistory(address)
    const atStartup = startupRoute()
    // Back and Forward read the same address again.
    const later = currentRoute()
    expect(atStartup).toBe(later)
    expect(later).toBe('/trips')
    // A real path wins, and neither read moves the payload into it.
    expect(replaces).toEqual([])
    expect(address.pathname).toBe('/trips')
  })

  it('agrees on a publication path that carries a snapshot fragment', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    const address = stubAddress(`${ORIGIN}/pub/kerala-trip_1#/share/${payload}`)
    stubHistory(address)
    expect(startupRoute()).toBe('/pub/kerala-trip_1')
    expect(currentRoute()).toBe('/pub/kerala-trip_1')
  })

  it('agrees on the bare root, where the snapshot is the route', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    const address = stubAddress(`${ORIGIN}/#/share/${payload}`)
    const { replaces } = stubHistory(address)
    expect(startupRoute()).toBe(`/share/${payload}`)
    expect(currentRoute()).toBe(`/share/${payload}`)
    expect(replaces).toEqual([])
  })

  it('agrees when the host serves the document as index.html', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    const address = stubAddress(`${ORIGIN}/index.html#/share/${payload}`)
    stubHistory(address)
    expect(startupRoute()).toBe(`/share/${payload}`)
    expect(currentRoute()).toBe(`/share/${payload}`)
  })

  it('never settles a snapshot into a path, whatever the address carries', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    for (const prefix of [`${ORIGIN}/`, `${ORIGIN}/trips`, `${ORIGIN}/index.html`]) {
      const address = stubAddress(`${prefix}#/share/${payload}`)
      const { replaces } = stubHistory(address)
      startupRoute()
      expect(replaces, prefix).toEqual([])
      expect(address.pathname + address.search, prefix).not.toContain(payload)
    }
  })
})

describe('public publication and invite routes are untouched', () => {
  it('keeps serving a publication at its own path', () => {
    stubAddress(`${ORIGIN}/pub/kerala-trip_1`)
    stubHistory()
    expect(currentRoute()).toBe('/pub/kerala-trip_1')
  })

  it('keeps a query on a publication route readable', () => {
    const address = stubAddress(`${ORIGIN}/?ref=copy#/pub/kerala-trip_1`)
    const { replaces } = stubHistory(address)
    expect(settleLegacyHash()).toBe('/pub/kerala-trip_1?ref=copy')
    expect(replaces).toEqual(['/pub/kerala-trip_1?ref=copy'])
  })
})

describe('join secrets stay out of the payload', () => {
  it('never carries the invite code or the crew list, and decode drops them', async () => {
    const trip = {
      ...structuredClone(seedData.trips[0]),
      inviteCode: 'GOA-K7QF',
      members: [{ userId: 'amelia', role: 'owner' as const, joinedAt: 1 }],
    }
    const payload = await encodeTripSnapshot(trip)
    const back = await decodeTripSnapshot(payload)
    expect(back).not.toHaveProperty('inviteCode')
    expect(back).not.toHaveProperty('members')
    expect(back.name).toBe(trip.name)
  })
})

// The collector builds its data point in the page, from the page's own URL. A
// browser keeps a fragment out of a request, but that is not the same thing as
// keeping it out of a collector that reads `location` in the page. The guard
// lives in our code so the claim does not depend on a script this repo does not
// ship.
describe('analytics never receives a snapshot payload', () => {
  it('drops the payload from a data point and keeps the page view', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/trips`)
    const redacted = redactSnapshotUrl(snapshotUrl(trip, payload))
    expect(redacted).not.toContain(payload)
    expect(redacted).not.toContain(CANARY)
    // The route survives, so the visit is still counted as a snapshot open.
    expect(redacted).toBe(`${ORIGIN}/#/share`)
  })

  it('drops a legacy path payload too, since old links still get read', () => {
    expect(redactSnapshotUrl(`${ORIGIN}/share/yf1_payload`)).toBe(`${ORIGIN}/share`)
  })

  it.each([
    `${ORIGIN}/pub/kerala-trip_1`,
    `${ORIGIN}/trips?ref=copy`,
    `${ORIGIN}/join/GOA4X2`,
    `${ORIGIN}/`,
  ])('leaves an unrelated address alone: %s', url => {
    expect(redactSnapshotUrl(url)).toBe(url)
  })

  it('is wired into the analytics component', () => {
    // A guard nobody mounts is not a guard.
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('<Analytics beforeSend={analyticsBeforeSend} />')
    expect(app).toContain('redactSnapshotUrl(event.url)')
  })
})

describe('the referrer policy keeps a same-origin request from quoting the path', () => {
  it('keeps the strict policy in the deployed headers', () => {
    // A legacy path link is exposed on its first request no matter what we do
    // now, and the request target travels onward in a same-origin Referer
    // unless the policy holds. This is the control that stops a second copy.
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    const headers = config.headers.flatMap((entry: { source: string; headers: { key: string; value: string }[] }) =>
      entry.headers.filter(h => h.key === 'Referrer-Policy').map(h => h.value))
    expect(headers).toContain('strict-origin-when-cross-origin')
  })
})