// ============ Stop-kind markers (Calm Travel Intelligence, milestone M4) ============
// Pure display mapping from a stop's existing data to the design system's
// seven stop types (docs/redesign/YATRAFLOW_DESIGN_DIRECTION.md §6.3: Drive,
// Stay, Food, Fuel, Rest, Activity, Viewpoint). No data-model change — the
// existing category + title drive everything.
import type { ItineraryStop, TransportMode } from '../data/types'

export type StopKind = 'drive' | 'stay' | 'food' | 'fuel' | 'rest' | 'activity' | 'viewpoint'

export const STOP_KIND_LABELS: Record<StopKind, string> = {
  drive: 'Drive',
  stay: 'Stay',
  food: 'Food',
  fuel: 'Fuel',
  rest: 'Rest',
  activity: 'Activity',
  viewpoint: 'Viewpoint',
}

/** Keep the style kind separate from the transport label and glyph. */
export function stopPresentation(
  stop: { category?: ItineraryStop['category']; title: string; auto?: boolean },
  tripMode: TransportMode = 'mixed',
): { kind: StopKind; label: string; mode?: TransportMode } {
  const kind = stopKindOf(stop)
  if (kind !== 'drive') return { kind, label: STOP_KIND_LABELS[kind] }
  if (stop.category === 'transport-hub') {
    return /\bairport\b/i.test(stop.title)
      ? { kind, label: 'Airport', mode: 'flight' }
      : { kind, label: 'Transport hub', mode: tripMode }
  }
  // An explicit ground transfer must not inherit the trip's flight mode.
  if (/\b(taxi|cab)\b/i.test(stop.title)) return { kind, label: 'Taxi', mode: 'taxi' }
  if (/\btransfer\b/i.test(stop.title)) return { kind, label: 'Transfer', mode: 'taxi' }
  if (tripMode === 'flight' && stop.auto) return { kind, label: 'Route point', mode: 'mixed' }
  const labels: Record<TransportMode, string> = {
    car: 'Drive', rental: 'Drive', motorcycle: 'Ride', taxi: 'Taxi',
    train: 'Train', bus: 'Bus', flight: 'Flight', mixed: 'Travel',
  }
  return { kind, label: labels[tripMode], mode: tripMode }
}

/** Fuel has no category of its own — it arrives as titled halts ("Upshi fuel stop"). */
const FUEL_RE = /\b(fuel|petrol|diesel|cng|charging)\b/i
/** Scenic pull-outs: explicit viewpoint words in the title win over the category. */
const VIEWPOINT_RE = /\b(viewpoint|view point|sunset|sunrise|waterfall|falls|lake|peak|pass)\b/i

export function stopKindOf(stop: { category?: ItineraryStop['category']; title: string }): StopKind {
  if (FUEL_RE.test(stop.title)) return 'fuel'
  if (VIEWPOINT_RE.test(stop.title)) return 'viewpoint'
  switch (stop.category) {
    case 'travel':
    case 'transport-hub':
      return 'drive'
    case 'hotel':
      return 'stay'
    case 'food':
      return 'food'
    case 'rest':
      return 'rest'
    case 'nature':
    case 'beach':
    case 'adventure':
      return 'viewpoint'
    // sightseeing, temple, museum, shopping, event, and anything uncategorised
    default:
      return 'activity'
  }
}
