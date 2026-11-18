// ============ My trips — Up next countdown row ============
// The flip tiles, the line under them and the health ring tone. Pure helpers:
// no clock reads, no store reads. Nothing here invents a time or a score.
import type { ItineraryDay, Trip } from '../data/types'
import type { HealthResult } from './engine'
import { dateStamp, daysUntilStart } from './tripsPage'
import { formatHM, type TimeFormat } from './timefmt'

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

export interface Countdown {
  /** One tile per digit: 17 gives ["1", "7"]. */
  digits: string[]
  /** "Days to go", or "Day to go" for one day. A label, so it starts with a capital. */
  unit: string
  /** The group label for a screen reader: "17 days to go". */
  label: string
}

/**
 * The flip tiles for an upcoming trip. A trip that is live, past or without
 * dates gets none, so the card keeps its countdown text ("Day 2 of 4").
 */
export function countdownTiles(t: Pick<Trip, 'startDate' | 'endDate'>, today: Date): Countdown | null {
  const away = daysUntilStart(t, today)
  if (away === null || away < 1) return null
  const unit = away === 1 ? 'Day to go' : 'Days to go'
  return { digits: String(away).split(''), unit, label: `${away} ${unit.toLowerCase()}` }
}

/** The stored clock of the first timed stop on a day, with the stop's own name. */
function firstTimedStop(day: ItineraryDay): { time: string; place: string } | null {
  const stops = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
  for (const stop of stops) {
    const time = [stop.departTime, stop.arrivalTime].find(value => value !== undefined && CLOCK.test(value))
    if (time) return { time, place: stop.title }
  }
  return null
}

/**
 * The line under the tiles. It is "Day 1 starts at 08:00 in Kochi" when day 1
 * has a timed stop, the stored clock shown in the viewer's 12h or 24h choice.
 * Otherwise it is "Starts Fri 27 Nov". A trip with no start day gets null.
 * The place is the timed stop's own name, and it is left out when that is blank.
 */
export function startsSubtitle(t: Pick<Trip, 'startDate' | 'days'>, fmt: TimeFormat): string | null {
  const dayOne = [...(t.days ?? [])].sort((a, b) => a.index - b.index)[0]
  const timed = dayOne ? firstTimedStop(dayOne) : null
  if (timed) {
    const place = timed.place.trim()
    return `Day 1 starts at ${formatHM(timed.time, fmt)}${place ? ` in ${place}` : ''}`
  }
  const stamp = dateStamp(t)
  if (!stamp) return null
  const weekday = stamp.weekday.charAt(0) + stamp.weekday.slice(1).toLowerCase()
  return `Starts ${weekday} ${stamp.day} ${stamp.month}`
}

export type RingTone = 'teal' | 'marigold' | 'bloom'

/** Comfortable and Manageable are teal, Tight is marigold, Unrealistic is bloom. */
export function ringTone(band: HealthResult['band']): RingTone {
  if (band === 'Tight') return 'marigold'
  return band === 'Unrealistic' ? 'bloom' : 'teal'
}

/** The ring's accessible name. The list page has no measured road data, so it says "Estimated". */
export function ringLabel(health: Pick<HealthResult, 'score' | 'band'>): string {
  return `Estimated trip health ${health.score}, ${health.band}`
}
