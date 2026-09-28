/**
 * #420, slice 4 — the rail's detour labels, in one place and under test.
 *
 * Two surfaces in the Map tab printed the SAME sentence about a place: the corridor
 * rows ("arrive 11:24 · +26 min · 58% of the day's detour budget") and the slot pins
 * on the map, which assemble the identical three bits from a slot's top candidate.
 * The wording was duplicated, so a change to one could quietly leave the other
 * behind — and `hitCosts` also carried the per-day budget cache that makes it cheap.
 *
 * `detourBits` is that sentence once. `hitCostLabels` and `slotPinsFor` are the two
 * callers, lifted out of the page so their behaviour is pinned by direct tests
 * instead of by rendering 2,700 lines.
 */
import { clockHM } from '../../../lib/clockOverlay'
import { budgetSharePct } from '../../../lib/detourBudget'
import type { DaySlot } from '../../../lib/daySlots'

export type DetourLabelBits = {
  /** "HH:MM" when the arrival is known — the caller decides that, not this module */
  arriveLabel?: string | null
  /** door-to-door detour minutes; null = the position/detour is unknown */
  detourMin: number | null
  /** whole-percent share of that day's detour budget, when it is worth saying */
  budgetSharePct?: number | null
}

/** The three bits, in the order every surface prints them. A zero share is not a
 *  sentence worth printing, and neither is an arrival nobody measured. */
export function detourBits({ arriveLabel, detourMin, budgetSharePct }: DetourLabelBits): string[] {
  return [
    arriveLabel ? `arrive ${arriveLabel}` : null,
    detourMin == null ? 'position unknown' : detourMin > 0.5 ? `+${Math.round(detourMin)} min` : 'on route',
    budgetSharePct != null && budgetSharePct > 0 ? `${budgetSharePct}% of the day's detour budget` : null,
  ].filter((bit): bit is string => bit != null)
}

export type HitCostInput = {
  /** one entry per corridor hit, in rail order; a hit with no position still gets a label */
  hits: ReadonlyArray<{
    id: string
    cumKm?: number | null
    detourMin: number | null
    /** the segment's planned arrival, before the detour is added */
    etaMinutes?: number | null
  }>
  /** the day a hit's road position belongs to */
  dayForKm: (km: number | null | undefined) => number | null
  /** that day's detour budget — looked up once per day, not once per hit */
  detourBudgetMin: (dayIndex: number) => number
}

/** The cost chip under every corridor row, keyed by hit id. */
export function hitCostLabels({ hits, dayForKm, detourBudgetMin }: HitCostInput): Record<string, string> {
  // One budget per day, not one per hit - the lookup is cheap, the repetition
  // across every hit on the map was not.
  const budgetByDay = new Map<number, number>()
  const budgetFor = (dayIndex: number): number => {
    const cached = budgetByDay.get(dayIndex)
    if (cached != null) return cached
    const budget = detourBudgetMin(dayIndex)
    budgetByDay.set(dayIndex, budget)
    return budget
  }

  const labels: Record<string, string> = {}
  for (const h of hits) {
    const dMin = h.detourMin
    const eta = h.etaMinutes
    const arriveLabel = eta != null && Number.isFinite(eta) && dMin != null
      ? clockHM(Math.round(eta + dMin))
      : null
    let share: number | null = null
    if (dMin != null && dMin > 0.5) {
      const budget = budgetFor(dayForKm(h.cumKm) ?? 0)
      if (budget > 0) share = budgetSharePct(dMin, budget)
    }
    labels[String(h.id)] = detourBits({ arriveLabel, detourMin: dMin, budgetSharePct: share }).join(' · ')
  }
  return labels
}

/** The map's empty-part pins: the day's empty slots that have a candidate to stand
 *  on, each carrying the same sentence as a corridor row. */
export function slotPinsFor(slots: readonly DaySlot[]) {
  return slots
    .filter(s => s.state === 'empty' && s.candidates.length > 0)
    .map(s => {
      const c = s.candidates[0]
      return {
        key: s.key,
        label: s.label,
        name: c.hit.name,
        meta: detourBits({ arriveLabel: c.arriveLabel, detourMin: c.detourMin, budgetSharePct: c.budgetSharePct }).join(' · '),
        hit: c.hit,
      }
    })
}
