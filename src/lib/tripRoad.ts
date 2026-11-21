// ============ The trip's road measurement: one chain, one retry (#188) ============
// Every trip surface needs the SAME road chain. The workspace's leg corrections
// (budget, fatigue, warnings — every tab) and the Map tab's line, totals and
// suggestion corridor all describe one drive. Measuring it per surface doubled
// the load on the shared, rate-limited OSRM demo server (the very thing that
// caused #185's transient failures) and let the map draw a road the detour math
// could not see ("blue line present + 0 km off-route", #184).
//
// So the workspace owns exactly ONE measurement — `buildRoadChain` once, one
// `routePath` chain, one retry — and every surface derives from it:
//   · correctionsFromLegs   → the engine's leg corrections
//   · mapRoadViewFromLegs   → the Map tab's geometry / totals / per-day road km
//
// The chain is a SUPERSET of the Map tab's points (start + every stop, then the
// optional return-to-start and trailing destination), so the Map tab's legs are
// a strict prefix — `outboundCount` marks the split. Nothing here is React or
// I/O beyond the injected measure; it is all pure and node-testable.
import { isRoundTrip, legKey, type EngineAssumptions, type LegEstimate } from './engine'
import { routePath, type RoadLeg } from './routing'
import type { Trip } from '../data/types'

export interface RoadChainPoint { lat: number; lng: number }
export type RoadPointKind = 'start' | 'stop' | 'return' | 'destination'

export interface RoadChain {
  /** start → stops, plus the round-trip return-to-start and any trailing destination */
  points: RoadChainPoint[]
  /** Parallel to `points`: the day each point's ARRIVAL leg belongs to (null for the start) */
  ptDay: (number | null)[]
  ptKind?: RoadPointKind[]
  ptStopId?: (string | null)[]
  /** Points in the outbound section (start → stops) — the Map tab's own view */
  outboundCount: number
  /** true when the chain ends with a one-way DESTINATION leg after the outbound
   *  legs — the map's drawn geometry includes it (#polylines), while
   *  totalKm/totalMin/dayRoadKm stay outbound-only. A round trip never has a
   *  tail (#1006): its destination sits INSIDE the outbound legs, before the
   *  ride home, so the ride home is always the last leg. */
  hasDestTail: boolean
}

/**
 * Build the one road chain for a trip. Points are the trip's start, every
 * non-rejected stop in day/order sequence, and the last destination when it is
 * not already the last stop. A round trip then ends with the return to the
 * start; a one-way trip keeps the destination as a trailing tail.
 *
 * `outboundCount` is the boundary the Map tab consumes: legs before it belong to
 * start → stops (→ destination, on a round trip) — the journey the fatigue math
 * and the suggestion corridor describe, which is also what the engine's day
 * journeys count. Legs after it are the drive home or a one-way destination
 * tail: the engine corrections need them, but the map's outbound view must not
 * double-count them.
 */
