// ============ Printable day-cards model ============
// Pure layout data for the offline print/PDF export (Share tab → "Print day
// cards"). No React, no DOM — node-testable like the rest of the engine.
// The model mirrors what a traveller needs on the road with no signal: per
// day, the ordered schedule (drive legs + stops with arrival clocks, visit
// durations, entry fees, notes), the day's km/time/cost totals, and a trip
// header with the budget summary. Times respect the 12h/24h clock preference
// by formatting at render time via timefmt, EXCEPT the sort/clock math here
// which stays on plain "HH:MM" minutes.

import type { Trip, ItineraryStop } from '../data/types'
import { simulateDay, originOf, computeTotals, hmToMinutes, getAssumptions, type LegEstimate, type DaySchedule } from './engine'

export interface PrintStop {
  title: string
  category: string
  status: ItineraryStop['status']
  /** "HH:MM" arrival, engine-computed */
  arrive?: string
  /** "HH:MM" departure (arrival + visit minutes) */
  depart?: string
  visitMinutes?: number
  entryFeeInrPerPerson?: number
  notes?: string
}

export interface PrintLeg {
  fromTitle: string
  toTitle: string
  distanceKm: number
  durationMinutes: number
}

export interface PrintDay {
  index: number
  title?: string
  date?: string
  /** first line of the day card: "X → Y" or "Based in X" */
  routeLine: string
  startTime: string
  endsAt: string
  /** ordered schedule rows: stops interleaved with the drive legs between them */
  rows: Array<{ kind: 'stop'; stop: PrintStop } | { kind: 'leg'; leg: PrintLeg }>
  totalDistanceKm: number
  totalTravelMinutes: number
  dwellMinutes: number
  costInr: number
  warnings: string[]
}

export interface PrintModel {
  tripName: string
  metaLine: string
  travellers: number
  days: PrintDay[]
  totals: { distanceKm: number; travelMinutes: number; costInr: number; stops: number }
  /** trip-level expense ledger (rooms/rentals have no day attribution) */
  expenses: Array<{ label: string; category: string; amountInr: number; perPerson: boolean; dayIndex?: number }>
  assumptionsLine: string
  printedAt: string
}

/** Finiteness guard shared by every numeric field — hydrated jsonb rows can
 *  carry undefined/null, and one NaN would poison a day's totals. */
