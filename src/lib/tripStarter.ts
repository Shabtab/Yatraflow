// ============ Trip Starter — CreateTrip "Trip Ticket" math ============
// Pure, node-testable math behind the create-trip page: the rough bill
// (printed on the ticket's paper receipt) and the rough timeline outline
// (seeded into the trip's days so the workspace opens with a starting plan).
// Same transparency contract as the Plan Bench: every line renders its own
// formula, nothing claims live data. Bench-local stay/meal rates are reused
// so the ticket's rough take and the bench's honest bill tell one story.

import { haversineKm } from './geo'
import { dayCountForRange } from './dayCount'
import { MODE_COST_PER_KM, isFuelEconomyMode, parseFuelEconomyKmL, parseFuelPricePerL } from './engine'
import { STAY_RATE_PER_NIGHT, MEALS_PER_HEAD_DAY } from './planBench'
import { defaultVehicleProfile, normalizeVehicleProfile } from './vehicleProfile'
import { sanitizeTankL } from './tripRow'
import { uid } from '../data/seed'
import type { ItineraryStop, LatLngPoint, TransportMode, StayStyle, VehicleProfile } from '../data/types'

/** Straight-line chains underestimate real roads — the bench-style detour factor. */
export const ROAD_FACTOR = 1.25

/** Suburban / unreserved ("local") train fares run a fraction of express
 *  ₹1.6/km — all-India suburban averages land near ₹0.45/km. */
export const LOCAL_TRAIN_COST_PER_KM = 0.45

export interface StarterTripInput {
  startDate: string
  endDate: string
  travellers: number
  mode: TransportMode
  /** Journey-ordered geocodeable points: [start, ...destinations incl. any custom return stops]. */
  orderedPoints: (LatLngPoint | null)[]
  /** Tail of `orderedPoints` (after the start) that belongs to the custom return leg. */
  returnCount: number
  roundTrip: boolean
  /** Raw form values — parsed with the engine's tolerant parsers. */
  kmPerL?: string | number | null
  inrPerL?: string | number | null
  /** Tank/battery capacity for the "≈ N km per tank" note — estimate-only in v1. */
  tankL?: number
  /** Rental car rate — estimate-only in v1 (persisted trips bill the blended ₹/km). */
  rentPerDay?: number
  /** Train mode only: bill suburban/unreserved fares instead of express ₹1.6/km. */
  localTrain?: boolean
  /** Budget preference — what the bed costs. The dial, not the legacy style:
   *  the bill and the settings page must never disagree about the bed. */
  stayStyle: StayStyle
}

export interface StarterBill {
  days: number
  nights: number
  roadKm: number | null
  transportCost: number | null
  transportFormula: string
  stayCost: number
  stayFormula: string
  mealCost: number
  mealFormula: string
  perHead: number | null
  rangeKm: number | null
}

const finitePos = (v: number | undefined | null): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0

/** Chain length over the finite points in `pts[from..to)` (haversine, km). 0 when under 2 points. */
function chainKm(pts: (LatLngPoint | null)[], from: number, to: number): number {
  let sum = 0
  let prev: LatLngPoint | null = null
  for (let i = from; i < to && i < pts.length; i++) {
    const p = pts[i]
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    if (prev) sum += haversineKm(prev.lat, prev.lng, p.lat, p.lng)
    prev = p
  }
  return sum
}

/** #377: the create form's stated vehicle details, as the profile Settings
 *  opens with. The form has no vehicle-type/fuel-type dial — those ride the
 *  transport mode's own default — while the tank and the mileage the user
 *  typed become the profile's capacity and economy, so Settings shows what
 *  was typed instead of the mode default ("set the tank → open Settings →
 *  gone"). Nothing stated → no profile: the mode default stays the live
 *  fallback, exactly today's behaviour. The tank bound is the persistence
 *  sanitizer's, so a value the row would refuse is never proposed here. */
export function vehicleProfileFor(input: { mode: TransportMode; tankL?: number; economyKmL?: number }): VehicleProfile | undefined {
  const base = defaultVehicleProfile(input.mode)
  const tank = sanitizeTankL(input.tankL)
  const eco = typeof input.economyKmL === 'number' && Number.isFinite(input.economyKmL)
    && input.economyKmL >= 1 && input.economyKmL <= 100
    ? input.economyKmL
    : undefined
  if (tank === null && eco === undefined) return undefined
  return normalizeVehicleProfile({
    ...base,
    capacity: tank ?? base.capacity,
    economy: eco ?? base.economy,
  })
}

