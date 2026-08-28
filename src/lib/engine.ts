// ============ Scheduling & impact engine ============
// All outputs are transparent estimates. Nothing here claims live data.
import type { Trip, ItineraryStop, FixedCommitment } from '../data/types'
import { haversineKm } from './geo'

export interface EngineAssumptions {
  mode: string
  avgSpeedKmph: number
  bufferMinutesPerStop: number
  mealBreakMinutes: number
  dayStart: string
  dayEnd: string
  inrPerKm?: number
  /** user-stated fuel economy (km/L) — present only when it drives inrPerKm */
  kmPerLiter?: number
  /** indicative fuel price behind the economy-derived inrPerKm */
  fuelPricePerL?: number
}

const MODE_SPEED: Record<string, number> = {
  car: 42, motorcycle: 44, taxi: 38, bus: 34, train: 55, flight: 320, mixed: 45,
}
const MODE_COST_PER_KM: Record<string, number> = {
  car: 9, motorcycle: 4.5, taxi: 16, bus: 2.2, train: 1.6, flight: 6.5, mixed: 8,
}

/**
 * Indicative all-India petrol price (₹/litre) used when a trip states its fuel
 * economy. Deliberately surfaced (Budget tab, field hints, StopEditor) — never
 * presented as live data, per the transparency promise.
 */
export const FUEL_PRICE_INR_PER_L = 105

/** Modes where the vehicle's own fuel economy meaningfully sets the ₹/km rate. */
const FUEL_ECONOMY_MODES = new Set<string>(['car', 'motorcycle'])

/** True when the trip mode benefits from a user-stated fuel economy. */
export function isFuelEconomyMode(mode: string): boolean {
  return FUEL_ECONOMY_MODES.has(mode)
}

/**
 * Parse a fuel-economy form input into a sane km/L number, or undefined when
 * blank/implausible (cars do ~12–25 km/L, bikes ~25–45; anything outside
 * 2–80 is a typo, not a vehicle).
 */
export function parseFuelEconomyKmL(raw: string | number | undefined | null): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  return Number.isFinite(n) && n >= 2 && n <= 80 ? n : undefined
}

/** Soft plausibility bands (hard acceptance stays 2–80) — used to nudge, never to block. */
const PLAUSIBLE_KM_PER_L: Record<string, [number, number]> = { car: [8, 35], motorcycle: [12, 75] }

/** True when a stated economy is outside the typical band for the mode — a nudge, not a veto. */
export function isImplausibleFuelEconomy(mode: string, economy: number | undefined): boolean {
  const band = PLAUSIBLE_KM_PER_L[mode]
  return !!band && !!economy && economy > 0 && (economy < band[0] || economy > band[1])
}

/** Default planning assumptions shown to users wherever we estimate. */
export function getAssumptions(trip: Pick<Trip, 'transportMode' | 'fuelEconomyKmL'>): EngineAssumptions {
  const mode = trip.transportMode
  const base: EngineAssumptions = {
    mode,
    avgSpeedKmph: MODE_SPEED[mode] ?? 40,
    bufferMinutesPerStop: 15,
    mealBreakMinutes: 60,
    dayStart: '08:30',
    dayEnd: '20:00',
    inrPerKm: MODE_COST_PER_KM[mode],
  }
  // A stated fuel economy beats the blended ₹/km table for self-drive modes:
  // litres burned = distance ÷ economy, so ₹/km = price-per-litre ÷ economy.
  const economy = trip.fuelEconomyKmL
  if (economy && economy > 0 && FUEL_ECONOMY_MODES.has(mode)) {
    return {
      ...base,
      kmPerLiter: economy,
      fuelPricePerL: FUEL_PRICE_INR_PER_L,
      inrPerKm: Math.round((FUEL_PRICE_INR_PER_L / economy) * 100) / 100,
    }
  }
  return base
}

