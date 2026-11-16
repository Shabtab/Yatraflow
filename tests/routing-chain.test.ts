// ============ The routing layer's chain request + session leg cache ============
// #polylines (Sep 2026): routePath used to fire N−1 SEQUENTIAL per-leg fetches
// and cache nothing, so the map's road lines took ~30 serial round-trips to
// finish drawing and re-fetched everything on every mount/chip flip. The pins:
// one chain request per span, per-leg geometry split back out, chunking past
// 25 waypoints, cache hits skip fetches, estimate legs stay uncached, and an
// aborted caller stops paying the fetch budget.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routePath, clearRouteCacheForTests, routeCacheSizeForTests } from '../src/lib/routing'
import { getAssumptions } from '../src/lib/engine'

// The chain request is the KEYLESS path by design (a keyed caller spends
// Google quota per leg instead) — force it explicitly: vitest loads .env, so
// the developer's real VITE_GOOGLE_MAPS_API_KEY would silently take the
// Google-per-leg path and these assertions would measure the wrong branch.
async function stubKeyless() {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
  const { routesEnabled } = await import('../src/lib/providers/routes')
  expect(routesEnabled()).toBe(false)
}

const A = { lat: 10.0, lng: 77.0 }
const B = { lat: 10.1, lng: 77.1 }
const C = { lat: 10.2, lng: 77.2 }
const D = { lat: 10.3, lng: 77.3 }
const E = { lat: 10.4, lng: 77.4 }
const F = { lat: 10.5, lng: 77.5 }

const asm = getAssumptions({ transportMode: 'car' })

/** OSRM chain response for a waypoint list: one leg per consecutive pair. */
function chainResponse(points: { lat: number; lng: number }[]) {
  const legs = [] as unknown[]
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    legs.push({
      distance: 10_000,
      duration: 600,
      geometry: { coordinates: [[a.lng, a.lat], [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2], [b.lng, b.lat]] },
      annotation: { distance: [5_000, 5_000], duration: [300, 300] },
    })
  }
  return { code: 'Ok', routes: [{ legs }] }
}

let fetchCalls: string[] = []

/** URL-faithful OSRM stub: answers every request with a chain response whose
 *  legs match the REQUESTED waypoints (each leg gets its own endpoint-distinct
 *  geometry, so a mis-assigned leg is visible in the assertions). */
function echoOsrmFetch(input: RequestInfo | URL): Promise<Response> {
  fetchCalls.push(String(input))
  const coords = String(input).split('/route/v1/driving/')[1]!.split('?')[0]!
    .split(';').map(s => s.split(',').map(Number))
  const pts = coords.map(([lng, lat]) => ({ lat, lng }))
  return Promise.resolve(new Response(JSON.stringify(chainResponse(pts)), { status: 200 }))
}

beforeEach(async () => {
  clearRouteCacheForTests()
  fetchCalls = []
  await stubKeyless()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  clearRouteCacheForTests()
})

