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

// ============ Google Routes corridor measurement (intermediates) ============
// #polylines: with a key configured, the whole corridor used to cost ONE
// Google event PER LEG (19 events for a 20-stop trip). computeRoutes accepts
// intermediates in one call, so a keyed corridor now costs ONE event per 12-point chunk — and
// per #187's rule, the response geometry is ASSERTED before it is drawn:
// every requested waypoint must sit on the returned polyline.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routePath, clearRouteCacheForTests } from '../src/lib/routing'
import { googleRoute, decodePolyline } from '../src/lib/providers/routes'
import { quotaResetForTests, quotaUsed } from '../src/lib/providers/quota'
import { getAssumptions } from '../src/lib/engine'

const A = { lat: 10.0, lng: 77.0 }
const B = { lat: 10.1, lng: 77.1 }
const C = { lat: 10.2, lng: 77.2 }

const asm = getAssumptions({ transportMode: 'car' })

/** Google encoded polyline encoder (the inverse of decodePolyline, 1e5). */
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
function enc(v: number): string {
  let x = v < 0 ? ~(v << 1) : (v << 1)
  let s = ''
  while (x >= 0x20) { s += String.fromCharCode((0x20 | (x & 0x1f)) + 63); x >>= 5 }
  return s + String.fromCharCode(x + 63)
}

interface WaypointBody {
  origin?: { location?: { latLng?: { latitude?: number; longitude?: number } } }
  destination?: { location?: { latLng?: { latitude?: number; longitude?: number } } }
  intermediates?: { location?: { latLng?: { latitude?: number; longitude?: number } } }[]
}

/** Waypoints of a computeRoutes request body, in corridor order. */
function waypointsOf(body: WaypointBody): { lat: number; lng: number }[] {
  const pts: { lat: number; lng: number }[] = []
  const o = body.origin?.location?.latLng
  if (o?.latitude != null && o?.longitude != null) pts.push({ lat: o.latitude, lng: o.longitude })
  for (const i of body.intermediates ?? []) {
    const w = i.location?.latLng
    if (w?.latitude != null && w?.longitude != null) pts.push({ lat: w.latitude, lng: w.longitude })
  }
  const d = body.destination?.location?.latLng
  if (d?.latitude != null && d?.longitude != null) pts.push({ lat: d.latitude, lng: d.longitude })
  return pts
}

/** A corridor response whose polyline runs through exactly the given points. */
function corridorResponse(points: { lat: number; lng: number }[], legCount?: number) {
  const n = legCount ?? points.length - 1
  const legs = Array.from({ length: n }, (_, i) => ({ distanceMeters: 10_000 + i * 1000, duration: `${600 + i * 60}s` }))
  const coords = points.map(p => [p.lng, p.lat] as [number, number])
  return new Response(JSON.stringify({
    routes: [{ distanceMeters: 10_000 * n, duration: `${600 * n}s`, polyline: { encodedPolyline: encodePolyline(coords) }, legs }],
  }), { status: 200 })
}

/** A point-to-point (no intermediates) response for the per-leg fallback. */
function pointResponse() {
  return new Response(JSON.stringify({
    routes: [{ distanceMeters: 12_000, duration: '700s', polyline: { encodedPolyline: encodePolyline([[77.0, 10.0], [77.1, 10.1]]) } }],
  }), { status: 200 })
}

let fetchCalls: string[] = []

beforeEach(() => {
  clearRouteCacheForTests()
  fetchCalls = []
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  quotaResetForTests()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  quotaResetForTests()
  clearRouteCacheForTests()
})

describe('googleRoute with intermediates', () => {
  it('splits one corridor response into per-leg results aligned with the requested legs', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as WaypointBody
      return corridorResponse(waypointsOf(body))
    }))
    const r = await googleRoute(A, C, 'car', [B])
    expect('legs' in r && r.legs.length === 2).toBe(true)
    if (!('legs' in r)) return
    expect(r.legs[0].coords[0]).toEqual([A.lng, A.lat])
    expect(r.legs[0].coords[r.legs[0].coords.length - 1]).toEqual([B.lng, B.lat])
    expect(r.legs[1].coords[0]).toEqual([B.lng, B.lat])
    expect(r.legs[1].coords[r.legs[1].coords.length - 1]).toEqual([C.lng, C.lat])
  })

  it('refuses a corridor whose waypoints sit off the returned polyline (#187 rule)', async () => {
    // the polyline skips B entirely — a response that "re-routed" must not be
    // drawn as the road we asked for
    vi.stubGlobal('fetch', vi.fn(async () => corridorResponse([A, { lat: 10.6, lng: 77.1 }, C])))
    await expect(googleRoute(A, C, 'car', [B])).rejects.toThrow(/off the returned polyline/)
  })

  it('refuses a corridor response with a mismatched leg count', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as WaypointBody
      return corridorResponse(waypointsOf(body), 1) // 2 legs requested, 1 returned
    }))
    await expect(googleRoute(A, C, 'car', [B])).rejects.toThrow(/missing per-leg data/)
  })

  it('round-trips the polyline codec against the corridor geometry', async () => {
    const coords: [number, number][] = [[77.0, 10.0], [77.05, 10.05], [77.1, 10.1], [77.2, 10.2]]
    const decoded = decodePolyline(encodePolyline(coords))
    expect(decoded.length).toBe(coords.length)
    expect(decoded[2][0]).toBeCloseTo(77.1)
    expect(decoded[2][1]).toBeCloseTo(10.1)
  })
})

describe('routePath over a keyed corridor', () => {
  it('measures the whole corridor in ONE Google event (not one per leg)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push(String(input))
      const body = JSON.parse(String(init?.body ?? '{}')) as WaypointBody
      return corridorResponse(waypointsOf(body))
    }))
    const legs = await routePath([A, B, C], asm)
    expect(legs.length).toBe(2)
    expect(legs.every(l => l.source === 'google')).toBe(true)
    expect(fetchCalls.length).toBe(1)
    expect(quotaUsed('routes')).toBe(1) // ONE quota event for the corridor
  })

  it('chunks a long keyed corridor past the waypoint cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push(String(input))
      const body = JSON.parse(String(init?.body ?? '{}')) as WaypointBody
      return corridorResponse(waypointsOf(body))
    }))
    const pts = Array.from({ length: 30 }, (_, i) => ({ lat: 10 + i * 0.01, lng: 77 + i * 0.01 }))
    const legs = await routePath(pts, asm)
    expect(legs.length).toBe(29)
    expect(legs.every(l => l.source === 'google')).toBe(true)
    expect(fetchCalls.length).toBe(3) // 12 + 12 + 8 waypoints, the joints shared
  })

  it('falls back to per-leg measurement when the corridor is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push('x')
      const body = JSON.parse(String(init?.body ?? '{}')) as WaypointBody
      if (body.intermediates?.length) return corridorResponse([A, { lat: 10.6, lng: 77.1 }, C]) // refused
      return pointResponse()
    }))
    const legs = await routePath([A, B, C], asm)
    expect(legs.length).toBe(2)
    expect(legs.every(l => l.source === 'google')).toBe(true) // per-leg google succeeded
    expect(fetchCalls.length).toBe(3) // 1 refused corridor + 2 per-leg
  })
})
