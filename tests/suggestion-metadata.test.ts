// ============ Place identity and stable day metadata (#839) ============
// Pure regressions for the pieces that keep a suggestion attached to the place
// and day it was raised for: drafts, day references, stored rows and export.
import { describe, it, expect } from 'vitest'
import { dayRefFor, resolveDayRef } from '../src/lib/dayRef'
import {
  editPlaceDraft, persistedPlace, persistedPlaceFromHit, persistedPlaceFromJson,
  pickPlaceDraft, resolvedPlaceFromHit, unresolvedPlace,
} from '../src/lib/placeDraft'
import { suggestionRowToEntry } from '../src/store/collabCommand'
import { suggestionToRow } from '../src/lib/restoreRows'
import { buildTripExport, ITINERARY_FORMAT_VERSION, normalizeTrip, emptyReport } from '../src/lib/itinerarySpec'
import { parseTripImport } from '../src/lib/tripImport'
import { seedData } from '../src/data/seed'
import type { ItineraryDay, PersistedPlaceIdentity, Trip } from '../src/data/types'
import type { PlaceHit } from '../src/lib/providers/hits'

const day = (id: string, index: number): ItineraryDay => ({ id, index, title: `Day ${index + 1}`, stops: [] })
const hit = (over: Partial<PlaceHit> = {}): PlaceHit => ({
  id: 'h1', name: 'Fort', latitude: 15.1, longitude: 73.2, kind: 'poi', source: 'google', placeId: 'g1', ...over,
})

describe('stable day references', () => {
  const days = [day('d0', 0), day('d1', 1)]
  it('resolves by id even when the index changed', () => {
    expect(resolveDayRef(days, { dayId: 'd1', dayIndex: 0 })).toEqual({ status: 'resolved', day: days[1] })
  })
  it('does not fall back to an index once an id is present', () => {
    expect(resolveDayRef(days, { dayId: 'gone', dayIndex: 1 })).toEqual({ status: 'missing', reason: 'missing-day' })
  })
  it('resolves a legacy index only when exactly one current day matches', () => {
    expect(resolveDayRef(days, { dayIndex: 1 })).toEqual({ status: 'resolved', day: days[1] })
    expect(resolveDayRef([...days, day('dup', 1)], { dayIndex: 1 })).toEqual({ status: 'missing', reason: 'legacy-ambiguous' })
    expect(resolveDayRef(days, { dayIndex: 9 })).toEqual({ status: 'missing', reason: 'missing-day' })
  })
  it('writes both halves, with the id authoritative', () => {
    expect(dayRefFor({ days }, 1)).toEqual({ dayId: 'd1', dayIndex: 1 })
    expect(dayRefFor({ days }, 7)).toEqual({ dayIndex: 7 })
  })
})

describe('place drafts', () => {
  it('editing the text releases the pin; unchanged text keeps it', () => {
    const picked = pickPlaceDraft(hit())
    expect(editPlaceDraft(picked, 'Fort')).toBe(picked)
    expect(editPlaceDraft(picked, 'Fort, Goa')).toEqual({ kind: 'unresolved', text: 'Fort, Goa', reason: 'edited' })
  })
  it('rejects unusable coordinates and an unknown provider', () => {
    expect(resolvedPlaceFromHit(hit({ latitude: 0, longitude: 0 }))).toBeNull()
    expect(resolvedPlaceFromHit(hit({ name: '  ' }))).toBeNull()
    // A provider this build cannot round-trip is still refused: the allowlist is
    // what stops an unknown provenance from being saved as a known one.
    const unknownProvider = { ...hit(), source: 'weather-api' } as unknown as PlaceHit
    expect(resolvedPlaceFromHit(unknownProvider)).toBeNull()
    expect(pickPlaceDraft(unknownProvider)).toEqual({ kind: 'unresolved', text: '', reason: 'empty' })
    expect(unresolvedPlace('', 'empty')).toEqual({ kind: 'unresolved', text: '', reason: 'empty' })
  })
  it('resolves a free-stack geocoder hit — open-meteo is a place engine (#839)', () => {
    // The keyless default geocoder returns cities through Open-Meteo with real
    // coordinates. The old reading of that provenance as "not a place" made every
    // keyless city search unpickable, so the pick resolves like any other.
    const city = hit({ source: 'open-meteo', name: 'Kolkata', latitude: 22.5726, longitude: 88.3639, placeId: undefined, eLoc: undefined })
    expect(resolvedPlaceFromHit(city)).toEqual({
      label: 'Kolkata', lat: 22.5726, lng: 88.3639, source: 'open-meteo', exposure: 'unknown',
    })
    expect(pickPlaceDraft(city)).toEqual({
      kind: 'resolved', text: 'Kolkata',
      place: { label: 'Kolkata', lat: 22.5726, lng: 88.3639, source: 'open-meteo', exposure: 'unknown' },
    })
    // …and the pick keeps its provenance through the persisted form and back.
    const picked = pickPlaceDraft(city)
    if (picked.kind !== 'resolved') throw new Error('expected a resolved pick')
    const persisted = persistedPlace(picked.place)
    expect(persisted).toEqual({ source: 'open-meteo', exposure: 'unknown' })
    expect(persistedPlaceFromJson(persisted)).toEqual({ source: 'open-meteo', exposure: 'unknown' })
  })
  it('stores identity only, never the coordinates or the label', () => {
    expect(persistedPlace({ label: 'Fort', lat: 15, lng: 73, source: 'google', placeId: 'g1', exposure: 'unknown' }))
      .toEqual({ source: 'google', placeId: 'g1', exposure: 'unknown' })
    expect(persistedPlaceFromHit(hit({ source: 'open-meteo', placeId: undefined, eLoc: undefined })))
      .toEqual({ source: 'open-meteo', exposure: 'unknown' })
  })
  it('parses stored identity defensively', () => {
    expect(persistedPlaceFromJson({ source: 'osm', eLoc: ' e1 ', exposure: 'unknown' }))
      .toEqual({ source: 'osm', eLoc: 'e1', exposure: 'unknown' })
    // A geocoder provenance round-trips; an unknown one does not.
    expect(persistedPlaceFromJson({ source: 'open-meteo', exposure: 'unknown' }))
      .toEqual({ source: 'open-meteo', exposure: 'unknown' })
    // Exposure widened to the real enum (indoor/outdoor/unknown), so 'indoor'
    // is valid now; the malformed shape that must still be refused is an
    // exposure value from no allowlist at all. A lone key still parses (legacy
    // rows carry exposure only), but an EMPTY key is refused.
    for (const bad of [null, [], 'x', { exposure: 'inside' }, { exposure: 'unknown', extra: 1 },
      { source: 'weather-api', exposure: 'unknown' }, { exposure: 'unknown', placeId: '' }]) {
      expect(persistedPlaceFromJson(bad)).toBeUndefined()
    }
    expect(persistedPlaceFromJson({ exposure: 'outdoor' })).toEqual({ exposure: 'outdoor' })
    expect(persistedPlaceFromJson({ placeId: 'x' })).toEqual({ placeId: 'x', exposure: 'unknown' })
  })
})

