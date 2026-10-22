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

/** The four truths a day header's distance can be showing. 'ok' = at least one
 *  of the day's legs carries a MEASURED road figure (the same threshold the
 *  Optimise label applies, engine.ts measuredLegCount) — so a day on a measured
 *  chain never wears an estimate label, and a day with nothing measured never
 *  passes as a road number. */
export type RoadState = RoadStatus | 'not-measured'

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
 * at least one of the day's own legs carries a measured correction → 'ok'
 * (status already promised the chain's legs are real — tripRoad.ts's
 * resolvedLegs rule); anything else reads 'not-measured', so a mode the road
 * layer never measures (a flight trip) and a day that never moves both tell
 * the estimate truth instead of implying a road number.
 */
export function roadStateOf(
  status: RoadStatus | undefined,
  journey: Pick<DistanceJourney, 'points'>,
  corrections?: Record<string, LegEstimate>,
): RoadState {
  if (status === 'pending') return 'pending'
  if (status === 'failed') return 'failed'
  return measuredLegCount(journey.points, corrections) > 0 ? 'ok' : 'not-measured'
}

/**
 * The distance stat the day header prints: `~83 km · straight-line estimate —
 * road not measured yet` while the road is unknown, `146 km · road measured`
 * once it is. The wording rides the text itself — a screen reader hears the
 * same distinction a sighted reader sees — and reuses the language the
 * Optimise tooltip already speaks ("straight-line estimate: the road has not
 * been measured yet", DaySection.tsx). The number is always the journey's own
 * engine-computed distance; this module only names whose kind of number it is.
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
    default:
      return `~${km} km · straight-line estimate — road not measured yet`
  }
}
