// ============ My trips cards — small pure text helpers ============
// The card, the Up next card and the list rows print the same facts. These
// helpers keep one wording for all of them. No clock reads, no store reads.
import type { Trip } from '../data/types'

/** "3 days", "1 day". */
function dayCount(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`
}

/** The place a trip ends at: its last destination with a name, or the start
 *  place when no destination has a name. The route line and the hero use it, so
 *  the card and the headline always name the same place. */
export function lastStop(t: Pick<Trip, 'startLocation' | 'destinations'>): string {
  const named = (t.destinations ?? []).filter(destination => destination.trim() !== '')
  return named.length > 0 ? named[named.length - 1] : t.startLocation
}

/** Route line: "Kochi → Alleppey · 4 days". An empty destination list ends the
 *  route at the start place. */
export function routeLine(t: Pick<Trip, 'startLocation' | 'destinations' | 'days'>): string {
  return `${t.startLocation} → ${lastStop(t)} · ${dayCount(t.days.length)}`
}

/** Whole travel hours as a short value: 767 minutes gives "13h". */
export function travelHoursText(totalTravelMinutes: number): string {
  const safeMinutes = Number.isFinite(totalTravelMinutes) ? totalTravelMinutes : 0
  return `${Math.round(safeMinutes / 60)}h`
}

/** Planning meter fill, a whole percent from 0 to 100. Zero days gives 0. */
export function meterPercent(planned: number, total: number): number {
  if (!(total > 0)) return 0
  const raw = Math.round((planned / total) * 100)
  return Math.min(100, Math.max(0, raw))
}

/** Meter label: "3 of 5 days have activities". The noun and verb follow the
 *  total, so one day reads "1 of 1 day has activities". No days gives "No days yet". */
export function meterLabel(planned: number, total: number): string {
  if (!(total > 0)) return 'No days yet'
  const dayPhrase = total === 1 ? 'day has' : 'days have'
  return `${planned} of ${total} ${dayPhrase} activities`
}

/** Midnight of the local calendar day of `date`, as a timestamp. It stays the
 *  same all day, so it works as a memo key for the day-based filters. */
export function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** The My trips card layout: a grid of cards, or one row per trip. */
export type TripsLayout = 'grid' | 'list'

/** The uiPrefs key the layout choice is stored under. Only the layout is stored. */
export const TRIPS_LAYOUT_PREF = 'trips_layout'

/** A stored layout that names a real layout. Anything else reads as the grid. */
export function layoutFromPref(raw: string | null | undefined): TripsLayout {
  return raw === 'list' ? 'list' : 'grid'
}
