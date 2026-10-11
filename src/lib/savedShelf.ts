// ============ the saved shelf (My Trips) ============
// MR8's hearts write `day:<n>` and `stop:<id>` into `lib/uiPrefs`. Nothing read
// them back, so a saved item was a heart that remembered a number. This module
// turns those ids into named rows a reader can act on: the day's own label and
// place, or the stop's title and the day it sits on.
//
// WHY THE RESOLUTION IS PURE AND SEPARATE: the ids outlive the plan. A stop can
// be deleted, or a re-split can move it to another day, and an id that names
// nothing must be dropped rather than rendered as a ghost row. That is a rule
// with cases, so it lives here where a test can argue with it, not in the
// component's render.
//
// A SAVED DAY IS NOT A SAVED STOP. A day is a bookmark on a whole day of the
// plan: it opens the timeline at that day and says how many stops the day
// holds. A stop is a bookmark on one experience inside a day: it opens the
// timeline AT that stop, and it names the day only to say where it lives. The
// two are kept apart in the row's own shape (`kind`) so a surface cannot
// quietly treat one as the other.

import type { ItineraryDay, ItineraryStop, Trip } from '../data/types'
import { dayStripItems } from './dayStrip'
import { timelineRoute } from './tripNextStep'

/** The id prefixes MR8 writes. Exported so the writer and reader cannot drift. */
export const SAVED_DAY_PREFIX = 'day:'
export const SAVED_STOP_PREFIX = 'stop:'

export interface ShelfRow {
  /** The stored id itself, so a shelf can flip exactly the heart that wrote it. */
  id: string
  kind: 'day' | 'stop'
  /** The day the row opens. Always known: a resolved row points at a real day. */
  dayIndex: number
  /** "Day 3" for a day; the stop's own title for a stop. */
  title: string
  /** Where it sits: "Jaipur · 4 stops" for a day, "Day 3 · Jaipur" for a stop. */
  meta: string
  /** The timeline address that opens it, stop focus included for a stop. */
  route: `/${string}`
}

/** Stops of one day in plan order, the way the timeline reads them. */
function orderedStops(day: ItineraryDay): ItineraryStop[] {
  return [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)
}

/** The stop with this id, wherever it currently lives — or null once deleted. */
function findStop(days: ItineraryDay[], stopId: string): { day: ItineraryDay; stop: ItineraryStop } | null {
  for (const day of days) {
    const stop = orderedStops(day).find(s => s.id === stopId)
    if (stop) return { day, stop }
  }
  return null
}

/**
 * The saved rows of one trip, in plan order: each day before the stops inside
 * it, days ascending. An id that names no day or no stop is dropped — the plan
 * moved on, and a shelf entry that opens nothing is worse than no entry. Ids the
 * module does not recognise (a future prefix) are dropped too, so an older
 * build never renders a row it cannot place.
 */
export function savedShelfFor(trip: Trip, ids: string[]): ShelfRow[] {
  const days = [...(trip.days ?? [])].sort((a, b) => a.index - b.index)
  const strip = new Map(dayStripItems(trip.days ?? []).map(item => [item.dayIndex, item]))
  const rows: ShelfRow[] = []
  const seen = new Set<string>()

  for (const raw of ids) {
    if (seen.has(raw)) continue
    seen.add(raw)

    if (raw.startsWith(SAVED_DAY_PREFIX)) {
      // Digits only: `Number('')` is 0 and `Number(' 1')` is 1, so a length
      // check alone would open Day 1 for an id that names nothing at all.
      const suffix = raw.slice(SAVED_DAY_PREFIX.length)
      if (!/^\d+$/.test(suffix)) continue
      const dayIndex = Number(suffix)
      const day = days.find(d => d.index === dayIndex)
      if (!day) continue
      const item = strip.get(dayIndex)
      const stopCount = item?.stopCount ?? day.stops.length
      const meta = [
        item?.place ?? null,
        `${stopCount} stop${stopCount === 1 ? '' : 's'}`,
      ].filter(Boolean).join(' · ')
      rows.push({
        id: raw,
        kind: 'day',
        dayIndex,
        title: item?.label ?? `Day ${dayIndex + 1}`,
        meta,
        route: timelineRoute(trip.id, dayIndex),
      })
      continue
    }

    if (raw.startsWith(SAVED_STOP_PREFIX)) {
      const stopId = raw.slice(SAVED_STOP_PREFIX.length)
      if (!stopId) continue
      const found = findStop(days, stopId)
      if (!found) continue
      const place = strip.get(found.day.index)?.place ?? null
      rows.push({
        id: raw,
        kind: 'stop',
        dayIndex: found.day.index,
        title: found.stop.title,
        meta: [`Day ${found.day.index + 1}`, place].filter(Boolean).join(' · '),
        route: timelineRoute(trip.id, found.day.index, stopId),
      })
    }
  }

  // A day leads its own stops, so the shelf reads like the plan it came from.
  return rows.sort((a, b) =>
    a.dayIndex - b.dayIndex ||
    (a.kind === b.kind ? 0 : a.kind === 'day' ? -1 : 1) ||
    a.title.localeCompare(b.title))
}
