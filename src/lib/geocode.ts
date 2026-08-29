// ============ Place search facade ============
// Google-first when VITE_GOOGLE_MAPS_API_KEY is configured, the 100% free
// stack underneath as the automatic fallback on key-absence, any error, or
// quota exhaustion (providers/quota.ts). Consumers keep importing from here
// exactly as before — downstream logic (corridor sampling, home zone, gap
// bias, ranking, budget math) never touches a provider directly.
//
//   providers/hits.ts    shared PlaceHit model + pure tourist-ranking logic
//   providers/free.ts    Mappls · Open-Meteo · Wikipedia · OSM engines
//   providers/google.ts  Places API (New): Autocomplete, Search-Along-Route
//                        (Text Search Pro), opening hours on the same events
//   providers/quota.ts   Phase-B per-SKU soft-cap guard (localStorage)
//
// Note: `resolveHitCoords` is kept (not deleted as first sketched in the
// report) because in free mode Mappls hits still arrive without coordinates
// ("the app behaves exactly as today when the key is absent"). Google picks
// resolve via one Place Details call instead of OSM Nominatim.
export { DEBOUNCE_MS } from './providers/free'
export { mapplsEnabled, parseOpeningHours, fetchOpeningHours, type OpeningHours } from './providers/free'
export { HOME_ZONE_KM, corridorAnchors, detourKm } from './providers/hits'
export type { NearbyOpts, PlaceHit } from './providers/hits'
export { googleEnabled } from './providers/google'

import { hasCoords, rankAndCap, type NearbyOpts, type PlaceHit } from './providers/hits'
import {
  searchPlacesFree,
  searchNearbyPoisMultiFree,
  resolveHitCoords as resolveFreeHitCoords,
} from './providers/free'
import {
  googleEnabled,
  googleAutocomplete,
  googleNearbyAlongRoute,
  googleResolveHitCoords,
} from './providers/google'

/**
 * Search cities AND points of interest at once. Google autocomplete first
 * (India-best coverage, real place ids) with the free stack merged underneath
 * so small towns never disappear; without a Google key this is exactly the
 * old free search.
 */
export async function searchPlaces(q: string, opts?: { indiaOnly?: boolean }): Promise<PlaceHit[]> {
  const needle = q.trim()
  if (needle.length < 2) return []
  if (!googleEnabled()) return searchPlacesFree(q, opts)
  const [google, free] = await Promise.all([
    googleAutocomplete(needle, opts?.indiaOnly ?? true).catch(() => [] as PlaceHit[]),
    searchPlacesFree(q, opts).catch(() => [] as PlaceHit[]),
  ])
  // Dedupe across providers, but only when the hits actually point at the
  // same location — Open-Meteo and Google can legitimately both return
  // "Munnar" with different precision/coords, and both belong in the list.
  const keyOf = (h: PlaceHit) =>
    `${h.name.toLowerCase()}@${h.latitude != null ? h.latitude.toFixed(2) : ''},${h.longitude != null ? h.longitude.toFixed(2) : ''}`
  const seen = new Set<string>()
  const out: PlaceHit[] = []
  for (const hit of [...google, ...free]) {
    if (!hit.name) continue
    const key = keyOf(hit)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
  }
  return out.slice(0, 8)
}

/**
 * Resolve coordinates for a picked hit. Google suggestions resolve via one
 * Place Details (Essentials) call; free-stack Mappls hits keep the Nominatim
 * fallback. Returns the hit untouched on failure — callers treat a miss as
 * manual entry exactly like an unmatched text.
 */
export async function resolveHitCoords(hit: PlaceHit): Promise<PlaceHit> {
  if (hasCoords(hit)) return hit
  if (hit.source === 'google' && hit.placeId) {
    if (!googleEnabled()) return hit
    try { return await googleResolveHitCoords(hit) } catch { return hit }
  }
  return resolveFreeHitCoords(hit)
}

/** Single-anchor convenience wrapper (empty-day chips). */
export async function searchNearbyPois(lat: number, lng: number, radiusM = 10000, count = 10, opts: NearbyOpts = {}): Promise<PlaceHit[]> {
  return searchNearbyPoisMulti([{ lat, lng }], radiusM, count, opts)
}

/**
 * Nearby ideas for the whole route. Google mode (key + OSRM geometry in
 * `opts.routeCoords`): Search-Along-Route — one Text Search Pro event per
 * category, opening hours and real road detours on every hit, ranked by the
 * same tourist engine. Any failure, empty result (round trips), or quota trip
 * falls back to the free stack.
 */
export async function searchNearbyPoisMulti(
  anchors: { lat: number; lng: number }[],
  radiusM = 10000,
  count = 10,
  opts: NearbyOpts = {},
): Promise<PlaceHit[]> {
  const capped = anchors.filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng)).slice(0, 12)
  if (capped.length === 0) return []
  const route = opts.routeCoords ?? []
  if (googleEnabled() && route.length >= 2) {
    try {
      const hits = await googleNearbyAlongRoute({ routeCoords: route, routeTotalKm: opts.routeTotalKm, count, includeFuel: opts.includeFuel })
      if (hits.length > 0) return rankAndCap(hits, capped, radiusM, count, opts)
      // round-trip routes (origin ≈ destination) can legitimately return
      // zero along-route results → fall through to the free corridor search
    } catch { /* quota or network → free stack */ }
  }
  return searchNearbyPoisMultiFree(capped, radiusM, count, opts)
}