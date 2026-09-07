// Horizon 3.4: crew-seeded suggestions.
// Open group-input ideas feed the engine: near-duplicates get suppressed and
// the corridor biases toward the crew's proposed kinds ("more like X").
import { describe, it, expect } from 'vitest'
import {
  crewSeedsFromSuggestions,
  crewSeedEvents,
  crewSeedsToPlannedStops,
  crewNoteForHit,
  buildDnaVector,
  dnaBoostForHit,
} from '../src/lib/tripDna'

const TRIP = 'trip-1'

function suggestion(over: Record<string, unknown> = {}) {
  return {
    id: 'sg-1',
    tripId: TRIP,
    dayIndex: 0,
    proposedBy: 'u-arjun',
    title: 'Arjun waterfall',
    category: 'waterfall',
    locationName: 'falls',
    lat: 10.1,
    lng: 76.5,
    visitMinutes: 60,
    estimatedEntryFeeInr: 0,
    estimatedTransportInr: 0,
    votes: [],
    comments: [],
    status: 'open',
    createdAt: 1,
    ...over,
  }
}

describe('crew seeds', () => {
  it('keeps open ideas with coords, drops declined and coord-less ones', () => {
    const seeds = crewSeedsFromSuggestions([
      suggestion(),
      suggestion({ id: 'sg-2', status: 'declined' }),
      suggestion({ id: 'sg-3', lat: Number.NaN }),
    ] as never)
    expect(seeds.map(s => s.name)).toEqual(['Arjun waterfall'])
  })

  it('maps seeds to planned-stop shape for suppression', () => {
    const seeds = crewSeedsFromSuggestions([suggestion()] as never)
    const stops = crewSeedsToPlannedStops(seeds)
    expect(stops).toEqual([{ lat: 10.1, lng: 76.5, name: 'Arjun waterfall' }])
  })

  it('biases the DNA vector toward seeded categories', () => {
    const seeds = crewSeedsFromSuggestions([suggestion()] as never)
    const v = buildDnaVector(crewSeedEvents(TRIP, seeds))
    expect(dnaBoostForHit({ category: 'waterfall' }, v)).toBeGreaterThan(0)
    expect(dnaBoostForHit({ category: 'museum' }, v)).toBe(0)
    // seeds bias but never inflate the acceptance record (proposing ≠ going)
    expect(v.accepts).toBe(0)
  })

  it('names the seed in the crew note', () => {
    const seeds = crewSeedsFromSuggestions([suggestion()] as never)
    expect(crewNoteForHit({ category: 'waterfall' }, seeds)).toBe('more like Arjun waterfall')
    expect(crewNoteForHit({ category: 'museum' }, seeds)).toBeNull()
  })
})
