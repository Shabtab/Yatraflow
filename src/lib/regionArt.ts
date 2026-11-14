// Picks which generated illustration a card shows. Pure logic, no React.
//
// The manifest (src/assets/art/manifest.json) lists the ids for each region.
// A seed (the trip id, the publication id or a place name) picks one id from
// the list with FNV-1a, so the same seed always shows the same image.
//
// Fallback chain for coverFor(): user cover, then the generated region image,
// then the generated road or city image, then null. A null result means the
// caller paints its inline SVG motif.
//
// Every region has at least one scene, including "generic", which holds the
// geographically neutral scene an unmatched destination shows. The road and
// city families are reached only when a region list is empty.
//
// coverPlanFor() is the same order as a LIST rather than one answer: the user
// upload first, then every scene that honestly fits, then the neutral ones.
// One renderer walks that list, so a missing or broken file moves to the next
// scene instead of blanking the slot. The emoji is the list's last resort and
// is never mixed into the images.

import manifestJson from '../assets/art/manifest.json'
import { placeArtFamilyFor, placeArtFor, placeFallbacksFrom } from './placeArt'

export type ArtRegion = 'kerala' | 'goa' | 'rajasthan' | 'coorg' | 'meghalaya' | 'kashmir' | 'generic'

export type ArtFallback = 'road' | 'city'

export interface ArtIdEntry {
  /** AVIF widths in pixels, one file each. */
  widths: number[]
  /** The width of the WebP fallback file. */
  webp: number
  /** Master aspect ratio, for example "3:2" or "1:1". */
  ratio: string
  /** Vertical focal point in percent, per crop ratio. `default` applies when a ratio has no entry. */
  focalY: Record<string, number> & { default: number }
  /**
   * Horizontal focal point in percent, per crop ratio. Optional: when it is
   * absent the slot uses 50%, the centre it has always used. Crops narrower
   * than the master, including 4:3 and square slots, can lose horizontal detail.
   */
  focalX?: Record<string, number> & { default: number }
}

export interface ArtManifest {
  version: number
  /** AVIF widths added to landscape scenes for cover-size slots. */
  coverWidths: number[]
  regions: Record<ArtRegion, string[]>
  fallbacks: Record<ArtFallback, string[]>
  vignettes: Record<string, string>
  ids: Record<string, ArtIdEntry>
  budget: {
    avifKiB: Record<string, number>
    webpKiB: number
    totalMiB: number
  }
}

export const ART_MANIFEST: ArtManifest = manifestJson

/** Every AVIF width this id has a file for, in ascending order. */
export function avifWidthsFor(id: string, manifest: ArtManifest = ART_MANIFEST): number[] {
  const entry = artEntryFor(id, manifest)
  if (!entry) return []
  return entry.ratio === '3:2' ? [...entry.widths, ...manifest.coverWidths] : entry.widths
}

// The manifest is the only source of art ids, so this map's key set is exactly
// the declared ids. A Map also keeps the lookup off the prototype chain, so a
// name such as "constructor" finds nothing instead of inheriting Object.
const ENTRIES_BY_ID = new Map(Object.entries(ART_MANIFEST.ids))

/** The user's own cover, or a generated image id, or null for the SVG floor. */
export type CoverChoice = { kind: 'user'; url: string } | { kind: 'generated'; id: string }

/**
 * The compass is the create form's default marker, not a cover choice. The form
 * previews it, and the create path stores an empty string unless the traveller
 * picks another emoji. A row written before this rule still holds the compass,
 * so every reader treats it as "no choice" and shows the trip's own artwork.
 */
export const DEFAULT_COVER_EMOJI = '🧭'

/** True only for an emoji the traveller actually chose. */
export function isChosenCoverEmoji(value: string | null | undefined): boolean {
  const emoji = value?.trim() ?? ''
  return emoji !== '' && emoji !== DEFAULT_COVER_EMOJI
}

export interface CoverInput {
  /** The cover photo the user chose. Empty or missing means no user cover. */
  userCover?: string | null
  region: ArtRegion
  /** Stable seed, such as a trip id. */
  seed: string
  /**
   * A position in a list of covers that steps through the region's scenes,
   * such as the day number on a timeline. When set, the region's own family is
   * chosen by this position instead of by hashing `seed`, so consecutive
   * entries differ whenever the region has more than one scene. Leave it unset
   * for a single cover, where hashing is the better answer.
   */
  sceneIndex?: number
  /** Number of distinct places on the trip. A trip with 2 or more uses road art, otherwise city art. */
  placeCount: number
  /**
   * The trip's own destination strings, before any collapsing. When present,
   * the India place layer gets the first say after the user cover, because it
   * knows 36 jurisdictions and 16 named destinations where `region` knows
   * seven. When absent, or when it only reaches the neutral scene, the region
   * chain below answers exactly as it always has.
   */
  destinations?: readonly string[] | null
  /**
   * The trip's start place. It is evidence only when the destination list
   * resolves to nothing: a trip whose stops name no supported place is still
   * a trip that starts somewhere. A recognised start never mixes with a
   * recognised destination, so a Goa trip that leaves from Mumbai keeps the
   * Goa scene and does not become a cross-state road cover.
   */
  startLocation?: string | null
  /**
   * The traveller's saved emoji. It is the cover's LAST resort: it shows only
   * when every image above it is unavailable, and it never paints over one.
   */
  fallbackEmoji?: string | null
}

