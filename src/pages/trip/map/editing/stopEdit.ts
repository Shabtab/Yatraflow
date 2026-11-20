// ============ Map v2 edit boundaries: edit a stop (#906) ============
// Visit steps, move to a day, swap and remove each build one EditRequest.
// A request is a mutator plus the change kind the workspace writer expects, so
// Map and Timeline write the same thing. `proposeEdit` measures a request on a
// copy of the trip with the existing impact function. Nothing here writes.
import type { ItineraryStop, Trip } from '../../../../data/types'
import { fixedRowsFor } from '../../../../lib/fixedTimes'
import { hmToMinutes, originOf, simulateDay } from '../../../../lib/engine'
import { computeImpact, type ImpactResult, type LegCorrections } from '../../../../lib/impact'
import { carryStopLinkedRecords, dayHoldingStop, moveStopToDay, renumberDay, stopById, stopsInOrder } from '../../../../lib/stopOrder'
import { validHM } from '../../../../lib/timefmt'
import type { PreviewClock, PreviewWarning } from './addPreview'

/** The stay length changes in this many minutes per press. */
export const VISIT_STEP_MIN = 15
/** The lowest length a step reaches. A stop already below it stays as it is. */
export const VISIT_LOWEST_MIN = 15
export const VISIT_HIGHEST_MIN = 720

/** One step up or down. A value that is not a number stays unknown (null). */
export function stepVisit(current: number | null | undefined, direction: 1 | -1): number | null {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null
  if (direction === 1) {
    return Math.min(VISIT_HIGHEST_MIN, (Math.floor(current / VISIT_STEP_MIN) + 1) * VISIT_STEP_MIN)
  }
  if (current <= VISIT_LOWEST_MIN) return current
  const next = Math.ceil(current / VISIT_STEP_MIN) * VISIT_STEP_MIN - VISIT_STEP_MIN
  return Math.max(VISIT_LOWEST_MIN, next === current ? current - VISIT_STEP_MIN : next)
}

export type EditRefusal =
  | 'stop-missing'
  | 'day-missing'
  | 'same-day'
  | 'same-stop'
  | 'different-days'
  | 'visit-invalid'

/** A change the workspace writer can stage: the same kinds Timeline uses. */
export interface EditRequest {
  kind: ImpactResult['kind']
  /** The day the writer is told about. */
  dayIndex: number
  /** Every day the change touches. */
  dayIndexes: number[]
  label: string
  mutate: (draft: Trip) => void
}

export type RequestResult = { kind: 'ok'; request: EditRequest } | { kind: 'refused'; reason: EditRefusal }

const refused = (reason: EditRefusal): RequestResult => ({ kind: 'refused', reason })

export function setVisitRequest(trip: Trip, stopId: string, minutes: number): RequestResult {
  const day = dayHoldingStop(trip, stopId)
  if (!day) return refused('stop-missing')
  if (!Number.isFinite(minutes) || minutes < 0) return refused('visit-invalid')
  return {
    kind: 'ok',
    request: {
      kind: 'edit', dayIndex: day.index, dayIndexes: [day.index], label: `Stay ${minutes} min`,
      mutate: draft => {
        const stop = stopById(draft, stopId)
        if (stop) stop.visitMinutes = minutes
      },
    },
  }
}

/** Without a drop point the stop lands by road order, as Timeline's modal does. */
export function moveToDayRequest(
  trip: Trip,
  stopId: string,
  toDayIndex: number,
  kmOf?: (s: ItineraryStop) => number | null | undefined,
): RequestResult {
  const from = dayHoldingStop(trip, stopId)
  if (!from) return refused('stop-missing')
  if (!trip.days.some(d => d.index === toDayIndex)) return refused('day-missing')
  if (from.index === toDayIndex) return refused('same-day')
  return {
    kind: 'ok',
    request: {
      kind: 'move-day', dayIndex: toDayIndex, dayIndexes: [from.index, toDayIndex], label: `Move to day ${toDayIndex + 1}`,
      // Linked commitments and expenses move with the stop (#989). The
      // preview's impact rows show the change, so no extra toast is needed.
      mutate: draft => {
        if (moveStopToDay(draft.days, stopId, toDayIndex, null, kmOf)) {
          carryStopLinkedRecords(draft, stopId, toDayIndex)
        }
      },
    },
  }
}

