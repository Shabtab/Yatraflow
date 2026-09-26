// ============ One “already added” identity (#345) ============
// The predicate that replaced five disagreeing inline checks: a rejected stop
// no longer blocks its own name forever, `" Hotel Taj "` matches
// `"Hotel Taj"`, a provider key beats a spelling difference, and a DISCARDED
// preview releases what it staged instead of leaving a ghost.
import { describe, it, expect } from 'vitest'
import {
  normalizePlaceName, placeKeysOf, tripPresence, placeIdentity, isAlreadyAdded, discardedStagedIds,
} from '../src/lib/placeIdentity'
import type { Trip } from '../src/data/types'

function stop(over: Record<string, unknown>) {
  return {
    id: 's1', title: 'Stop', category: 'sightseeing', locationName: 'L', lat: 15, lng: 73,
    description: '', notes: '', visitMinutes: 60, openTime: '', closeTime: '',
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'nice-to-have',
    sourceUrl: '', status: 'suggested', orderInDay: 1, ...over,
  } as never
}
function tripOf(stops: unknown[]): Trip {
  return {
    id: 't1', name: 'T', startLocation: 'A', destinations: ['B'],
    startDate: '2026-09-01', endDate: '2026-09-02', travellers: 2,
    transportMode: 'car', budgetPerPersonInr: 10000, travelStyle: 'balanced',
    fixedCommitments: [], days: [{ id: 'd0', index: 0, title: 'Day 1', stops }],
    expenses: [], coverEmoji: '🚗', visibility: 'private', createdAt: 0, updatedAt: 0,
  } as unknown as Trip
}
const hit = (over: Record<string, unknown> = {}) => ({ id: 'h1', name: 'Hotel Taj', ...over })
const empty = () => placeIdentity(tripOf([]))

describe('name normalization', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizePlaceName('  Hotel   Taj ')).toBe('hotel taj')
    expect(normalizePlaceName('HOTEL TAJ')).toBe('hotel taj')
    expect(normalizePlaceName(undefined)).toBe('')
  })
  it('keeps punctuation — an address suffix is a different name', () => {
    expect(normalizePlaceName('Hotel Taj, Mumbai')).not.toBe(normalizePlaceName('Hotel Taj'))
  })
})

describe('trip presence', () => {
  it('normalizes titles and joins provider keys', () => {
    const p = tripPresence(tripOf([
      stop({ id: 'a', title: ' Hotel  Taj ', placeId: 'pid-1' }),
      stop({ id: 'b', title: 'Basilica', eLoc: 'eloc-9' }),
    ]))
    expect(p.names.has('hotel taj')).toBe(true)
    expect(p.keys.has('pid-1')).toBe(true)
    expect(p.keys.has('eloc-9')).toBe(true)
  })
  it('a REJECTED stop does not block its own name', () => {
    const t = tripOf([
      stop({ id: 'r', title: 'Hotel Taj', status: 'rejected' }),
      stop({ id: 'k', title: 'Basilica', status: 'confirmed' }),
    ])
    const id = placeIdentity(t)
    expect(isAlreadyAdded(hit({ name: 'Hotel Taj' }), id)).toBe(false) // re-addable
    expect(isAlreadyAdded(hit({ name: 'Basilica' }), id)).toBe(true)
  })
})

describe('isAlreadyAdded', () => {
  it('matches a spelling variant through normalization', () => {
    const id = placeIdentity(tripOf([stop({ title: 'Hotel Taj' })]))
    expect(isAlreadyAdded(hit({ name: '  hotel   taj ' }), id)).toBe(true)
  })
  it('matches a different spelling through the provider key', () => {
    const id = placeIdentity(tripOf([stop({ title: 'Taj Hotel', placeId: 'pid-1' })]))
    // Same place, different name — the key is the real identity.
    expect(isAlreadyAdded(hit({ name: 'Hotel Taj, Mumbai', placeId: 'pid-1' }), id)).toBe(true)
    // Without the key it is (correctly) treated as a different name.
    expect(isAlreadyAdded(hit({ name: 'Hotel Taj, Mumbai' }), id)).toBe(false)
  })
  it('blocks a dismissed hit and a staged one', () => {
    const id = placeIdentity(tripOf([]), new Set(['h1']), new Set(['h2']))
    expect(isAlreadyAdded(hit({ id: 'h1', name: 'Something' }), id)).toBe(true)
    expect(isAlreadyAdded(hit({ id: 'h2', name: 'Something else' }), id)).toBe(true)
    expect(isAlreadyAdded(hit({ id: 'h3', name: 'Fresh place' }), id)).toBe(false)
  })
  it('is tolerant of missing hits and missing identity', () => {
    expect(isAlreadyAdded(null, empty())).toBe(false)
    expect(isAlreadyAdded(hit(), null)).toBe(false)
    expect(isAlreadyAdded(hit({ name: '' }), empty())).toBe(false)
  })
  it('reads eLoc the same way as placeId (Mappls hits)', () => {
    const id = placeIdentity(tripOf([stop({ title: 'Fort', eLoc: 'eloc-9' })]))
    expect(isAlreadyAdded(hit({ name: 'Fort Aguada', eLoc: 'eloc-9' }), id)).toBe(true)
  })
  it('placeKeysOf skips blanks', () => {
    expect(placeKeysOf({ placeId: '', eLoc: 'x' })).toEqual(['x'])
    expect(placeKeysOf({})).toEqual([])
  })
})

describe('a discarded preview leaves no ghost', () => {
  const staged = new Map<string, string>([['h1', 'hotel taj'], ['h2', 'basilica']])
  it('releases the ids whose place the plan does not contain', () => {
    // Keep landed the hotel, the basilica was discarded.
    expect(discardedStagedIds(staged, new Set(['hotel taj']))).toEqual(['h2'])
  })
  it('releases everything on a full discard — the place is re-offered', () => {
    const released = discardedStagedIds(staged, new Set())
    expect(released.sort()).toEqual(['h1', 'h2'])
    // …and once the effect has dropped those ids, the very same hit is
    // addable again — which is what "discard → the place comes back" means.
    const stillAdded = new Set(['h1', 'h2'])
    for (const id of released) stillAdded.delete(id)
    const id = placeIdentity(tripOf([]), stillAdded)
    expect(isAlreadyAdded(hit({ id: 'h1', name: 'Hotel Taj' }), id)).toBe(false)
  })
})
