import { buildJourney, legKey, type LegEstimate } from './engine'
import type { Trip } from '../data/types'

/** One pin chip's clock: the planned arrival, road km into the trip, and
 *  whether the drive behind it is still an estimate. */
export interface StopClockEntry {
  arrive: string
  cumKm: number
  estimated: boolean
}

/**
 * The map's pin clocks, derived from the SAME journey the Timeline rows read
 * (#611). `legCorrections` is the workspace's measured road data: a leg the
 * map carries reads measured, a leg it does not cover stays an estimate and
 * says so. The first point's own start clock is never an estimate — no drive
 * stands behind it.
 */
export function buildStopClock(
  trip: Trip,
  legCorrections?: Record<string, LegEstimate>,
): Map<string, StopClockEntry> {
  const clock = new Map<string, StopClockEntry>()
  let cum = 0
  for (const d of trip.days) {
    const j = buildJourney(trip, d, legCorrections)
    let legKm = 0
    j.points.forEach((p, i) => {
      legKm += p.legIn?.distanceKm ?? 0
      if (p.synthesized) return
      const prev = j.points[i - 1]
      const measured = !!p.legIn && !!prev && legCorrections?.[legKey(prev, p)] != null
      clock.set(p.stop.id, { arrive: p.arrive, cumKm: Math.round(cum + legKm), estimated: !measured })
    })
    cum += j.distanceKm
  }
  return clock
}