/** The whole rough bill in one pure pass — every line carries its formula. */
export function estimateTripStarter(input: StarterTripInput): StarterBill {
  // The one day count (#376): local-midnight parse, 0 on bad dates — the same
  // value the store builds from, with the store's ≥1 guarantee at its own
  // boundary instead of here.
  const days = dayCountForRange(input.startDate, input.endDate)
  const nights = Math.max(0, days - 1)

  const crew = finitePos(input.travellers) ? Math.round(input.travellers) : 1
  const rooms = Math.ceil(crew / 2)
  const stayRate = STAY_RATE_PER_NIGHT[input.stayStyle]
  const stayCost = nights * rooms * stayRate
  const stayFormula = `${nights} night${nights === 1 ? '' : 's'} × ${rooms} room${rooms === 1 ? '' : 's'} × ₹${stayRate}`

  const mealCost = days * crew * MEALS_PER_HEAD_DAY
  const mealFormula = `${days} day${days === 1 ? '' : 's'} × ${crew} head${crew === 1 ? '' : 's'} × ₹${MEALS_PER_HEAD_DAY}`

  // Road km: outbound leg (doubled for a round trip with no custom return
  // stops) plus the explicit return leg when the user plotted one — a plotted
  // loop must not bill its roads twice.
  const n = input.orderedPoints.length
  const returnCount = Math.min(Math.max(0, Math.round(input.returnCount)), Math.max(0, n - 1))
  const outKm = chainKm(input.orderedPoints, 0, n - returnCount)
  const retKm = returnCount > 0 ? chainKm(input.orderedPoints, n - returnCount - 1, n) : 0
  const hasRoute = outKm > 0 || retKm > 0
  const roadKm = hasRoute
    ? Math.round((outKm * (returnCount === 0 && input.roundTrip ? 2 : 1) + retKm) * ROAD_FACTOR)
    : null

  let transportCost: number | null = null
  let transportFormula = ''
  if (roadKm != null) {
    const economy = parseFuelEconomyKmL(input.kmPerL)
    const price = parseFuelPricePerL(input.inrPerL)
    if (isFuelEconomyMode(input.mode) && economy && price) {
      const inrPerKm = Math.round((price / economy) * 100) / 100
      transportCost = Math.round(roadKm * inrPerKm)
      transportFormula = `${roadKm} km ÷ ${economy} km/L × ₹${price}/L`
    } else {
      const local = input.mode === 'train' && input.localTrain === true
      const rate = local ? LOCAL_TRAIN_COST_PER_KM : (MODE_COST_PER_KM[input.mode] ?? MODE_COST_PER_KM.car)
      transportCost = Math.round(roadKm * rate)
      transportFormula = local ? `${roadKm} km × ₹${rate}/km (local train)` : `${roadKm} km × ₹${rate}/km`
    }
    if (input.mode === 'rental' && finitePos(input.rentPerDay)) {
      const rent = Math.round(input.rentPerDay) * days
      transportCost = (transportCost ?? 0) + rent
      transportFormula += ` + ₹${Math.round(input.rentPerDay)} × ${days}d rent`
    }
  }

  const total = transportCost != null ? transportCost + stayCost + mealCost : null
  const perHead = total != null ? Math.round(total / crew) : null

  // "≈ N km per tank": tank × economy, only when both are sane.
  const tankL = input.tankL
  const tankOk = finitePos(tankL) && tankL <= 300
  const economyForRange = parseFuelEconomyKmL(input.kmPerL)
  const rangeKm = tankOk && economyForRange ? Math.round(tankL! * economyForRange) : null

  return {
    days, nights, roadKm, transportCost, transportFormula,
    stayCost, stayFormula, mealCost, mealFormula, perHead, rangeKm,
  }
}

// ---------------- Rough outline seeding ----------------

export interface OutlineDest {
  name: string
  lat?: number
  lng?: number
}

/**
 * Seed the trip's days with the journey's destinations so the workspace opens
 * with a starting outline instead of empty days. Outbound stops spread over
 * the first ~60% of the day range when a custom return leg follows (else the
 * whole range); return stops fill the remainder in journey order. Stops the
 * user typed without picking a real place are skipped (no coordinates to
 * anchor) — they still live on trip.destinations for the map to geocode later.
 * Returns undefined when there is nothing to seed; the store then keeps its
 * plain anchor behaviour.
 */
export function buildOutlineSeedStops(opts: {
  dests: OutlineDest[]
  /** How many of the trailing `dests` belong to the custom return leg. */
  returnCount: number
  dayCount: number
}): ItineraryStop[][] | undefined {
  const dayCount = Math.max(0, Math.round(opts.dayCount))
  if (dayCount < 1) return undefined
  const geocoded = opts.dests.filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lng))
  if (geocoded.length === 0) return undefined

  // Split by the caller's tail count FIRST, then drop the store-anchored
  // final destination from seeding (createTrip auto-anchors trip.destinations'
  // last geocoded entry on the last day — seeding it too would pin it twice).
  const returnCount = Math.min(Math.max(0, Math.round(opts.returnCount)), geocoded.length)
  const out = geocoded.slice(0, geocoded.length - returnCount)
  const ret = geocoded.slice(geocoded.length - returnCount)
  if (ret.length > 0) ret.pop(); else out.pop()
  if (out.length + ret.length === 0) return undefined
  const lastDay = dayCount - 1
  // With a custom return leg, outbound stops stay inside the first 60% of days.
  const outSpan = returnCount > 0 ? Math.round(lastDay * 0.6) : lastDay

  const days: ItineraryStop[][] = Array.from({ length: dayCount }, () => [])
  const mkStop = (d: OutlineDest): ItineraryStop => ({
    id: uid('st'), title: d.name, category: 'sightseeing', locationName: d.name,
    lat: d.lat!, lng: d.lng!, visitMinutes: 90,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'must-do', status: 'confirmed', orderInDay: 1,
  })

  out.forEach((d, i) => {
    const frac = (i + 1) / (out.length + 1)
    const day = Math.min(outSpan, Math.max(0, Math.round(frac * outSpan)))
    days[day].push(mkStop(d))
  })
  ret.forEach((d, j) => {
    const span = lastDay - outSpan
    const frac = (j + 1) / (ret.length + 1)
    const day = outSpan + Math.min(span, Math.max(0, Math.round(frac * span)))
    days[Math.min(lastDay, day)].push(mkStop(d))
  })
  return days
}
