/**
 * #420, slice 3 — the Map tab page's module-level pieces, in one place.
 *
 * These are the constants and pure helpers that sat at the top of `MapTab.tsx`.
 * None of them needs the component, and three of them (`smallThumb`, `googleMapsUrl`,
 * `newStopId`) had no direct test at all because they were only reachable through a
 * 2,700-line page. Moving them here is what makes them testable, and the tests are
 * the point of the move.
 *
 * `clockHM` deliberately did NOT move: it already exists in `lib/clockOverlay.ts`
 * with the same body and its own tests, so the page's copy was deleted and the lib
 * one imported instead — parallel logic with two homes is the thing this file is
 * supposed to end, not add to.
 */
import type { PlaceHit } from '../../../lib/geocode'
import { visitMinutesForCategory } from '../../../lib/slackPrompts'

/**
 * Purposes that are finite by construction — their halts are needs, not sights.
 * Module scope: this is a constant, so it must not be rebuilt on every render.
 */
export const NEED_PURPOSES = new Set(['fuel', 'meal', 'food', 'rest', 'stretch', 'overnight', 'stay'])

/** See-rail cards shown before the rest fold behind one expander. */
export const SEE_VISIBLE = 4

/** Detour-scope presets for nearby suggestions (km off the route). */
export const SCOPE_KM_STEPS = [10, 20, 30, 50, 80, 100]
export const SCOPE_STORAGE_KEY = 'nearby_scope_km'

/** Sensible visit durations per suggestion category (tourist pacing). */
export const poiVisitMinutes = visitMinutesForCategory

/** Wikipedia thumbnail URLs are hotlink-friendly but huge; ask for a small one.
 *  #177: only Wikimedia thumb URLs carry a /<w>px- size segment — rewriting a
 *  path segment that merely LOOKS like a size on any other host mangles it. */
export function smallThumb(url: string): string {
  if (!/upload\.wikimedia\.org/.test(url)) return url
  return url.replace(/\/(\d+)px-/, '/120px-')
}

export function googleMapsUrl(hit: Pick<PlaceHit, 'placeId' | 'latitude' | 'longitude' | 'name'>): string {
  // Real Place page when Google gave us a place_id (reviews, hours, directions)
  if (hit.placeId) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(hit.placeId)}`
  // Free-stack hits have no place_id — Google's documented pin URL by coords
  // (hand-building /place/<name>/@lat,lng broke on encoded names)
  if (Number.isFinite(hit.latitude) && Number.isFinite(hit.longitude)) {
    return `https://www.google.com/maps/search/?api=1&query=${hit.latitude},${hit.longitude}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hit.name)}`
}

/** A locally minted stop id. Platform CSPRNG, never `Math.random` (#267's
 *  presence-key lesson): a temporary handle is still a handle, and three
 *  different add paths had drifted onto two different generators. */
export function newStopId(): string {
  const rnd = new Uint32Array(2)
  crypto.getRandomValues(rnd)
  return `pending_${rnd[0].toString(36)}${rnd[1].toString(36)}`
}
