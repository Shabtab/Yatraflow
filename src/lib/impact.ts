// ============ Impact Preview engine ============
// Compares the current plan against a hypothetical modified plan.
import type { Trip } from '../data/types'
import {
  getAssumptions, simulateDay, computeTotals, originOf,
  minutesToHM, hmToMinutes, legBetween, collectWarnings,
  type ScheduleWarning,
} from './engine'

export interface ImpactResult {
  kind: 'add' | 'remove' | 'reorder' | 'edit' | 'move-day'
  dayIndex: number
  timeDeltaMin: number          // + more travel/visit time, − less
  distanceDeltaKm: number
  costDeltaInr: number
  arrivalChanges: { stopTitle: string; from: string; to: string }[]
  newWarnings: ScheduleWarning[]   // warnings that appear only in the proposed plan
  clearedWarnings: ScheduleWarning[]
  crossDayNote?: string
  tooBusy: boolean
  backtracking: boolean
  commitmentConflicts: string[]
  openingHoursIssues: string[]
  assumptions: string
}

function tripTravel(trip: Trip) {
  const A = getAssumptions(trip)
  let mins = 0, km = 0
  trip.days.forEach(day => {
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
    // Total time on the road = driving + stop time (visit minutes + buffers).
    // Driving alone hid a halt's own duration: adding a 20-minute break
    // previously showed a ~0 time delta because only the extra leg driving
    // changed. That is exactly the number the impact dialog must move.
    mins += sim.totalTravelMinutes + sim.dwellMinutes
    km += sim.totalDistanceKm
  })
  return { mins, km }
}

function keyOf(w: ScheduleWarning): string {
  return `${w.code}|${w.title}`
}

function diffWarnings(before: ScheduleWarning[], after: ScheduleWarning[]) {
  const bKeys = new Set(before.map(keyOf))
  const aKeys = new Set(after.map(keyOf))
  return {
    newWarnings: after.filter(w => !bKeys.has(keyOf(w))),
    clearedWarnings: before.filter(w => !aKeys.has(keyOf(w))),
  }
}

function detectBacktrack(trip: Trip): boolean {
  const A = getAssumptions(trip)
  for (const day of trip.days) {
    const pts = [...day.stops].filter(s => s.status !== 'rejected').sort((x, y) => x.orderInDay - y.orderInDay)
    for (let i = 1; i < pts.length - 1; i++) {
      const back = legBetween(pts[i], pts[i - 1], A)
      const fwd = legBetween(pts[i], pts[i + 1], A)
      if (back.distanceKm < fwd.distanceKm * 0.55 && fwd.distanceKm > 18) return true
    }
  }
  return false
}

function commitmentConflictsFor(trip: Trip): string[] {
  const out: string[] = []
  for (const fc of trip.fixedCommitments) {
    if (fc.type === 'hotel-checkin') continue
    const day = trip.days.find(d => d.index === fc.dayIndex)
    if (!day) continue
    const sim = simulateDay(day, trip, originOf(trip, fc.dayIndex), fc.dayIndex)
    if (!sim.activeStops.length) continue
    const lastArr = sim.arrivalTimes[sim.arrivalTimes.length - 1]
    if (hmToMinutes(lastArr) > hmToMinutes(fc.time)) out.push(`${fc.title} (${fc.time})`)
  }
  return out
}

function openingHoursIssuesFor(trip: Trip): string[] {
  const out: string[] = []
  trip.days.forEach(day => {
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
    sim.activeStops.forEach((s, i) => {
      if (!s.openTime || !s.closeTime) return
      const arr = sim.arrivalTimes[i]
      if (hmToMinutes(arr) < hmToMinutes(s.openTime)) out.push(`${s.title}: arrive ${arr}, opens ${s.openTime}`)
      else if (hmToMinutes(arr) + s.visitMinutes > hmToMinutes(s.closeTime)) out.push(`${s.title}: closes at ${s.closeTime} before you can finish`)
    })
  })
  return out
}

function assumptionsText(trip: Trip): string {
  const A = getAssumptions(trip)
  return [
    `Mode: ${A.mode}`,
    `Avg speed ~${A.avgSpeedKmph} km/h`,
    `Buffer ${A.bufferMinutesPerStop} min per stop`,
    `Time includes driving + stop time`,
    `Road distance ≈ straight-line × 1.25`,
    `Demo coordinates — not live traffic`,
  ].join(' · ')
}

/** Core comparison. `proposed` should already contain the change being previewed. */
export function computeImpact(trip: Trip, proposed: Trip, kind: ImpactResult['kind'], dayIndex: number): ImpactResult {
  const curT = tripTravel(trip)
  const propT = tripTravel(proposed)
  const curCost = computeTotals(trip).totalCostInr
  const propCost = computeTotals(proposed).totalCostInr

  const curW = collectWarnings(trip)
  const propW = collectWarnings(proposed)
  const { newWarnings, clearedWarnings } = diffWarnings(curW, propW)

  // Arrival-time changes on the affected day (compare stop by stop)
  const arrivalChanges: ImpactResult['arrivalChanges'] = []
  const day = proposed.days.find(d => d.index === dayIndex)
  const curDay = trip.days.find(d => d.index === dayIndex)
  if (day && curDay) {
    const simP = simulateDay(day, proposed, originOf(proposed, dayIndex), dayIndex)
    const simC = simulateDay(curDay, trip, originOf(trip, dayIndex), dayIndex)
    const maxLen = Math.max(simP.activeStops.length, simC.activeStops.length)
    for (let i = 0; i < maxLen; i++) {
      const pStop = simP.activeStops[i]
      const cStop = simC.activeStops[i]
      const to = i < simP.arrivalTimes.length ? simP.arrivalTimes[i] : '—'
      const from = i < simC.arrivalTimes.length ? simC.arrivalTimes[i] : '—'
      if (pStop && cStop && pStop.id === cStop.id && from !== to) {
        arrivalChanges.push({ stopTitle: pStop.title, from, to })
      } else if ((pStop && !cStop) || (cStop && !pStop)) {
        arrivalChanges.push({ stopTitle: pStop?.title ?? cStop?.title ?? '?', from, to })
      }
    }
  }

  // Cross-day effect: any other day's schedule shifted?
  let crossDayNote: string | undefined
  const otherDaysChanged = trip.days.filter(d => d.index !== dayIndex).some(d => {
    const a = simulateDay(d, trip, originOf(trip, d.index), d.index).endsAt
    const b = simulateDay(d, proposed, originOf(proposed, d.index), d.index).endsAt
    return a !== b
  })
  if (otherDaysChanged) crossDayNote = 'This change shifts timings on another day too.'

  const propBusyCount = day ? simulateDay(day, proposed, originOf(proposed, dayIndex), dayIndex).activeStops.length : 0

  return {
    kind,
    dayIndex,
    timeDeltaMin: propT.mins - curT.mins,
    distanceDeltaKm: propT.km - curT.km,
    costDeltaInr: propCost - curCost,
    arrivalChanges,
    newWarnings,
    clearedWarnings,
    crossDayNote,
    tooBusy: propBusyCount > 6,
    backtracking: detectBacktrack(proposed),
    commitmentConflicts: commitmentConflictsFor(proposed),
    openingHoursIssues: openingHoursIssuesFor(proposed),
    assumptions: assumptionsText(proposed),
  }
}
