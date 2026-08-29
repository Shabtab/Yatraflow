// ============ Long-ride break planner ============
// A 588 km Kolkata → Siliguri day is not one sitting. This module turns a
// day's self-drive into a fatigue-aware break plan: how many halts, where
// along the route they should fall, how long each should be, and what they do
// to the total ride time. Pure math only — fetching actual stop spots is a
// UI-layer concern (network), and per the transparency promise every number
// here is surfaced with its assumptions.

import type { Trip, ItineraryDay } from '../data/types'
import {
  simulateDay, originOf, getAssumptions, routeDayDrive,
  hmToMinutes, addMinutesToClock, isFuelEconomyMode,
  ROUTE_DAY_MIN_KM,
  type LegEstimate,
} from './engine'

/** Wheel time from which a self-drive day wants a break plan. */
export const LONG_RIDE_MINUTES = 300
/** Distance from which a self-drive day wants one, even on fast roads — same threshold the engine uses for route-day overlays. */
export const LONG_RIDE_KM = ROUTE_DAY_MIN_KM
/** Wheel-time gap between consecutive halts in the regular-breaks style (~2.5 h). */
export const BREAK_INTERVAL_MINUTES = 150
/** Motorcycle fatigue builds faster — halts come more often (~2 h). */
export const BREAK_INTERVAL_MOTORCYCLE_MINUTES = 120
/** First halt never comes before this much wheel time. */
export const BREAK_LEAD_MINUTES = 120
/** A halt landing this close to the destination isn't worth the stop. */
export const BREAK_TAIL_MINUTES = 60
/** Recommended halt lengths: a proper meal vs a quick tea/fuel stretch. */
export const MEAL_MINUTES = 40
export const TEA_MINUTES = 20
/** Regular-breaks never proposes more than this many halts per day. */
export const MAX_BREAKS = 4
/** Wheel time above which the plan insists on a proper meal halt. */
export const MEAL_REQUIRED_MINUTES = 360
/** An existing food/rest stop within ±this of a slot's position covers it. */
export const SLOT_COVERED_MINUTES = 45

export type RideStyle = 'nonstop' | 'one-halt' | 'regular-breaks' | 'custom'

export const RIDE_STYLES: { key: RideStyle; label: string; blurb: string }[] = [
  { key: 'nonstop', label: 'Push through', blurb: 'Cover it in one go — no halts' },
  { key: 'one-halt', label: 'One halt', blurb: 'A single proper halt around the halfway point' },
  { key: 'regular-breaks', label: 'Regular breaks', blurb: 'A stretch every ~2.5 h of riding' },
  { key: 'custom', label: 'Custom', blurb: 'Pick how many halts yourself — spaced evenly across the drive' },
]

/** A recommended halt: where along the drive, how long, and when you'd reach it. */
export interface BreakSlot {
  /** cumulative wheel-minutes from the ride start where the halt ideally falls */
  atDriveMinute: number
  /** 0..1 — how far along the day's drive this sits */
  fraction: number
  /** km from the ride start, along the day's route */
  atKm: number
  /** recommended halt length */
  stopMinutes: number
  /** meal (proper food) vs tea (short stretch / fuel top-up) */
  kind: 'meal' | 'tea'
  /** insert the halt into the day's ordered active stops at this index (0 = right after the origin) */
  insertAt: number
  /** rough clock time the halt starts, given the day's start time */
  clock: string
  /** the day already has a food/rest halt around this point */
  alreadyStopped: boolean
}

export interface RidePlan {
  isLongRide: boolean
  /** wheel time without halts */
  driveMinutes: number
  distanceKm: number
  /** clock the day's ride starts (per-day override or the planning default) */
  startClock: string
  /** clock the drive ends if pushed through without halts */
  finishClock: string
  style: RideStyle
  breaks: BreakSlot[]
  breakMinutes: number
  /** drive + halts */
  totalMinutes: number
  /** clock the day ends with the planned halts taken */
  finishWithBreaks: string
  /**
   * True when this day only held the trip-start anchor and the plan is really
   * the trip's outbound drive to the next planned destination (e.g. Day 1 for
   * a Kolkata → Siliguri trip). Kept distinct so the UI can label it honestly.
   */
  isOutboundDrive: boolean
  /**
   * True when this day ends at the final-destination anchor of a round trip
   * whose outbound drive was planned on an earlier day — the plan is the ride
   * BACK to the trip start (e.g. Day 2: Siliguri → Kolkata), not a replay of
   * the outbound leg the day's chain happens to carry.
   */
  isReturnDrive: boolean
  /** plain name of the far end of the drive when this is a route day (label only) */
  targetLabel?: string
}