export function buildRoadChain(trip: Pick<Trip, 'startLocationCoords' | 'days' | 'destinationCoords' | 'roundTrip' | 'transportMode'>): RoadChain & { ptKind: RoadPointKind[]; ptStopId: (string | null)[] } {
  const points: RoadChainPoint[] = []
  const ptDay: (number | null)[] = []
  const ptKind: RoadPointKind[] = []
  const ptStopId: (string | null)[] = []
  if (trip.startLocationCoords) {
    points.push({ lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng })
    ptDay.push(null)
    ptKind.push('start'); ptStopId.push(null)
  }
  ;[...trip.days]
    .sort((a, b) => a.index - b.index)
    .forEach(d => [...d.stops]
      .filter(s => s.status !== 'rejected')
      .sort((a, b) => a.orderInDay - b.orderInDay)
      .forEach(s => {
        points.push({ lat: s.lat, lng: s.lng })
        ptDay.push(d.index)
        ptKind.push('stop'); ptStopId.push(s.id)
      }))
  const dc = trip.destinationCoords ?? []
  const lastDest = dc.length ? dc[dc.length - 1] : undefined
  const returnsHome = isRoundTrip(trip) && !!trip.startLocationCoords
  // #1006: test the destination against the last OUTBOUND point, never against
  // the ride-home point. A round trip's home is the start, so comparing there
  // made a destination that IS the last stop look new, and a home → destination
  // "tail" leg was added after the return.
  const same = (a: RoadChainPoint | undefined, b: RoadChainPoint) => !!a && a.lat === b.lat && a.lng === b.lng
  const destIsNew = !!lastDest
    && !same(points[points.length - 1], lastDest)
    // a round trip that ends its destination at home adds nothing before the return
    && !(returnsHome && same(trip.startLocationCoords ?? undefined, lastDest))
  // A round trip's destination is part of the OUTBOUND journey, so it goes
  // BEFORE the drive home and inside `outboundCount`. A one-way destination
  // stays a tail after the outbound legs (`hasDestTail`).
  if (returnsHome && destIsNew && lastDest) {
    points.push({ lat: lastDest.lat, lng: lastDest.lng })
    ptDay.push(null)
    ptKind.push('destination'); ptStopId.push(null)
  }
  // The outbound journey ends here: everything below is the drive back.
  const outboundCount = points.length
  if (returnsHome && trip.startLocationCoords) {
    points.push({ lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng })
    ptDay.push(null)
    ptKind.push('return'); ptStopId.push(null)
  }
  const hasDestTail = !returnsHome && destIsNew
  if (hasDestTail && lastDest) {
    points.push({ lat: lastDest.lat, lng: lastDest.lng })
    ptDay.push(null)
    ptKind.push('destination'); ptStopId.push(null)
  }
  return { points, ptDay, ptKind, ptStopId, outboundCount, hasDestTail }
}

/** Geometry-only signature: the trip's road chain rebuilds only when a stop moves,
 *  is added/dropped, or an endpoint changes — NEVER when fuel/crew/budget/dates
 *  change. Without this, `mutateTrip`'s identity-clone on every save re-measures
 *  the whole OSRM chain on a fuel-price keystroke (#188/#202/#213).
 *
 *  Mirrors `buildRoadChain` exactly — same sort order, same rejected-filter,
 *  same round-trip-return-to-start leg, same last-destination tail. If this
 *  function ever drifts from buildRoadChain, re-measure fires on cosmetic
 *  changes (cache miss) or fails to fire on real ones (stale chain). The
 *  `tripRoad.test.ts` "matches what buildRoadChain actually consumes" case
 *  pins the equality. */
export function roadChainSig(
  trip: Pick<Trip, 'startLocationCoords' | 'days' | 'destinationCoords' | 'roundTrip' | 'transportMode'>,
): string {
  const parts: string[] = []
  if (trip.startLocationCoords) {
    parts.push(roundCoord(trip.startLocationCoords.lat, trip.startLocationCoords.lng))
  } else {
    parts.push('-')
  }
  ;[...trip.days]
    .sort((a, b) => a.index - b.index)
    .forEach(d => [...d.stops]
      .filter(s => s.status !== 'rejected')
      .sort((a, b) => a.orderInDay - b.orderInDay)
      .forEach(s => parts.push(roundCoord(s.lat, s.lng))))
  if (isRoundTrip(trip) && trip.startLocationCoords) {
    parts.push(roundCoord(trip.startLocationCoords.lat, trip.startLocationCoords.lng))
  }
  const dc = trip.destinationCoords ?? []
  const lastDest = dc.length ? dc[dc.length - 1] : undefined
  if (lastDest) parts.push(roundCoord(lastDest.lat, lastDest.lng))
  parts.push(trip.transportMode)
  parts.push(isRoundTrip(trip) ? 'rt' : 'ow')
  return parts.join('|')
}

/** 5 decimals ≈ 1.1 m at the equator — stable for "same place" comparisons
 *  across providers that round-trip coordinates through different precisions. */
