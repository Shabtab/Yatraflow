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
import { buildJourney, computeTotals, hmToMinutes, getAssumptions, type LegEstimate } from './engine'

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
  kind?: 'air' | 'road'
  estimated?: boolean
  flightNumber?: string
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
    const journey = buildJourney(trip, day, opts.legCorrections)
    const rows: PrintDay['rows'] = []
    journey.points.forEach(p => {
      const leg = p.legIn
      if (leg && (leg.distanceKm > 0 || leg.durationMinutes > 0)) {
        const flight = trip.flights?.find(f => f.id === leg.flightId)
        rows.push({ kind: 'leg', leg: {
          ...leg, distanceKm: fin(leg.distanceKm), durationMinutes: fin(leg.durationMinutes),
          estimated: leg.kind === 'air' && !(flight?.departAt && flight?.arriveAt),
          flightNumber: flight?.flightNumber,
        } })
      }
      if (p.synthesized && p.kind !== 'waypoint') return
      const s = p.stop
      rows.push({ kind: 'stop', stop: {
        title: s.title, category: s.category, status: p.synthesized ? 'suggested' : s.status,
        arrive: p.arrive, depart: p.depart,
        visitMinutes: fin(s.visitMinutes), entryFeeInrPerPerson: fin(s.entryFeeInrPerPerson), notes: p.synthesized ? undefined : s.notes,
      } })
    })

    // The day's bucket is found by INDEX, like the Timeline's chip (#338): a
    // positional clamp printed another day's cost on a skipped-index day.
    const dayTot = totals.byDay.find(b => b.dayIndex === day.index)
    const { startTitle, endTitle } = journey
    return {
      index: day.index,
      title: day.title,
      date: fmtDate(trip.startDate, day.index),
      routeLine: journey.distanceKm < 0.5 && rows.length === 0
        ? `Based in ${startTitle}`
        : `${startTitle} → ${endTitle}`,
      startTime: journey.startTime,
      endsAt: journey.points[journey.points.length - 1]?.depart ?? journey.startTime,
      rows,
      totalDistanceKm: fin(journey.distanceKm),
      totalTravelMinutes: fin(journey.driveMinutes),
      dwellMinutes: fin(journey.dwellMinutes),
      costInr: fin(dayTot?.totalInr),
      // strip the "Day n:"/"Day n " prefix collectWarnings adds — the card
      // heading already says which day it is.
      warnings: (opts.warningsByDay?.[day.index] ?? []).map(w => w.replace(/^Day \d+[:\s]\s*/, '')),
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
    assumptionsLine: trip.transportMode === 'flight' ? `Per-person flight fares + ground transfers · ${A.dayStart}–${A.dayEnd} planning window` : `~₹${Math.round(A.inrPerKm ?? 8)}/km · ${A.avgSpeedKmph} km/h avg · ${hmToMinutes(A.dayEnd) - hmToMinutes(A.dayStart) >= 0 ? '' : ''}${A.dayStart}–${A.dayEnd} planning window`.replace('  ', ' '),
    printedAt: (opts.now ?? new Date()).toISOString(),
  }
}
