// #420 slice 15: the rail rows' pure helpers — the trip-aware numbers behind
// each suggestion row, with no component state in reach.
//
// `alternativesFor` names the halt and hands over the pool; `chipsFor`
// resolves the row's detour and day budget through the facts the page hands
// in; the two labels read the day's readiness and identity. All four are pure:
// the page calls them during render like every other `map/` helper, so no
// hook boundary is involved. The JSX rows stay with the page for the rails
// slice.
import type { Trip, ItineraryDay } from '../../../data/types'
import type { PlaceHit, SegmentHit } from '../../../lib/geocode'
import type { RailChip } from '../../../lib/railReasons'
import { dayDetourBudgetMin } from '../../../lib/detourBudget'
import {
  alternativesFor as pickAlternatives, sightRowChips, type AltPool,
} from './sightRows'

/** Closest alternatives for a halt: next 2 by road position plus detour. */
export function alternativesFor(sh: SegmentHit, hit: PlaceHit, pool: AltPool): Array<{ h: PlaceHit; dKm: number | null }> {
  // #420 slice 5: the family/ranking rule lives in ./sightRows with its tests;
  // this only names the halt and hands over the pool.
  return pickAlternatives({
    purpose: sh.segment.purpose,
    targetKm: sh.segment.targetKm,
    hit,
    pool,
  })
}

/** The trip-aware facts `chipsFor` resolves per row, handed in by the page. */
export type ChipFacts = {
  detourMinFor: (hit: PlaceHit) => number | null
  days: ItineraryDay[]
  dayForKm: (km: number | null | undefined) => number | null
  travelStyle: Trip['travelStyle']
}

/** Reason chips for one suggestion, shared by the card and the rail filter. */
export function chipsFor(sh: SegmentHit, hit: PlaceHit, facts: ChipFacts): RailChip[] {
  // #420 slice 5: the chips themselves (including the #163 rounding predicate) come
  // from ./sightRows; the trip-aware numbers are resolved here.
  const detourMin = facts.detourMinFor(hit)
  const hitDay = facts.days.find(d => d.index === facts.dayForKm(hit.cumKm))
  const dayBudget = dayDetourBudgetMin({
    travelStyle: facts.travelStyle,
    plannedStops: (hitDay?.stops ?? []).filter(s => s.status !== 'rejected').length,
  })
  return sightRowChips({ segment: sh.segment, hit, detourMin, dayBudget })
}

/** The rail's meter copy: the mockup's wording, honest per day. The count is
 *  over `required` (engine-managed parts excluded) — the work the crew owns. */
export function activeReadinessLabel(r: { total: number; filled: number; required: number; auto: number }): string {
  if (r.total === 0) return 'nothing scheduled for this day yet'
  return `${r.filled} of ${r.required} planned${r.auto > 0 ? ` · ${r.auto} auto` : ''}`
}

/** The header's day identity: the day's own title, else its first-to-last
 *  stops - the mockup reads 'Day 2 - Kochi to Alleppey' where it can. */
export function activeDayLabel(days: ItineraryDay[], activeDayIndex: number): string {
  const d = days.find(x => x.index === activeDayIndex)
  if (!d) return 'your drive'
  if (d.title && d.title.trim()) return d.title.trim()
  const stops = d.stops.filter(s => s.status !== 'rejected')
  const first = stops[0]?.locationName ?? stops[0]?.title
  const last = stops[stops.length - 1]?.locationName ?? stops[stops.length - 1]?.title
  if (first && last && first !== last) return `${first} to ${last}`
  return first ?? 'your drive'
}