export function minutesToHM(mins: number): string {
  const m = Math.max(0, Math.round(mins))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function hmToMinutes(hm: string): number {
  if (!hm || !hm.includes(':')) return 0
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + (Number.isFinite(m) ? m : 0)
}

export function addMinutesToClock(startMin: number, mins: number): string {
  let t = startMin + Math.round(mins)
  t = ((t % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export interface LegEstimate {
  distanceKm: number
  durationMinutes: number
}

/** Canonical key for a leg between two points (used by the OSRM refinement layer). */
export function legKey(a: { lat: number; lng: number }, b: { lat: number; lng: number }): string {
  return `${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`
}

/** Distance/duration between two points using demo coordinates (haversine × road factor). */
export function legBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  assumptions: EngineAssumptions,
): LegEstimate {
  const straight = haversineKm(a.lat, a.lng, b.lat, b.lng)
  const roadFactor = 1.25 // roads rarely follow great circles
  const dist = straight * roadFactor
  const dur = (dist / assumptions.avgSpeedKmph) * 60 + 10 // +10 min city-traffic pad per leg
  return { distanceKm: dist, durationMinutes: dur }
}

// ---------------- Day schedule simulation ----------------

export interface ScheduledLeg {
  fromTitle: string
  toTitle: string
  distanceKm: number
  durationMinutes: number
}

export interface DaySchedule {
  dayIndex: number
  arrivalTimes: string[]     // per stop (active stops only)
  departures: string[]
  legs: ScheduledLeg[]
  totalTravelMinutes: number
  totalDistanceKm: number
  activeStops: ItineraryStop[]
  endsAt: string
}

/** Simulate one day's schedule: arrivals, departures, legs. Rejected stops are skipped. */
export function simulateDay(
  day: { stops: ItineraryStop[] },
  trip: Pick<Trip, 'transportMode' | 'startLocation'>,
  startOrigin: { lat: number; lng: number },
  dayIndex: number,
  /**
   * Optional per-leg corrections from real road data (OSRM). Keyed by
   * `legKey(from, to)`. When present for a leg, its distance/duration replace
   * the haversine estimate — the engine itself stays deterministic.
   */
  legCorrections?: Record<string, LegEstimate>,
): DaySchedule {
  const A = getAssumptions(trip)
  const active = [...day.stops].filter(s => s.status !== 'rejected').sort((x, y) => x.orderInDay - y.orderInDay)
  let t = hmToMinutes(A.dayStart)
  const arrivalTimes: string[] = []
  const departures: string[] = []
  const legs: ScheduledLeg[] = []
  let travelMin = 0
  let distKm = 0
  let prev = startOrigin

  for (const s of active) {
    // pure waypoint (auto start/end anchors): counts for distance but adds no dwell/buffer time
    const isWaypoint = s.auto === true || (s.category === 'travel' && s.visitMinutes === 0 && s.transportCostInrTotal === 0)
    const leg = (legCorrections && legCorrections[legKey(prev, s)]) ?? legBetween(prev, s, A)
    t += leg.durationMinutes
    arrivalTimes.push(addMinutesToClock(hmToMinutes(A.dayStart), t - hmToMinutes(A.dayStart)))
    travelMin += leg.durationMinutes
    distKm += leg.distanceKm
    legs.push({ fromTitle: prev === startOrigin ? `${trip.startLocation} (start)` : legsLabel(prev), toTitle: s.locationName || s.title, distanceKm: leg.distanceKm, durationMinutes: leg.durationMinutes })
    departures.push(addMinutesToClock(hmToMinutes(A.dayStart), t - hmToMinutes(A.dayStart) + s.visitMinutes + (isWaypoint ? 0 : A.bufferMinutesPerStop)))
    t += s.visitMinutes + (isWaypoint ? 0 : A.bufferMinutesPerStop)
    prev = s
  }
  return { dayIndex, arrivalTimes, departures, legs, totalTravelMinutes: travelMin, totalDistanceKm: distKm, activeStops: active, endsAt: addMinutesToClock(hmToMinutes(A.dayStart), t - hmToMinutes(A.dayStart)) }
}

function legsLabel(p: { lat: number; lng: number }): string {
  return `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}`
}

// ---------------- Leg-aware stop insertion ----------------

/** Where you'd be coming from / heading to when inserting a stop on a day. */
export interface LegAnchor {
  name: string
  point: { lat: number; lng: number }
}

/**
 * Current location before the insertion point of `dayIndex`: the last active
 * stop of that day, else the last stop of the nearest previous day, else the
 * trip's geocoded start anchor (point A).
 */
export function predecessorOf(trip: Trip, dayIndex: number): LegAnchor | null {
  const day = trip.days.find(d => d.index === dayIndex)
  if (day) {
    const active = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
    const last = active[active.length - 1]
    if (last) return { name: last.locationName || last.title, point: { lat: last.lat, lng: last.lng } }
  }
  for (let d = dayIndex - 1; d >= 0; d--) {
    const stops = trip.days.find(x => x.index === d)?.stops.filter(s => s.status !== 'rejected') ?? []
    if (stops.length) {
      const last = [...stops].sort((a, b) => a.orderInDay - b.orderInDay)[stops.length - 1]
      return { name: last.locationName || last.title, point: { lat: last.lat, lng: last.lng } }
    }
  }
  if (trip.startLocationCoords) {
    return { name: `${trip.startLocation} (start)`, point: { lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng } }
  }
  return null
}

/**
 * Next destination after the insertion point of `dayIndex`: the first stop of
 * the nearest later day, else the trip's final geocoded destination anchor.
 */
export function nextAfter(trip: Trip, dayIndex: number): LegAnchor | null {
  for (let d = dayIndex + 1; d < trip.days.length; d++) {
    const stops = trip.days.find(x => x.index === d)?.stops.filter(s => s.status !== 'rejected') ?? []
    if (stops.length) {
      const first = [...stops].sort((a, b) => a.orderInDay - b.orderInDay)[0]
      return { name: first.locationName || first.title, point: { lat: first.lat, lng: first.lng } }
    }
  }
  if (trip.destinationCoords?.length) {
    for (let i = trip.destinationCoords.length - 1; i >= 0; i--) {
      const c = trip.destinationCoords[i]
      const name = trip.destinations[i]
      if (c && name) return { name: `${name} (end)`, point: { lat: c.lat, lng: c.lng } }
    }
  }
  return null
}

export interface StopLegEstimate extends LegEstimate {
  /** fuel/fare cost for the leg at the trip mode's ₹/km rate */
  costInr: number
}

/** Distance/time/cost for the leg into a new stop (haversine estimate — OSRM refines in the UI). */
export function estimateLeg(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  trip: Pick<Trip, 'transportMode' | 'fuelEconomyKmL'>,
): StopLegEstimate {
  const A = getAssumptions(trip)
  const est = legBetween(from, to, A)
  return { ...est, costInr: est.distanceKm * (A.inrPerKm ?? 8) }
}

// ---------------- Warnings ----------------

export type Severity = 'high' | 'medium' | 'low'

export interface ScheduleWarning {
  code: string
  severity: Severity
  title: string
  detail: string
  fix: string            // recommended action
}

export interface HealthResult {
  score: number          // 0–100
  band: 'Comfortable' | 'Manageable' | 'Tight' | 'Unrealistic'
  warnings: ScheduleWarning[]
}

/**
 * All schedule issues for a trip. Used both for the health score and for
 * diffing current-vs-proposed plans in the Impact Preview.
 */
export function collectWarnings(trip: Trip): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = []
  const A = getAssumptions(trip)
  const dayCount = Math.max(1, trip.days.length)

  trip.days.forEach((day) => {
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
    const n = sim.activeStops.length

    // Excessive daily travel (>5h on the road)
    if (sim.totalTravelMinutes > 300) {
      warnings.push({ code: 'travel', severity: 'high', title: `Day ${day.index + 1}: heavy travel time`, detail: `About ${minutesToHM(sim.totalTravelMinutes)} of driving/transit across ${sim.totalDistanceKm.toFixed(0)} km.`, fix: 'Move one activity to another day or pick a closer alternative.' })
    } else if (sim.totalTravelMinutes > 210) {
      warnings.push({ code: 'travel', severity: 'medium', title: `Day ${day.index + 1}: long travel time`, detail: `Roughly ${minutesToHM(sim.totalTravelMinutes)} in transit.`, fix: 'Consider starting earlier or dropping an optional stop.' })
    }

    // Too many activities
    if (n > 6) {
      warnings.push({ code: 'density', severity: 'high', title: `Day ${day.index + 1} is over-packed`, detail: `${n} activities in one day leaves almost no slack.`, fix: 'Move one activity to another day.' })
    } else if (n > 5) {
      warnings.push({ code: 'density', severity: 'low', title: `Day ${day.index + 1} is busy`, detail: `${n} activities scheduled.`, fix: 'Keep buffer time in mind before adding more.' })
    }

    // Late finish
    const endMin = hmToMinutes(sim.endsAt)
    if (endMin > hmToMinutes('21:30')) {
      warnings.push({ code: 'late-arrival', severity: 'medium', title: `Day ${day.index + 1} ends very late`, detail: `Last activity wraps around ${sim.endsAt}.`, fix: 'Remove an optional stop or shorten visit durations.' })
    } else if (endMin > hmToMinutes(A.dayEnd)) {
      warnings.push({ code: 'late-arrival', severity: 'low', title: `Day ${day.index + 1} runs past plan`, detail: `Plan ends near ${sim.endsAt}.`, fix: 'Trim an optional stop to protect your evening.' })
    }

    // Opening-hours conflicts
    sim.activeStops.forEach((s, i) => {
      if (!s.openTime || !s.closeTime) return
      const arr = sim.arrivalTimes[i]
      if (hmToMinutes(arr) < hmToMinutes(s.openTime)) {
        warnings.push({ code: 'hours', severity: 'medium', title: `${s.title}: arrives before opening`, detail: `You reach ~${arr}, opens at ${s.openTime}.`, fix: 'Reorder stops so this comes later in the day.' })
      } else if (hmToMinutes(arr) + s.visitMinutes > hmToMinutes(s.closeTime)) {
        warnings.push({ code: 'hours', severity: 'medium', title: `${s.title}: closes too soon after arrival`, detail: `Arrival ~${arr}, but closes at ${s.closeTime} while you need ${minutesToHM(s.visitMinutes)}.`, fix: 'Visit this stop earlier or reduce time here.' })
      }
    })

    // Backtracking: any leg that doubles back within 25 km of a previous point chain
    const pts = sim.activeStops
    for (let i = 1; i < pts.length - 1; i++) {
      const back = legBetween(pts[i], pts[i - 1], A)
      const fwd = legBetween(pts[i], pts[i + 1], A)
      if (back.distanceKm < fwd.distanceKm * 0.55 && fwd.distanceKm > 18) {
        warnings.push({ code: 'backtrack', severity: 'low', title: `Day ${day.index + 1}: route backtracking`, detail: `The order of “${pts[i].title}” adds zig-zag distance.`, fix: 'Reorder stops along one direction.' })
        break
      }
    }

    // No meal window: if the day spans >6h with no food/rest stop
    const hasFoodOrRest = sim.activeStops.some(s => s.category === 'food' || s.category === 'rest')
    const span = endMin - hmToMinutes(A.dayStart)
    if (!hasFoodOrRest && span > 360) {
      warnings.push({ code: 'meals', severity: 'medium', title: `Day ${day.index + 1}: no meal/rest break`, detail: `A ${minutesToHM(span)} day without a planned food or rest stop.`, fix: 'Add a rest period or lunch stop.' })
    }

    // Weather-sensitive outdoor items
    const wCount = sim.activeStops.filter(s => s.weatherSensitive).length
    if (wCount >= 3) {
      warnings.push({ code: 'weather', severity: 'low', title: `Day ${day.index + 1} is weather-dependent`, detail: `${wCount} outdoor stops would all be affected by rain.`, fix: 'Identify an indoor backup for at least one stop.' })
    }
  })

  // Fixed-commitment conflicts: does anything run past a commitment time?
  for (const fc of trip.fixedCommitments) {
    const day = trip.days.find(d => d.index === fc.dayIndex)
    if (!day) continue
    const sim = simulateDay(day, trip, originOf(trip, fc.dayIndex), fc.dayIndex)
    const commitMin = hmToMinutes(fc.time)
    if (fc.type === 'hotel-checkin') continue // check-in is an anchor, not a race
    const lastDepIdx = sim.departures.length - 1
    if (lastDepIdx >= 0 && hmToMinutes(sim.arrivalTimes[lastDepIdx]) > commitMin) {
      warnings.push({ code: 'commitment', severity: 'high', title: `Conflicts with ${fc.title}`, detail: `Day ${fc.dayIndex + 1} plan reaches its last stop after the ${fc.time} commitment.`, fix: 'Cut an earlier stop so you arrive with buffer.' })
    } else if (lastDepIdx >= 0 && commitMin - hmToMinutes(sim.arrivalTimes[lastDepIdx]) < 45 && sim.activeStops.length > 0) {
      warnings.push({ code: 'buffer', severity: 'medium', title: `Thin buffer before ${fc.title}`, detail: `Less than ~45 min of slack before the ${fc.time} commitment.`, fix: 'Drop one optional stop to protect your connection.' })
    }
  }

  // Hotel/transport changes between days (each new hotel night counts as friction)
  const hotelNights = countHotelNights(trip)
  if (hotelNights >= dayCount && dayCount >= 3) {
    warnings.push({ code: 'hotels', severity: 'low', title: 'Frequent accommodation changes', detail: `About ${hotelNights} different overnight bases in ${dayCount} days means packing/unpacking daily.`, fix: 'Consider a 2-night stay in one base town.' })
  }

  return warnings
}

/** Public API: compute health from collected warnings. */
export function computeHealth(trip: Trip): HealthResult {
  return scoreWarnings(collectWarnings(trip))
}

export function scoreWarnings(warnings: ScheduleWarning[]): HealthResult {
  let score = 100
  for (const w of warnings) {
    score -= w.severity === 'high' ? 11 : w.severity === 'medium' ? 7 : 3
  }
  score = Math.max(5, Math.min(100, score))
  const band = score >= 85 ? 'Comfortable' : score >= 70 ? 'Manageable' : score >= 55 ? 'Tight' : 'Unrealistic'
  return { score, band, warnings }
}

export function countHotelNights(trip: Trip): number {
  const hotels = new Set<string>()
  trip.days.forEach(d => d.stops.forEach(s => { if (s.category === 'hotel') hotels.add(s.locationName) }))
  return hotels.size
}

export function originOf(trip: Trip, dayIndex: number): { lat: number; lng: number } {
  // Origin = last stop of previous day, else the first fixed point we know.
  for (let d = dayIndex - 1; d >= 0; d--) {
    const stops = trip.days[d]?.stops.filter(s => s.status !== 'rejected') ?? []
    if (stops.length) {
      const last = [...stops].sort((a, b) => a.orderInDay - b.orderInDay)[stops.length - 1]
      return { lat: last.lat, lng: last.lng }
    }
  }
  return firstFixedPoint(trip)
}

export function firstFixedPoint(trip: Trip): { lat: number; lng: number } {
  // A geocoded start (point A) is the trip's true origin when known.
  if (trip.startLocationCoords) return { lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng }
  for (const d of trip.days) {
    const first = [...d.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)[0]
    if (first) return { lat: first.lat, lng: first.lng }
  }
  return { lat: 9.9312, lng: 76.2673 } // Kochi fallback
}

// ---------------- Totals ----------------

export interface TripTotals {
  totalCostInr: number
  costPerPersonInr: number
  totalTravelMinutes: number
  totalDistanceKm: number
  stopCount: number
  costPerDayInr: number
  essentialInr: number
  optionalInr: number
  byCategory: Record<string, number>
}

export function computeTotals(trip: Trip, legCorrections?: Record<string, LegEstimate>): TripTotals {
  const A = getAssumptions(trip)
  let travelMinutes = 0, distanceKm = 0, stopCount = 0
  let transportKmCost = 0
  trip.days.forEach(day => {
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index, legCorrections)
    travelMinutes += sim.totalTravelMinutes
    distanceKm += sim.totalDistanceKm
    sim.activeStops.forEach(() => { stopCount++ })
    // per-leg fuel/fare cost derived from distance
    sim.legs.forEach(l => { transportKmCost += l.distanceKm * (A.inrPerKm ?? 8) })
  })

  let sum = 0, essential = 0, optional = 0
  const byCategory: Record<string, number> = {}
  for (const e of trip.expenses) {
    const amt = e.perPerson ? e.amountInr * trip.travellers : e.amountInr
    sum += amt
    byCategory[e.category] = (byCategory[e.category] ?? 0) + amt
    if (e.optional) optional += amt; else essential += amt
  }
  // entry fees from stops not already covered by explicit expenses
  let entryFromStops = 0
  trip.days.forEach(d => d.stops.forEach(s => {
    if (s.status !== 'rejected') entryFromStops += s.entryFeeInrPerPerson * trip.travellers
  }))
  sum += entryFromStops + transportKmCost
  byCategory['entry-fees'] = (byCategory['entry-fees'] ?? 0) + entryFromStops
  byCategory['transport'] = (byCategory['transport'] ?? 0) + transportKmCost
  essential += entryFromStops + transportKmCost

  const dayCount = Math.max(1, trip.days.length)
  return {
    totalCostInr: sum,
    costPerPersonInr: sum / trip.travellers,
    totalTravelMinutes: travelMinutes,
    totalDistanceKm: distanceKm,
    stopCount,
    costPerDayInr: sum / dayCount,
    essentialInr: essential,
    optionalInr: optional,
    byCategory,
  }
}

export function formatInr(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN')
}
