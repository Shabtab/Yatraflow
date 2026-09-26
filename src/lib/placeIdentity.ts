// ============ One “already added” identity (#345) ============
// “Is this place already mine?” used to be answered five different ways in five
// places — and they disagreed. Discarding a preview left a ghost id that hid
// the place until reload; during an open preview the same hit was addable
// twice; a REJECTED stop blocked its name forever; `" Hotel Taj "` never
// matched `"Hotel Taj"`; story arcs advertised places already on the plan. This
// module is the single predicate every surface routes through.
import type { Trip } from '../data/types'

/**
 * The identity facts a place can be known by. Provider keys are the strong
 * half; names are the fallback, and the price of a name-only match is that two
 * genuinely different “Sharma Dhaba”s look like one place — which is why keys
 * win when the provider gave one.
 */
export interface PlaceIdentity {
  /** Normalized titles of planned stops. Rejected stops do NOT block: a
   *  suggestion the crew turned down must stay re-addable. */
  names: Set<string>
  /** Provider place keys (placeId / eLoc) of planned stops. */
  keys: Set<string>
  /** Hit ids added in THIS session — staged in a preview or committed. */
  added: Set<string>
  /** Hit ids dismissed in this session. */
  dismissed: Set<string>
}

export interface PlaceLike {
  id?: number | string
  name?: string
  placeId?: string
  eLoc?: string
}

/**
 * The whole normalization: trim, lowercase, collapse whitespace. Deliberately
 * NOT fuzzy — `"Hotel Taj, Mumbai"` stays a DIFFERENT name unless a place key
 * says otherwise, because punctuation is part of an address and two real
 * places can share a name.
 */
export function normalizePlaceName(name: string | undefined | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Provider keys a place is known by, strongest first; empty when it has none. */
export function placeKeysOf(p: PlaceLike): string[] {
  return [p.placeId, p.eLoc].filter((k): k is string => typeof k === 'string' && k.length > 0)
}

/** What the committed plan already contains — the stable half of the identity,
 *  rebuildable per trip and unaffected by session adds/dismissals. */
export function tripPresence(trip: Pick<Trip, 'days'>): Pick<PlaceIdentity, 'names' | 'keys'> {
  const names = new Set<string>()
  const keys = new Set<string>()
  for (const day of trip.days) {
    for (const s of day.stops) {
      if (s.status === 'rejected') continue
      const n = normalizePlaceName(s.title)
      if (n) names.add(n)
      for (const k of placeKeysOf(s)) keys.add(k)
    }
  }
  return { names, keys }
}

/** The full identity: the plan's own presence plus this session's state. */
export function placeIdentity(
  trip: Pick<Trip, 'days'>,
  addedIds?: ReadonlySet<string>,
  dismissedIds?: ReadonlySet<string>,
): PlaceIdentity {
  const { names, keys } = tripPresence(trip)
  return { names, keys, added: new Set(addedIds ?? []), dismissed: new Set(dismissedIds ?? []) }
}

/**
 * Which staged ids a closed preview must release. A staged id may stay only if
 * the plan now CONTAINS its place — so Keep leaves the id in place and a
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
 * key, then the name fallback — one identity, so a rail, a slot, an arc and a
 * pin can never disagree about the same place again.
 */
export function isAlreadyAdded(
  hit: PlaceLike | null | undefined,
  identity: PlaceIdentity | null | undefined,
): boolean {
  if (!hit || !identity) return false
  const id = hit.id != null ? String(hit.id) : ''
  if (id && identity.dismissed.has(id)) return true
  if (id && identity.added.has(id)) return true
  if (placeKeysOf(hit).some(k => identity.keys.has(k))) return true
  const name = normalizePlaceName(hit.name)
  return !!name && identity.names.has(name)
}
