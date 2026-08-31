import type { VehicleProfile } from '../../data/types'
// ============ Provider-agnostic hit model & pure ranking logic ============
// The shared contract between the free engines (providers/free.ts) and the
// Google provider (providers/google.ts), plus the pure part of the tourist
// engine (corridor sampling, home zone, detour measure, ranking). No network
// and no env access live here — the corridor tests (tests/nearby.test.ts)
// exercise this module directly.
import { haversineKm } from '../geo'

export interface PlaceHit {
  id: number | string
  name: string
  latitude: number
  longitude: number
  admin1?: string          // state/region (populated places)
  country?: string
  country_code?: string
  kind: 'place' | 'poi'
  description?: string     // e.g. "Waterfall in Athirapilly, India"
  thumb?: string           // small image URL (Wikipedia only)
  /** Mappls place id — present when the hit came from Mappls (coords pending) */
  eLoc?: string
  /** Google place id — present when the hit came from Google Places */
  placeId?: string
  /** which provider produced this hit (drives pick-time coord resolution + attribution) */
  source?: 'google' | 'mappls' | 'open-meteo' | 'wikipedia' | 'osm'
  /** stop category hint (e.g. from a nearby category) — used by the add flows */
  category?: string
  /** reported opening hours "HH:MM" — Google hits only, rendered as "reported" */
  openTime?: string
  closeTime?: string
  /** real road detour in km (Google routingSummaries); falls back to straight-line-to-anchor */
  offRouteKm?: number
  // ---- ride-plan annotations (filled by src/lib/ridePlan.ts + providers) ----
  /** road km along the route from the journey origin (Google leg0/1000; free = coarse anchor position) */
  alongRouteKm?: number
  /** which fatigue segment this suggestion is for (stretch / meal / fuel / rest / overnight / sight) */
  haltPurpose?: HaltPurpose
  /** km from the previous planned stop/suggestion (ridePlan fills) */
  legKm?: number
  /** est. drive minutes for that leg (ridePlan fills) */
  legMinutes?: number
  /** cumulative km from journey origin (ridePlan fills) */
  cumKm?: number
  /** nearest key city to this hit (city overlay fills) */
  nearestCity?: string
  /** true for populated-place/city hits from the city overlay */
  isPopulatedPlace?: boolean
  /** OSM `population` tag when present (city ordering) */
  population?: number
}

/** What kind of journey break a suggestion serves. */
export type HaltPurpose = 'stretch' | 'meal' | 'fuel' | 'rest' | 'overnight' | 'sight'

/** true when a hit already carries usable coordinates */
export function hasCoords(h: PlaceHit): boolean {
  return Number.isFinite(h.latitude) && Number.isFinite(h.longitude) && (h.latitude !== 0 || h.longitude !== 0)
}

/** Distance in meters between a hit and the nearest route anchor. */
export function distToNearest(h: Pick<PlaceHit, 'latitude' | 'longitude'>, anchors: { lat: number; lng: number }[]): number {
  return Math.min(...anchors.map(a => haversineKm(h.latitude, h.longitude, a.lat, a.lng) * 1000))
}

/** How far a hit sits off the route corridor, in km (real road detour when known). */
export function detourKm(h: Pick<PlaceHit, 'latitude' | 'longitude' | 'offRouteKm'>, anchors: { lat: number; lng: number }[]): number {
  if (h.offRouteKm != null && Number.isFinite(h.offRouteKm)) return h.offRouteKm
  return distToNearest(h, anchors) / 1000
}

/** Nothing within this radius of the trip's start is ever suggested. */
export const HOME_ZONE_KM = 15

/**
 * Coarse along-route position of a hit (km from the journey origin).
 * Prefers the real road distance when the provider gave one (`alongRouteKm`,
 * e.g. Google's routingSummaries leg0); otherwise maps the hit onto the
 * nearest ordered corridor anchor and returns that anchor's cumulative route
 * distance (interpolated between consecutive anchors' straight-line spans).
 * Returns null when there are no usable anchors.
 */
