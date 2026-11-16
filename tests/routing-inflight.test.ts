// The account-wide Routes quota asks Supabase before each Google request. These
// tests drive the Google path, so the shared counter always grants here. The
// fail-closed cases are covered in tests/shared-routes-quota.test.ts.
vi.mock('../src/lib/supabase', () => {
  const granted = () => {
    const b: {
      abortSignal: () => unknown
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise<unknown>
    } = {
      abortSignal: () => b,
      then: (ok, fail) => Promise.resolve({ data: true, error: null }).then(ok, fail),
    }
    return b
  }
  return { isSupabaseConfigured: true, supabase: { rpc: () => granted() } }
})

// ============ Routing: one Google request per cold load ============
// A signed-in trip page load used to fire 16 Google computeRoutes requests:
// two whole-chain requests (React StrictMode replays the workspace effect, and
// nothing shared the pending request) plus fourteen per-leg requests (a chain
// that failed in transport was "recovered" by splitting it, which cannot help).
// These tests pin the call counts with a stubbed fetch — no real network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routePath, roadLegBetween, clearRouteCacheForTests, type LatLng } from '../src/lib/routing'
import { googleRoute } from '../src/lib/providers/routes'
import { SOFT_CAPS, quotaResetForTests } from '../src/lib/providers/quota'
import { getAssumptions } from '../src/lib/engine'

const asm = getAssumptions({ transportMode: 'car' })
const GOOGLE_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

/** 15 stops on a line, like the Kerala trip (14 legs, 13 intermediates). */
const KERALA: LatLng[] = Array.from({ length: 15 }, (_, i) => ({ lat: 10 + i * 0.01, lng: 77 + i * 0.01 }))
const A = KERALA[0]
const B = KERALA[1]

/** Google encoded polyline encoder (inverse of decodePolyline, 1e5). */
function enc(v: number): string {
  let x = v < 0 ? ~(v << 1) : (v << 1)
  let s = ''
  while (x >= 0x20) { s += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5 }
  return s + String.fromCharCode(x + 63)
}
function encodePolyline(coords: [number, number][]): string {
  let prevLat = 0
  let prevLng = 0
  let out = ''
  for (const [lng, lat] of coords) {
    const ilat = Math.round(lat * 1e5)
    const ilng = Math.round(lng * 1e5)
    out += enc(ilat - prevLat) + enc(ilng - prevLng)
    prevLat = ilat
    prevLng = ilng
  }
  return out
}

interface Waypoint { location?: { latLng?: { latitude?: number; longitude?: number } } }
interface Body { origin?: Waypoint; destination?: Waypoint; intermediates?: Waypoint[] }

function waypointsOf(body: Body): LatLng[] {
  const ll = (w?: Waypoint): LatLng[] => {
    const p = w?.location?.latLng
    return p?.latitude != null && p?.longitude != null ? [{ lat: p.latitude, lng: p.longitude }] : []
  }
  return [...ll(body.origin), ...(body.intermediates ?? []).flatMap(ll), ...ll(body.destination)]
}

/** A Google response whose polyline runs through exactly the requested points. */
function googleBody(body: Body, legCount?: number, polylinePoints?: LatLng[]): Response {
  const pts = waypointsOf(body)
  const n = legCount ?? pts.length - 1
  const coords = (polylinePoints ?? pts).map(p => [p.lng, p.lat] as [number, number])
  const polyline = { encodedPolyline: encodePolyline(coords) }
  const base = { distanceMeters: 10_000 * (pts.length - 1), duration: `${600 * (pts.length - 1)}s`, polyline }
  const legs = Array.from({ length: n }, (_, i) => ({ distanceMeters: 10_000 + i * 1000, duration: `${600 + i * 60}s` }))
  return new Response(JSON.stringify({ routes: [(body.intermediates ?? []).length ? { ...base, legs } : base] }), { status: 200 })
}

/** An OSRM chain response for the coordinates named in the URL, in the real
 *  shape: the road shape sits on the route, and each leg carries its own counts. */
function osrmChain(url: string): Response {
  const pts = url.split('/route/v1/driving/')[1]!.split('?')[0]!.split(';').map(s => s.split(',').map(Number))
  const legs = pts.slice(0, -1).map(() => ({ distance: 5000, duration: 300, annotation: { distance: [5000], duration: [300] } }))
  const route = { distance: 5000 * legs.length, duration: 300 * legs.length, geometry: { type: 'LineString', coordinates: pts }, legs }
  return new Response(JSON.stringify({ code: 'Ok', routes: [route] }), { status: 200 })
}

interface Calls { google: Body[]; googleSignals: (AbortSignal | undefined)[]; osrm: string[] }
let calls: Calls

type GoogleHandler = (body: Body, init: RequestInit | undefined) => Response | Promise<Response>
interface Stub { google?: GoogleHandler; osrm?: (url: string) => Response | Promise<Response> }

