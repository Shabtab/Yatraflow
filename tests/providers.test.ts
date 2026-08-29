// ============ Google Places provider tests ============
// Phase-A facade + Phase-B quota guard, verified without any real network:
// the encoded-polyline encoder against Google's own test vector, the
// localStorage quota guard, and the Google-first → free-stack fallbacks with
// a stubbed global fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePolyline } from '../src/lib/providers/google'
import {
  SOFT_CAPS, quotaAllows, quotaCount, quotaMonthKey, quotaResetForTests, quotaUsed,
} from '../src/lib/providers/quota'
import type { QuotaSku } from '../src/lib/providers/quota'
import { detourKm, searchNearbyPoisMulti, searchPlaces, resolveHitCoords, type PlaceHit } from '../src/lib/geocode'

describe('encodePolyline', () => {
  it('encodes [lng,lat] points with the canonical Google algorithm', () => {
    // the official example vector from Google's polyline encoding docs
    const pts: [number, number][] = [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
  })

  it('skips non-finite points instead of corrupting the deltas', () => {
    expect(encodePolyline([[77, 10] as [number, number], [NaN, 12] as [number, number]]))
      .toBe(encodePolyline([[77, 10]]))
    expect(encodePolyline([])).toBe('')
  })
})

describe('detourKm (offRouteKm override)', () => {
  it('prefers the real road detour from routingSummaries when present', () => {
    const hit = { latitude: 10, longitude: 77, offRouteKm: 4.2 } as PlaceHit
    expect(detourKm(hit, [{ lat: 10.5, lng: 77.5 }])).toBeCloseTo(4.2)
  })

  it('falls back to straight-line distance to the nearest anchor', () => {
    const hit = { latitude: 10, longitude: 77 } as PlaceHit
    expect(detourKm(hit, [{ lat: 10, lng: 77.1 }])).toBeGreaterThan(0)
  })
})

describe('quota guard (Phase B)', () => {
  beforeEach(() => quotaResetForTests())
  afterEach(() => quotaResetForTests())

  it('month key is YYYY-MM in UTC (counters roll over monthly)', () => {
    expect(quotaMonthKey(new Date('2026-08-29T10:00:00Z'))).toBe('2026-08')
    expect(quotaMonthKey(new Date('2026-01-01T00:30:00Z'))).toBe('2026-01')
  })

  it('counts events and blocks at the soft cap (free stack takes over)', () => {
    const sku: QuotaSku = 'textSearchPro'
    const prev = SOFT_CAPS[sku]
    SOFT_CAPS[sku] = 2
    try {
      expect(quotaAllows(sku)).toBe(true)
      quotaCount(sku)
      quotaCount(sku)
      expect(quotaUsed(sku)).toBe(2)
      expect(quotaAllows(sku)).toBe(false)
    } finally {
      SOFT_CAPS[sku] = prev
    }
  })

  it('soft caps sit at 80% of the verified India free allowances', () => {
    expect(SOFT_CAPS.textSearchPro).toBe(28_000) // 80% of 35k
    expect(SOFT_CAPS.autocomplete).toBe(56_000)  // 80% of 70k
    expect(SOFT_CAPS.placeDetails).toBe(56_000)  // 80% of 70k
  })
})

// ============ Facade: Google-first, free-stack-always (stubbed network) ============
const HOME = { lat: 10.01, lng: 77.01 }

/** tiny URL-routed fetch stub — handlers matched in order */
function routeFetch(handlers: Array<[RegExp, unknown]>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const [re, body] of handlers) {
      if (re.test(url)) return new Response(JSON.stringify(body), { status: 200 })
    }
    throw new Error('unexpected fetch: ' + url)
  })
}

const AUTOCOMPLETE_MUNNAR = {
  suggestions: [{
    placePrediction: {
      placeId: 'PID1',
      text: { text: 'Munnar, Kerala' },
      structuredFormat: { mainText: { text: 'Munnar' }, secondaryText: { text: 'Kerala, India' } },
      types: ['locality', 'geocode'],
    },
  }],
}
const OPEN_METEO_MUNNAR = {
  results: [{ id: 1, name: 'Munnar', latitude: 10.089, longitude: 77.06, admin1: 'Kerala', country: 'India', country_code: 'IN' }],
}
const EMPTY = {}
const OVERPASS_FALLS = {
  elements: [{ type: 'node', id: 42, lat: 10.2, lon: 77.2, tags: { name: 'KFDC Falls', tourism: 'attraction' } }],
}