export function kmFromStartForHit(
  h: Pick<PlaceHit, 'latitude' | 'longitude' | 'alongRouteKm'>,
  anchors: { lat: number; lng: number }[],
): number | null {
  if (h.alongRouteKm != null && Number.isFinite(h.alongRouteKm)) return Math.max(0, h.alongRouteKm)
  const pts = anchors.filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng))
  if (pts.length === 0 || !Number.isFinite(h.latitude) || !Number.isFinite(h.longitude)) return null
  // cumulative km at each anchor (anchors sit ON the route line, so the
  // straight-line sum between consecutive ones approximates along-route travel)
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + haversineKm(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng))
  }
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < pts.length; i++) {
    const d = haversineKm(h.latitude, h.longitude, pts[i].lat, pts[i].lng)
    if (d < bestD) { bestD = d; best = i }
  }
  return cum[best]
}

/** Stable hash string for a list of anchors — used as a cache key so that
 * adding, removing, or reordering stops invalidates the suggestion cache. */
export function anchorHash(anchors: { lat: number; lng: number }[]): string {
  const pts = anchors
    .filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng))
    .map(a => `${a.lat.toFixed(5)},${a.lng.toFixed(5)}`)
  return pts.join('|')
}

export interface NearbyOpts {
  /** include petrol pumps as pit stops (self-drive trips only, capped) */
  includeFuel?: boolean
  /** the trip's starting point — hits inside HOME_ZONE_KM of it are dropped */
  homeCenter?: { lat: number; lng: number } | null
  /** additive per-category score bias from itinerary gaps (computeCategoryBias) */
  categoryBias?: Record<string, number>
  /**
   * Simplified road geometry of the whole route ([lng, lat][] — OSRM format).
   * When present and a Google key is configured, the nearby search runs as one
   * Search-Along-Route request per category instead of per-anchor free calls.
   */
  routeCoords?: [number, number][] | null
  /**
   * Total road distance of routeCoords in km (OSRM leg sum). Google's
   * routingSummaries report origin→place and place→destination legs, so the
   * real detour of each hit is (leg0 + leg1) − routeTotalKm; when this is
   * absent, Google hits fall back to the straight-line-to-anchor estimate.
   */
  routeTotalKm?: number | null
  /**
   * Vehicle tank range in km — sets the fuel-stop cadence (default 450).
   * 0/undefined keep the default; only meaningful when includeFuel is true.
   */
  vehicleRangeKm?: number
  /**
   * true = plan the WHOLE trip (cross-day overnight segments allowed);
   * false/undefined = single-day journey (fatigue halts only, no overnight).
   */
  multiDay?: boolean
  /** When set, nearby searches use purpose-specific queries instead of generic tourist queries. */
  purposes?: HaltPurpose[]
  /** Vehicle profile for accurate fuel/charging cadence. */
  vehicleProfile?: VehicleProfile
}

/**
 * Sample anchors along the WHOLE route line (consecutive stop points) so the
 * search corridor covers every part of the drive, spaced ~`radiusM` apart and
 * capped at `maxAnchors` points. Samples inside the home zone around `start`
 * are skipped — no suggestions around where the trip begins.
 */
