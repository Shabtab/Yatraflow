// ============ India place art — pure selection ============
// Which generated scene a set of destination strings earns, for the raster art
// only. No React, no clock, no network, no I/O.
//
// This layer exists because TripRegion is shared with the inline SVG motif and
// the stylesheet. Widening it to 36 jurisdictions would push raster concerns
// into planning code. So the app's seven existing regions stay exactly as they
// are, and the far wider India set is resolved here, against the manifest's
// `places` tables.
//
// Order, and nothing may reorder it:
//   1. An uploaded cover has already won before this module is reached.
//   2. An exact supported destination.
//   3. A supported state or UT representative.
//   4. A neutral road scene when the matched places span two or more states.
//   5. The neutral generic scene for anything unknown or ambiguous.
//
// Matching is on whole tokens only, never on a substring. "Goalpara" is not
// Goa and "Keralapuram" is not Kerala, which is the same rule regionFor uses.

import manifestJson from '../assets/art/manifest.json'

/** One jurisdiction: its display name, the scenes it owns, and its aliases. */
export interface StateArtEntry {
  /** Canonical display name, such as "Uttar Pradesh". */
  state: string
  /** Every scene id the jurisdiction honestly owns. One, except Goa and Meghalaya. */
  ids: string[]
  /** Extra whole-name spellings, lower case. Matched on tokens, never substrings. */
  aliases: string[]
}

/** One named destination that has a scene of its own. */
export interface DestinationArtEntry {
  /** Canonical display name, such as "Rishikesh". */
  place: string
  /** The jurisdiction that owns it. This is what the cross-state test reads. */
  state: string
  ids: string[]
  aliases: string[]
}

/** The additive part of the art manifest this layer reads. */
export interface PlaceArtTables {
  destination: Record<string, DestinationArtEntry>
  state: Record<string, StateArtEntry>
}

/**
 * What a set of destination strings resolved to, and why. `id` is the chosen
 * scene; `states` is present only on a cross-state match and names every state
 * the trip positively reaches.
 */
export type PlaceArtMatch =
  | { kind: 'destination'; id: string; place: string; seed: string }
  | { kind: 'state'; id: string; state: string; seed: string }
  | { kind: 'crossState'; id: string; states: string[]; seed: string }
  | { kind: 'generic'; id: string; seed: string }

/**
 * The two neutral scene families this layer may fall back to. Both come from the
 * manifest: `road` from its `fallbacks` table, `neutral` from its `generic`
 * region. They are passed in rather than read here so a test can supply its own
 * and so this module never has to know the manifest's section names.
 */
export interface PlaceArtFallbacks {
  /** The existing multi-place road family, used when a trip spans two states. */
  road: readonly string[]
  /** The geographically neutral scene, used for anything unknown or ambiguous. */
  neutral: readonly string[]
}

const PLACES = (manifestJson as { places?: PlaceArtTables }).places

/** The manifest's place tables, or empty tables when the manifest declares none. */
export function placeTables(): PlaceArtTables {
  return PLACES ?? { destination: {}, state: {} }
}

/** The fallback lists from an art manifest, in this module's own terms. */
export function placeFallbacksFrom(manifest: {
  fallbacks: { road: readonly string[] }
  regions: { generic: readonly string[] }
}): PlaceArtFallbacks {
  return { road: manifest.fallbacks.road, neutral: manifest.regions.generic }
}

/**
 * The tokens of one place string: split on every separator, lower case, with the
 * empty runs dropped. "Jammu & Kashmir" gives ["jammu", "kashmir"]. A digit is a
 * separator, so "Sector 17" does not become a place token.
 *
 * Combining marks are part of a token, not separators. Devanagari and the other
 * Indic scripts write a syllable as base letters plus marks that are Unicode
 * category Mn, so splitting on letters alone would break "कोच्चि" into "क","च","च"
 * and lose the name. Splitting on `\p{L}` alone is what the older region matcher
 * does; this layer must be no stricter, or an Indic-script destination would be
 * dropped instead of matched.
 */
export function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{M}]+/u)
    .filter(token => token !== '')
}

/** True when `needle` appears in `haystack` as one contiguous run of tokens. */
function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) { matched = false; break }
    }
    if (matched) return true
  }
  return false
}

/**
 * The names one entry answers to: its canonical name and its aliases, as token
 * runs. Everything is derived from the display text, so an alias list cannot
 * drift from the name it belongs to.
 */
function namesOf(canonical: string, aliases: readonly string[]): string[][] {
  return [canonical, ...aliases].map(tokensOf).filter(run => run.length > 0)
}

/**
 * The entry whose name or alias appears in the text as a whole-token run, or
 * null. The longest matching run wins, so "Jammu and Kashmir" beats a stray
 * one-word alias, and a two-word place beats its one-word neighbour.
 */
