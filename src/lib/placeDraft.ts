// ============ A picked place, kept honest until it is saved ============
// The composer used to keep only two optional numbers. A text edit after a
// pick left the old pin behind, and a text-only idea was silently pinned to the
// trip anchor. A draft now either carries a real picked place or it does not;
// there is no third state the submit path could mistake for one.
import type { PersistedPlaceIdentity, PlaceProvider, ResolvedPlace } from '../data/types'
import type { PlaceHit } from './providers/hits'

/** Every provider this build can round-trip as a place identity. `open-meteo`
 *  belongs here: the free stack's city geocoder returns real populated places
 *  through it, so rejecting its hits left keyless city searches unpickable
 *  (#839). A provider that is NOT on this list is still refused — the allowlist
 *  is what keeps an unknown provenance from being persisted as a known one. */
export const PLACE_PROVIDERS: readonly PlaceProvider[] = ['google', 'mappls', 'open-meteo', 'wikipedia', 'osm']

export type PlaceDraft =
  | { kind: 'unresolved'; text: string; reason?: 'edited' | 'empty' }
  | { kind: 'resolved'; text: string; place: ResolvedPlace }

export function unresolvedPlace(text = '', reason?: 'edited' | 'empty'): PlaceDraft {
  return reason ? { kind: 'unresolved', text, reason } : { kind: 'unresolved', text }
}

export function isPlaceProvider(value: unknown): value is PlaceProvider {
  return typeof value === 'string' && (PLACE_PROVIDERS as readonly string[]).includes(value)
}

function cleanKey(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** A usable pick: finite, in-range, non-zero coordinates and no provider this
 *  build cannot round-trip. Latitude is −90..90 and longitude is −180..180
 *  (#839 R4). `open-meteo` is a legitimate place engine here — the free stack's
 *  geocoder returns cities and towns through it — so a hit from it resolves like
 *  any other, and an unknown provider is what gets refused. */
export function resolvedPlaceFromHit(hit: PlaceHit): ResolvedPlace | null {
  if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return null
  if (hit.latitude < -90 || hit.latitude > 90 || hit.longitude < -180 || hit.longitude > 180) return null
  if (hit.latitude === 0 || hit.longitude === 0) return null
  if (hit.source !== undefined && !isPlaceProvider(hit.source)) return null
  const label = (hit.name ?? '').trim()
  if (!label) return null
  return {
    label,
    lat: hit.latitude,
    lng: hit.longitude,
    ...(hit.source ? { source: hit.source } : {}),
    ...(cleanKey(hit.placeId) ? { placeId: cleanKey(hit.placeId) } : {}),
    ...(cleanKey(hit.eLoc) ? { eLoc: cleanKey(hit.eLoc) } : {}),
    exposure: 'unknown',
  }
}

/** Editing the text invalidates the pin unless the text still names it. */
export function editPlaceDraft(draft: PlaceDraft, text: string): PlaceDraft {
  if (draft.kind === 'resolved' && text === draft.text) return draft
  return unresolvedPlace(text, text.trim() ? 'edited' : 'empty')
}

export function pickPlaceDraft(hit: PlaceHit): PlaceDraft {
  const place = resolvedPlaceFromHit(hit)
  return place
    ? { kind: 'resolved', text: place.label, place }
    : unresolvedPlace('', 'empty')
}

/** The metadata the database stores. Coordinates and the display label stay in
 *  their own columns; this object carries identity only. */
export function persistedPlace(place: ResolvedPlace): PersistedPlaceIdentity {
  return {
    ...(place.source ? { source: place.source } : {}),
    ...(place.placeId ? { placeId: place.placeId } : {}),
    ...(place.eLoc ? { eLoc: place.eLoc } : {}),
    exposure: 'unknown',
  }
}

/** Identity only, from a provider hit whose coordinates were resolved by the
 *  caller. Used by the map rails, which keep the pinned coordinates separate. */
export function persistedPlaceFromHit(hit: PlaceHit): PersistedPlaceIdentity | undefined {
  const source = hit.source
  const placeId = cleanKey(hit.placeId)
  const eLoc = cleanKey(hit.eLoc)
  if (!source && !placeId && !eLoc) return undefined
  return { ...(source ? { source } : {}), ...(placeId ? { placeId } : {}), ...(eLoc ? { eLoc } : {}), exposure: 'unknown' }
}

/** Read one JSONB value defensively: a malformed historical row cannot make
 *  the identity a lie or crash hydration. */export function persistedPlaceFromJson(value: unknown): PersistedPlaceIdentity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const allowed = new Set(['source', 'placeId', 'eLoc', 'exposure'])
  if (Object.keys(row).some(k => !allowed.has(k))) return undefined
  if (row.exposure !== 'unknown') return undefined
  if (row.source !== undefined && !isPlaceProvider(row.source)) return undefined
  for (const key of ['placeId', 'eLoc'] as const) {
    if (row[key] !== undefined && (typeof row[key] !== 'string' || !row[key].trim())) return undefined
  }
  const source = row.source as PlaceProvider | undefined
  const placeId = cleanKey(row.placeId)
  const eLoc = cleanKey(row.eLoc)
  return {
    ...(source ? { source } : {}),
    ...(placeId ? { placeId } : {}),
    ...(eLoc ? { eLoc } : {}),
    exposure: 'unknown',
  }
}