/** Style the planner pre-picks from the ride length — the user can override. */
export function recommendedStyle(driveMinutes: number): RideStyle {
  return driveMinutes >= MEAL_REQUIRED_MINUTES ? 'regular-breaks' : 'one-halt'
}

/** Wheel-time marks for a style's halts, clamped to a useful window. */
function slotTimes(style: RideStyle, driveMinutes: number, mode: string, customHaltCount?: number): number[] {
  if (style === 'nonstop' || driveMinutes <= BREAK_LEAD_MINUTES + BREAK_TAIL_MINUTES) return []
  if (style === 'one-halt') {
    return [Math.min(Math.max(driveMinutes / 2, BREAK_LEAD_MINUTES), driveMinutes - BREAK_TAIL_MINUTES)]
  }
  // custom divides the drive into n+1 equal stretches so exactly n halts fit
  // inside the lead/tail window; regular-breaks spaces halts by fixed wheel time
  const gap = style === 'custom'
    ? driveMinutes / (Math.min(MAX_BREAKS, Math.max(1, Math.round(customHaltCount ?? 2))) + 1)
    : mode === 'motorcycle' ? BREAK_INTERVAL_MOTORCYCLE_MINUTES : BREAK_INTERVAL_MINUTES
  const out: number[] = []
  for (let t = gap; t <= driveMinutes - BREAK_TAIL_MINUTES && out.length < MAX_BREAKS; t += gap) out.push(t)
  return out
}

/** The slot nearest the middle of the drive becomes the meal halt (when one is warranted). */
function mealSlotIndex(slotTs: number[], driveMinutes: number): number {
  if (slotTs.length === 0 || driveMinutes < MEAL_REQUIRED_MINUTES) return -1
  const mid = driveMinutes / 2
  let best = 0
  for (let i = 1; i < slotTs.length; i++) {
    if (Math.abs(slotTs[i] - mid) < Math.abs(slotTs[best] - mid)) best = i
  }
  return best
}

/**
 * Plan the break halts for one day's drive. Reads the day's simulated legs
 * (OSRM-corrected when the UI has them), places halts by wheel time, maps each
 * onto its position along the route and clock time, and totals the ride.
 */