export function corridorAnchors(
  routePts: { lat: number; lng: number }[],
  start: { lat: number; lng: number } | null | undefined,
  radiusM: number,
  maxAnchors = 12,
): { lat: number; lng: number }[] {
  const raw = routePts.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (raw.length === 0) return []
  // drop consecutive duplicates (< 500 m) so legs are real
  const pts = raw.filter((p, i) => i === 0 || haversineKm(p.lat, p.lng, raw[i - 1].lat, raw[i - 1].lng) > 0.5)
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + haversineKm(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) * 1000)
  }
  const total = cum[cum.length - 1]
  const homeZoneM = HOME_ZONE_KM * 1000
  const radius = Math.min(Math.max(radiusM, 1000), 120000)
  const n = Math.max(2, Math.min(maxAnchors, Math.ceil(total / radius) + 1))
  const out: { lat: number; lng: number }[] = []
  const add = (p: { lat: number; lng: number }): boolean => {
    if (start && haversineKm(p.lat, p.lng, start.lat, start.lng) * 1000 < homeZoneM) return false
    if (out.some(q => haversineKm(q.lat, q.lng, p.lat, p.lng) < 1)) return false
    out.push(p)
    return true
  }
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1)
    let j = 1
    while (j < cum.length - 1 && cum[j] < target) j++
    const segLen = Math.max(1e-9, cum[j] - cum[j - 1])
    const f = Math.min(1, Math.max(0, (target - cum[j - 1]) / segLen))
    add({ lat: pts[j - 1].lat + (pts[j].lat - pts[j - 1].lat) * f, lng: pts[j - 1].lng + (pts[j].lng - pts[j - 1].lng) * f })
  }
  // the destination always gets coverage — unless it sits in the home zone
  const last = pts[pts.length - 1]
  if (!out.some(q => haversineKm(q.lat, q.lng, last.lat, last.lng) < 1)) add(last)
  return out
}

/**
 * Tourist-value score. Category priority (see & do > meals > stays > pit
 * stops), notability signals (Wikipedia thumb / rich description, strong OSM
 * categories), and a distance decay across the scope — a far POI must be more
 * notable to survive, but proximity is never the whole answer.
 */
export const CATEGORY_PRIORITY: Record<string, number> = {
  sightseeing: 0, nature: 0, beach: 1, temple: 1, museum: 1, adventure: 1,
  food: 2, event: 2, travel: 2, rest: 3, hotel: 3, 'transport-hub': 4, shopping: 5,
}

export function poiTouristScore(
  h: PlaceHit,
  anchors: { lat: number; lng: number }[],
  radiusM: number,
  categoryBias?: Record<string, number>,
): number {
  const cat = h.category ?? 'sightseeing'
  let s = -(CATEGORY_PRIORITY[cat] ?? 2) * 8
  if (h.thumb) s += 5 // Wikipedia imagery ⇒ notable place
  if ((h.description ?? '').length > 40) s += 3
  if (cat === 'sightseeing' || cat === 'nature' || cat === 'beach' || cat === 'temple' || cat === 'museum') s += 3
  if (categoryBias && categoryBias[cat]) s += categoryBias[cat] // itinerary gaps
  const frac = Math.min(1, distToNearest(h, anchors) / Math.max(1, radiusM))
  s -= frac * 6
  return s
}

export function normWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)
}

/**
 * Shared tail of every nearby search: drop hits in the home zone around the
 * trip's start, rank by tourist value (+ itinerary-gap bias), then greedy-pick
 * with a per-category cap so the list stays varied (fuel capped harder).
 */
export function rankAndCap(
  hits: PlaceHit[],
  anchors: { lat: number; lng: number }[],
  radiusM: number,
  count: number,
  opts: NearbyOpts = {},
): PlaceHit[] {
  // never suggest anything in the home zone around the trip's start
  const home = opts.homeCenter
  const homeFiltered = home
    ? hits.filter(h => haversineKm(h.latitude, h.longitude, home.lat, home.lng) * 1000 >= HOME_ZONE_KM * 1000)
    : hits
  homeFiltered.sort((a, b) =>
    poiTouristScore(b, anchors, radiusM, opts.categoryBias) - poiTouristScore(a, anchors, radiusM, opts.categoryBias))
  const catCap = Math.max(2, Math.ceil(count / 3))
  const fuelCap = opts.includeFuel ? 2 : 0
  const used = new Map<string, number>()
  const out: PlaceHit[] = []
  let fuelUsed = 0
  for (const h of homeFiltered) {
    if (out.length >= count) break
    const k = h.category ?? 'sightseeing'
    if (k === 'transport-hub') {
      if (fuelUsed >= fuelCap) continue
      fuelUsed++
    } else {
      const n = used.get(k) ?? 0
      if (n >= catCap) continue
      used.set(k, n + 1)
    }
    out.push(h)
  }
  return out
}