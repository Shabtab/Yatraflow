// ============ The Timeline's per-day card facts (#347) ============
// Every day card is a memoized component, and that memo could never bite: `trip`
// is a fresh object on every store commit (`mutateTrip` clones) and its identity
// was a prop, so one stop edit re-rendered EVERY day — and each day re-derived
// its own journey, schedule and anchors from the whole trip while it was at it.
//
// So the trip-wide slice a day card actually reads is resolved ONCE per trip
// change here, and a day is handed back the SAME object while none of its inputs
// changed (the React.memo on DaySection then bails out, and the engine math is
// not re-run either). `dayCardKey` is the input list — the same reads
// `buildJourney`/`simulateDay`/`originOf`/`nextAfter`/`predecessorOf` make — and
// tests pin it in both directions: changing any of those inputs busts the day,
// and changing something else does not. When you teach a day card to read a new
// trip field, it goes in `dayCardKey` in the same commit, or the card renders
// one edit behind.
import {
  buildJourney, coLocates, computeTotals, getAssumptions, isRoundTrip, nextAfter, originOf, predecessorOf, simulateDay,
  type DaySchedule, type EngineAssumptions, type Journey, type LegAnchor, type LegEstimate,
  type ScheduleWarning,
} from './engine'
import type { FixedCommitment, Trip } from '../data/types'

/** computeTotals().byDay's element — this day's money slice (also its chip). */
export type DayTotals = NonNullable<ReturnType<typeof computeTotals>['byDay']>[number]

/** Everything a day card reads from the trip around it, resolved once. */
export interface DayCardFacts {
  /** the cache key these facts were built from — a hit is decided on this */
  key: string
  /** trip start date (ISO) — the weather chip's forecast date rides on it */
  startDate: string
  /** where the day wakes up (the engine's originOf) */
  origin: { lat: number; lng: number }
  /** latest active stop before this day — the nearby-search anchor fallback */
  prevPoint: { lat: number; lng: number } | null
  /** the trip's geocoded start, when known (nearby-search home center) */
  homeCenter: { lat: number; lng: number } | null
  /** the next planned anchor ahead of this day ("Continue to X") */
  nextAnchor: LegAnchor | null
  /** true when the day's origin already IS that anchor — the chip then says nothing */
  alreadyAtNext: boolean
  /** false on the trip's last day (the Copy-to-next-day button) */
  hasNextDay: boolean
  /** the day's journey (start → visits → destination) */
  journey: Journey
  /** the day's schedule — arrivals, departures, dwell, endsAt */
  sim: DaySchedule
  /** engine assumptions for this trip (window, per-stop buffer, speeds) */
  assumptions: EngineAssumptions
  /** this day's fixed commitments */
  commitments: FixedCommitment[]
}

export interface DayCards {
  tripId: string
  /** the corrections these facts were measured from — a new map rebuilds all */
  legCorrections: Record<string, LegEstimate> | undefined
  byDay: Map<number, DayCardFacts>
}

/**
 * Resolve every day's facts, reusing the previous object for any day whose
 * inputs are unchanged (and skipping its engine math). Pass the previous result
 * in: that is what makes the reuse — and therefore the memo — possible.
 */