function roundCoord(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`
}

export type RoadOutcome =
  | { ok: true; legs: RoadLeg[] }
  | { ok: false }

/** Measurement lifecycle: pending while in flight, failed only after the retry. */
export type RoadStatus = 'pending' | 'ok' | 'failed'

/** What a consumer surface (the Map tab) receives: the chain, its legs, and how it went. */
export interface TripRoadView {
  chain: RoadChain | null
  legs: RoadLeg[] | null
  status: RoadStatus
  /** re-run the measurement (after a transient failure) */
  retry: () => void
}

export interface MeasureOpts {
  /** one retry after this delay — the OSRM demo is shared and rate-limited */
  retryDelayMs?: number
  /** injectable for tests (keeps them synchronous) */
  sleep?: (ms: number) => Promise<void>
  /** injectable for tests (fetch counters / scripted failures) */
  measure?: (points: RoadChainPoint[], assumptions: EngineAssumptions) => Promise<RoadLeg[]>
}

/** Default backoff before the single retry (matches the pre-#188 map behaviour). */
export const ROAD_RETRY_DELAY_MS = 2000

/**
 * Test seam. The dev fixture swaps the measurement so a capture run never
 * depends on the shared OSRM demo server. Production never calls the setter,
 * so the shipped path is still `routePath`.
 */
let roadMeasureOverride: MeasureOpts['measure'] | null = null

export function setRoadMeasureForTests(next: MeasureOpts['measure'] | null): void {
  // Dev and test only. A production bundle must never swap the measurement.
  if (!import.meta.env.DEV) return
  roadMeasureOverride = next
}

function activeMeasure(opts: MeasureOpts, signal?: AbortSignal): NonNullable<MeasureOpts['measure']> {
  return opts.measure ?? roadMeasureOverride ?? ((pts, asm) => routePath(pts, asm, signal))
}

/**
 * Did this chain resolve? A rate-limited OSRM does not throw — `routePath`
 * degrades to all-estimate haversine legs internally — so a chain counts as a
 * road only when at least ONE leg came from a real provider. Returns the legs
 * to use, or null for "unresolved". ONE copy of that rule: both measurement
 * paths below apply it, and so does every surface that grades a line it draws
 * (#188's rule, made shareable in #370).
 */
export function resolvedLegs(legs: RoadLeg[]): RoadLeg[] | null {
  return legs.some(l => l.source !== 'estimate') ? legs : null
}

/** What a surface may claim about a line it is drawing (#370). */
export type RouteGrade = 'measured' | 'rough'

/**
 * Grade a line a surface is ABOUT to draw, from the measured geometry it should
 * have come from: real road geometry is `measured`; the straight-line chord
 * fallback a surface falls back to when nothing has resolved — or while a
 * shared measurement is still pending — is `rough`, and must never wear the
 * same paint as a road. Takes the MEASURED geometry (not the drawn
 * coordinates), so "no measurement yet" and "measurement failed" grade the
 * same way: both are honest guesses.
 */
export function routeDrawGrade(geometry: [number, number][] | null | undefined): RouteGrade {
  return geometry && geometry.length > 1 ? 'measured' : 'rough'
}

/**
 * Measure ONE day's synthesized ride (the Map tab's day-filter line) with the
 * same contract as the whole-trip chain: one attempt, one retry after a
 * transient failure, and an all-estimate result counts as unresolved — a
 * rate-limited OSRM must never be drawn as if it were a road (#188's rule,
 * applied per day). Accepts an AbortSignal so flipping day chips kills the
 * previous day's in-flight measurement instead of racing it (#polylines).
 */
export async function measureDayRide(
  points: RoadChainPoint[],
  assumptions: EngineAssumptions,
  opts: MeasureOpts & { signal?: AbortSignal } = {},
): Promise<RoadOutcome> {
  const signal = opts.signal
  if (signal?.aborted) return { ok: false }
  const measure = activeMeasure(opts, signal)
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const retryDelayMs = opts.retryDelayMs ?? ROAD_RETRY_DELAY_MS
  const attempt = async (): Promise<RoadLeg[] | null> => resolvedLegs(await measure(points, assumptions))
  const first = await attempt().catch(() => null)
  if (first) return { ok: true, legs: first }
  if (signal?.aborted) return { ok: false }
  await sleep(retryDelayMs)
  if (signal?.aborted) return { ok: false }
  const second = await attempt().catch(() => null)
  return second ? { ok: true, legs: second } : { ok: false }
}

/**
 * Measure the chain once, retrying ONCE after a transient failure. Returns an
 * explicit outcome rather than throwing: a caller must be able to tell "the road
 * did not resolve" (degrade honestly) from "there is no road to measure".
 *
 * "Did not resolve" covers BOTH a thrown measurement and a chain in which every
 * leg fell back to the engine's haversine `estimate` — the latter is what a
 * rate-limited OSRM actually produces (routePath degrades internally instead of
 * rejecting), and treating those chords as a measured road is exactly the
 * contradictory state #184 fixed (a straight-line "road" drawn while the detour
 * math claims to know the road). Any real leg counts: a partial corridor beats
 * none, and the Map tab renders what it got.
 *
 * Accepts an AbortSignal for the same reason `measureDayRide` does (#325): the
 * workspace path used to run a whole OSRM chain plus its parallel per-leg
 * fallbacks to completion behind a `cancelled` flag that only suppressed
 * `setState`. Switching trips burns no quota and cannot land a late road on the
 * next trip's view now — and an abort is "stop silently", never a failure that
 * earns the 2s retry.
 */
export async function measureRoadChain(
  points: RoadChainPoint[],
  assumptions: EngineAssumptions,
  opts: MeasureOpts & { signal?: AbortSignal } = {},
): Promise<RoadOutcome> {
  const signal = opts.signal
  if (signal?.aborted) return { ok: false }
  const measure = activeMeasure(opts, signal)
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const retryDelayMs = opts.retryDelayMs ?? ROAD_RETRY_DELAY_MS
  const attempt = async (): Promise<RoadLeg[] | null> => resolvedLegs(await measure(points, assumptions))
  const first = await attempt().catch(() => null)
  if (first) return { ok: true, legs: first }
  if (signal?.aborted) return { ok: false }
  await sleep(retryDelayMs)
  if (signal?.aborted) return { ok: false }
  const second = await attempt().catch(() => null)
  return second ? { ok: true, legs: second } : { ok: false }
}

/**
 * The engine's leg corrections from a measured chain: keyed by legKey(a, b),
 * with the mirrored key too — the drive home runs the same road in reverse, and
 * a reversed road number beats a haversine fallback.
 */
export function correctionsFromLegs(
  chain: Pick<RoadChain, 'points'>,
  legs: RoadLeg[],
): Record<string, LegEstimate> {
  const map: Record<string, LegEstimate> = {}
  for (let i = 0; i < legs.length && i + 1 < chain.points.length; i++) {
    const est: LegEstimate = {
      distanceKm: legs[i].distanceKm,
      durationMinutes: legs[i].durationMinutes,
      geometry: legs[i].geometry,
      // The chain admits a leg the router could not measure, and
      // `resolvedLegs` accepts the chain when ANY leg resolved. Carry the
      // fallback flag so a distance label can tell a road number from a
      // haversine number on the same chain (#671).
      ...(legs[i].source === 'estimate' ? { estimated: true } : {}),
    }
    map[legKey(chain.points[i], chain.points[i + 1])] = est
    const rk = legKey(chain.points[i + 1], chain.points[i])
    if (!map[rk]) map[rk] = est
  }
  return map
}

export interface MapRoadView {
  /** flat [lng, lat][] road geometry for the outbound journey (null while unmeasured) */
  geometry: [number, number][] | null
  /** outbound road total — the Map tab's planKm input (the loop factor is applied separately) */
  totalKm: number | null
  totalMin: number | null
  /** road km per day, aligned positionally with trip.days */
  dayRoadKm: number[] | null
}

const EMPTY_MAP_VIEW: MapRoadView = { geometry: null, totalKm: null, totalMin: null, dayRoadKm: null }

/** Largest gap between where one leg ends and the next starts for them to join. */
const JOIN_TOLERANCE_KM = 25

/** Does `next` start where the last of `legs` ends? A router snaps both ends to the
 *  same road point, so a real join is metres apart; a join gap is hundreds of km. */
function startsWhereLineEnds(legs: RoadLeg[], next: RoadLeg): boolean {
  const lastGeometry = legs[legs.length - 1]?.geometry
  const end = lastGeometry?.[lastGeometry.length - 1]
  const start = next.geometry[0]
  if (!end || !start) return false
  const dLat = (end[1] - start[1]) * 111.32
  const dLng = (end[0] - start[0]) * 111.32 * Math.cos(((end[1] + start[1]) / 2) * Math.PI / 180)
  return Math.hypot(dLat, dLng) <= JOIN_TOLERANCE_KM
}

/**
 * The OUTBOUND legs of a measured chain (start → stops, excluding the round
 * trip's ride home and any trailing destination) — the slice the Map tab's
 * view and the terrain profile (#124) are both built from, so they cannot
 * disagree about which road they describe.
 */
export function outboundLegs(chain: RoadChain | null, legs: RoadLeg[] | null): RoadLeg[] {
  if (!chain || !legs || legs.length === 0) return []
  const count = Math.min(legs.length, Math.max(0, chain.outboundCount - 1))
  return count > 0 ? legs.slice(0, count) : []
}

/**
 * The measured return leg from the workspace chain, if the chain contains one.
 * The Map tab draws the outbound and return as separate lines; keeping this
 * derivation beside `outboundLegs` prevents the renderer from measuring the
 * same pair again.
 */
export function mapReturnGeometryFromLegs(
  chain: RoadChain | null,
  legs: RoadLeg[] | null,
): [number, number][] | null {
  if (!chain || !legs) return null
  // A destination tail is also a post-outbound leg, but it is not the drive
  // home. Only the repeated first point proves a round-trip return exists.
  const first = chain.points[0]
  const afterOutbound = chain.points[chain.outboundCount]
  if (!first || !afterOutbound || first.lat !== afterOutbound.lat || first.lng !== afterOutbound.lng) return null
  const returnIndex = chain.outboundCount - 1
  if (returnIndex < 0 || returnIndex >= legs.length) return null
  const coords = legs[returnIndex].geometry
  return coords.length > 1 ? coords : null
}

/**
 * The Map tab's view of a measured chain: ONLY the outbound legs
 * (start → stops). A round trip's chain carries the drive home too, and the
 * fatigue math already multiplies by its own loop factor — counting the return
 * here would double the journey.
 *
 * #polylines: the DRAWN GEOMETRY is the full chain the user plans (outbound
 * legs + any trailing one-way destination leg), while totalKm/totalMin and
 * dayRoadKm stay outbound-only — the line must match the pins on screen, and
 * a one-way trip whose destination anchor sits after its last stop used to
 * draw one leg short (the line visibly ended before the destination).
 */
export function mapRoadViewFromLegs(
  chain: RoadChain | null,
  legs: RoadLeg[] | null,
  dayIndexes: number[],
): MapRoadView {
  if (!chain || !legs || legs.length === 0) return EMPTY_MAP_VIEW
  if (chain.outboundCount <= 1) return EMPTY_MAP_VIEW
  const outbound = Math.min(legs.length, chain.outboundCount - 1)
  if (outbound <= 0) return EMPTY_MAP_VIEW
  const legsView = legs.slice(0, outbound)
  const perDay = new Map<number, number>()
  legsView.forEach((l, i) => {
    const day = chain.ptDay[i + 1]
    if (day != null) perDay.set(day, (perDay.get(day) ?? 0) + l.distanceKm)
  })
  // The drawn geometry is outbound + (when present) the one-way destination
  // tail. A round-trip return is a separate line, so it is never added here.
  // #1006 backstop: the tail is the leg RIGHT AFTER the outbound legs, and only
  // when it starts where the outbound line ends. The old code took the chain's
  // last leg, which on a round trip started at home — flattening it onto an
  // outbound line that ends at the last stop drew one straight join segment.
  const tail = chain.hasDestTail && chain.points.length === chain.outboundCount + 1
    ? legs[outbound]
    : undefined
  const drawnLegs = tail && startsWhereLineEnds(legsView, tail) ? [...legsView, tail] : legsView
  return {
    geometry: drawnLegs.flatMap(l => l.geometry),
    totalKm: legsView.reduce((sum, l) => sum + l.distanceKm, 0),
    totalMin: legsView.reduce((sum, l) => sum + l.durationMinutes, 0),
    dayRoadKm: dayIndexes.map(idx => perDay.get(idx) ?? 0),
  }
}
