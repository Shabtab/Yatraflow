/**
 * The trip card's derivations: its next-step line (MR1) and its planning bar
 * (MR2). Pure on purpose: no React, no store, no DOM, so each answer is testable on
 * its own and the card only reads them.
 *
 * The next-step order below is the finding, not a taste call. An unfilled day
 * blocks every later day, because the engine plans days in sequence. A booking
 * blocks the day that carries it. A suggestion blocks nothing, so it waits. A
 * cover photo blocks nothing at all, so it waits for last.
 *
 * An automatic route anchor is not an activity (#647). `autoAnchor` in the store
 * writes one stop at the origin and one at the last destination, each with zero
 * dwell time, so the route has a start and an end. The engine treats those stops
 * as waypoints (`src/lib/engine.ts`). A planning meter that counts them reports
 * progress a traveller does not have.
 */

import type { ItineraryDay, ItineraryStop, Trip } from '../data/types'

/** What the card should offer. `done` means the trip needs nothing from you. */
export type NextStepKind =
  | 'add-dates'
  | 'plan-day'
  | 'book-stop'
  | 'confirm-stop'
  | 'add-cover'
  | 'done'

export interface NextStep {
  kind: NextStepKind
  /** Short label for the card, already worded as an instruction. */
  label: string
  /** 0-based day index. Absent for trip-level steps. */
  dayIndex?: number
  /** The stop that needs attention. Absent for trip-level steps. */
  stopId?: string
}

/**
 * The cover emoji a trip gets before anyone chooses one.
 *
 * `trips.cover_emoji` is `not null default '🧭'`, and `CoverThumb` falls back to
 * the same glyph when it is handed no emoji at all. A stored 🧭 is therefore
 * indistinguishable from "no cover chosen" on screen and in the data — which is
 * why a live read of every publication (2026-10-05) found `coverEmoji` set on
 * all of them while `coverImageUrl` was set on one. Counting 🧭 as a cover made
 * the `add-cover` step unreachable, so MR5 could never render.
 */
const DEFAULT_COVER_EMOJI = '🧭'

/** A rejected stop is a decision already made, so it never blocks anything. */
function isUsable(stop: ItineraryStop): boolean {
  return stop.status !== 'rejected'
}

function usableStops(day: ItineraryDay): ItineraryStop[] {
  return day.stops.filter(isUsable).sort((a, b) => a.orderInDay - b.orderInDay)
}

/**
 * True for a stop that answers "what will I do here". An automatic route anchor
 * does not answer it: the store writes it only to anchor the route, so it holds
 * no dwell time and no chosen activity (#647).
 */
function isActivity(stop: ItineraryStop): boolean {
  return stop.auto !== true
}

/**
 * The one definition of a planned day: it holds at least one activity. Both the
 * meter and the empty-day test read this, so the two can never disagree.
 */
function isPlannedDay(day: ItineraryDay): boolean {
  return usableStops(day).some(isActivity)
}

/** Days sorted by index, because array order is not a contract. */
function byIndex(days: ItineraryDay[]): ItineraryDay[] {
  return [...days].sort((a, b) => a.index - b.index)
}

/**
 * True when the trip carries a cover somebody chose. A photo counts. So does an
 * emoji the user picked from the cover picker — but not the 🧭 every trip is
 * born with, which renders as the same generic placeholder an empty cover does.
 */
function hasCover(trip: Trip): boolean {
  if (trip.coverImageUrl) return true
  return Boolean(trip.coverEmoji) && trip.coverEmoji !== DEFAULT_COVER_EMOJI
}

export function nextTripStep(trip: Trip): NextStep {
  // A draft has no dates, so the engine has no days to plan against.
  if (!trip.startDate || !trip.endDate) {
    return { kind: 'add-dates', label: 'Set your travel dates' }
  }

  const days = byIndex(trip.days ?? [])

  if (days.length === 0) {
    return { kind: 'plan-day', label: 'Plan your first day' }
  }

  // The earliest empty day blocks every day after it. A day that holds only an
  // automatic route anchor is empty: nothing on it answers what to do there.
  for (const day of days) {
    if (!isPlannedDay(day)) {
      return {
        kind: 'plan-day',
        label: `Plan day ${day.index + 1}`,
        dayIndex: day.index,
      }
    }
  }

  // The earliest unbooked stop is the one that bites first.
  for (const day of days) {
    const stop = usableStops(day).find(s => s.status === 'needs-booking')
    if (stop) {
      return {
        kind: 'book-stop',
        label: `Book ${stop.title}`,
        dayIndex: day.index,
        stopId: stop.id,
      }
    }
  }

  // A suggestion is advice, not a blocker, so it comes after the real blockers.
  for (const day of days) {
    const stop = usableStops(day).find(s => s.status === 'suggested' || s.status === 'maybe')
    if (stop) {
      return {
        kind: 'confirm-stop',
        label: `Confirm ${stop.title}`,
        dayIndex: day.index,
        stopId: stop.id,
      }
    }
  }

  if (!hasCover(trip)) {
    return { kind: 'add-cover', label: 'Add a cover photo' }
  }

  return { kind: 'done', label: 'Ready to travel' }
}

/**
 * Days with activities over total days, for the progress bar in MR2.
 *
 * The measure is activity coverage, not readiness. A day the store anchored
 * automatically is not planned, because an anchor is a route point (#647). A
 * trip can therefore read 0 of 3 days while a route already exists, which is the
 * honest answer to "what have I planned".
 */
export function plannedDayRatio(trip: Pick<Trip, 'days'>): { planned: number; total: number; pct: number } {
  const days = trip.days ?? []
  const total = days.length
  const planned = days.filter(isPlannedDay).length
  // A trip with no days is 0% planned, never NaN from an empty denominator.
  const pct = total === 0 ? 0 : Math.round((planned / total) * 100)
  return { planned, total, pct }
}

/**
 * Where a step's own action goes (#645).
 *
 * The card's task row and the featured card's primary button both read this, so
 * the two can never disagree about where a step lives. A step that names a stop
 * rides the timeline's `?day=&stop=` deep link, which `TripWorkspace` validates
 * against the trip before it opens anything. A step that names a day opens the
 * timeline at that day. The trip-level steps open the tab that can act on them:
 * Settings holds the date fields and the cover picker. Only `done` has nothing
 * to open, and it falls back to the trip root so a caller always gets a route.
 * The return type is the app's own link shape, so `appLink` takes it unchanged.
 */
export function nextStepRoute(trip: Trip, step: NextStep): `/${string}` {
  if (step.kind === 'add-dates' || step.kind === 'add-cover') return `/trip/${trip.id}/settings`
  if (step.dayIndex !== undefined) return timelineRoute(trip.id, step.dayIndex, step.stopId)
  return `/trip/${trip.id}`
}

/**
 * A timeline address at one day, with an optional stop (#645).
 *
 * The deep link's shape lives here once: `TripWorkspace` reads `?day=&stop=` on
 * a timeline address and validates both against the trip before it opens
 * anything, so a caller that invents its own query is one rename away from a
 * link that silently opens nothing. The next-step route and the saved shelf
 * both ride this.
 */
export function timelineRoute(tripId: string, dayIndex: number, stopId?: string | null): `/${string}` {
  const q = new URLSearchParams({ day: String(dayIndex) })
  if (stopId) q.set('stop', stopId)
  return `/trip/${tripId}/timeline?${q.toString()}`
}