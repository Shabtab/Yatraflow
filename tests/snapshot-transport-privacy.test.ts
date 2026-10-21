// ============ Snapshot transport privacy (#805) ============
// A snapshot payload is the whole trip in reversible base64. A browser sends
// `pathname + search` and never the fragment, so those tests read the request
// target and check the trip is absent from it.
//
// Links made before the fix carried the payload in the path. They must still
// render, and they can never be un-exposed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeTripSnapshot, encodeTripSnapshot, redactSnapshotUrl, snapshotUrl } from '../src/lib/snapshot'
import { analyticsBeforeSend } from '../src/lib/analyticsPrivacy'
import { currentRoute, forceNativeRouting, legacyHashRoute, settleLegacyHash } from '../src/lib/router'
import { pageTitle, routeParts } from '../src/lib/pageTitle'
import { seedData } from '../src/data/seed'
import { readFileSync } from 'node:fs'

const ORIGIN = 'https://app.example.test'
const CANARY = 'CANARY-RAJASTHAN-HOLIDAY-PLAN'

function canaryTrip() {
  return { ...structuredClone(seedData.trips[0]), name: CANARY }
}

/** Decode every percent layer an address can hide, then read each payload
 *  token back with the shipped decoder. A canary name here means the trip
 *  travelled; an empty list means it did not. */
async function recoverableTripNames(value: string): Promise<string[]> {
  let decoded = value
  for (let pass = 0; pass < 8; pass++) {
    const next = decoded.replace(/(?:%[0-9a-f]{2})+/gi, run => {
      try {
        return decodeURIComponent(run)
      } catch {
        return run
      }
    })
    if (next === decoded) break
    decoded = next
  }
  const names: string[] = []
  for (const match of decoded.matchAll(/yf1_[A-Za-z0-9_-]+/g)) {
    try {
      names.push((await decodeTripSnapshot(match[0])).name)
    } catch {
      // Not a payload; leave it alone.
    }
  }
  return names
}

function requestTarget(url: URL | string): string {
  const parsed = typeof url === 'string' ? new URL(url) : url
  return parsed.pathname + parsed.search
}

function stubAddress(url: string) {
  const address = new URL(url)
  vi.stubGlobal('location', address)
  return address
}

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
    expect(replaces).toEqual([])
    expect(pushes).toEqual([])
    expect(address.pathname).toBe('/')
    expect(address.hash).toBe(`#/share/${payload}`)
    expect(settled).toBe(`/share/${payload}`)
  })

  it('never writes the payload into the path or query, whatever the URL already carried', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    const address = stubAddress(`${ORIGIN}/?ref=copy#/share/${payload}`)
    stubHistory(address)
    settleLegacyHash()
    expect(address.pathname + address.search).not.toContain(payload)
    expect(address.pathname).toBe('/')
    expect(address.search).toBe('?ref=copy')
    expect(address.hash).toBe(`#/share/${payload}`)
  })

  it('resolves the fragment share on every later read, so Back keeps working', async () => {
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
    // tests/route-integrity.test.ts needs `share` to be bridged, and the router
    // still resolves /share/<payload> for old links.
    expect(legacyHashRoute('#/share/yf1_abc')).toBe('/share/yf1_abc')
  })
})