/** Replace a stop with a pick, in the same place and with the same order. */
export function swapWithPickRequest(trip: Trip, stopId: string, pick: ItineraryStop): RequestResult {
  const day = dayHoldingStop(trip, stopId)
  if (!day) return refused('stop-missing')
  return {
    kind: 'ok',
    request: {
      kind: 'edit', dayIndex: day.index, dayIndexes: [day.index], label: `Swap with ${pick.title}`,
      mutate: draft => {
        const target = dayHoldingStop(draft, stopId)
        if (!target) return
        const list = stopsInOrder(target)
        const at = list.findIndex(s => s.id === stopId)
        if (at < 0) return
        list[at] = { ...pick, orderInDay: list[at].orderInDay }
        list.forEach((s, i) => { s.orderInDay = i + 1 })
        target.stops = list
      },
    },
  }
}

/** Swap the places of two stops on one day. */
export function swapWithStopRequest(trip: Trip, stopId: string, withStopId: string): RequestResult {
  if (stopId === withStopId) return refused('same-stop')
  const day = dayHoldingStop(trip, stopId)
  const other = dayHoldingStop(trip, withStopId)
  if (!day || !other) return refused('stop-missing')
  if (day.index !== other.index) return refused('different-days')
  return {
    kind: 'ok',
    request: {
      kind: 'reorder', dayIndex: day.index, dayIndexes: [day.index], label: 'Swap places',
      mutate: draft => {
        const target = dayHoldingStop(draft, stopId)
        if (!target) return
        const list = stopsInOrder(target)
        const a = list.findIndex(s => s.id === stopId)
        const b = list.findIndex(s => s.id === withStopId)
        if (a < 0 || b < 0) return
        ;[list[a], list[b]] = [list[b], list[a]]
        list.forEach((s, i) => { s.orderInDay = i + 1 })
        target.stops = list
      },
    },
  }
}

/** The proposal only. The destructive write itself goes through removeStopWithUndo. */
export function removeRequest(trip: Trip, stopId: string): RequestResult {
  const day = dayHoldingStop(trip, stopId)
  if (!day) return refused('stop-missing')
  return {
    kind: 'ok',
    request: {
      kind: 'remove', dayIndex: day.index, dayIndexes: [day.index], label: 'Remove stop',
      // The same result as the shared removal: drop the stop, then close the numbering gap.
      mutate: draft => {
        const target = dayHoldingStop(draft, stopId)
        if (!target) return
        target.stops = target.stops.filter(s => s.id !== stopId)
        renumberDay(target)
      },
    },
  }
}

// ----------------------------------------------------------- fixed times

export interface FixedTouch {
  stopId: string
  title: string
  commitTitle: string
  commitTime: string
  from: string | null
  to: string | null
  /** moves: the clock changes. unlinked: the stop left the day. late: it now misses the time. */
  change: 'moves' | 'unlinked' | 'late'
}

export interface FixedGuard {
  /** Every stop a fixed commitment names. A map drag must not move these. */
  fixedStopIds: string[]
  touched: FixedTouch[]
  needsConfirm: boolean
}

