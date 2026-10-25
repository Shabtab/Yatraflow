import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLACE_EXPOSURES, type ItineraryStop, type PlaceExposure, type Trip } from '../../src/data/types'
import { persistedPlace, persistedPlaceFromHit, persistedPlaceFromJson, pickPlaceDraft } from '../../src/lib/placeDraft'
import { buildTripExport, emptyReport, normalizeTrip } from '../../src/lib/itinerarySpec'
import { parseTripImport } from '../../src/lib/tripImport'
import { submitCollabCommand, submitCollabTransition, suggestionRowToEntry } from '../../src/store/collabCommand'
import { suggestionToRow } from '../../src/lib/restoreRows'
import { seedData } from '../../src/data/seed'
import type { PlaceHit } from '../../src/lib/providers/hits'

const { transport } = vi.hoisted(() => ({
  transport: { calls: [] as Array<{ name: string; args: Record<string, unknown> }>, response: null as unknown },
}))

vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      transport.calls.push({ name, args })
      return { data: transport.response, error: null }
    },
  },
}))

const hit = (exposure?: PlaceExposure): PlaceHit => ({
  id: 'museum-1', name: 'Museum', latitude: 15.4, longitude: 73.7,
  kind: 'poi', source: 'google', placeId: 'g-museum',
  ...(exposure === undefined ? {} : { exposure }),
})

function tripWithStop(stop: ItineraryStop): Trip {
  const trip = structuredClone(seedData.trips[0])
  trip.days[0].stops[0] = stop
  return trip
}