function stubFetch(stub: Stub): void {
  calls = { google: [], googleSignals: [], osrm: [] }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (url === GOOGLE_URL) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Body
      calls.google.push(body)
      calls.googleSignals.push(init?.signal ?? undefined)
      if (!stub.google) throw new TypeError('Failed to fetch')
      return stub.google(body, init)
    }
    if (url.includes('router.project-osrm.org')) {
      calls.osrm.push(url)
      if (!stub.osrm) throw new TypeError('Failed to fetch')
      return stub.osrm(url)
    }
    throw new Error('unexpected fetch: ' + url)
  }))
}

const ok: GoogleHandler = body => googleBody(body)
const transportFailure: GoogleHandler = () => { throw new TypeError('Failed to fetch') }

beforeEach(() => {
  clearRouteCacheForTests()
  quotaResetForTests()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  quotaResetForTests()
  clearRouteCacheForTests()
})

describe('a cold load makes one Google attempt', () => {
  it('success: a 15-stop chain is two Google requests, one per 12-point chunk', async () => {
    stubFetch({ google: ok })
    const legs = await routePath(KERALA, asm)
    expect(legs).toHaveLength(14)
    expect(legs.every(l => l.source === 'google')).toBe(true)
    expect(calls.google).toHaveLength(2)
    expect(calls.osrm).toHaveLength(0)
  })

  it('transport failure: 1 Google request, then 1 OSRM chain, never one Google request per leg', async () => {
    stubFetch({ google: transportFailure, osrm: osrmChain })
    const legs = await routePath(KERALA, asm)
    expect(calls.google).toHaveLength(1)
    expect(calls.osrm).toHaveLength(1)
    expect(legs).toHaveLength(14)
    expect(legs.every(l => l.source === 'osrm')).toBe(true)
  })

  it('transport failure with OSRM down: 1 Google + 1 OSRM, then estimates (planning never blocks)', async () => {
    stubFetch({ google: transportFailure })
    const legs = await routePath(KERALA, asm)
    expect(calls.google).toHaveLength(1)
    expect(calls.osrm).toHaveLength(1)
    expect(legs).toHaveLength(14)
    expect(legs.every(l => l.source === 'estimate')).toBe(true)
  })

  it.each([401, 403, 429])('HTTP %i is an auth/quota failure: no per-leg Google retry', async status => {
    stubFetch({ google: () => new Response('{}', { status }), osrm: osrmChain })
    const legs = await routePath(KERALA, asm)
    expect(calls.google).toHaveLength(1)
    expect(calls.osrm).toHaveLength(1)
    expect(legs.every(l => l.source === 'osrm')).toBe(true)
  })

  it('quota guard refusal sends no Google request, then 1 OSRM chain', async () => {
    const prev = SOFT_CAPS.routes
    SOFT_CAPS.routes = 0
    try {
      stubFetch({ google: ok, osrm: osrmChain })
      const legs = await routePath(KERALA, asm)
      expect(calls.google).toHaveLength(0)
      expect(calls.osrm).toHaveLength(1)
      expect(legs.every(l => l.source === 'osrm')).toBe(true)
    } finally {
      SOFT_CAPS.routes = prev
    }
  })
})

