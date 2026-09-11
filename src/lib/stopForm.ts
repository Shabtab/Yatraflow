// ============ Add/edit-stop form plumbing, shared by Timeline and Board ============
// The Board and the Timeline both let you add and edit a stop; both need the
// same two derivations — what the form should be pre-filled with, and where the
// traveller is coming from / headed next for the leg preview. They used to live
// privately inside TimelineTab, which meant the Board either duplicated them or
// (as it did) simply couldn't offer the action at all. One implementation here
// keeps the two views from drifting the way their rejected-stop handling did.
import type { Trip } from '../data/types'
import { predecessorOf, nextAfter, coLocates, getAssumptions } from './engine'
import type { StopFormValues, LegContext } from '../components/StopEditor'

/** Which stop the editor is open for — a new one on `dayIndex`, or an existing `stopId`. */
export type StopEditorTarget =
  | { mode: 'add'; dayIndex: number }
  | { mode: 'edit'; stopId: string }
  | null

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

/** Stable identity for the editor's reset key — flips the form when the target changes. */
export function stopEditorKey(state: StopEditorTarget): string {
  if (!state) return ''
  return state.mode === 'edit' ? state.stopId : `add-${state.dayIndex}`
}

/** Which day index a stop belongs to (0 if not found — the engine's convention). */
export function stopDayIndex(trip: Trip, stopId: string): number {
  for (const d of trip.days) if (d.stops.some(s => s.id === stopId)) return d.index
  return 0
}