/** FNV-1a 32-bit hash of a string. The same input always gives the same number. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function pickFromList(ids: readonly string[], seed: string): string | null {
  if (ids.length === 0) return null
  return ids[hashSeed(seed) % ids.length]
}

/** The generated id for a region, chosen by seed. Null when the region has no generated image. */
export function artIdFor(region: ArtRegion, seed: string, manifest: ArtManifest = ART_MANIFEST): string | null {
  return pickFromList(manifest.regions[region] ?? [], seed)
}

/**
 * Every scene a region owns, seeded-first.
 *
 * `artIdFor` answers with ONE id, so a cover that can try only that id falls
 * straight through to the neutral road or city family when the file is missing
 * or refused — even though the region's other scenes are bundled and would be
 * an honest answer. This returns the whole family instead, rotated so the same
 * seeded scene leads and the rest follow in their declared order. The order is
 * stable for one seed and the list is finite.
 *
 * Empty only when the region declares no ids at all.
 */
export function artFamilyFor(region: ArtRegion, seed: string, manifest: ArtManifest = ART_MANIFEST): string[] {
  const ids = manifest.regions[region] ?? []
  if (ids.length === 0) return []
  const start = hashSeed(seed) % ids.length
  return [...ids.slice(start), ...ids.slice(0, start)]
}

/** Which fallback family a trip uses when its region has no image of its own. */
export function fallbackKindFor(placeCount: number): ArtFallback {
  return placeCount >= 2 ? 'road' : 'city'
}

/**
 * Resolve the cover for one card.
 *
 * Order: user cover, the India place layer (only when it identifies a place or
 * a jurisdiction), region variant, road or city fallback, then null (SVG).
 *
 * The place layer answers "generic" for anything it does not recognise. That is
 * a real scene, but it is the same neutral scene the region chain already
 * reaches through `regionFor`, and the region chain knows the seven older
 * regions this module does not. So a generic place result does not short-circuit
 * the chain: the region step still gets its turn.
 */
export function coverFor(input: CoverInput, manifest: ArtManifest = ART_MANIFEST): CoverChoice | null {
  const userUrl = input.userCover?.trim()
  if (userUrl) return { kind: 'user', url: userUrl }

  const place = placeArtFor(input.destinations, input.seed, {
    road: manifest.fallbacks.road,
    neutral: manifest.regions.generic,
  })
  if (place && place.kind !== 'generic') return { kind: 'generated', id: place.id }

  const regionId = artIdFor(input.region, input.seed, manifest)
  if (regionId) return { kind: 'generated', id: regionId }

  const fallbackId = pickFromList(manifest.fallbacks[fallbackKindFor(input.placeCount)] ?? [], input.seed)
  if (fallbackId) return { kind: 'generated', id: fallbackId }

  return null
}

/**
 * The whole cover as an ordered list, plus the emoji that may stand in when
 * every image is gone.
 *
 * `candidates` is ordered by how specific the claim is: the traveller's own
 * upload, then the scenes that name a place the trip actually reaches, then
 * the neutral ones. A renderer walks the list and stops at the first image
 * that paints, so one missing file costs a step, not the slot. The list holds
 * no duplicates: a scene that is already a candidate is never added twice.
 *
 * `fallbackEmoji` is the saved emoji, or the compass when none is saved. It is
 * drawn only when the list is exhausted, and never over an image.
 */
export interface CoverPlan {
  candidates: readonly CoverChoice[]
  fallbackEmoji: string
}

/**
 * Resolve a cover as a whole plan.
 *
 * Order, and nothing may reorder it:
 *   1. The traveller's own upload. It wins, and it is the only thing the slot
 *      shows while it works.
 *   2. The India place layer, when it identifies a destination or a
 *      jurisdiction. Its own family follows, so a failed file has siblings.
 *   3. The seven-region matcher's family, when the place layer named nothing
 *      but the region matcher recognised the stops. Its table is the wider one,
 *      so "Gulmarg" is Kashmir here even though no place table lists it.
 *   4. The start place, but ONLY when steps 2 and 3 found nothing. A recognised
 *      destination is the stronger claim, and mixing a recognised origin into
 *      it would invent a cross-state trip that the traveller never planned.
 *   5. The rest of the region's own scenes, seeded-first, then the road or city
 *      family. A region with two bundled scenes never drops to the neutral
 *      family while a scene of its own is still available.
 *
 * The generated scenes follow the upload rather than being dropped by it: an
 * upload that cannot load is not a usable cover, and artwork beats an emoji.
 * They never paint over an upload that does load, because the renderer stops at
 * the first image that succeeds.
 *
 * A scene id is added at most once. The list is finite and its order is a pure
 * function of the input, so the same trip always gets the same plan.
 */
