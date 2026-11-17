// Crew preferences: the aggregation and the list helpers (node env, no DOM).
import { describe, expect, it } from 'vitest'
import {
  CREW_INTERESTS, isCrewInterest, myCrewPreference, normalizeInterests, removeCrewPreference, replaceTripPreferences,
  summarizeCrewPreferences, upsertCrewPreference,
} from '../src/lib/crewPreferences'
import { STOP_CATEGORIES, type CrewInterest, type CrewPreference } from '../src/data/types'

const row = (userId: string, interests: CrewInterest[], extra: Partial<CrewPreference> = {}): CrewPreference =>
  ({ tripId: 't1', userId, interests, updatedAt: 1, ...extra })

describe('the interest set', () => {
  it('is the stop category list, in the same order', () => {
    expect([...CREW_INTERESTS]).toEqual([...STOP_CATEGORIES])
  })
  it('knows its own entries and nothing else', () => {
    expect(isCrewInterest('food')).toBe(true)
    expect(isCrewInterest('transport-hub')).toBe(true)
    expect(isCrewInterest('Food')).toBe(false)
    expect(isCrewInterest('casino')).toBe(false)
    expect(isCrewInterest(3)).toBe(false)
    expect(isCrewInterest(null)).toBe(false)
  })
})

describe('normalizeInterests', () => {
  it('removes duplicates and puts the list in the standard order', () => {
    expect(normalizeInterests(['temple', 'food', 'temple', 'sightseeing'])).toEqual(['sightseeing', 'food', 'temple'])
  })
  it('keeps an empty list: that is an answer', () => {
    expect(normalizeInterests([])).toEqual([])
  })
  it('refuses a list with an unknown entry instead of dropping it', () => {
    expect(normalizeInterests(['food', 'casino'])).toBeNull()
    expect(normalizeInterests([1 as unknown as string])).toBeNull()
  })
  it('refuses a value that is not a list', () => {
    expect(normalizeInterests('food' as unknown as string[])).toBeNull()
  })
})

describe('summarizeCrewPreferences', () => {
  it('returns zero shares and zero answers for no rows, without a division by zero', () => {
    const s = summarizeCrewPreferences([])
    expect(s.answered).toBe(0)
    expect(s.members).toBeNull()
    for (const interest of CREW_INTERESTS) {
      expect(s.picks[interest]).toBe(0)
      expect(s.shares[interest]).toBe(0)
    }
  })
  it('divides by the members who answered, not by every member', () => {
    const rows = [row('a', ['food', 'nature']), row('b', ['food']), row('c', ['museum'])]
    const s = summarizeCrewPreferences(rows, { tripId: 't1', memberIds: ['a', 'b', 'c', 'd'] })
    expect(s.answered).toBe(3)
    expect(s.members).toBe(4)
    expect(s.picks.food).toBe(2)
    expect(s.shares.food).toBeCloseTo(2 / 3)
    expect(s.shares.nature).toBeCloseTo(1 / 3)
    expect(s.shares.museum).toBeCloseTo(1 / 3)
    expect(s.shares.beach).toBe(0)
  })
  it('counts a member with an empty answer as answered, with no picks', () => {
    const s = summarizeCrewPreferences([row('a', ['food']), row('b', [])])
    expect(s.answered).toBe(2)
    expect(s.shares.food).toBe(0.5)
  })
  it('does not count a member who did not answer as a no', () => {
    const withSilentMember = summarizeCrewPreferences([row('a', ['food'])], { memberIds: ['a', 'b'] })
    expect(withSilentMember.answered).toBe(1)
    expect(withSilentMember.members).toBe(2)
    expect(withSilentMember.shares.food).toBe(1)
  })
  it('keeps every share between 0 and 1', () => {
    const s = summarizeCrewPreferences([row('a', [...CREW_INTERESTS]), row('b', [...CREW_INTERESTS])])
    for (const interest of CREW_INTERESTS) {
      expect(s.shares[interest]).toBeGreaterThanOrEqual(0)
      expect(s.shares[interest]).toBeLessThanOrEqual(1)
    }
  })
  it('keeps only the requested trip', () => {
    const rows = [row('a', ['food']), row('a', ['beach'], { tripId: 't2' }), row('b', ['beach'], { tripId: 't2' })]
    const s = summarizeCrewPreferences(rows, { tripId: 't2' })
    expect(s.answered).toBe(2)
    expect(s.picks.beach).toBe(2)
    expect(s.picks.food).toBe(0)
  })
  it('leaves out a member who left the trip', () => {
    const rows = [row('a', ['food']), row('gone', ['beach'])]
    const s = summarizeCrewPreferences(rows, { tripId: 't1', memberIds: ['a'] })
    expect(s.answered).toBe(1)
    expect(s.members).toBe(1)
    expect(s.picks.beach).toBe(0)
  })
  it('counts one row per member: the newer row wins', () => {
    const rows = [row('a', ['food'], { updatedAt: 5 }), row('a', ['beach'], { updatedAt: 9 })]
    const s = summarizeCrewPreferences(rows)
    expect(s.answered).toBe(1)
    expect(s.picks.beach).toBe(1)
    expect(s.picks.food).toBe(0)
  })
  it('counts a row that holds an unknown interest as answered and ignores the unknown entry', () => {
    const unknown = row('a', ['food', 'casino' as unknown as CrewInterest])
    const s = summarizeCrewPreferences([unknown])
    expect(s.answered).toBe(1)
    expect(s.picks.food).toBe(1)
    expect(Object.keys(s.picks)).toHaveLength(CREW_INTERESTS.length)
  })
  it('does not change its input', () => {
    const rows = [row('a', ['food'])]
    const copy = structuredClone(rows)
    summarizeCrewPreferences(rows, { tripId: 't1', memberIds: ['a'] })
    expect(rows).toEqual(copy)
  })
})

describe('list helpers', () => {
  const a = row('a', ['food'])
  const b = row('b', ['nature'])
  it('myCrewPreference finds the own row for one trip', () => {
    expect(myCrewPreference([a, b], 't1', 'b')).toBe(b)
    expect(myCrewPreference([a, b], 't2', 'b')).toBeUndefined()
  })
  it('upsertCrewPreference replaces in place and appends a new row', () => {
    const a2 = row('a', ['beach'])
    expect(upsertCrewPreference([a, b], a2)).toEqual([a2, b])
    expect(upsertCrewPreference([a], b)).toEqual([a, b])
  })
  it('upsertCrewPreference does not change its input', () => {
    const list = [a]
    upsertCrewPreference(list, row('a', ['beach']))
    expect(list).toEqual([a])
  })
  it('removeCrewPreference removes one member of one trip', () => {
    const other = row('a', ['food'], { tripId: 't2' })
    expect(removeCrewPreference([a, b, other], 't1', 'a')).toEqual([b, other])
  })
  it('replaceTripPreferences swaps one trip and leaves the others', () => {
    const other = row('a', ['food'], { tripId: 't2' })
    const fresh = [row('c', ['rest'])]
    expect(replaceTripPreferences([a, b, other], 't1', fresh)).toEqual([other, ...fresh])
  })
  it('replaceTripPreferences ignores a fresh row of a different trip', () => {
    const stray = row('z', ['rest'], { tripId: 't9' })
    expect(replaceTripPreferences([a], 't1', [stray])).toEqual([])
  })
  it('replaceTripPreferences with no fresh rows clears the trip', () => {
    expect(replaceTripPreferences([a, b], 't1', [])).toEqual([])
  })
})
