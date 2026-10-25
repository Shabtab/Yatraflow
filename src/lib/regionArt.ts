// Picks which generated illustration a card shows. Pure logic, no React.
//
// The manifest (src/assets/art/manifest.json) lists the ids for each region.
// A seed (the trip id, the publication id or a place name) picks one id from
// the list with FNV-1a, so the same seed always shows the same image.
//
// Fallback chain for coverFor(): user cover, then the generated region image,
// then the generated road or city image, then null. A null result means the
// caller paints its inline SVG motif.

import manifestJson from '../assets/art/manifest.json'

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
 * Order: user cover, region variant, road or city fallback, then null (SVG).
 */
export function coverFor(input: CoverInput, manifest: ArtManifest = ART_MANIFEST): CoverChoice | null {
  const userUrl = input.userCover?.trim()
  if (userUrl) return { kind: 'user', url: userUrl }

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

/** Vertical focal point (percent) for an id at a crop ratio. Falls back to 50 for unknown ids. */
export function focalYFor(id: string, ratio: string, manifest: ArtManifest = ART_MANIFEST): number {
  const entry = manifest.ids[id]
  if (!entry) return 50
  return entry.focalY[ratio] ?? entry.focalY.default
}