describe('stored suggestion metadata', () => {
  it('round-trips day_id and place and ignores a malformed place', () => {
    const place: PersistedPlaceIdentity = { source: 'google', placeId: 'g1', exposure: 'unknown' }
    const entry = suggestionRowToEntry({
      id: 's1', trip_id: 't1', day_index: 1, day_id: 'd1', place, proposed_by: 'u1',
      title: 'Fort', category: 'sightseeing', location_name: 'Fort', lat: 15, lng: 73,
      visit_minutes: 30, estimated_entry_fee_inr: 0, estimated_transport_inr: 0, status: 'open', created_at: 1,
    })
    expect(entry.dayId).toBe('d1')
    expect(entry.place).toEqual(place)
    const malformed = suggestionRowToEntry({
      id: 's2', trip_id: 't1', day_index: 0, proposed_by: 'u1', title: 'X',
      category: 'sightseeing', location_name: 'X', lat: 15, lng: 73,
      status: 'open', place: { exposure: 'inside' },
    })
    expect(malformed.place).toBeUndefined()
  })
  it('restores the new columns only when present, keeping old rows unchanged', () => {
    const base = {
      id: 's1', tripId: 't1', dayIndex: 0, proposedBy: 'u1', title: 'Fort', category: 'sightseeing' as const,
      locationName: 'Fort', lat: 15, lng: 73, description: '', visitMinutes: 30, estimatedEntryFeeInr: 0,
      estimatedTransportInr: 0, votes: [], comments: [], status: 'open' as const, createdAt: 1,
    }
    expect(suggestionToRow(base)).not.toHaveProperty('day_id')
    expect(suggestionToRow(base)).not.toHaveProperty('place')
    expect(suggestionToRow({ ...base, dayId: 'd1', place: { exposure: 'unknown' } })).toMatchObject({
      day_id: 'd1', place: { exposure: 'unknown' },
    })
  })
})

describe('format version 3', () => {
  const trip: Trip = structuredClone(seedData.trips[0])
  trip.days[0].stops[0] = {
    ...trip.days[0].stops[0],
    eLoc: 'eloc-1', placeSource: 'mappls', exposure: 'unknown',
  }
  it('exports and imports identity fields without repair', () => {
    const exported = buildTripExport(trip)
    expect(exported.formatVersion).toBe(3)
    const parsed = parseTripImport(JSON.stringify(exported))
    expect(parsed.version).toBe(ITINERARY_FORMAT_VERSION)
    expect(parsed.report.repairs).toEqual([])
    const stop = parsed.trip.days[0].stops[0]
    expect(stop.placeSource).toBe('mappls')
    expect(stop.eLoc).toBe('eloc-1')
    expect(stop.exposure).toBe('unknown')
  })
  it('keeps a geocoder-picked provenance through export and import (#839)', () => {
    // A stop picked from the keyless geocoder carries source open-meteo. It used
    // to be repaired away on import as an unknown provider, so the round-trip
    // lost where the place came from.
    const picked: Trip = structuredClone(trip)
    picked.days[0].stops[0] = { ...picked.days[0].stops[0], placeSource: 'open-meteo', exposure: 'unknown' }
    const parsed = parseTripImport(JSON.stringify(buildTripExport(picked)))
    expect(parsed.report.repairs).toEqual([])
    expect(parsed.trip.days[0].stops[0].placeSource).toBe('open-meteo')
  })
  it('drops an invalid source and exposure and names them', () => {
    const report = emptyReport()
    const raw = JSON.parse(JSON.stringify(trip)) as Record<string, unknown>
    const day0 = (raw.days as Record<string, unknown>[])[0]
    ;(day0.stops as Record<string, unknown>[])[0] = {
      ...(day0.stops as Record<string, unknown>[])[0], placeSource: 'weather-api', exposure: 'inside',
    }
    const out = normalizeTrip(raw, report)
    expect(out?.days[0].stops[0].placeSource).toBeUndefined()
    expect(out?.days[0].stops[0].exposure).toBeUndefined()
    expect(report.repairs.some(r => r.includes('placeSource'))).toBe(true)
    expect(report.repairs.some(r => r.includes('exposure'))).toBe(true)
  })
})