describe('links made before the fix still render', () => {
  it('reads a legacy path link straight from the pathname', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    // A link copied out of the address bar before this fix.
    stubAddress(`${ORIGIN}/share/${payload}`)
    stubHistory()
    expect(currentRoute()).toBe(`/share/${payload}`)
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
/** App.tsx's own route initializer: the boot bridge gets the first word and
   *  the route reader answers every read after it. */
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
    const later = currentRoute()
    expect(atStartup).toBe(later)
    expect(later).toBe('/trips')
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

// A collector builds its data point in the page, from the page's own URL, so a
// fragment rule in the network does not reach it.
describe('analytics never receives a snapshot payload', () => {
  it('drops the payload from a data point and keeps the page view', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/trips`)
    const redacted = redactSnapshotUrl(snapshotUrl(trip, payload))
    expect(redacted).not.toContain(payload)
    expect(redacted).not.toContain(CANARY)
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

  it('drops a mixed-case route label', () => {
    expect(redactSnapshotUrl(`${ORIGIN}/Share/yf1_payload`)).toBe(`${ORIGIN}/share`)
    expect(redactSnapshotUrl(`${ORIGIN}/SHARE/yf1_payload`)).toBe(`${ORIGIN}/share`)
  })

  it('drops every canonical occurrence', () => {
    expect(redactSnapshotUrl(`${ORIGIN}/#/share/yf1_one?again=/share/yf1_two`))
      .toBe(`${ORIGIN}/#/share?again=/share`)
  })

  it('drops a route label that hides behind percent encoding', () => {
    expect(redactSnapshotUrl(`${ORIGIN}/%73hare/yf1_payload`)).toBe(`${ORIGIN}/share`)
  })
})

describe('the analytics callback drops a snapshot payload at every encoding', () => {
  it('redacts the canonical fragment link and keeps the page view', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/#/share/${payload}`)
    const event = analyticsBeforeSend({ type: 'pageview', url: snapshotUrl(trip, payload) })
    expect(event).not.toBeNull()
    expect(event?.url).toBe(`${ORIGIN}/#/share`)
    expect(await recoverableTripNames(event?.url ?? '')).toEqual([])
  })

  it('redacts a payload carried in an encoded nested URL', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    const nested = encodeURIComponent(`${ORIGIN}/#/share/${payload}`)
    const event = analyticsBeforeSend({ type: 'pageview', url: `${ORIGIN}/#/share/${payload}?next=${nested}` })
    expect(event?.url).not.toContain(payload)
    expect(await recoverableTripNames(event?.url ?? '')).toEqual([])
  })

  it('redacts a payload carried in a doubly encoded nested URL', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    const nested = encodeURIComponent(encodeURIComponent(`${ORIGIN}/#/share/${payload}`))
    const event = analyticsBeforeSend({ type: 'pageview', url: `${ORIGIN}/#/share/${payload}?next=${nested}` })
    expect(event?.url).not.toContain(payload)
    expect(await recoverableTripNames(event?.url ?? '')).toEqual([])
  })

  it('redacts mixed-case and percent-encoded route labels', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    for (const path of [`/Share/${payload}`, `/SHARE/${payload}`, `/%73hare/${payload}`]) {
      const event = analyticsBeforeSend({ type: 'pageview', url: `${ORIGIN}${path}` })
      expect(event?.url, path).not.toContain(payload)
      expect(await recoverableTripNames(event?.url ?? ''), path).toEqual([])
    }
  })

  it('redacts every occurrence, not only the first', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    const url = `${ORIGIN}/#/share/${payload}?a=${encodeURIComponent(`/share/${payload}`)}&b=/Share/${payload}`
    const event = analyticsBeforeSend({ type: 'pageview', url })
    expect(await recoverableTripNames(event?.url ?? '')).toEqual([])
  })
})

describe('the referrer policy is not a snapshot control', () => {
  it('keeps the deployed policy, which still sends a same-origin path', () => {
    // `strict-origin-when-cross-origin` strips the path only for CROSS-origin
    // requests. A legacy `/share/<payload>` link so recurs in same-origin
    // referrers for as long as a reader stays on that page, and no fragment rule
    // touches it. This test pins the setting so nobody reads the header as a
    // snapshot guarantee. A change here is a product decision about analytics
    // referrer data, not a snapshot fix (#805).
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    const policies = config.headers.flatMap((entry: { headers: { key: string; value: string }[] }) =>
      entry.headers.filter(h => h.key === 'Referrer-Policy').map(h => h.value))
    expect(policies).toEqual(['strict-origin-when-cross-origin'])
  })
})