describe('facade: searchPlaces', () => {
  beforeEach(() => quotaResetForTests())
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); quotaResetForTests() })

  it('without a key it never touches Google (free stack unchanged)', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    const f = routeFetch([
      [/open-meteo/, OPEN_METEO_MUNNAR],
      [/wikipedia/, EMPTY],
    ])
    vi.stubGlobal('fetch', f)
    const hits = await searchPlaces('munnar')
    expect(f.mock.calls.some(([u]) => String(u).includes('places:'))).toBe(false)
    expect(hits[0]).toMatchObject({ name: 'Munnar', source: 'open-meteo' })
  })

  it('with a key it prefers Google suggestions and keeps free results underneath', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    const f = routeFetch([
      [/places:autocomplete/, AUTOCOMPLETE_MUNNAR],
      [/open-meteo/, OPEN_METEO_MUNNAR],
      [/wikipedia/, EMPTY],
    ])
    vi.stubGlobal('fetch', f)
    const hits = await searchPlaces('munnar')
    expect(hits[0]).toMatchObject({ name: 'Munnar', placeId: 'PID1', source: 'google', kind: 'place' })
    expect(hits.some(h => h.source === 'open-meteo')).toBe(true)
  })

  it('on Google failure it silently falls back to the free stack', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('places:autocomplete')) return new Response('{}', { status: 500 })
      if (url.includes('open-meteo')) return new Response(JSON.stringify(OPEN_METEO_MUNNAR), { status: 200 })
      if (url.includes('wikipedia')) return new Response(JSON.stringify(EMPTY), { status: 200 })
      throw new Error('unexpected fetch: ' + url)
    })
    vi.stubGlobal('fetch', f)
    const hits = await searchPlaces('munnar')
    expect(hits[0]).toMatchObject({ name: 'Munnar', source: 'open-meteo' })
    expect(hits.some(h => h.source === 'google')).toBe(false)
  })
})

describe('facade: resolveHitCoords', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('resolves Google picks via one Place Details call', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.stubGlobal('fetch', routeFetch([
      [/\/places\/PID1/, { id: 'PID1', location: { latitude: 10.089, longitude: 77.06 }, formattedAddress: 'Munnar, Kerala 685612, India' }],
    ]))
    const hit = await resolveHitCoords({ id: 'gpred_PID1', name: 'Munnar', latitude: 0, longitude: 0, kind: 'place', placeId: 'PID1', source: 'google' } as PlaceHit)
    expect(hit.latitude).toBeCloseTo(10.089)
    expect(hit.longitude).toBeCloseTo(77.06)
  })

  it('leaves a stale Google pick untouched when the key is gone', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const hit = await resolveHitCoords({ id: 'gpred_PID1', name: 'Munnar', latitude: 0, longitude: 0, kind: 'place', placeId: 'PID1', source: 'google' } as PlaceHit)
    expect(hit.latitude).toBe(0)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('facade: searchNearbyPoisMulti (Search-Along-Route)', () => {
  beforeEach(() => quotaResetForTests())
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); quotaResetForTests() })

  it('with route geometry it runs 3 category queries and maps places, hours and road detours', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    const f = routeFetch([
      [/places:searchText/, {
        places: [
          { id: 'P1', displayName: { text: 'Echo Point' }, location: { latitude: 10.15, longitude: 77.15 }, primaryTypeDisplayName: { text: 'Tourist attraction' }, regularOpeningHours: { periods: [{ open: { hour: 9, minute: 0 }, close: { hour: 18, minute: 0 } }] } },
          { id: 'P2', displayName: { text: 'Home Cafe' }, location: { latitude: HOME.lat, longitude: HOME.lng }, primaryTypeDisplayName: { text: 'Cafe' }, currentOpeningHours: { periods: [{ open: { hour: 8, minute: 30 }, close: { hour: 22, minute: 0 } }] } },
        ],
        routingSummaries: [{ distanceMeters: 4200 }, { distanceMeters: 300 }],
      }],
    ])
    vi.stubGlobal('fetch', f)
    const hits = await searchNearbyPoisMulti([{ lat: 10.0, lng: 77.0 }], 20000, 10, {
      routeCoords: [[77.0, 10.0], [77.4, 10.5]],
      homeCenter: HOME,
    })
    const searchCalls = f.mock.calls.filter(([u]) => String(u).includes('places:searchText'))
    expect(searchCalls.length).toBe(3) // attractions + food + hotels (no fuel)
    const body = JSON.parse(String(searchCalls[0][1]?.body))
    expect(body.searchAlongRouteParameters.polyline.encodedPolyline).toBeTruthy()
    expect(body.regionCode).toBe('IN')
    const echo = hits.find(h => h.name === 'Echo Point')!
    expect(echo).toMatchObject({ category: 'sightseeing', openTime: '09:00', closeTime: '18:00' })
    expect(echo.offRouteKm).toBeCloseTo(4.2) // real road detour from routingSummaries
    // the home-zone exclusion still applies to Google hits
    expect(hits.some(h => h.name === 'Home Cafe')).toBe(false)
  })

  it('falls back to the free stack when Google returns nothing (round-trip routes)', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.stubGlobal('fetch', routeFetch([
      [/places:searchText/, EMPTY],
      [/overpass/, OVERPASS_FALLS],
      [/open-meteo/, EMPTY],
      [/wikipedia/, EMPTY],
    ]))
    const hits = await searchNearbyPoisMulti([{ lat: 10.0, lng: 77.0 }], 20000, 10, {
      routeCoords: [[77.0, 10.0], [77.4, 10.5]],
    })
    expect(hits.some(h => h.name === 'KFDC Falls')).toBe(true)
    expect(hits.some(h => h.source === 'google')).toBe(false)
  })

  it('counts Text Search Pro events against the quota guard', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
    vi.stubGlobal('fetch', routeFetch([
      [/places:searchText/, {
        places: [{ id: 'P1', displayName: { text: 'Echo Point' }, location: { latitude: 10.15, longitude: 77.15 } }],
        routingSummaries: [],
      }],
    ]))
    await searchNearbyPoisMulti([{ lat: 10.0, lng: 77.0 }], 20000, 10, { routeCoords: [[77.0, 10.0], [77.4, 10.5]] })
    expect(quotaUsed('textSearchPro')).toBe(3)
  })
})