function bestMatch<T extends { aliases: string[] }>(
  entries: readonly T[],
  display: (entry: T) => string,
  tokens: readonly string[],
): T | null {
  let best: T | null = null
  let bestRun = 0
  for (const entry of entries) {
    for (const run of namesOf(display(entry), entry.aliases)) {
      if (run.length > bestRun && containsRun(tokens, run)) {
        best = entry
        bestRun = run.length
      }
    }
  }
  return best
}

/** FNV-1a 32-bit hash, the same one the manifest's id picking already uses. */
function hash(text: string): number {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

function pickFromList(ids: readonly string[], seed: string): string | null {
  if (ids.length === 0) return null
  return ids[hash(seed) % ids.length]
}

/** One stop resolved as far as the tables allow. */
interface StopMatch {
  destination: DestinationArtEntry | null
  state: StateArtEntry | null
  /** The state the stop belongs to, from either table. Null when nothing matched. */
  owner: string | null
  /** True when the name answers to two tables that disagree about the scene. */
  ambiguous: boolean
}

function matchStop(name: string, tables: PlaceArtTables): StopMatch {
  const tokens = tokensOf(name)
  const destination = bestMatch(Object.values(tables.destination), entry => entry.place, tokens)
  const state = bestMatch(Object.values(tables.state), entry => entry.state, tokens)
  // A name both tables claim is ambiguous only when they disagree about which
  // jurisdiction it belongs to. They routinely agree about the owner and differ
  // about the scene — "Rishikesh, Uttarakhand" is a destination scene and a
  // state scene for one state — and that is not a conflict, because the
  // destination is the more specific answer. A genuine conflict is the two
  // tables placing the same name in two different jurisdictions.
  const ambiguous = destination !== null && state !== null && destination.state !== state.state
  if (ambiguous) return { destination: null, state: null, owner: null, ambiguous: true }
  return {
    destination,
    state,
    owner: destination?.state ?? state?.state ?? null,
    ambiguous: false,
  }
}

/**
 * The scene a trip's destination list earns.
 *
 * A single place is taken exactly: its own destination scene, or the
 * representative scene of its state, or nothing. A multi-stop trip is labelled
 * with a state scene only when every positively matched stop agrees on one
 * state. Two or more states give the neutral road scene, because one state's
 * valley scene would be a false claim about the others.
 *
 * `seed` is the trip or publication id, so a place with two scenes keeps the
 * same one across renders.
 */
export function placeArtFor(
  destinations: readonly string[] | null | undefined,
  seed: string,
  fallbacks: PlaceArtFallbacks,
  tables: PlaceArtTables = placeTables(),
): PlaceArtMatch | null {
  const stops = (destinations ?? [])
    .map(name => String(name ?? '').trim())
    .filter(name => name !== '')
    .map(name => matchStop(name, tables))
    .filter(stop => !stop.ambiguous)

  const genericId = pickFromList(fallbacks.neutral, seed)

  // Nothing to match at all: the neutral scene. Not an error, and not a guess.
  if (stops.length === 0) return genericId ? { kind: 'generic', id: genericId, seed } : null

  const destinationStops = stops.filter(stop => stop.destination !== null)
  const owners = new Set(stops.map(stop => stop.owner).filter((owner): owner is string => owner !== null))

  // 4. Cross-state first among the multi-stop cases: positively matched stops
  // that disagree about the state must not borrow one state's scene. This is
  // checked before the destination branch so a two-state trip never takes the
  // first place's scene.
  if (owners.size >= 2) {
    const roadId = pickFromList(fallbacks.road, seed)
    if (roadId) return { kind: 'crossState', id: roadId, states: [...owners].sort(), seed }
  }

  // 2. Exact supported destination, but only when the trip names exactly one of
  // them. A trip that visits both Jaipur and Udaipur is not a Jaipur trip, so it
  // falls through to the state scene instead of being named after whichever
  // destination happened to be listed first. That also keeps the result
  // independent of stop order.
  const distinctPlaces = new Map(destinationStops.map(stop => [(stop.destination as DestinationArtEntry).place, stop.destination as DestinationArtEntry]))
  if (distinctPlaces.size === 1) {
    const chosen = [...distinctPlaces.values()][0]
    const id = pickFromList(chosen.ids, seed)
    if (id) return { kind: 'destination', id, place: chosen.place, seed }
  }

  // 3. One agreed state or UT, with no more specific place. The scene is that
  // jurisdiction's representative scene, not a claim about a pictured spot.
  if (owners.size === 1) {
    const owner = [...owners][0]
    const entry = Object.values(tables.state).find(candidate => candidate.state === owner)
    const id = pickFromList(entry?.ids ?? [], seed)
    if (id) return { kind: 'state', id, state: owner, seed }
  }

  // 5. Unknown or ambiguous.
  return genericId ? { kind: 'generic', id: genericId, seed } : null
}

/** The single scene id from a match, or null so the caller keeps its motif. */
export function placeArtIdFor(
  destinations: readonly string[] | null | undefined,
  seed: string,
  fallbacks: PlaceArtFallbacks,
  tables: PlaceArtTables = placeTables(),
): string | null {
  return placeArtFor(destinations, seed, fallbacks, tables)?.id ?? null
}
