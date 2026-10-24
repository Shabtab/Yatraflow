// ============ One "already added" identity (#345) ============
// "Is this place already mine?" used to be answered five different ways in five
// places - and they disagreed. A discarded preview left a ghost id that hid
// the place until reload; during an open preview the same hit was addable
// twice; a REJECTED stop blocked its name forever; `" Hotel Taj "` never
// matched `"Hotel Taj"`; story arcs advertised places already on the plan. This
// module is the single predicate every surface routes through.
import type { PersistedPlaceIdentity, PlaceProvider, Trip } from '../data/types'

export interface PlaceKey {
  provider?: PlaceProvider
  kind: 'placeId' | 'eLoc'
  value: string
}

export interface PlaceRecord {
  name: string
  lat: number
  lng: number
  /** The provider keys this one place is known by, so a name match can honour a
   *  key conflict instead of bypassing it (#839 R1). */
  keys: PlaceKey[]
}

/**
 * The identity facts a place can be known by. Provider keys are the strong
 * half; names are the fallback, and the price of a name-only match is that two
 * genuinely different "Sharma Dhaba"s look like one place - which is why keys
 * win when the provider gave one.
 */
export interface PlaceIdentity {
  /** Normalized names of planned stops. Rejected stops do NOT block: a
   *  suggestion the crew turned down must stay re-addable. */
  names: Set<string>
  /** Typed provider keys (placeId / eLoc) of planned stops. */
  keys: PlaceKey[]
  /** Named, placed records for proximity checks. */
  places: PlaceRecord[]
  /** Hit ids added in THIS session - staged in a preview or committed. */
  added: Set<string>
  /** Hit ids dismissed in this session. */
  dismissed: Set<string>
}

export interface PlaceLike {
  id?: number | string
  name?: string
  placeId?: string
  eLoc?: string
  /** Any provider this build can round-trip. `open-meteo` is a place engine (the
   *  free stack's city geocoder), so its hits keep their provenance instead of
   *  being downgraded to "unknown provider" (#839). */
  source?: PlaceProvider
  lat?: number
  lng?: number
}

/**
 * The whole normalization: trim, lowercase, collapse whitespace. Deliberately
 * NOT fuzzy - `"Hotel Taj, Mumbai"` stays a DIFFERENT name unless a place key
 * says otherwise, because punctuation is part of an address and two real
 * places can share a name.
 */
