// #704 — a failed stop search is not an empty one.
//
// The public search answers an empty list on a provider failure, because most of
// its callers cannot show a note. The Map tab passes `rejectOnFailure`, so its
// cache hook hears the failure. The Map then shows its own note in place of
// "Not enough driving distance". The searches run against a stubbed fetch, as
// tests/providers.test.ts does. The wiring between the hook and the Map tab is
// pinned as source text.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { planJourneyHalts, searchNearbyPoisMulti } from '../src/lib/geocode'
import { QuotaExhaustedError } from '../src/lib/providers/google'
import { SOFT_CAPS, quotaResetForTests } from '../src/lib/providers/quota'

const ROUTE = [[77.0, 10.0], [77.4, 10.5]] as [number, number][]
const ANCHOR = { lat: 10.0, lng: 77.0 }
const FAR_ANCHOR = { lat: 10.4, lng: 77.3 }

type SearchBody = { locationBias?: { circle?: { center?: { latitude?: number } } } }

/** Answers every Google text search with `respond`. Any other URL fails, as an offline stub would. */
function stubPlaces(respond: (body: SearchBody) => Response) {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.includes('places:searchText')) throw new Error('unexpected fetch: ' + url)
    return respond(JSON.parse(String(init?.body ?? '{}')) as SearchBody)
  })
  vi.stubGlobal('fetch', f)
  return f
}

const httpError = () => new Response('{}', { status: 500 })
const noStops = () => new Response('{}', { status: 200 })

describe('a failed stop search is not an empty one (#704)', () => {
  beforeEach(() => {
    quotaResetForTests()
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    quotaResetForTests()
  })

  it('rejects a failed route search when the caller asks to hear failures', async () => {
    stubPlaces(httpError)
    await expect(searchNearbyPoisMulti([ANCHOR], 20000, 10, { routeCoords: ROUTE, rejectOnFailure: true })).rejects.toThrow('HTTP 500')
  })

  it('still answers an empty list for the same failure when the caller does not ask', async () => {
    stubPlaces(httpError)
    await expect(searchNearbyPoisMulti([ANCHOR], 20000, 10, { routeCoords: ROUTE })).resolves.toEqual([])
  })

  it('answers an empty list, not a rejection, when Google searched and found nothing', async () => {
    stubPlaces(noStops)
    await expect(searchNearbyPoisMulti([ANCHOR], 20000, 10, { routeCoords: ROUTE, rejectOnFailure: true })).resolves.toEqual([])
  })

  it('rejects a point-search scan in which every anchor fails', async () => {
    stubPlaces(httpError)
    await expect(searchNearbyPoisMulti([ANCHOR, FAR_ANCHOR], 20000, 10, { rejectOnFailure: true })).rejects.toThrow('HTTP 500')
  })

  it('rejects a point-search scan that found no stop while one anchor failed', async () => {
    stubPlaces(body => (body.locationBias?.circle?.center?.latitude === ANCHOR.lat ? noStops() : httpError()))
    await expect(searchNearbyPoisMulti([ANCHOR, FAR_ANCHOR], 20000, 10, { rejectOnFailure: true })).rejects.toThrow('HTTP 500')
  })

  it('a quota error still reaches the caller, with or without the flag', async () => {
    stubPlaces(noStops)
    const previousCap = SOFT_CAPS.textSearchPro
    SOFT_CAPS.textSearchPro = 0
    try {
      await expect(searchNearbyPoisMulti([ANCHOR], 20000, 10, { routeCoords: ROUTE })).rejects.toBeInstanceOf(QuotaExhaustedError)
      await expect(searchNearbyPoisMulti([ANCHOR], 20000, 10, { routeCoords: ROUTE, rejectOnFailure: true })).rejects.toBeInstanceOf(QuotaExhaustedError)
    } finally {
      SOFT_CAPS.textSearchPro = previousCap
    }
  })

  it('the Map plan rejects when its stop search fails, and other callers still get a plan', async () => {
    stubPlaces(httpError)
    const anchors = [ANCHOR, FAR_ANCHOR]
    await expect(planJourneyHalts(anchors, 900, 900, { routeCoords: ROUTE, multiDay: true, rejectOnFailure: true }, 35000)).rejects.toThrow('HTTP 500')
    await expect(planJourneyHalts(anchors, 900, 900, { routeCoords: ROUTE, multiDay: true }, 35000)).resolves.toEqual(expect.any(Array))
  })
})

describe('the Map tab turns the failure into its own note (#704)', () => {
  const geocode = readFileSync(new URL('../src/lib/geocode.ts', import.meta.url), 'utf8')
  const corridorCache = readFileSync(new URL('../src/pages/trip/map/useCorridorCache.ts', import.meta.url), 'utf8')
  const mapTab = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')

  it('the plan no longer answers an empty list for its stop search unconditionally', () => {
    expect(geocode).not.toContain('searchNearbyPoisMulti(anchors, radiusM, 16, { ...opts, purposes }).catch(() => [] as PlaceHit[])')
  })

  it('both Map-tab searches ask to hear a failure', () => {
    expect(corridorCache.match(/rejectOnFailure: true/g)?.length).toBe(2)
  })

  it('the cache hook exposes the failure to the Map tab', () => {
    expect(corridorCache).toMatch(/poisFailed: scanFailed \|\| fractionFailed/)
    expect(mapTab).toMatch(/loadingPois, poisFailed \} = useCorridorCache\(/)
  })

  it('the failed note comes before the default copy, so a failure never reads as an empty route', () => {
    const note = mapTab.indexOf('Stops along the route could not be loaded just now.')
    const blame = mapTab.indexOf('Not enough driving distance yet')
    expect(note).toBeGreaterThan(-1)
    expect(mapTab).toMatch(/\) : poisFailed \? \(/)
    expect(blame).toBeGreaterThan(note)
  })
})
