// ============ The keyless geocoder's city pick stays usable (#839) ============
// Without a Google key the app's place search IS the free stack, and that stack's
// city engine is Open-Meteo's geocoder. `resolvedPlaceFromHit` used to refuse
// those hits by source alone — "open-meteo is a weather source" — so every keyless
// city search returned results that could not be picked at all. These assertions
// run the seams the coordinator's regression evidence named: the real facade, the
// real provider mapping, the real draft module. Fixture HTTP only; no provider is
// called for real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchPlaces } from '../src/lib/geocode'
import { persistedPlace, persistedPlaceFromJson, pickPlaceDraft, resolvedPlaceFromHit } from '../src/lib/placeDraft'
import { quotaResetForTests } from '../src/lib/providers/quota'
import type { PlaceHit } from '../src/lib/providers/hits'

/** The real Open-Meteo geocoding shape for Kolkata, as the provider returns it. */
const KOLKATA = {
  results: [{
    id: 1275004, name: 'Kolkata', latitude: 22.5726, longitude: 88.3639,
    admin1: 'West Bengal', country: 'India', country_code: 'IN',
  }],
}

function fixtureFetch(body: unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('geocoding-api.open-meteo.com')) return new Response(JSON.stringify(body), { status: 200 })
    if (url.includes('wikipedia')) return new Response('{}', { status: 200 })
    throw new Error('unexpected fetch: ' + url)
  })
}

describe('the keyless geocoder pick round-trips (#839)', () => {
  beforeEach(() => quotaResetForTests())
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); quotaResetForTests() })

  it('a city hit from the default geocoder can be picked and keeps its provenance', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    vi.stubGlobal('fetch', fixtureFetch(KOLKATA))

    const hits = await searchPlaces('kolkata')
    expect(hits[0]).toMatchObject({
      name: 'Kolkata', source: 'open-meteo', kind: 'place', latitude: 22.5726, longitude: 88.3639,
    })

    // The pick resolves instead of answering null…
    expect(resolvedPlaceFromHit(hits[0])).toEqual({
      label: 'Kolkata', lat: 22.5726, lng: 88.3639, source: 'open-meteo', exposure: 'unknown',
    })

    // …the draft carries it…
    const draft = pickPlaceDraft(hits[0])
    expect(draft).toEqual({
      kind: 'resolved', text: 'Kolkata',
      place: { label: 'Kolkata', lat: 22.5726, lng: 88.3639, source: 'open-meteo', exposure: 'unknown' },
    })

    // …the persisted metadata keeps the source, and reading it back keeps it too.
    if (draft.kind !== 'resolved') return
    const persisted = persistedPlace(draft.place)
    expect(persisted).toEqual({ source: 'open-meteo', exposure: 'unknown' })
    expect(persistedPlaceFromJson(persisted)).toEqual({ source: 'open-meteo', exposure: 'unknown' })
  })

  it('still refuses a hit whose provider is not one this build knows', () => {
    const unknown = {
      id: 9, name: 'Nowhere', latitude: 1, longitude: 1, kind: 'place', source: 'weather-api',
    } as unknown as PlaceHit
    expect(resolvedPlaceFromHit(unknown)).toBeNull()
    expect(pickPlaceDraft(unknown)).toEqual({ kind: 'unresolved', text: '', reason: 'empty' })
  })

  it('still refuses a geocoder hit with unusable coordinates or no name', () => {
    const bad: PlaceHit[] = [
      { id: 1, name: 'Null Island', latitude: 0, longitude: 0, kind: 'place', source: 'open-meteo' },
      { id: 2, name: 'Off chart', latitude: 91, longitude: 0, kind: 'place', source: 'open-meteo' },
      { id: 3, name: '   ', latitude: 22.5, longitude: 88.3, kind: 'place', source: 'open-meteo' },
    ]
    for (const hit of bad) expect(resolvedPlaceFromHit(hit)).toBeNull()
  })
})