export function coverPlanFor(input: CoverInput, manifest: ArtManifest = ART_MANIFEST): CoverPlan {
  const emoji = input.fallbackEmoji?.trim()
  const fallbackEmoji = emoji || DEFAULT_COVER_EMOJI
  const generated: CoverChoice[] = []
  const seen = new Set<string>()
  const addScene = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    generated.push({ kind: 'generated', id })
  }

  const fallbacks = placeFallbacksFrom(manifest)
  const destinationMatch = placeArtFor(input.destinations, input.seed, fallbacks)
  const destinationFamily = placeArtFamilyFor(destinationMatch, fallbacks)
  // The place layer answers "generic" for anything it does not know. That is
  // not evidence about this trip, so it does not stop the start place from
  // being consulted.
  const placeLayerKnows = destinationMatch !== null && destinationMatch.kind !== 'generic'
  // The seven-region matcher is the WIDER table: it knows Gulmarg is Kashmir
  // and Kochi is Kerala, where the place layer knows neither. A region it names
  // is destination evidence too, so an unrelated origin cannot outrank it.
  const regionKnows = input.region !== 'generic'

  // The region's own family. With `sceneIndex` the family is rotated by that
  // position rather than hashed, so a list of covers (one per day) steps through
  // the region's scenes instead of hashing into collisions.
  const regionFamily = input.sceneIndex === undefined
    ? artFamilyFor(input.region, input.seed, manifest)
    : (() => {
        const ids = manifest.regions[input.region] ?? []
        if (ids.length === 0) return []
        const start = Math.abs(Math.trunc(input.sceneIndex)) % ids.length
        return [...ids.slice(start), ...ids.slice(0, start)]
      })()

  if (placeLayerKnows) {
    for (const id of destinationFamily) addScene(id)
  } else if (regionKnows) {
    // No place named, but the region matcher recognised the stops. Its own
    // family leads, so a refused file costs a step inside the region rather
    // than dropping to the neutral scene.
    for (const id of regionFamily) addScene(id)
  } else {
    const startMatch = placeArtFor([input.startLocation ?? ''], input.seed, fallbacks)
    const startIsEvidence = startMatch !== null && startMatch.kind !== 'generic'
    if (startIsEvidence) {
      for (const id of placeArtFamilyFor(startMatch, fallbacks)) addScene(id)
    }
  }

  // Every scene the region owns follows, seeded-first, so a place-layer match
  // inside a recognised region still has the region's own scenes behind it.
  for (const id of regionFamily) addScene(id)
  for (const id of manifest.fallbacks[fallbackKindFor(input.placeCount)] ?? []) addScene(id)

  const userUrl = input.userCover?.trim()
  const candidates: CoverChoice[] = userUrl
    ? [{ kind: 'user', url: userUrl }, ...generated]
    : generated
  return { candidates, fallbackEmoji }
}

/**
 * The generated id for a named page-level state, or null when the manifest
 * declares none. State vignettes are square masters and serve only the
 * `StateBlock` art slot; they are never used for a wide cover.
 */
export function vignetteArtFor(name: string, manifest: ArtManifest = ART_MANIFEST): string | null {
  return manifest.vignettes[name] ?? null
}

/**
 * The manifest entry for one id, or undefined when the manifest declares none.
 * Both paths read a map built from the manifest's own keys, so the lookup never
 * walks the prototype chain: "constructor" or "toString" finds nothing rather
 * than an Object member with no `widths`, and no object is indexed by a variable.
 */
export function artEntryFor(id: string, manifest: ArtManifest = ART_MANIFEST): ArtIdEntry | undefined {
  const entries = manifest === ART_MANIFEST ? ENTRIES_BY_ID : new Map(Object.entries(manifest.ids))
  return entries.get(id)
}

/** Vertical focal point (percent) for an id at a crop ratio. Falls back to 50 for unknown ids. */
export function focalYFor(id: string, ratio: string, manifest: ArtManifest = ART_MANIFEST): number {
  const entry = artEntryFor(id, manifest)
  if (!entry) return 50
  return clampPercent(entry.focalY[ratio] ?? entry.focalY.default)
}

/**
 * Horizontal focal point (percent) for an id at a crop ratio.
 *
 * 50 for every id that declares no `focalX`. That is what every slot used
 * before this key existed, so an id without the key crops exactly as it did.
 * A declared value is clamped to 0-100; a non-finite one is 50. Clamping is not
 * cosmetic: `object-position` accepts any percentage, so an unclamped 420 would
 * silently pan a scene off its subject.
 */
export function focalXFor(id: string, ratio: string, manifest: ArtManifest = ART_MANIFEST): number {
  const entry = artEntryFor(id, manifest)
  const declared = entry?.focalX?.[ratio] ?? entry?.focalX?.default
  return clampPercent(declared)
}

/** A focal percentage that is safe to put in `object-position`. */
function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50
  return Math.min(100, Math.max(0, value))
}
