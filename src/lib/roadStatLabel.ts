// ============ The day header's distance stat: which truth is on screen (#671) ============
// The Timeline's per-day distance is honest ONLY after the workspace's road
// chain (src/lib/tripRoad.ts) has measured it. While the measurement is
// pending, or fails, or the trip's mode is never road-measured, the engine
// falls back to haversine × 1.25 — a number that on the Kerala demo trip reads
// ~83 km where the road is ~146 km. The `~` prefix marks the approximation,
// but nothing said WHICH kind of number it was. This module is that wording:
// one rule the header prints and a screen reader hears, pure and node-testable.
import { measuredLegCount, type Journey, type LegEstimate } from './engine'
import type { RoadStatus } from './tripRoad'

/** The five truths a day header's distance can be showing. 'ok' = EVERY one of
 *  the day's legs carries a measured road figure, so the day's total is a road
 *  number. 'partial' = only some legs are measured, so the total still mixes
 *  chord math and must keep the estimate wording. */
export type RoadState = RoadStatus | 'not-measured' | 'partial'

/**
 * The journey fields a distance label needs. A real `Journey` satisfies it;
 * tests construct the two fields directly, with plain {lat,lng} points.
 */
export type DistanceJourney = Pick<Journey, 'distanceKm'> & {
  points: Array<{ lat: number; lng: number }>
}

/**
 * Resolve the day's road state from the workspace's road status.
 *
 * `points` and `corrections` decide what an 'ok' status MEANS for this day:
 * every one of the day's own legs carries a measured correction → 'ok'; some
 * but not all → 'partial'; none → 'not-measured', so a mode the road layer
 * never measures (a flight trip) and a day that never moves both tell the
 * estimate truth instead of implying a road number. The status alone is not
 * enough: tripRoad.ts calls the chain 'ok' when its legs resolve, but an
 * individual day can still be short of measurements.
 */
export function roadStateOf(
  status: RoadStatus | undefined,
  journey: Pick<DistanceJourney, 'points'>,
  corrections?: Record<string, LegEstimate>,
): RoadState {
  if (status === 'pending') return 'pending'
  if (status === 'failed') return 'failed'
  const measured = measuredLegCount(journey.points, corrections)
  if (measured === 0) return 'not-measured'
  return fullyMeasured(journey, corrections) ? 'ok' : 'partial'
}

/**
 * True when EVERY leg of this day carries a measured road figure, so the day's
 * total is a road number. `measuredLegCount` counts only the measured legs, and
 * one measured leg is enough to make the chain's status 'ok' — so a day whose
 * other legs are still chord math must not print its mixed total as a road km.
 * A day with fewer than two points has no leg to measure.
 */
export function fullyMeasured(
  journey: Pick<DistanceJourney, 'points'>,
  corrections?: Record<string, LegEstimate>,
): boolean {
  const legs = journey.points.length - 1
  if (legs < 1) return false
  return measuredLegCount(journey.points, corrections) === legs
}

/**
 * The distance stat the day header prints: `~83 km · straight-line estimate —
 * road not measured yet` while the road is unknown, `146 km · road measured`
 * once every leg of the day is measured. A partly measured day keeps the `~`
 * and says its estimate is mixed. The wording rides the text itself — a screen
 * reader hears the same distinction a sighted reader sees — and reuses the
 * language the Optimise tooltip already speaks ("straight-line estimate: the
 * road has not been measured yet", DaySection.tsx). The number is always the
 * journey's own engine-computed distance; this module only names whose kind of
 * number it is.
 */
export function distanceStatLabel(journey: DistanceJourney, state: RoadState): string {
  const km = Math.round(journey.distanceKm)
  switch (state) {
    case 'ok':
      return `${km} km · road measured`
    case 'pending':
      return `~${km} km · straight-line estimate — measuring the road`
    case 'failed':
      return `~${km} km · straight-line estimate — road measurement failed`
    case 'partial':
      return `~${km} km · mixed estimate — part of this day's road is measured`
    default:
      return `~${km} km · straight-line estimate — road not measured yet`
  }
}
