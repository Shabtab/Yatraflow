// ============ Stable day references ============
// A day INDEX is a position. Delete Day 2 and every later index moves, so an
// idea or vote raised for "Day 3" can land on a different day without anyone
// choosing that. New rows carry the day id; older rows fall back to their index
// only while exactly one current day matches it. No clamp, no Day 1 guess.
import type { ID, ItineraryDay, Trip } from '../data/types'

export interface DayRef {
  dayId?: ID
  dayIndex?: number
}

export type DayResolution =
  | { status: 'resolved'; day: ItineraryDay }
  | { status: 'missing'; reason: 'legacy-ambiguous' | 'missing-day' }

export function resolveDayRef(days: ItineraryDay[], ref: DayRef): DayResolution {
  if (typeof ref.dayId === 'string' && ref.dayId) {
    const exact = days.find(d => d.id === ref.dayId)
    return exact ? { status: 'resolved', day: exact } : { status: 'missing', reason: 'missing-day' }
  }
  if (typeof ref.dayIndex === 'number' && Number.isInteger(ref.dayIndex)) {
    const matches = days.filter(d => d.index === ref.dayIndex)
    if (matches.length === 1) return { status: 'resolved', day: matches[0] }
    if (matches.length > 1) return { status: 'missing', reason: 'legacy-ambiguous' }
  }
  return { status: 'missing', reason: 'missing-day' }
}

/** The reference a NEW row writes: both halves, with the id authoritative. */
export function dayRefFor(trip: Pick<Trip, 'days'>, dayIndex: number): DayRef {
  const day = trip.days.find(d => d.index === dayIndex)
  return day ? { dayId: day.id, dayIndex: day.index } : { dayIndex }
}