describe('routePath as one chain request', () => {
  it('measures a whole corridor in ONE OSRM fetch and splits per-leg geometry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return new Response(JSON.stringify(chainResponse([A, B, C])), { status: 200 })
    }))
    const legs = await routePath([A, B, C], asm)
    expect(legs.length).toBe(2)
    expect(legs.every(l => l.source === 'osrm')).toBe(true)
    // leg 0's geometry runs A→B (its own polyline, not the concatenated whole)
    expect(legs[0].geometry[0]).toEqual([A.lng, A.lat])
    expect(legs[0].geometry[legs[0].geometry.length - 1]).toEqual([B.lng, B.lat])
    expect(legs[1].geometry[0]).toEqual([B.lng, B.lat])
    expect(legs[1].geometry[legs[1].geometry.length - 1]).toEqual([C.lng, C.lat])
    expect(fetchCalls.length).toBe(1)
    // the chain URL carries all three waypoints
    expect(fetchCalls[0]).toContain(`${A.lng},${A.lat};${B.lng},${B.lat};${C.lng},${C.lat}`)
  })

  it('chunks a long corridor (over 25 waypoints) into parallel sub-requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      // echo the waypoints back as a proper chain response for whatever came in
      const coords = String(input).split('/route/v1/driving/')[1]!.split('?')[0]!
        .split(';').map(s => s.split(',').map(Number))
      const pts = coords.map(([lng, lat]) => ({ lat, lng }))
      return new Response(JSON.stringify(chainResponse(pts)), { status: 200 })
    }))
    const pts = Array.from({ length: 40 }, (_, i) => ({ lat: 10 + i * 0.01, lng: 77 + i * 0.01 }))
    const legs = await routePath(pts, asm)
    expect(legs.length).toBe(39)
    expect(legs.every(l => l.source === 'osrm')).toBe(true)
    // 40 waypoints = ceil(39 / 24) chunk requests, not 39
    expect(fetchCalls.length).toBe(2)
  })

  it('falls back to per-leg measurement when the chain request refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      const url = String(input)
      // the chain request (3 waypoints) fails; per-leg requests (2 waypoints) succeed
      if (url.includes(`${A.lng},${A.lat};${B.lng},${B.lat};${C.lng},${C.lat}`)) {
        return new Response(JSON.stringify({ code: 'NoRoute' }), { status: 200 })
      }
      return new Response(JSON.stringify(chainResponse([A, B])), { status: 200 })
    }))
    const legs = await routePath([A, B, C], asm)
    expect(legs.length).toBe(2)
    expect(legs.every(l => l.source === 'osrm')).toBe(true)
    expect(fetchCalls.length).toBe(3) // 1 failed chain + 2 per-leg
  })

  it('degrades unmeasured legs to the engine estimate — never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const legs = await routePath([A, B, C], asm)
    expect(legs.length).toBe(2)
    expect(legs.every(l => l.source === 'estimate')).toBe(true)
  })
})

describe('the session leg cache', () => {
  it('a measured span is not re-fetched on the next routePath over the same legs', async () => {
    // URL-faithful stub: OSRM always answers with legs matching the REQUESTED
    // waypoints — a canned body here would wrongly fail the leg-count check
    // and route the test through the per-leg fallback.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      const coords = String(input).split('/route/v1/driving/')[1]!.split('?')[0]!
        .split(';').map(s => s.split(',').map(Number))
      const pts = coords.map(([lng, lat]) => ({ lat, lng }))
      return new Response(JSON.stringify(chainResponse(pts)), { status: 200 })
    }))
    await routePath([A, B, C], asm)
    expect(fetchCalls.length).toBe(1)
    await routePath([A, B, C], asm)
    expect(fetchCalls.length).toBe(1) // zero new fetches
    expect(routeCacheSizeForTests()).toBe(2)
    // a partial overlap still fetches only the unknown leg's span
    const D = { lat: 10.3, lng: 77.3 }
    await routePath([C, D], asm)
    expect(fetchCalls.length).toBe(2)
    expect(String(fetchCalls[1])).toContain(`${C.lng},${C.lat};${D.lng},${D.lat}`)
  })

  it.each([
    { name: 'cached B→C between missing AB and CD', points: [A, B, C, D], cached: [1], span: [A, B, C, D] },
    { name: 'a hole at the start with only B→C cached', points: [A, B, C], cached: [1], span: [A, B] },
    { name: 'multiple cached holes (BC and DE)', points: [A, B, C, D, E, F], cached: [1, 3], span: [A, B, C, D, E, F] },
    { name: 'a nonzero span start with a cached hole', points: [A, B, C, D, E], cached: [0, 2], span: [B, C, D, E] },
    { name: 'a fully cold cache', points: [A, B, C, D], cached: [], span: [A, B, C, D] },
  ])('assigns and caches each span leg correctly: $name', async ({ points, cached, span }) => {
    vi.stubGlobal('fetch', vi.fn(echoOsrmFetch))
    for (const i of cached) await routePath(points.slice(i, i + 2), asm)
    expect(routeCacheSizeForTests()).toBe(cached.length)
    fetchCalls.length = 0

    const legs = await routePath(points, asm)
    expect(legs.length).toBe(points.length - 1)
    expect(legs.every(l => l.source === 'osrm')).toBe(true)
    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0]).toContain(span.map(p => `${p.lng},${p.lat}`).join(';'))
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      const geometry = [[a.lng, a.lat], [(a.lng + b.lng) / 2, (a.lat + b.lat) / 2], [b.lng, b.lat]]
      // Soft assertions expose BOTH wrong returned legs and poisoned cache keys.
      expect.soft(legs[i].geometry).toEqual(geometry)
      const hit = await routePath([a, b], asm)
      expect.soft(hit[0].geometry).toEqual(geometry)
    }
    // Each pair above must be served from its own cache key, without fetching.
    expect(fetchCalls.length).toBe(1)
    expect(routeCacheSizeForTests()).toBe(points.length - 1)
  })

  it('estimate legs are never cached — a rate-limited leg can recover', async () => {
    let down = true
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      if (down) throw new Error('rate limited')
      return new Response(JSON.stringify(chainResponse([A, B])), { status: 200 })
    }))
    const first = await routePath([A, B], asm)
    expect(first[0].source).toBe('estimate')
    expect(routeCacheSizeForTests()).toBe(0)
    down = false
    const second = await routePath([A, B], asm)
    expect(second[0].source).toBe('osrm')
    expect(routeCacheSizeForTests()).toBe(1)
  })

  it('cache entries are keyed by transport mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return new Response(JSON.stringify(chainResponse([A, B])), { status: 200 })
    }))
    await routePath([A, B], asm)
    await routePath([A, B], getAssumptions({ transportMode: 'motorcycle' }))
    expect(fetchCalls.length).toBe(2)
    expect(routeCacheSizeForTests()).toBe(2)
  })
})