export function planRide(
  day: ItineraryDay,
  trip: Trip,
  legCorrections?: Record<string, LegEstimate>,
  styleOverride?: RideStyle,
  customHaltCount?: number,
): RidePlan {
  const A = getAssumptions(trip)
  const sim = simulateDay(day, trip, originOf(trip, day.index), day.index, legCorrections)
  const startHM = day.startTime ?? A.dayStart
  const startMin = hmToMinutes(startHM)

  // --- Route-day overlays --------------------------------------------------
  // A self-drive day holding only trip anchors and ride halts represents one
  // long drive the day's own chain doesn't fully carry: the departure day
  // (only the trip-start anchor) drives on toward the next planned
  // destination, and the return day of a round trip (only the destination
  // anchor) drives back home — its chain still carries the OUTBOUND leg
  // (originOf walks back to the start), which is exactly why Day 2 used to
  // replay the outbound numbers. Overlay the drive the day actually
  // represents, with its own wheel time, distance and direction.
  let driveMinutes = sim.totalTravelMinutes
  let distanceKm = sim.totalDistanceKm
  let planningLegs = sim.legs
  let isOutboundDrive = false
  let isReturnDrive = false
  let targetLabel: string | undefined
  const overlay = routeDayDrive(trip, day, legCorrections)
  if (overlay) {
    driveMinutes = overlay.minutes
    distanceKm = overlay.km
    planningLegs = overlay.legs.map(l => ({
      fromTitle: '', toTitle: '',
      distanceKm: l.distanceKm, durationMinutes: l.durationMinutes,
    }))
    isOutboundDrive = overlay.direction === 'outbound'
    isReturnDrive = overlay.direction === 'return'
    targetLabel = overlay.targetName
  }

  const isLongRide = isFuelEconomyMode(trip.transportMode)
    && sim.activeStops.length > 0
    && (driveMinutes >= LONG_RIDE_MINUTES || distanceKm >= LONG_RIDE_KM)
  const style: RideStyle = isLongRide ? (styleOverride ?? recommendedStyle(driveMinutes)) : 'nonstop'

  const finishClock = addMinutesToClock(startMin, driveMinutes)
  if (!isLongRide) {
    return {
      isLongRide, driveMinutes, distanceKm, startClock: startHM,
      finishClock, style, breaks: [], breakMinutes: 0,
      totalMinutes: driveMinutes, finishWithBreaks: finishClock,
      isOutboundDrive: false, isReturnDrive: false, targetLabel,
    }
  }

  // Cumulative wheel-minutes/km at the END of each leg (leg i runs point i →
  // point i+1, where point 0 is the origin and point j is ordered stop j−1 —
  // or, on an overlaid route day, the (j−1)th ride halt).
  const cumMin: number[] = []
  const cumKm: number[] = []
  let m = 0, k = 0
  for (const leg of planningLegs) {
    m += leg.durationMinutes
    k += leg.distanceKm
    cumMin.push(m)
    cumKm.push(k)
  }

  const ts = slotTimes(style, driveMinutes, trip.transportMode, customHaltCount)
  const mealIdx = mealSlotIndex(ts, driveMinutes)

  // Splice position in the day's ordered stops for a halt riding leg li: right
  // before the stop that ENDS the leg. On overlaid route days the final leg
  // ends at the far destination (not a stop of this day), so its halt appends
  // after the day's anchor — keeping it on the correct side of the drive
  // (after the start anchor outbound, after the destination anchor on the way
  // home). Inserting before the start anchor instead made the day's chain run
  // origin → halt → origin and doubled/halved the wheel time.
  const orderedStops = [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)
  const nonAutoStops = sim.activeStops.filter(s => !s.auto)
  const insertPosForLeg = (li: number): number => {
    const endStop = overlay ? nonAutoStops[li] : sim.activeStops[li]
    if (!endStop) return orderedStops.length
    const pos = orderedStops.findIndex(s => s.id === endStop.id)
    return pos < 0 ? orderedStops.length : pos
  }

  const breaks: BreakSlot[] = ts.map((t, i) => {
    // the leg whose cumulative time crosses t carries this halt
    let li = cumMin.findIndex(cm => cm >= t - 1e-9)
    if (li < 0) li = cumMin.length - 1
    const prevM = li > 0 ? cumMin[li - 1] : 0
    const prevK = li > 0 ? cumKm[li - 1] : 0
    const leg = planningLegs[li]
    const f = leg && leg.durationMinutes > 0
      ? Math.min(1, Math.max(0, (t - prevM) / leg.durationMinutes))
      : 0
    const kind: BreakSlot['kind'] = i === mealIdx ? 'meal' : 'tea'
    return {
      atDriveMinute: Math.round(t),
      fraction: driveMinutes > 0 ? t / driveMinutes : 0,
      atKm: Math.round(prevK + f * (leg?.distanceKm ?? 0)),
      stopMinutes: kind === 'meal' ? MEAL_MINUTES : TEA_MINUTES,
      kind,
      insertAt: insertPosForLeg(li),
      clock: addMinutesToClock(startMin, t),
      alreadyStopped: false,
    }
  })

  // A food/rest stop the day already has, within ±SLOT_COVERED_MINUTES of a
  // slot's position, means that halt is planned — don't suggest a second one.
  // Arrival wheel-minutes: ordinary days index the cum arrays by active-stop
  // position (sim.legs has a leg per active stop); overlaid route days index
  // them by ride-halt order (auto anchors drop out of the overlay drive).
  let haltIdx = 0
  sim.activeStops.forEach((s, idx) => {
    if (s.auto) return
    const arriveMin = overlay
      ? (haltIdx < cumMin.length ? cumMin[haltIdx] : m)
      : (idx < cumMin.length ? cumMin[idx] : m)
    if (overlay) haltIdx++
    if ((s.category !== 'food' && s.category !== 'rest') || s.visitMinutes <= 0) return
    for (const b of breaks) {
      if (Math.abs(b.atDriveMinute - arriveMin) <= SLOT_COVERED_MINUTES) b.alreadyStopped = true
    }
  })

  const breakMinutes = breaks.reduce((a, b) => a + b.stopMinutes, 0)
  return {
    isLongRide, driveMinutes, distanceKm, startClock: startHM,
    finishClock, style, breaks, breakMinutes,
    totalMinutes: driveMinutes + breakMinutes,
    finishWithBreaks: addMinutesToClock(startMin, driveMinutes + breakMinutes),
    isOutboundDrive, isReturnDrive, targetLabel,
  }
}