describe('in-flight sharing', () => {
  it('two concurrent identical routePath calls share one Google request per chunk', async () => {
    stubFetch({ google: ok })
    const [x, y] = await Promise.all([routePath(KERALA, asm), routePath(KERALA, asm)])
    expect(calls.google).toHaveLength(2)
    expect(x.every(l => l.source === 'google')).toBe(true)
    expect(y.map(l => l.distanceKm)).toEqual(x.map(l => l.distanceKm))
  })

  it('two concurrent identical calls on a transport failure: 1 Google + 1 OSRM in total', async () => {
    stubFetch({ google: transportFailure, osrm: osrmChain })
    await Promise.all([routePath(KERALA, asm), routePath(KERALA, asm)])
    expect(calls.google).toHaveLength(1)
    expect(calls.osrm).toHaveLength(1)
  })

  it('a different mode or a different route is not shared', async () => {
    stubFetch({ google: ok })
    await Promise.all([
      routePath(KERALA, asm),
      routePath(KERALA, getAssumptions({ transportMode: 'motorcycle' })),
      routePath(KERALA.slice(0, 5), asm),
    ])
    expect(calls.google).toHaveLength(5) // 2 + 2 + 1 chunks
  })

  it('concurrent single legs share one Google request by the leg cache key', async () => {
    stubFetch({ google: ok })
    const [x, y] = await Promise.all([roadLegBetween(A, B, asm), roadLegBetween(A, B, asm)])
    expect(calls.google).toHaveLength(1)
    expect(x.source).toBe('google')
    expect(y.source).toBe('google')
  })

  it('an aborted first subscriber does not cancel the second subscriber', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    stubFetch({
      google: async (body, init) => {
        await gate
        if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
        return googleBody(body)
      },
    })
    const first = new AbortController()
    const second = new AbortController()
    const p1 = routePath(KERALA, asm, first.signal)
    const p2 = routePath(KERALA, asm, second.signal)
    first.abort()
    await new Promise(r => setTimeout(r, 5)) // past the abandon grace period
    expect(calls.googleSignals[0]?.aborted).toBe(false)
    release()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r2.every(l => l.source === 'google')).toBe(true)
    expect(r1.every(l => l.source === 'estimate')).toBe(true) // the aborted caller degrades, never throws
    expect(calls.google).toHaveLength(2)
  })

  it('StrictMode replay (subscribe, abort, subscribe in one tick) is still one Google request per chunk', async () => {
    stubFetch({ google: ok })
    const first = new AbortController()
    const p1 = routePath(KERALA, asm, first.signal)
    first.abort() // effect cleanup
    const p2 = routePath(KERALA, asm, new AbortController().signal) // effect replay
    const [, r2] = await Promise.all([p1, p2])
    expect(calls.google).toHaveLength(2)
    expect(r2.every(l => l.source === 'google')).toBe(true)
  })

  it('when every subscriber aborts, the shared Google request is cancelled', async () => {
    stubFetch({ google: (_body, init) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    }) })
    const ac = new AbortController()
    const p = routePath(KERALA, asm, ac.signal)
    ac.abort()
    await p
    await new Promise(r => setTimeout(r, 5))
    expect(calls.google).toHaveLength(1)
    expect(calls.googleSignals[0]?.aborted).toBe(true)
    expect(calls.osrm).toHaveLength(0)
  })

  it('a cancelled request does not poison the next load', async () => {
    stubFetch({ google: ok })
    const ac = new AbortController()
    const p = routePath(KERALA, asm, ac.signal)
    ac.abort()
    await p
    await new Promise(r => setTimeout(r, 5))
    const legs = await routePath(KERALA, asm)
    expect(legs.every(l => l.source === 'google')).toBe(true)
  })
})

describe('googleRoute honours the caller signal', () => {
  it('the fetch signal aborts when the caller aborts', async () => {
    stubFetch({ google: ok })
    const ac = new AbortController()
    await googleRoute(A, B, 'car', [], ac.signal)
    const sent = calls.googleSignals[0]!
    expect(sent.aborted).toBe(false)
    ac.abort()
    expect(sent.aborted).toBe(true)
  })

  it('an already-aborted caller sends no request', async () => {
    stubFetch({ google: ok })
    const ac = new AbortController()
    ac.abort()
    await expect(googleRoute(A, B, 'car', [], ac.signal)).rejects.toThrow()
    expect(calls.google).toHaveLength(0)
  })
})

describe('two-point chains', () => {
  it('accepts the single-route result as one leg: one call, not two', async () => {
    stubFetch({ google: ok })
    const legs = await routePath([A, B], asm)
    expect(legs).toHaveLength(1)
    expect(legs[0].source).toBe('google')
    expect(calls.google).toHaveLength(1)
  })

  it('a 26-point chain splits into three chunks and costs three requests', async () => {
    stubFetch({ google: ok })
    const pts = Array.from({ length: 26 }, (_, i) => ({ lat: 10 + i * 0.01, lng: 77 + i * 0.01 }))
    const legs = await routePath(pts, asm)
    expect(legs).toHaveLength(25)
    expect(legs.every(l => l.source === 'google')).toBe(true)
    expect(calls.google).toHaveLength(3)
  })
})

describe('failures that splitting can fix still split', () => {
  it('a leg-count mismatch falls back to per-leg Google requests', async () => {
    stubFetch({ google: body => ((body.intermediates ?? []).length ? googleBody(body, 1) : googleBody(body)) })
    const legs = await routePath(KERALA.slice(0, 3), asm)
    expect(legs.every(l => l.source === 'google')).toBe(true)
    expect(calls.google).toHaveLength(3) // 1 refused chain + 2 legs
    expect(calls.osrm).toHaveLength(0)
  })

  it('a refused geometry assertion falls back to per-leg Google requests', async () => {
    // the chain's polyline skips the middle stop, so the geometry assertion refuses it
    const offRoad: GoogleHandler = body => (
      (body.intermediates ?? []).length
        ? googleBody(body, undefined, [KERALA[0], { lat: 10.6, lng: 77.5 }, KERALA[2]])
        : googleBody(body)
    )
    stubFetch({ google: offRoad })
    const legs = await routePath(KERALA.slice(0, 3), asm)
    expect(legs.every(l => l.source === 'google')).toBe(true)
    expect(calls.google).toHaveLength(3)
  })
})
