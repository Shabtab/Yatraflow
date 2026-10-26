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

import manifestJson from '../assets/art/manifest.json'
import { placeArtFor } from './placeArt'

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

// The manifest is the only source of art ids, so this map's key set is exactly
// the declared ids. A Map also keeps the lookup off the prototype chain, so a
// name such as "constructor" finds nothing instead of inheriting Object.
const ENTRIES_BY_ID = new Map(Object.entries(ART_MANIFEST.ids))

/** The user's own cover, or a generated image id, or null for the SVG floor. */
export type CoverChoice = { kind: 'user'; url: string } | { kind: 'generated'; id: string }

export interface CoverInput {
  /** The cover photo the user chose. Empty or missing means no user cover. */
  userCover?: string | null
  region: ArtRegion
  /** Stable seed, such as a trip id. */
  seed: string
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