describe('abort propagation', () => {
  it('an aborted signal stops the in-flight chain request', async () => {
    const ac = new AbortController()
    let sawSignal: AbortSignal | null = null
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sawSignal = init?.signal ?? null
      await new Promise(r => setTimeout(r, 30))
      throw new Error('should not matter — caller aborts first')
    }))
    const p = routePath([A, B, C], asm, ac.signal)
    ac.abort()
    const legs = await p
    // aborted fetches reject → the span degrades to estimates; the caller's
    // cancelled-flag decides whether they're ever used
    expect(legs.every(l => l.source === 'estimate')).toBe(true)
    // the shared request is cancelled one macrotask after its LAST subscriber
    // leaves (the grace lets a StrictMode replay adopt it), so wait past that
    await new Promise(r => setTimeout(r, 5))
    expect(sawSignal).not.toBeNull()
    expect(sawSignal!.aborted).toBe(true)
  })
})

describe('coordinate boundary guard (Codacy SAST: user-controlled URL taint)', () => {
  // Stop coordinates hydrate from Supabase as untyped JSON — a poisoned row
  // must never reach a request URL. The guard refuses the fetch and the span
  // degrades to estimates, exactly like a network failure.
  it('a non-numeric coordinate never reaches a fetch URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return new Response(JSON.stringify(chainResponse([A, B, C])), { status: 200 })
    }))
    // Simulate a poisoned hydration row: numbers typed as LatLng, runtime strings.
    const bad = { lat: '12.9', lng: '77.6' } as unknown as { lat: number; lng: number }
    const legs = await routePath([A, bad, C], asm)
    expect(legs.every(l => l.source === 'estimate')).toBe(true)
    expect(fetchCalls.length).toBe(0)
  })

  it('an out-of-range coordinate (raw Supabase lat < -90) never reaches a fetch URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return new Response(JSON.stringify(chainResponse([A, B, C])), { status: 200 })
    }))
    const bad = { lat: -999.5, lng: 77.0 }
    const legs = await routePath([A, bad, C], asm)
    expect(legs.every(l => l.source === 'estimate')).toBe(true)
    expect(fetchCalls.length).toBe(0)
  })

  it('boundary values stay legal (-90/90/±180 pass through and are fetched)', async () => {
    // this suite's stubKeyless already pins the env, but re-assert it HERE:
    // this is the only guard test that asserts a REAL fetch happened, so a
    // developer .env Google key would silently take the keyed branch and
    // zero-fetch the OSRM path this test exists to prove.
    const { routesEnabled } = await import('../src/lib/providers/routes')
    expect(routesEnabled()).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input))
      return new Response(JSON.stringify(chainResponse([A, B, C])), { status: 200 })
    }))
    const edge = { lat: -90, lng: 180 }
    const legs = await routePath([A, edge, C], asm)
    expect(legs.filter(l => l.source === 'osrm').length).toBe(2)
    expect(fetchCalls.length).toBe(1)
    expect(fetchCalls[0]).toContain('180,-90')
  })
})