function fin(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function fmtDate(iso: string, dayIndex: number): string | undefined {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return undefined
  d.setDate(d.getDate() + dayIndex)
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Build the printable model. `warningsByDay` mirrors collectWarnings output
 *  (titles only, per day index) so the printed card carries the same health
 *  flags the timeline shows. */
export function buildPrintModel(
  trip: Trip,
  opts: { legCorrections?: Record<string, LegEstimate>; warningsByDay?: Record<number, string[]>; now?: Date } = {},
): PrintModel {
  const A = getAssumptions(trip)
  const totals = computeTotals(trip, opts.legCorrections)

  const days: PrintDay[] = trip.days.map(day => {
    const sim: DaySchedule = simulateDay(day, trip, originOf(trip, day.index), day.index, opts.legCorrections)
    const byOrder = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
    // Pair each active stop with its engine arrival/departure clock. sim's
    // rows are in schedule order and exclude synthesized START anchors, so
    // index-matching against order-sorted stops holds for the common case;
    // a stop the simulator skipped (rejected handled above) just misses its
    // clocks rather than throwing the whole export.
    const byId = new Map<string, { arrive?: string; depart?: string }>()
    sim.activeStops.forEach((s, i) => {
      byId.set(s.id, { arrive: sim.arrivalTimes[i], depart: sim.departures[i] })
    })

    const rows: PrintDay['rows'] = []
    byOrder.forEach((s, i) => {
      const clocks = byId.get(s.id)
      // the leg that brought you to this stop, when the simulator knows it
      if (i > 0) {
        const leg = sim.legs[sim.activeStops.findIndex(x => x.id === s.id)]
        if (leg && leg.distanceKm > 0) rows.push({ kind: 'leg', leg: { fromTitle: leg.fromTitle, toTitle: leg.toTitle, distanceKm: fin(leg.distanceKm), durationMinutes: fin(leg.durationMinutes) } })
      }
      rows.push({
        kind: 'stop',
        stop: {
          title: s.title, category: s.category, status: s.status,
          arrive: clocks?.arrive, depart: clocks?.depart,
          visitMinutes: fin(s.visitMinutes),
          entryFeeInrPerPerson: fin(s.entryFeeInrPerPerson),
          notes: s.notes,
        },
      })
    })

    // Base → first stop (and last stop → destination when the journey adds an
    // anchor) are real legs the traveller drives; surface them when present.
    const firstLeg = sim.legs[0]
    if (firstLeg && firstLeg.distanceKm > 0 && rows.length > 0 && rows[0].kind === 'stop') {
      rows.unshift({ kind: 'leg', leg: { fromTitle: firstLeg.fromTitle, toTitle: firstLeg.toTitle, distanceKm: fin(firstLeg.distanceKm), durationMinutes: fin(firstLeg.durationMinutes) } })
    }
    const lastLeg = sim.legs[sim.legs.length - 1]
    if (lastLeg && lastLeg.distanceKm > 0 && sim.legs.length > 1) {
      rows.push({ kind: 'leg', leg: { fromTitle: lastLeg.fromTitle, toTitle: lastLeg.toTitle, distanceKm: fin(lastLeg.distanceKm), durationMinutes: fin(lastLeg.durationMinutes) } })
    }

    const dayTot = totals.byDay[Math.min(day.index, totals.byDay.length - 1)]
    const startTitle = sim.legs[0]?.fromTitle ?? trip.startLocation
    const endTitle = sim.legs.length > 1 ? lastLeg?.toTitle : startTitle
    return {
      index: day.index,
      title: day.title,
      date: fmtDate(trip.startDate, day.index),
      routeLine: sim.totalDistanceKm < 0.5 && sim.activeStops.length === 0
        ? `Based in ${startTitle}`
        : `${startTitle} → ${endTitle}`,
      startTime: sim.startsAt,
      endsAt: sim.endsAt,
      rows,
      totalDistanceKm: fin(sim.totalDistanceKm),
      totalTravelMinutes: fin(sim.totalTravelMinutes),
      dwellMinutes: fin(sim.dwellMinutes),
      costInr: fin(dayTot?.totalInr),
      // strip the "Day n:" prefix collectWarnings adds — the card heading
      // already says which day it is.
      warnings: (opts.warningsByDay?.[day.index] ?? []).map(w => w.replace(/^Day \d+:\s*/, '')),
    }
  })

  return {
    tripName: trip.name,
    metaLine: [
      trip.destinations.length > 0 ? trip.destinations.join(' → ') : trip.startLocation,
      `${trip.days.length} days · ${trip.travellers} traveller${trip.travellers !== 1 ? 's' : ''}`,
      trip.transportMode,
    ].join(' · '),
    travellers: trip.travellers,
    days,
    totals: {
      distanceKm: fin(totals.totalDistanceKm),
      travelMinutes: fin(totals.totalTravelMinutes),
      costInr: fin(totals.totalCostInr),
      stops: fin(totals.stopCount),
    },
    expenses: trip.expenses.map(e => ({
      label: e.label, category: e.category,
      amountInr: fin(e.amountInr), perPerson: e.perPerson === true, dayIndex: e.dayIndex,
    })),
    assumptionsLine: `~₹${Math.round(A.inrPerKm ?? 8)}/km · ${A.avgSpeedKmph} km/h avg · ${hmToMinutes(A.dayEnd) - hmToMinutes(A.dayStart) >= 0 ? '' : ''}${A.dayStart}–${A.dayEnd} planning window`.replace('  ', ' '),
    printedAt: (opts.now ?? new Date()).toISOString(),
  }
}