export function buildDayCards(
  trip: Trip,
  days: Trip['days'][number][],
  legCorrections?: Record<string, LegEstimate>,
  prev?: DayCards | null,
): DayCards {
  // A different trip, or newly measured legs, invalidates everything: the
  // corrections are looked up by legKey rather than read as a field, so their
  // identity is what tells these facts whether the road moved under them.
  const reusable = prev && prev.tripId === trip.id && prev.legCorrections === legCorrections ? prev.byDay : null
  const byDay = new Map<number, DayCardFacts>()
  for (const day of days) {
    const origin = originOf(trip, day.index)
    const prevPoint = predecessorOf(trip, day.index)?.point ?? null
    const nextAnchor = nextAfter(trip, day.index)
    const key = dayCardKey(trip, day, origin, prevPoint, nextAnchor)
    const hit = reusable?.get(day.index)
    if (hit && hit.key === key) {
      byDay.set(day.index, hit)
      continue
    }
    // The journey's own origin IS originOf — passing it explicitly keeps the
    // walk to one per day instead of one more inside buildJourney.
    const journey = buildJourney(trip, day, legCorrections, origin)
    const sim = simulateDay(day, trip, origin, day.index, legCorrections)
    const sc = trip.startLocationCoords
    byDay.set(day.index, {
      key,
      startDate: trip.startDate,
      origin,
      prevPoint,
      homeCenter: sc ? { lat: sc.lat, lng: sc.lng } : null,
      nextAnchor,
      alreadyAtNext: !!nextAnchor && coLocates(origin, nextAnchor.point),
      hasNextDay: day.index + 1 < trip.days.length,
      journey,
      sim,
      assumptions: getAssumptions(trip),
      commitments: trip.fixedCommitments.filter(fc => fc.dayIndex === day.index),
    })
  }
  return { tripId: trip.id, legCorrections, byDay }
}

/** The active (non-rejected) stops of a day, in order — what the engine walks. */
function activeStops(day: Trip['days'][number]) {
  return [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
}

const NO = '-'
function num(v: number | undefined | null): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : NO
}

/**
 * The exact inputs `buildDayCards` derives a day's facts from. EXACT string
 * forms (no rounding): a coordinate that moved by any amount is a different
 * key, so a reused fact can never hide a moved stop.
 */
export function dayCardKey(
  trip: Pick<Trip, 'id' | 'days' | 'startDate' | 'startLocation' | 'startLocationCoords' | 'destinationCoords' |
    'transportMode' | 'travelStyle' | 'fuelEconomyKmL' | 'fuelPricePerL' | 'roundTrip' | 'fixedCommitments'>,
  day: Trip['days'][number],
  origin: { lat: number; lng: number },
  prevPoint: { lat: number; lng: number } | null,
  nextAnchor: LegAnchor | null,
): string {
  const stops = activeStops(day)
    .map(s => `${s.id},${s.lat},${s.lng},${s.orderInDay},${s.status},${s.auto ? 1 : 0},${num(s.visitMinutes)},${s.category},${num(s.transportCostInrTotal)}`)
    .join(';')
  const commitments = trip.fixedCommitments
    .filter(fc => fc.dayIndex === day.index)
    .map(fc => `${fc.id},${fc.title},${fc.time},${fc.type},${fc.notes ?? NO}`)
    .join(';')
  const sc = trip.startLocationCoords
  const dest = trip.destinationCoords ?? []
  const lastDest = dest.length ? dest[dest.length - 1] : undefined
  // Day-index shape facts the engine reads indirectly: how many days exist,
  // which is the last one, whether this is a round trip, and whether ANY
  // earlier day holds a stop (buildJourney's outbound-was-planned-earlier).
  // The emptiness vector, not the stop counts: adding a second stop to day 1
  // must not rebuild day 5.
  let lastDayIndex = 0
  for (const d of trip.days) lastDayIndex = Math.max(lastDayIndex, d.index)
  const emptyShape = [...trip.days]
    .sort((a, b) => a.index - b.index)
    .map(d => (d.stops.some(s => s.status !== 'rejected') ? 1 : 0))
    .join('')
  return [
    trip.id,
    `day ${day.index}|${day.startTime ?? NO}`,
    `origin ${origin.lat},${origin.lng}`,
    `prev ${prevPoint ? `${prevPoint.lat},${prevPoint.lng}` : NO}`,
    `next ${nextAnchor ? `${nextAnchor.name}|${nextAnchor.point.lat},${nextAnchor.point.lng}` : NO}`,
    `stops ${stops}`,
    `shape ${trip.days.length}|${lastDayIndex}|${isRoundTrip(trip) ? 'rt' : 'ow'}|${emptyShape}`,
    `labels ${trip.startLocation}`,
    `home ${sc ? `${sc.lat},${sc.lng}` : NO}`,
    `dest ${lastDest ? `${lastDest.lat},${lastDest.lng}` : NO}`,
    `mode ${trip.transportMode}|${num(trip.fuelEconomyKmL)}|${num(trip.fuelPricePerL)}|${trip.travelStyle ?? NO}`,
    `start ${trip.startDate}`,
    `fc ${commitments}`,
  ].join('~')
}

