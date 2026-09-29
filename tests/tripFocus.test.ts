import { describe, it, expect } from 'vitest'
import {
  normalizeFocus,
  focusMatchesTrip,
  sameFocus,
  canFocusDay,
  focusDayRequest,
  type TripFocus,
} from '../src/lib/tripFocus'

const TRIP_A = 'trip-a'
const TRIP_B = 'trip-b'

const trip = {
  id: TRIP_A,
  days: [
    { index: 0, stops: [{ id: 's1' }, { id: 's2' }] },
    { index: 1, stops: [{ id: 's3' }] },
  ],
}

describe('normalizeFocus', () => {
  it('keeps a well-formed focus intact', () => {
    const f = normalizeFocus({ tripId: TRIP_A, dayIndex: 1, stopId: 's3' })
    expect(f).toEqual({ tripId: TRIP_A, dayIndex: 1, stopId: 's3', legKey: undefined, hitId: undefined })
  })

  it('drops a stop/leg/hit that has no day to live in', () => {
    expect(normalizeFocus({ tripId: TRIP_A, stopId: 's1' }).stopId).toBeUndefined()
    expect(normalizeFocus({ tripId: TRIP_A, legKey: 'leg0' }).legKey).toBeUndefined()
    expect(normalizeFocus({ tripId: TRIP_A, hitId: 'h1' }).hitId).toBeUndefined()
    expect(normalizeFocus({ tripId: TRIP_A, stopId: 's1' }).dayIndex).toBeNull()
  })

  it('drops non-finite and negative days', () => {
    expect(normalizeFocus({ tripId: TRIP_A, dayIndex: NaN }).dayIndex).toBeNull()
    expect(normalizeFocus({ tripId: TRIP_A, dayIndex: Infinity }).dayIndex).toBeNull()
    expect(normalizeFocus({ tripId: TRIP_A, dayIndex: -1, stopId: 's1' }).dayIndex).toBeNull()
    expect(normalizeFocus({ tripId: TRIP_A, dayIndex: -1, stopId: 's1' }).stopId).toBeUndefined()
  })
})

describe('focusMatchesTrip', () => {
  it('trip-wide focus matches its own trip', () => {
    expect(focusMatchesTrip({ tripId: TRIP_A, dayIndex: null }, trip)).toBe(true)
  })

  it('refuses another trip', () => {
    expect(focusMatchesTrip({ tripId: TRIP_B, dayIndex: null }, trip)).toBe(false)
  })

  it('refuses a day the trip does not have (clock-walk drive days)', () => {
    expect(focusMatchesTrip({ tripId: TRIP_A, dayIndex: 2 }, trip)).toBe(false)
    expect(focusMatchesTrip({ tripId: TRIP_A, dayIndex: 99 }, trip)).toBe(false)
  })

  it('refuses a stop that is not in the named day', () => {
    expect(focusMatchesTrip({ tripId: TRIP_A, dayIndex: 0, stopId: 's1' }, trip)).toBe(true)
    // s3 exists, but in day 1 — day 0 must not claim it
    expect(focusMatchesTrip({ tripId: TRIP_A, dayIndex: 0, stopId: 's3' }, trip)).toBe(false)
  })

  it('reads empty focus as nothing, never truthy', () => {
    expect(focusMatchesTrip(null, trip)).toBe(false)
    expect(focusMatchesTrip(undefined, trip)).toBe(false)
  })
})

describe('sameFocus', () => {
  const base: TripFocus = { tripId: TRIP_A, dayIndex: 0 }

  it('equal identities are the same', () => {
    expect(sameFocus(base, { tripId: TRIP_A, dayIndex: 0 })).toBe(true)
    expect(sameFocus({ tripId: TRIP_A, dayIndex: 0, stopId: 's1' }, { tripId: TRIP_A, dayIndex: 0, stopId: 's1' })).toBe(true)
  })

  it('any differing field makes it a different object', () => {
    expect(sameFocus(base, { tripId: TRIP_B, dayIndex: 0 })).toBe(false)
    expect(sameFocus(base, { tripId: TRIP_A, dayIndex: 1 })).toBe(false)
    expect(sameFocus(base, { tripId: TRIP_A, dayIndex: 0, stopId: 's1' })).toBe(false)
    expect(sameFocus(base, { tripId: TRIP_A, dayIndex: 0, hitId: 'h1' })).toBe(false)
  })

  it('empty is never equal to anything, not even itself', () => {
    expect(sameFocus(null, null)).toBe(false)
    expect(sameFocus(undefined, base)).toBe(false)
  })
})

describe('canFocusDay (the one-shot request gate)', () => {
  it('accepts a day the trip owns', () => {
    expect(canFocusDay({ dayIndex: 1 }, trip)).toBe(true)
    expect(canFocusDay(focusDayRequest(0), trip)).toBe(true)
  })

  it('refuses the clock-walk shapes: non-finite, negative, past-the-itinerary', () => {
    expect(canFocusDay({ dayIndex: NaN }, trip)).toBe(false)
    expect(canFocusDay({ dayIndex: -3 }, trip)).toBe(false)
    expect(canFocusDay({ dayIndex: 7 }, trip)).toBe(false)
    expect(canFocusDay(null, trip)).toBe(false)
    expect(canFocusDay(undefined, trip)).toBe(false)
  })

  it('refuses when the request belongs to another trip', () => {
    expect(canFocusDay({ dayIndex: 0 }, trip, TRIP_B)).toBe(false)
    expect(canFocusDay({ dayIndex: 0 }, trip, TRIP_A)).toBe(true)
  })
})
