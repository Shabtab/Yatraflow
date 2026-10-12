// ============ Flights panel — the flight-mode travel card ============
// A flight trip used to be planned as one long leg at one blended speed, which
// is why its map drew road directions, its timeline showed driving time, and a
// 20 km run to the airport cost four minutes. This card is where the flight
// becomes DATA: which airports, which day, and — once the traveller says — the
// carrier, the real times and the real fare.
//
// Every number it shows without an entry is labelled as a model, and the two
// assumption sentences are printed next to the numbers they explain. That is
// the transparency promise: no estimate without its assumptions on screen.
import React, { useMemo, useState } from 'react'
import { PlaneTakeoff, Plus, Trash2, Pencil } from 'lucide-react'
import type { Trip, ItineraryDay, FlightLeg } from '../../../data/types'
import { updateTrip } from '../../../store/store'
import { uid } from '../../../data/seed'
import {
  flightForDay, resolveAirports, flightBlockMinutes, flightFareInrPerPerson,
  flightDistanceKm, AIRPORT_CHECKIN_MIN, originOf, nextAfter, minutesToHM,
} from '../../../lib/engine'
import { AIR_TIME_ASSUMPTION_TEXT, AIR_FARE_ASSUMPTION_TEXT, INDIAN_AIRPORTS, nearestAirport } from '../../../lib/air'
import { formatInr } from '../../../lib/engine'
import { useTimeFormat, formatHM } from '../../../lib/timefmt'
import { Select } from '../../../components/Select'
import { InlineIcon } from '../../../components/icons'

/** The airport options for a select, in the order a traveller scans them. */
const AIRPORT_OPTIONS = INDIAN_AIRPORTS
  .slice()
  .sort((a, b) => a.iata.localeCompare(b.iata))
  .map(a => ({ value: a.iata, label: `${a.iata} · ${a.name}, ${a.city}` }))

/** Where the day's flight runs from and to, before any traveller input. */
function defaultAirports(trip: Trip, dayIndex: number): { from: string; to: string } {
  const from = nearestAirport(originOf(trip, dayIndex))
  const to = nearestAirport(nextAfter(trip, dayIndex)?.point)
  return { from: from?.iata ?? '', to: to?.iata ?? '' }
}

/**
 * The flight card for one day. Renders nothing unless the trip flies — every
 * other mode keeps the ordinary travel panel and is unaffected.
 */
export function FlightsPanel({ trip, day, editable }: {
  trip: Trip
  day: ItineraryDay
  editable: boolean
}) {
  if (trip.transportMode !== 'flight') return null
  return <FlightDayCard trip={trip} day={day} editable={editable} />
}