export function normalizePlaceName(name: string | undefined | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** A typed provider key. A provider is optional so legacy rows still match. */
export function placeKeysOf(p: PlaceLike): PlaceKey[] {
  const provider = p.source
  const out: PlaceKey[] = []
  if (typeof p.placeId === 'string' && p.placeId.length > 0) out.push({ provider, kind: 'placeId', value: p.placeId })
  if (typeof p.eLoc === 'string' && p.eLoc.length > 0) out.push({ provider, kind: 'eLoc', value: p.eLoc })
  return out
}

/** Two keys match only when their kind and value agree and no known provider conflicts. */
export function placeKeyMatches(a: PlaceKey, b: PlaceKey): boolean {
  if (a.kind !== b.kind || a.value !== b.value) return false
  return !a.provider || !b.provider || a.provider === b.provider
}

function usableCoords(a: { lat?: number; lng?: number }): a is { lat: number; lng: number } {
  return typeof a.lat === 'number' && typeof a.lng === 'number'
    && Number.isFinite(a.lat) && Number.isFinite(a.lng)
    && !(a.lat === 0 && a.lng === 0)
}

/** What the committed plan already contains - the stable half of the identity,
 *  rebuildable per trip and unaffected by session adds/dismissals. */
export function tripPresence(trip: Pick<Trip, 'days'>): Pick<PlaceIdentity, 'names' | 'keys' | 'places'> {
  const names = new Set<string>()
  const keys: PlaceKey[] = []
  const places: PlaceRecord[] = []
  for (const day of trip.days) {
    for (const s of day.stops) {
      if (s.status === 'rejected') continue
      const name = normalizePlaceName(s.title || s.locationName)
      if (name) names.add(name)
      const like: PlaceLike = {
        name, placeId: s.placeId, eLoc: s.eLoc, source: s.placeSource, lat: s.lat, lng: s.lng,
      }
      for (const key of placeKeysOf(like)) {
        if (!keys.some(k => k.kind === key.kind && k.value === key.value && k.provider === key.provider)) keys.push(key)
      }
      if (name && usableCoords(s)) places.push({ name, lat: s.lat, lng: s.lng, keys: placeKeysOf(like) })
    }
  }
  return { names, keys, places }
}

/** The full identity: the plan's own presence plus this session's state. */
export function placeIdentity(
  trip: Pick<Trip, 'days'>,
  addedIds?: ReadonlySet<string>,
  dismissedIds?: ReadonlySet<string>,
): PlaceIdentity {
  const { names, keys, places } = tripPresence(trip)
  return { names, keys, places, added: new Set(addedIds ?? []), dismissed: new Set(dismissedIds ?? []) }
}

/**
 * Which staged ids a closed preview must release. A staged id may stay only if
 * the plan now CONTAINS its place - so Keep leaves the id in place and a
 * discarded preview releases it, instead of leaving a ghost that hides the
 * place from every rail until the next reload (#345). Extracted pure so the
 * page effect is a one-liner and the rule is testable without a DOM.
 */
export function discardedStagedIds(
  staged: ReadonlyMap<string, string>,
  names: ReadonlySet<string>,
): string[] {
  const out: string[] = []
  for (const [id, name] of staged) if (!names.has(name)) out.push(id)
  return out
}

/**
 * THE predicate. Session state first (cheap and decisive), then the provider
 * key, then proximity, then the name fallback - one identity, so a rail, a
 * slot, an arc and a pin can never disagree about the same place again.
 */
export function isAlreadyAdded(
  hit: PlaceLike | null | undefined,
  identity: PlaceIdentity | null | undefined,
): boolean {
  if (!hit || !identity) return false
  const id = hit.id != null ? String(hit.id) : ''
  if (id && identity.dismissed.has(id)) return true
  if (id && identity.added.has(id)) return true
  const hitKeys = placeKeysOf(hit)
  if (hitKeys.some(hk => identity.keys.some(k => placeKeyMatches(hk, k)))) return true
  const name = normalizePlaceName(hit.name)
  if (!name) return false
  const sameName = identity.places.filter(p => p.name === name)
  if (sameName.length > 0) {
    // A same-named place whose known key conflicts with the hit's known key is a
    // different entity. The name fallback must not bypass that conflict (#839 R1).
    const conflicts = (p: PlaceRecord) =>
      hitKeys.length > 0 && p.keys.length > 0
      && !hitKeys.some(hk => p.keys.some(k => placeKeyMatches(hk, k)))
    const candidates = sameName.filter(p => !conflicts(p))
    if (candidates.length === 0) return false
    if (!usableCoords(hit)) return true
    return candidates.some(p => placeDistanceKm({ lat: hit.lat, lng: hit.lng }, p) <= 0.5)
  }
  return identity.names.has(name)
}

/** Nearest-neighbour distance in km - the same spherical formula the engine
 *  uses for its 0.5 km "same place" leg rule. */
export function placeDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export interface VisitPlaceLike extends PlaceLike {
  title?: string
  locationName?: string
  /** An ItineraryStop keeps its provider here, not in `source` (#839 R2). */
  placeSource?: PlaceProvider
  /** Identity captured beside the row, as persisted for a suggestion or a
   *  decision place. The flat fields still win when a caller supplies them. */
  place?: PersistedPlaceIdentity
}

function entityOfVisit(p: VisitPlaceLike): PlaceLike {
  return {
    ...p,
    name: p.locationName || p.title || p.name,
    placeId: p.placeId ?? p.place?.placeId,
    eLoc: p.eLoc ?? p.place?.eLoc,
    source: p.source ?? p.place?.source ?? p.placeSource,
  }
}

/** Does this pair name the same place?
 *
 *  A shared provider key is decisive. Two known but different providers conflict
 *  even when the names look alike. Without a usable pair of keys, the normalized
 *  names must match and any usable coordinates must be within 0.5 km. A legacy
 *  record with no coordinates falls back to the name alone.
 */
export function isSameEntity(a: VisitPlaceLike, b: VisitPlaceLike): boolean {
  // A raw local id is not a provider entity: two providers can both number a hit
  // "1". Provider keys decide identity, so a shared id never outranks a namespace
  // conflict (#839 R3).
  const keysA = placeKeysOf(entityOfVisit(a))
  const keysB = placeKeysOf(entityOfVisit(b))
  if (keysA.some(ka => keysB.some(kb => placeKeyMatches(ka, kb)))) return true
  if (keysA.length > 0 && keysB.length > 0) return false

  const nameA = normalizePlaceName(entityOfVisit(a).name)
  const nameB = normalizePlaceName(entityOfVisit(b).name)
  if (!nameA || nameA !== nameB) return false

  const ca = entityOfVisit(a)
  const cb = entityOfVisit(b)
  if (!usableCoords(ca) || !usableCoords(cb)) return true
  return placeDistanceKm({ lat: ca.lat, lng: ca.lng }, { lat: cb.lat, lng: cb.lng }) <= 0.5
}

/** Is this suggestion the same visit as a stop already on a day?
 *  Rejected stops do not block: the crew turned the idea down and it must stay
 *  addable.
 */
export function sameVisitPlace(a: VisitPlaceLike, b: VisitPlaceLike): boolean {
  return isSameEntity(a, b)
}
