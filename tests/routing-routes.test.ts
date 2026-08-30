// ============ Routing facade: Google-first, OSRM fallback (issue #6) ============
// Verified without any real network: the polyline codec against Google's own
// test vector, the Google→OSRM→estimate fallback chain with a stubbed fetch,
// and the quota guard gating Routes API calls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decodePolyline, travelModeFor, googleRoute, routesEnabled, QuotaExhaustedError,
} from '../src/lib/providers/routes'
import { quotaAllows, quotaResetForTests, quotaUsed, type QuotaSku } from '../src/lib/providers/quota'
import { roadLegBetween } from '../src/lib/routing'
import { getAssumptions } from '../src/lib/engine'

const A = { lat: 10.0, lng: 77.0 }
const B = { lat: 10.1, lng: 77.1 }

describe('decodePolyline', () => {
  it('decodes the canonical Google example vector', () => {
    // official docs example - points (-179.98321, 0) then (38.5, -120.2)
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(pts.length).toBe(3)
    expect(pts[0]).toEqual([-120.2, 38.5])
    expect(pts[1][1]).toBeCloseTo(40.7)
    expect(pts[2][0]).toBeCloseTo(-126.453)
  })

  it('handles an empty string', () => {
    expect(decodePolyline('')).toEqual([])
  })
})

describe('travelModeFor', () => {
  it('maps the engine modes to Google travelModes', () => {
    expect(travelModeFor('car')).toBe('DRIVE')
    expect(travelModeFor('taxi')).toBe('DRIVE')
    expect(travelModeFor('motorcycle')).toBe('TWO_WHEELER')
    expect(travelModeFor('bus')).toBe('BUS')
    expect(travelModeFor('train')).toBe('TRAIN')
    expect(travelModeFor('flight')).toBe('FLYING')
    expect(travelModeFor(undefined)).toBe('DRIVE')
  })
})

describe('googleRoute', () => {
  beforeEach(() => quotaResetForTests())
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); quotaResetForTests() })

  it('parses distance/duration/geometry from a computeRoutes response', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      routes: [{
        distanceMeters: 14200,
        duration: '1245s',
        polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
      }],
    }), { status: 200 })))
    const r = await googleRoute(A, B, 'car')
    expect(r.km).toBeCloseTo(14.2)
    expect(r.min).toBeCloseTo(1245 / 60)
    expect(r.coords.length).toBe(3)
    expect(quotaUsed('routes')).toBe(1)
  })

  it('throws without a Google key (facade falls back to OSRM)', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    expect(routesEnabled()).toBe(false)
    await expect(googleRoute(A, B, 'car')).rejects.toThrow()
  })

  it('throws (and counts nothing) when the quota soft cap is hit', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    const sku: QuotaSku = 'routes'
    const prev = (await import('../src/lib/providers/quota')).SOFT_CAPS[sku]
    const caps = (await import('../src/lib/providers/quota')).SOFT_CAPS
    caps[sku] = 0
    try {
      await expect(googleRoute(A, B, 'car')).rejects.toBeInstanceOf(QuotaExhaustedError)
      expect(quotaUsed('routes')).toBe(0)
    } finally {
      caps[sku] = prev
    }
  })
})

describe('routing facade fallback chain', () => {
  beforeEach(() => quotaResetForTests())
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); quotaResetForTests() })

  it('uses Google when a key is present and the API answers', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      routes: [{ distanceMeters: 8000, duration: '600s', polyline: { encodedPolyline: '' } }],
    }), { status: 200 })))
    const leg = await roadLegBetween(A, B, getAssumptions({ transportMode: 'car' }))
    expect(leg.source).toBe('google')
    expect(leg.distanceKm).toBeCloseTo(8)
  })

  it('falls back to OSRM when Google fails but no key is configured', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    // OSRM returns a route; Google is never called
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('router.project-osrm.org')) {
        return new Response(JSON.stringify({
          code: 'Ok',
          routes: [{ distance: 9000, duration: 720, geometry: { coordinates: [[77.0, 10.0], [77.1, 10.1]] } }],
        }), { status: 200 })
      }
      throw new Error('unexpected fetch: ' + String(input))
    }))
    const leg = await roadLegBetween(A, B, getAssumptions({ transportMode: 'car' }))
    expect(leg.source).toBe('osrm')
    expect(leg.distanceKm).toBeCloseTo(9)
  })

  it('falls back to the haversine estimate when both providers fail', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const leg = await roadLegBetween(A, B, getAssumptions({ transportMode: 'car' }))
    expect(leg.source).toBe('estimate')
    expect(leg.geometry).toEqual([[A.lng, A.lat], [B.lng, B.lat]])
  })
})