describe('stage-c/843 place exposure persistence', () => {
  it('serializes suggestion create commands and hydrates acknowledged receipts for every enum value', async () => {
    for (const [index, exposure] of PLACE_EXPOSURES.entries()) {
      transport.calls = []
      const commandId = `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      const suggestionId = `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      const place = { source: 'google' as const, placeId: `rpc-${exposure}`, exposure }
      transport.response = {
        status: 'applied', tripRevision: 3,
        suggestion: {
          id: suggestionId, trip_id: 'trip-1', day_index: 0, proposed_by: 'user-1', day_id: 'day-1', place,
          title: 'Museum', category: 'sightseeing', location_name: 'Museum', lat: 15.4, lng: 73.7,
          visit_minutes: 45, estimated_entry_fee_inr: 0, estimated_transport_inr: 0,
          votes: [], comments: [], status: 'open', created_at: 1,
        },
      }
      const command = {
        type: 'suggestion.create' as const, suggestionId,
        suggestion: {
          dayIndex: 0, dayId: 'day-1', place, title: 'Museum', category: 'sightseeing',
          locationName: 'Museum', lat: 15.4, lng: 73.7, description: '', visitMinutes: 45,
          estimatedEntryFeeInr: 0, estimatedTransportInr: 0,
        },
      }
      const outcome = await submitCollabCommand(commandId, 'trip-1', command)
      expect(transport.calls).toHaveLength(1)
      expect(transport.calls[0]).toMatchObject({
        name: 'submit_collab_command', args: { p_command_id: commandId, p_trip_id: 'trip-1', p_command: command },
      })
      expect(outcome).toMatchObject({ status: 'applied', suggestion: { place } })
    }
  })

  it('hydrates a decision resolution receipt with its nested exposure and separate placement result', async () => {
    const exposure = 'indoor'
    const nestedPlace = { source: 'google', placeId: 'resolved-museum', exposure }
    transport.calls = []
    transport.response = {
      status: 'applied', tripRevision: 4, winnerId: 'slot:lunch:museum',
      placementStatus: 'applied', stopId: 'st_museum',
      decision: {
        id: 'decision-1', trip_id: 'trip-1', question: 'Visit museum?', options: [{
          id: 'slot:lunch:museum', label: 'Museum', place: {
            title: 'Museum', category: 'sightseeing', locationName: 'Museum', lat: 15.4, lng: 73.7,
            dayId: 'day-1', dayIndex: 0, slotKey: 'lunch', place: nestedPlace,
          },
        }], votes_by_user_id: {}, comments: [], status: 'resolved',
        resolved_option_id: 'slot:lunch:museum', resolved_stop_id: 'st_museum', raised_by: 'user-1', created_at: 1,
      },
    }
    const outcome = await submitCollabTransition('50000000-0000-4000-8000-000000000010', 'trip-1', {
      type: 'decision.resolve', decisionId: 'decision-1', optionId: 'slot:lunch:museum', expectedRevision: 3, dayId: 'day-1',
    })
    expect(outcome).toMatchObject({
      status: 'applied', winnerId: 'slot:lunch:museum',
      placement: { status: 'applied', stopId: 'st_museum' },
      decision: { options: [{ place: { place: nestedPlace } }] },
    })
  })

  it('preserves explicit values through hit draft, persisted identity, row hydration, and restore mapping', () => {
    for (const exposure of PLACE_EXPOSURES) {
      const picked = pickPlaceDraft(hit(exposure))
      expect(picked.kind).toBe('resolved')
      if (picked.kind !== 'resolved') continue
      const identity = persistedPlace(picked.place)
      expect(identity).toEqual({ source: 'google', placeId: 'g-museum', exposure })
      expect(persistedPlaceFromHit(hit(exposure))).toEqual(identity)
      expect(persistedPlaceFromJson(identity)).toEqual(identity)

      const row = suggestionToRow({
        id: `suggestion-${exposure}`, tripId: 'trip-1', dayIndex: 0, proposedBy: 'user-1',
        title: 'Museum', category: 'sightseeing', locationName: 'Museum', lat: 15.4, lng: 73.7,
        visitMinutes: 60, estimatedEntryFeeInr: 0, estimatedTransportInr: 0, votes: [], comments: [],
        status: 'open', createdAt: 1, place: identity,
      })
      expect(row.place).toEqual(identity)
      const hydrated = suggestionRowToEntry({
        id: row.id, trip_id: row.trip_id, day_index: row.day_index, proposed_by: row.proposed_by,
        title: row.title, category: row.category, location_name: row.location_name, lat: row.lat, lng: row.lng,
        visit_minutes: row.visit_minutes, estimated_entry_fee_inr: row.estimated_entry_fee_inr,
        estimated_transport_inr: row.estimated_transport_inr, votes: [], comments: [], status: row.status,
        created_at: row.created_at, place: row.place,
      })
      expect(hydrated.place).toEqual(identity)
    }
  })

  it('defaults missing evidence to unknown and refuses malformed place wire identity', () => {
    const picked = pickPlaceDraft(hit())
    expect(picked.kind === 'resolved' ? persistedPlace(picked.place) : undefined)
      .toEqual({ source: 'google', placeId: 'g-museum', exposure: 'unknown' })
    expect(persistedPlaceFromHit(hit())).toEqual({ source: 'google', placeId: 'g-museum', exposure: 'unknown' })
    for (const exposure of ['inside', '', null, 1, false]) {
      expect(persistedPlaceFromJson({ source: 'google', placeId: 'g-museum', exposure })).toBeUndefined()
      const malformed = { ...hit(), exposure } as unknown as PlaceHit
      expect(pickPlaceDraft(malformed).kind).toBe('unresolved')
      expect(persistedPlaceFromHit(malformed)).toBeUndefined()
    }
    for (const bad of [
      { source: 'weather-api', placeId: 'g-museum', exposure: 'indoor' },
      { source: 'google', placeId: 'g-museum', exposure: 'indoor', extra: true },
      { source: 'google', placeId: ' ', exposure: 'outdoor' },
    ]) expect(persistedPlaceFromJson(bad)).toBeUndefined()
  })

  it('keeps all explicit enum values through format-3 import/export and repairs malformed values', () => {
    for (const exposure of PLACE_EXPOSURES) {
      const source = structuredClone(seedData.trips[0])
      source.days[0].stops[0] = { ...source.days[0].stops[0], placeSource: 'google', placeId: 'g-museum', exposure }
      const exported = buildTripExport(source)
      expect(exported.formatVersion).toBe(3)
      const imported = parseTripImport(JSON.stringify(exported))
      expect(imported.trip.days[0].stops[0]).toMatchObject({ placeSource: 'google', placeId: 'g-museum', exposure })
      expect(imported.report.repairs).toEqual([])
    }

    const malformed = structuredClone(seedData.trips[0]) as unknown as Record<string, unknown>
    const days = malformed.days as Array<Record<string, unknown>>
    const stops = days[0].stops as Array<Record<string, unknown>>
    stops[0] = { ...stops[0], placeSource: 'google', placeId: 'g-museum', exposure: 'inside' }
    const report = emptyReport()
    const normalized = normalizeTrip(malformed, report)
    expect(normalized?.days[0].stops[0]).not.toHaveProperty('exposure')
    expect(report.repairs.some(repair => repair.includes('exposure'))).toBe(true)
  })

  it('accepts the three exposures in the real itinerary CLI and rejects malformed values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yf-843-exposure-'))
    try {
      const source = JSON.parse(readFileSync('docs/examples/itineraries/goa-north-to-south.golden.json', 'utf8'))
      const file = join(dir, 'exposure.json')
      for (const exposure of PLACE_EXPOSURES) {
        source.trip.days[0].stops[0].placeSource = 'google'
        source.trip.days[0].stops[0].placeId = 'g-museum'
        source.trip.days[0].stops[0].exposure = exposure
        writeFileSync(file, JSON.stringify(source))
        expect(() => execFileSync(process.execPath, ['scripts/validate-itinerary.mjs', file], { encoding: 'utf8' })).not.toThrow()
      }
      source.trip.days[0].stops[0].exposure = 'inside'
      writeFileSync(file, JSON.stringify(source))
      let output = ''
      try {
        execFileSync(process.execPath, ['scripts/validate-itinerary.mjs', file], { encoding: 'utf8' })
      } catch (error) {
        output = (error as { stdout?: string }).stdout ?? ''
      }
      expect(output).toContain('exposure')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not derive indoor exposure from provenance or weather sensitivity', () => {
    const source = structuredClone(seedData.trips[0])
    const stop = source.days[0].stops[0]
    const imported = tripWithStop({ ...stop, placeSource: 'google', weatherSensitive: false })
    const parsed = parseTripImport(JSON.stringify(buildTripExport(imported)))
    expect(parsed.trip.days[0].stops[0].exposure).toBeUndefined()
    expect(parsed.trip.days[0].stops[0].placeSource).toBe('google')
  })
})
