// ============ My trips — per-day checks and the "Ready to go" rule ============
// The Up next card shows one cell per day: "All clear", "3 to fix" or
// "Not planned". The cells come from the engine's own warnings, grouped by day
// with `groupWarnings`, so this page and the workspace never disagree on which
// day a warning belongs to. The list page has no measured road data, so the
// engine falls back to its estimates. The card says so.
import type { Trip } from '../data/types'
import { groupWarnings, type ScheduleWarning } from './engine'
import { plannedDayFlags } from './tripNextStep'
import { statusOf } from './tripsPage'

export type DayTone = 'clear' | 'fix' | 'risk' | 'empty'

export interface DayCell {
  /** 1-based, as the traveller reads it. */
  dayNumber: number
  tone: DayTone
  label: string
}

/**
 * One cell per day, in day order.
 *  - A day with no activity: "Not planned".
 *  - A planned day with no warning: "All clear".
 *  - A planned day with warnings: "N to fix". The tone is `risk` when any of
 *    them is high, else `fix`.
 * Trip-wide warnings belong to no day, so they are not in the strip.
 */
export function dayStrip(trip: Pick<Trip, 'days'>, warnings: ScheduleWarning[]): DayCell[] {
  const days = [...(trip.days ?? [])].sort((a, b) => a.index - b.index)
  const flags = plannedDayFlags(trip)
  const { byDay } = groupWarnings(warnings)
  return days.map((day, position) => {
    const dayNumber = day.index + 1
    if (!flags[position]) return { dayNumber, tone: 'empty', label: 'Not planned' }
    const list = byDay.get(day.index) ?? []
    if (list.length === 0) return { dayNumber, tone: 'clear', label: 'All clear' }
    const tone: DayTone = list.some(w => w.severity === 'high') ? 'risk' : 'fix'
    return { dayNumber, tone, label: `${list.length} to fix` }
  })
}

/**
 * "Ready to go" has one rule: the trip is live or upcoming, it has at least one
 * day, every day holds an activity, and the engine reports no high warning.
 * A trip without dates, or one that ended, is never ready.
 */
export function isReadyToGo(trip: Trip, today: Date, warnings: ScheduleWarning[]): boolean {
  const status = statusOf(trip, today)
  if (status !== 'upcoming' && status !== 'live') return false
  const flags = plannedDayFlags(trip)
  if (flags.length === 0 || !flags.every(Boolean)) return false
  return !warnings.some(w => w.severity === 'high')
}
