// ============ Add/edit-stop form plumbing, shared by Timeline and Board ============
// The Board and the Timeline both let you add and edit a stop; both need the
// same two derivations — what the form should be pre-filled with, and where the
// traveller is coming from / headed next for the leg preview. They used to live
// privately inside TimelineTab, which meant the Board either duplicated them or
// (as it did) simply couldn't offer the action at all. One implementation here
// keeps the two views from drifting the way their rejected-stop handling did.
import type { Trip } from '../data/types'
import { predecessorOf, nextAfter, coLocates, getAssumptions, scheduleRowsById } from './engine'
import type { DayCardFacts } from './dayCards'
import { titleCase, statusLabel } from './labels'
import { formatHM, type TimeFormat } from './timefmt'
import { formatInr } from './engine'
import type { StopFormValues, LegContext } from '../components/StopEditor'

export const STOP_PRIORITY_CHOICES = [
  { value: 'must-do', label: 'Must', accessibleLabel: 'Must do' },
  { value: 'nice-to-have', label: 'Nice', accessibleLabel: 'Nice to have' },
  { value: 'optional', label: 'If time', accessibleLabel: 'Optional, if time allows' },
] as const

export function stopEditorSummaries(values: Partial<StopFormValues>, timeFormat: TimeFormat) {
  const hours = values.openTime && values.closeTime
    ? `Opens ${formatHM(values.openTime, timeFormat)}–${formatHM(values.closeTime, timeFormat)}`
    : values.openTime ? `Opens ${formatHM(values.openTime, timeFormat)}`
      : values.closeTime ? `Closes ${formatHM(values.closeTime, timeFormat)}` : ''
  const money = (amount: number | undefined, label: string) =>
    amount != null && Number.isFinite(amount) && amount > 0 ? `${label} ${formatInr(amount)}` : ''
  return {
    categoryHours: [values.category ? titleCase(values.category) : '', hours].filter(Boolean).join(' · '),
    costs: [money(values.entryFeeInrPerPerson, 'Entry'), money(values.transportCostInrTotal, 'Transport')].filter(Boolean).join(' · '),
    details: [values.description?.trim() ? 'Description' : '', values.notes?.trim() ? 'Notes' : '', values.sourceUrl?.trim() ? 'Link' : '', values.status ? statusLabel(values.status) : ''].filter(Boolean).join(' · '),
  }
}

/** Which stop the editor is open for — a new one on `dayIndex`, or an existing `stopId`.
 *  A new one may carry the insertion `position` the user picked (#422): the
 *  Timeline's between-stop control knows the slot, so the full editor opens on
 *  that slot instead of appending and asking for a later reorder. Absent = append. */
export type StopEditorTarget =
  | { mode: 'add'; dayIndex: number; position?: number }
  | { mode: 'edit'; stopId: string }
  | null

export interface StopPlanFacts {
  arrive?: string
  leave?: string
  stayMin?: number
  distanceKm?: number
  driveMin?: number
}

export function stopPlanFacts(state: StopEditorTarget, facts: DayCardFacts | undefined): StopPlanFacts | undefined {
  if (!state || state.mode !== 'edit' || !facts) return undefined
  const row = scheduleRowsById(facts.sim).get(state.stopId)
  if (!row) return undefined
  const point = facts.journey.points.find(p => !p.synthesized && p.stop.id === state.stopId)
  // A leg with no distance and no drive time is the day's start standing on this
  // stop, not a drive. Showing "0.0 km, drive 0 min" would invent a trip leg.
  const leg = point?.legIn && (point.legIn.distanceKm >= 0.05 || point.legIn.durationMinutes >= 0.5) ? point.legIn : undefined
  return {
    arrive: row.arrive || undefined,
    leave: row.depart || undefined,
    stayMin: point?.dwellMinutes,
    distanceKm: leg?.distanceKm,
    driveMin: leg?.durationMinutes,
  }
}

/** Pre-fill for the editor: the existing stop when editing, nothing when adding. */
export function stopInitialValues(
  state: StopEditorTarget,
  trip: Trip,
): Partial<StopFormValues> | undefined {
  if (!state || state.mode !== 'edit') return undefined
  for (const d of trip.days) {
    const s = d.stops.find(x => x.id === state.stopId)
    if (!s) continue
    return {
      ...s,
      // An existing stop IS pinned to its stored name, so the form opens with
      // the hint telling the truth ("Pinned to a real place on the map"); only
      // typing in the location field flips this back to false. New stops
      // default to false — they have no pin until one is picked.
      geocoded: true,
      description: s.description ?? '',
      notes: s.notes ?? '',
      openTime: s.openTime ?? '',
      closeTime: s.closeTime ?? '',
      departTime: s.departTime ?? '',
      arrivalTime: s.arrivalTime ?? '',
      legDistanceKm: s.legDistanceKm ?? 0,
      legTravelMinutes: s.legTravelMinutes ?? 0,
    }
  }
  return undefined
}

/**
 * Leg context for the add-stop flow: where you're coming from and where you're
 * headed next. Add-only — an edit has no travel leg to preview.
 */
export function stopLegContext(state: StopEditorTarget, trip: Trip): LegContext | undefined {
  if (!state || state.mode !== 'add') return undefined
  const pred = predecessorOf(trip, state.dayIndex)
  if (!pred) return undefined
  const nxt = nextAfter(trip, state.dayIndex)
  // Don't advertise "headed next to X" when you're already standing in X.
  const next = nxt && !coLocates(pred.point, nxt.point) ? nxt : undefined
  const A = getAssumptions(trip)
  return {
    fromName: pred.name,
    fromPoint: pred.point,
    nextName: next?.name,
    dayStart: A.dayStart,
    transportMode: trip.transportMode,
    fuelEconomyKmL: trip.fuelEconomyKmL,
    fuelPricePerL: trip.fuelPricePerL,
  }
}

/** Stable identity for the editor's reset key — flips the form when the target
 *  changes. The insertion slot is part of that identity: moving from "insert
 *  between A and B" to "add at the end of the day" is a different target, and
 *  the form must re-seed rather than keep the earlier slot's copy. */
export function stopEditorKey(state: StopEditorTarget): string {
  if (!state) return ''
  return state.mode === 'edit' ? state.stopId : `add-${state.dayIndex}-${state.position ?? 'end'}`
}

/** Which day index a stop belongs to (0 if not found — the engine's convention). */
export function stopDayIndex(trip: Trip, stopId: string): number {
  for (const d of trip.days) if (d.stops.some(s => s.id === stopId)) return d.index
  return 0
}