function FlightDayCard({ trip, day, editable }: { trip: Trip; day: ItineraryDay; editable: boolean }) {
  const timeFormat = useTimeFormat()
  const [open, setOpen] = useState(false)
  const flight = flightForDay(trip, day.index)
  const airports = useMemo(() => {
    if (!flight) return null
    return resolveAirports(flight, originOf(trip, day.index), nextAfter(trip, day.index)?.point)
  }, [flight, trip, day.index])

  const addFlight = () => {
    const d = defaultAirports(trip, day.index)
    const next: FlightLeg = {
      id: uid('flt'), dayIndex: day.index,
      fromAirport: d.from, toAirport: d.to,
    }
    updateTrip(trip.id, { flights: [...(trip.flights ?? []), next] })
    setOpen(true)
  }

  const patch = (p: Partial<FlightLeg>) => {
    if (!flight) return
    const next = (trip.flights ?? []).map(f => (f.id === flight.id ? { ...f, ...p } : f))
    updateTrip(trip.id, { flights: next })
  }

  const remove = () => {
    if (!flight) return
    updateTrip(trip.id, { flights: (trip.flights ?? []).filter(f => f.id !== flight.id) })
    setOpen(false)
  }

  if (!flight) {
    return (
      <div className="flight-empty">
        <div className="small muted">
          <InlineIcon icon={PlaneTakeoff} size={12} gap={3} />
          No flight recorded for Day {day.index + 1} yet. Add one and the map, the timeline and the budget plan around it — home to the airport, the sector, then the airport to your stay.
        </div>
        {editable && (
          <button className="btn btn-outline btn-sm" onClick={addFlight}>
            <InlineIcon icon={Plus} size={13} gap={4} />Add this day's flight
          </button>
        )}
      </div>
    )
  }

  const statedTimes = !!(flight.departAt && flight.arriveAt)
  const statedFare = typeof flight.costInrPerPerson === 'number' && flight.costInrPerPerson > 0
  const from = airports?.from
  const to = airports?.to
  const km = from && to ? flightDistanceKm(from, to) : 0
  const blockMin = from && to ? flightBlockMinutes(flight, from, to) : 0
  const fare = from && to ? flightFareInrPerPerson(flight, from, to) : 0
  const routeLabel = from && to ? `${from.iata} → ${to.iata}` : 'Airports to confirm'
  const atAirportBy = flight.departAt ? hmMinus(flight.departAt, AIRPORT_CHECKIN_MIN) : ''

  return (
    <div className="flight-card">
      <div className="flight-card-head">
        <div className="flight-card-title">
          <InlineIcon icon={PlaneTakeoff} size={13} gap={4} />Flight · Day {day.index + 1}
        </div>
        <b className="flight-route">{routeLabel}</b>
        {editable && (
          <button className="btn btn-ghost btn-sm flight-edit" onClick={() => setOpen(o => !o)}>
            <InlineIcon icon={Pencil} size={13} gap={4} />{open ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      <div className="flight-card-body">
        <div className="tps-stat"><div className="tps-label">Sector</div><b>{km > 0 ? `${Math.round(km)} km` : '—'}</b></div>
        <div className="tps-stat">
          <div className="tps-label">Block time</div>
          <b>{blockMin ? minutesToHM(blockMin) : '—'}</b>
        </div>
        <div className="tps-stat">
          <div className="tps-label">Fare / person</div>
          <b>{fare ? formatInr(Math.round(fare)) : '—'}</b>
        </div>
        <div className="tps-stat">
          <div className="tps-label">At the airport by</div>
          <b>{atAirportBy ? formatHM(atAirportBy, timeFormat) : '—'}</b>
        </div>
      </div>

      {!statedTimes && <div className="flight-note">{AIR_TIME_ASSUMPTION_TEXT}</div>}
      {!statedFare && <div className="flight-note">{AIR_FARE_ASSUMPTION_TEXT}</div>}

      {open && editable && (
        <div className="flight-form">
          <label className="hp-field">
            <span className="tps-label">From</span>
            <Select compact value={flight.fromAirport} onChange={v => patch({ fromAirport: v })}
              options={AIRPORT_OPTIONS} aria-label="Departure airport" />
          </label>
          <label className="hp-field">
            <span className="tps-label">To</span>
            <Select compact value={flight.toAirport} onChange={v => patch({ toAirport: v })}
              options={AIRPORT_OPTIONS} aria-label="Arrival airport" />
          </label>
          <label className="hp-field">
            <span className="tps-label">Airline</span>
            <input className="input input--compact flight-w-airline" value={flight.airline ?? ''}
              onChange={e => patch({ airline: e.target.value })} placeholder="IndiGo" />
          </label>
          <label className="hp-field">
            <span className="tps-label">Flight no.</span>
            <input className="input input--compact flight-w-flight" value={flight.flightNumber ?? ''}
              onChange={e => patch({ flightNumber: e.target.value })} placeholder="6E 2144" />
          </label>
          <label className="hp-field">
            <span className="tps-label">Departs</span>
            <input type="time" className="input input--compact" value={flight.departAt ?? ''}
              onChange={e => patch({ departAt: e.target.value })} />
          </label>
          <label className="hp-field">
            <span className="tps-label">Arrives</span>
            <input type="time" className="input input--compact" value={flight.arriveAt ?? ''}
              onChange={e => patch({ arriveAt: e.target.value })} />
          </label>
          <label className="hp-field">
            <span className="tps-label">Fare ₹ / person</span>
            <input type="number" min={0} step={100} className="input input--compact flight-w-fare"
              value={flight.costInrPerPerson ?? ''} onChange={e => patch({ costInrPerPerson: numOrUndef(e.target.value) })}
              placeholder="as paid" />
          </label>
          <label className="hp-field">
            <span className="tps-label">Booking ref</span>
            <input className="input input--compact flight-w-ref" value={flight.bookingRef ?? ''}
              onChange={e => patch({ bookingRef: e.target.value })} placeholder="PNR" />
          </label>
          <button className="btn btn-ghost btn-sm" onClick={remove}><InlineIcon icon={Trash2} size={13} gap={4} />Remove</button>
        </div>
      )}
    </div>
  )
}

/** A number input's value as a finite positive number, or undefined. */
function numOrUndef(raw: string): number | undefined {
  const n = Number(raw)
  return raw.trim() && Number.isFinite(n) && n > 0 ? n : undefined
}

/** "HH:MM" minus `mins`, wrapped at midnight. */
function hmMinus(hm: string, mins: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim())
  if (!m) return hm
  const total = ((Number(m[1]) * 60 + Number(m[2]) - mins) % 1440 + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
