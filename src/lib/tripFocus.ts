/**
 * Shared selection/focus model (#425, PR 1 of 2).
 *
 * One identity a trip surface can examine: WHICH trip, WHICH day, optionally
 * WHICH stop / leg / suggestion. Timeline, Map and Board each hold local
 * selection state today and "selection" means something different on each;
 * this module is the canonical shape they will converge on. PR 1 lands the
 * contract + the Timeline bridge; Map/Board adoption is PR 2.
 *
 * Rules this module exists to keep (from the issue):
 * - Focus is EPHEMERAL UI state. It is never written into trip data, never
 *   persisted with the itinerary, and never handed to a provider/mutation.
 * - A one-shot focus REQUEST is validated against the trip it names before
 *   use, then consumed — a stale value can neither re-fire on a later mount
 *   nor leak across trips (the workspace outlives trips; the clock walk's
 *   drive-day numbers index past the itinerary).
 * - `null`/`undefined` focus is a valid, expected state (nothing examined),
 *   so every predicate treats "empty" as a distinct answer, never truthiness.
 */

/** What a surface is examining, as data. `stopId`/`legKey`/`hitId` refine the
 *  day; they are meaningless without their day. */
export interface TripFocus {
  tripId: string
  dayIndex: number | null
  /** itinerary stop id, when a stop is the examined object */
  stopId?: string
  /** leg/segment key inside the focused day (see lib/routing's leg identity) */
  legKey?: string
  /** suggestion or search-hit id, when the examined object is not (yet) a stop */
  hitId?: string
}

/** A one-shot "go examine this" signal, mirroring the existing focusDay
 *  handoff's shape so the Timeline bridge stays compatible. */
export interface FocusRequest {
  dayIndex: number
}

/** Normalize any caller shape into a TripFocus, dropping fields that cannot
 *  mean anything: a stop/leg/hit without a day, a non-finite day. */
export function normalizeFocus(input: Partial<TripFocus> & { tripId: string }): TripFocus {
  const dayRaw = input.dayIndex
  const hasDay = typeof dayRaw === 'number' && Number.isFinite(dayRaw) && dayRaw >= 0
  const dayIndex = hasDay ? dayRaw : null
  return {
    tripId: input.tripId,
    dayIndex,
    stopId: hasDay ? input.stopId : undefined,
    legKey: hasDay ? input.legKey : undefined,
    hitId: hasDay ? input.hitId : undefined,
  }
}

/** Does this focus still name a real object in THIS trip? A focus that
 *  outlived its data (day deleted, stop removed, trip switched) reads as
 *  nothing rather than as another day's object. */
export function focusMatchesTrip(
  focus: TripFocus | null | undefined,
  trip: { id: string; days: { index: number; stops: { id: string }[] }[] },
): boolean {
  if (!focus || focus.tripId !== trip.id) return false
  if (focus.dayIndex == null) return true
  const day = trip.days.find(d => d.index === focus.dayIndex)
  if (!day) return false
  if (focus.stopId && !day.stops.some(s => s.id === focus.stopId)) return false
  return true
}

/** Identity comparison: are these two focuses examining the same object?
 *  Field-wise (not reference), undefined-safe. */
export function sameFocus(a: TripFocus | null | undefined, b: TripFocus | null | undefined): boolean {
  if (!a || !b) return false
  return a.tripId === b.tripId
    && a.dayIndex === b.dayIndex
    && a.stopId === b.stopId
    && a.legKey === b.legKey
    && a.hitId === b.hitId
}

/** Can this focus request be honoured by THIS trip? The clock walk numbers
 *  its own drive days (the return pass indexes past the itinerary), so a
 *  value no day matches must be refused, not clamped — clamping would open
 *  a stranger day's accordion. */
export function canFocusDay(
  request: FocusRequest | null | undefined,
  trip: { id: string; days: { index: number }[] },
  tripId?: string,
): boolean {
  if (!request || !Number.isFinite(request.dayIndex) || request.dayIndex < 0) return false
  if (tripId !== undefined && trip.id !== tripId) return false
  return trip.days.some(d => d.index === request.dayIndex)
}

/** Build the one-shot request a "open this day" affordance raises (map halt
 *  label → Timeline day, day rail, etc.). */
export function focusDayRequest(dayIndex: number): FocusRequest {
  return { dayIndex }
}