/**
 * Same day, content-wise. The store hands every row it merges (and every echo it
 * applies) fresh day objects with identical content — identity is new, the plan
 * is not — and a shallow memo treats that as a change, which is how one edit
 * still re-rendered every card after the facts pass.
 *
 * Compared EXHAUSTIVELY (`JSON.stringify`) rather than field by field, on
 * purpose: a hand-written field list is a stale render the day someone adds a
 * field to `ItineraryDay` and forgets this function. Key order differences can
 * only make it compare UNEQUAL — the safe direction (one extra render, never a
 * stale one).
 */
export function sameDayContent(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false // unstringifiable shape (a cycle): fall back to "changed"
  }
}

/**
 * The memo comparator for a day card: every prop by identity, `day` by content.
 * Exhaustive by construction — any prop that appears on either side must be
 * identical, so a new prop added later is compared automatically (a hand-written
 * key list would silently skip it, in whatever direction the new prop wanted).
 */
export function sameDaySectionProps<T extends { day: unknown }>(a: T, b: T): boolean {
  if (a === b) return true
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (k === 'day') continue
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false
  }
  return sameDayContent(a.day, b.day)
}

/** Two day-money slices are the same numbers — the chip may keep its identity. */
function sameDayTotals(a: DayTotals, b: DayTotals): boolean {
  return a.dayIndex === b.dayIndex && a.expensesInr === b.expensesInr && a.transportInr === b.transportInr &&
    a.totalInr === b.totalInr && a.stops === b.stops && a.distanceKm === b.distanceKm
}

/**
 * `computeTotals().byDay` mints a fresh object per day on every trip change, so
 * a day's cost chip was a new prop for all days — enough on its own to defeat
 * the memo. Keep the previous object per day while its numbers are unchanged.
 */
export function reuseDayTotals(
  prev: Map<number, DayTotals> | null,
  byDay: DayTotals[],
): Map<number, DayTotals> {
  const map = new Map<number, DayTotals>()
  for (const t of byDay) {
    const p = prev?.get(t.dayIndex)
    map.set(t.dayIndex, p && sameDayTotals(p, t) ? p : t)
  }
  return map
}

/** Identical warnings, in the same order — the pill's tooltip, its severity
 *  class and its `+N more` count all read content, so equal content keeps the ref. */
function sameWarnings(a: ScheduleWarning[], b: ScheduleWarning[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.code !== y.code || x.title !== y.title || x.detail !== y.detail || x.fix !== y.fix ||
        x.severity !== y.severity || x.dayIndex !== y.dayIndex) return false
  }
  return true
}

/**
 * The warning groups a day renders, with their previous array kept whenever the
 * content repeats — `groupWarnings` rebuilds every warned day's array on every
 * trip change (`NO_WARNINGS` only ever saved the unwarned ones).
 */
export function reuseWarningGroups(
  prev: Map<number, ScheduleWarning[]> | null,
  byDay: Map<number, ScheduleWarning[]> | null | undefined,
): Map<number, ScheduleWarning[]> {
  const map = new Map<number, ScheduleWarning[]>()
  if (!byDay) return map
  for (const [idx, list] of byDay) {
    const p = prev?.get(idx)
    map.set(idx, p && sameWarnings(p, list) ? p : list)
  }
  return map
}
