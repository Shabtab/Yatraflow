// ============ Impact Preview engine ============
// Compares the current plan against a hypothetical modified plan.
import type { Trip } from '../data/types'
import {
  getAssumptions, simulateDay, computeTotals, originOf,
  hmToMinutes, legBetween, legKey, collectWarnings,
  type LegEstimate, type ScheduleWarning,
} from './engine'

/** The measured road corrections the surfaces render with (tripRoad's
 *  `correctionsFromLegs`). Optional so a caller without a measurement keeps
 *  working — but passing it is what makes the preview's numbers the same
 *  numbers the timeline shows (#342). */
export type LegCorrections = Record<string, LegEstimate> | undefined

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

function tripTravel(trip: Trip, legCorrections?: LegCorrections) {
  let mins = 0, km = 0
  trip.days.forEach(day => {
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index, legCorrections)
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

// Chord heuristic, deliberately limited: `legBetween` is haversine × road
// factor, so a ghat switchback that doubles back on the map can look like
// backtracking while the road is doing the only sane thing. Where the legs are
// ROAD-MEASURED we skip the suspicion entirely — road truth beats chord
// suspicion (#342). The same limitation applies to `commitmentConflictsFor`
// below, which mirrors `collectWarnings`' own chord-based check.
function detectBacktrack(trip: Trip, legCorrections?: LegCorrections): boolean {
  const A = getAssumptions(trip)
  for (const day of trip.days) {
    const pts = [...day.stops].filter(s => s.status !== 'rejected').sort((x, y) => x.orderInDay - y.orderInDay)
    for (let i = 1; i < pts.length - 1; i++) {
      if (legCorrections && (legCorrections[legKey(pts[i], pts[i - 1])] || legCorrections[legKey(pts[i], pts[i + 1])])) continue
      const back = legBetween(pts[i], pts[i - 1], A)
      const fwd = legBetween(pts[i], pts[i + 1], A)
      if (back.distanceKm < fwd.distanceKm * 0.55 && fwd.distanceKm > 18) return true
    }
  }
  return false
}

function commitmentConflictsFor(trip: Trip, legCorrections?: LegCorrections): string[] {
  const out: string[] = []
  for (const fc of trip.fixedCommitments) {
    // Same rule as collectWarnings: check-in is an anchor, not a race.
    if (fc.type === 'hotel-checkin') continue
    const day = trip.days.find(d => d.index === fc.dayIndex)
    if (!day) continue
    const sim = simulateDay(day, trip, originOf(trip, fc.dayIndex), fc.dayIndex, legCorrections)
    if (!sim.activeStops.length) continue
    const lastArr = sim.arrivalTimes[sim.arrivalTimes.length - 1]
    if (hmToMinutes(lastArr) > hmToMinutes(fc.time)) out.push(`${fc.title} (${fc.time})`)
  }
  return out
}

function openingHoursIssuesFor(trip: Trip, legCorrections?: LegCorrections): string[] {
  const out: string[] = []
  trip.days.forEach(day => {
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index, legCorrections)
    sim.activeStops.forEach((s, i) => {
      if (!s.openTime || !s.closeTime) return
      const arr = sim.arrivalTimes[i]
      // A hydrated or hand-edited row can carry no `visitMinutes` at all;
      // `undefined` made every comparison NaN and the conflict vanished
      // silently. Coerce like the engine does — a missing dwell is 0 minutes.
      const visit = Number.isFinite(s.visitMinutes) ? s.visitMinutes : 0
      if (hmToMinutes(arr) < hmToMinutes(s.openTime)) out.push(`${s.title}: arrive ${arr}, opens ${s.openTime}`)
      else if (hmToMinutes(arr) + visit > hmToMinutes(s.closeTime)) out.push(`${s.title}: closes at ${s.closeTime} before you can finish`)
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

/** Core comparison. `proposed` should already contain the change being previewed.
 *  `legCorrections` is the same measured road data every surface renders with —
 *  threaded through here so the preview's “adds ~X min” IS the number the
 *  timeline will show after Keep, not a chord estimate ~20% short (#342). */
export function computeImpact(trip: Trip, proposed: Trip, kind: ImpactResult['kind'], dayIndex: number, legCorrections?: LegCorrections): ImpactResult {
  const curT = tripTravel(trip, legCorrections)
  const propT = tripTravel(proposed, legCorrections)
  const curCost = computeTotals(trip).totalCostInr
  const propCost = computeTotals(proposed).totalCostInr

  const curW = collectWarnings(trip)
  const propW = collectWarnings(proposed)
  const { newWarnings, clearedWarnings } = diffWarnings(curW, propW)

  // Arrival-time changes on the affected day, matched by STOP IDENTITY (#342).
  // Comparing position by position misattributed every reorder: after a pure
  // reorder `pStop.id !== cStop.id` at every index, and each row paired the NEW
  // occupant's title with the OLD occupant's clock. Matching on id reports what
  // actually happened — this stop moved (same title, new clock), that one is
  // new, the other is gone.
  const arrivalChanges: ImpactResult['arrivalChanges'] = []
  const day = proposed.days.find(d => d.index === dayIndex)
  const curDay = trip.days.find(d => d.index === dayIndex)
  if (day && curDay) {
    const simP = simulateDay(day, proposed, originOf(proposed, dayIndex), dayIndex, legCorrections)
    const simC = simulateDay(curDay, trip, originOf(trip, dayIndex), dayIndex, legCorrections)
    const byId = (sim: typeof simP) => {
      const m = new Map<string, { title: string; at: string }>()
      sim.activeStops.forEach((s, i) => {
        const key = String(s.id)
        if (m.has(key)) return // a corrupt duplicate id must not clobber the first
        m.set(key, { title: s.title, at: sim.arrivalTimes[i] ?? '—' })
      })
      return m
    }
    const before = byId(simC)
    const after = byId(simP)
    for (const [id, stop] of after) {
      const was = before.get(id)
      if (!was) arrivalChanges.push({ stopTitle: stop.title, from: '—', to: stop.at })
      else if (was.at !== stop.at) arrivalChanges.push({ stopTitle: stop.title, from: was.at, to: stop.at })
    }
    for (const [id, stop] of before) {
      if (!after.has(id)) arrivalChanges.push({ stopTitle: stop.title, from: stop.at, to: '—' })
    }
  }

  // Cross-day effect: any other day's schedule shifted?
  let crossDayNote: string | undefined
  const otherDaysChanged = trip.days.filter(d => d.index !== dayIndex).some(d => {
    // Compare the day's ORIGIN as well as its clock. An empty day's `endsAt`
    // is just its start time — origin-independent — so a change that moved
    // kilometres of tomorrow's wake-up point used to slip through silently
    // (#341's food-tail case), which is exactly the note's job.
    const curOrigin = originOf(trip, d.index)
    const propOrigin = originOf(proposed, d.index)
    if (curOrigin.lat !== propOrigin.lat || curOrigin.lng !== propOrigin.lng) return true
    const a = simulateDay(d, trip, curOrigin, d.index, legCorrections).endsAt
    const b = simulateDay(d, proposed, propOrigin, d.index, legCorrections).endsAt
    return a !== b
  })
  if (otherDaysChanged) crossDayNote = 'This change shifts timings on another day too.'

  // Same verdict as the day pill: `n > 5` is busy (#342). The preview said “No”
  // at n=6 while the pill showed busy — one day, two answers.
  const propBusyCount = day ? simulateDay(day, proposed, originOf(proposed, dayIndex), dayIndex, legCorrections).activeStops.length : 0

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
    tooBusy: propBusyCount > 5,
    backtracking: detectBacktrack(proposed, legCorrections),
    commitmentConflicts: commitmentConflictsFor(proposed, legCorrections),
    openingHoursIssues: openingHoursIssuesFor(proposed, legCorrections),
    assumptions: assumptionsText(proposed),
  }
}