/** Which fixed-time stops the change moves, unlinks or makes late. Compares real clocks. */
export function fixedGuardFor(
  base: Trip,
  proposed: Trip,
  dayIndexes: readonly number[],
  legCorrections?: LegCorrections,
): FixedGuard {
  const fixedStopIds = base.fixedCommitments.flatMap(fc => (fc.stopId != null ? [String(fc.stopId)] : []))
  const touched: FixedTouch[] = []
  for (const dayIndex of new Set(dayIndexes)) {
    const was = base.days.find(d => d.index === dayIndex)
    const now = proposed.days.find(d => d.index === dayIndex)
    if (!was || !now) continue
    const commitments = base.fixedCommitments.filter(fc => fc.dayIndex === dayIndex && fc.stopId != null)
    if (!commitments.length) continue
    const beforeRows = fixedRowsFor(simulateDay(was, base, originOf(base, dayIndex), dayIndex, legCorrections), commitments)
    const afterRows = fixedRowsFor(simulateDay(now, proposed, originOf(proposed, dayIndex), dayIndex, legCorrections), commitments)
    beforeRows.forEach((row, i) => {
      if (row.at == null) return
      const after = afterRows[i]
      const stop = stopById(base, String(row.fc.stopId))
      const common = { stopId: String(row.fc.stopId), title: stop?.title ?? '', commitTitle: row.fc.title, commitTime: row.fc.time, from: row.arrival, to: after.arrival }
      if (after.at == null) touched.push({ ...common, change: 'unlinked' })
      else if (after.tone === 'clash' && row.tone !== 'clash') touched.push({ ...common, change: 'late' })
      else if (after.arrival !== row.arrival) touched.push({ ...common, change: 'moves' })
    })
  }
  return { fixedStopIds, touched, needsConfirm: touched.length > 0 }
}

// -------------------------------------------------------------- proposal

export interface EditProposal {
  request: EditRequest
  proposedTrip: Trip
  impact: ImpactResult
  /** Stops whose arrival moved. A stop that stays put is left out. */
  clocks: PreviewClock[]
  dayIndexes: number[]
  warnings: { added: PreviewWarning[]; cleared: PreviewWarning[] }
  fixed: FixedGuard
}

function warningRef(w: ImpactResult['newWarnings'][number]): PreviewWarning {
  return { code: w.code, title: w.title, detail: w.detail, severe: w.severity === 'high', dayIndex: w.dayIndex ?? null }
}

function dayClocks(base: Trip, proposed: Trip, dayIndexes: readonly number[], corrections: LegCorrections): PreviewClock[] {
  const before = new Map<string, { at: string; day: number }>()
  for (const index of dayIndexes) {
    const day = base.days.find(d => d.index === index)
    if (!day) continue
    const sim = simulateDay(day, base, originOf(base, index), index, corrections)
    sim.activeStops.forEach((s, i) => before.set(s.id, { at: sim.arrivalTimes[i], day: index }))
  }
  const out: PreviewClock[] = []
  for (const index of dayIndexes) {
    const day = proposed.days.find(d => d.index === index)
    if (!day) continue
    const sim = simulateDay(day, proposed, originOf(proposed, index), index, corrections)
    sim.activeStops.forEach((s, i) => {
      const was = before.get(s.id)
      if (!was || was.at === sim.arrivalTimes[i]) return
      const a = validHM(was.at)
      const b = validHM(sim.arrivalTimes[i])
      // A stop that changed day has no honest minute difference.
      const deltaMin = was.day === index && a && b ? hmToMinutes(b) - hmToMinutes(a) : null
      out.push({ stopId: s.id, title: s.title, from: was.at, to: sim.arrivalTimes[i], deltaMin })
    })
  }
  return out
}

/** Measure one request on a copy of the trip. The input trip is never changed. */
export function proposeEdit(input: { trip: Trip; request: EditRequest; legCorrections?: LegCorrections }): EditProposal {
  const { trip, request, legCorrections } = input
  const proposedTrip = structuredClone(trip)
  request.mutate(proposedTrip)
  const impact = computeImpact(trip, proposedTrip, request.kind, request.dayIndex, legCorrections)
  return {
    request,
    proposedTrip,
    impact,
    clocks: dayClocks(trip, proposedTrip, request.dayIndexes, legCorrections),
    dayIndexes: request.dayIndexes,
    warnings: { added: impact.newWarnings.map(warningRef), cleared: impact.clearedWarnings.map(warningRef) },
    fixed: fixedGuardFor(trip, proposedTrip, request.dayIndexes, legCorrections),
  }
}
