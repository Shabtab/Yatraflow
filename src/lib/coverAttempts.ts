// ============ Cover candidates — the finite image chain ============
// A cover plan names the images that honestly fit, in the plan's own order. This
// module turns that plan into the exact URLs a renderer may try, and nothing
// else. Pure: no React, no network, no clock.
//
// Three rules, and each one exists because its absence shipped a bug:
//   1. A scene with no bundled file is SKIPPED, never tried. The build's glob is
//      the only source of truth for what exists, so a manifest entry whose files
//      were never generated costs the chain nothing.
//   2. A scene is tried in AVIF first and in WebP second, as two separate
//      candidates. A browser that cannot decode AVIF, or a network that refuses
//      the file, then costs one step inside the scene instead of the scene's
//      whole slot. RegionArt could not do this: it rejected an id with no AVIF
//      file outright, so a WebP-only scene never painted.
//   3. Every candidate carries a distinct URL. The chain is finite, its order is
//      a pure function of the plan, and a renderer that walks it once cannot
//      loop.

import { artUrl, srcsetFor, type ArtFormat } from './artUrls'
import { artEntryFor, avifWidthsFor, type ArtManifest, ART_MANIFEST, type CoverPlan } from './regionArt'

/** One image a renderer may put in the slot. */
export type CoverAttempt =
  | { kind: 'user'; url: string }
  | {
    kind: 'scene'
    /** The manifest id this candidate belongs to. */
    id: string
    format: ArtFormat
    /** The `src` fallback, for a browser that ignores the srcset. */
    src: string
    /** The responsive candidates, already filtered to the files that exist. */
    srcSet: string
  }

/**
 * The candidates a plan may offer, in the plan's order.
 *
 * The traveller's own upload is a single candidate: it is their choice, and a
 * generated scene behind it would be a claim they did not make. Every scene
 * contributes an AVIF candidate then a WebP candidate, and only for the formats
 * the build actually holds.
 */
export function coverAttemptsFor(plan: CoverPlan, manifest: ArtManifest = ART_MANIFEST): CoverAttempt[] {
  const attempts: CoverAttempt[] = []
  const seenUrls = new Set<string>()
  const push = (attempt: CoverAttempt) => {
    const url = attempt.kind === 'user' ? attempt.url : attempt.src
    if (!url || seenUrls.has(url)) return
    seenUrls.add(url)
    attempts.push(attempt)
  }

  for (const candidate of plan.candidates) {
    if (candidate.kind === 'user') {
      push({ kind: 'user', url: candidate.url })
      continue
    }
    const entry = artEntryFor(candidate.id, manifest)
    if (!entry) continue

    const widths = avifWidthsFor(candidate.id, manifest)
    const avifSrcSet = srcsetFor(candidate.id, widths, 'avif')
    if (avifSrcSet) {
      const largest = [...widths].reverse().map(width => artUrl(candidate.id, width, 'avif')).find(Boolean)
      if (largest) push({ kind: 'scene', id: candidate.id, format: 'avif', src: largest, srcSet: avifSrcSet })
    }

    const webp = artUrl(candidate.id, entry.webp, 'webp')
    if (webp) push({ kind: 'scene', id: candidate.id, format: 'webp', src: webp, srcSet: `${webp} ${entry.webp}w` })
  }

  return attempts
}

/**
 * A stable key for a plan: its candidates and its emoji.
 *
 * A renderer resets its failure memory when this key changes, so switching to
 * another trip — or clearing an upload — starts from the first candidate
 * again instead of inheriting a verdict about a different plan. The key is
 * built from the plan's own content, so two renders of one plan agree and no
 * render-time identity is involved.
 */
export function coverPlanKey(plan: CoverPlan): string {
  const parts = plan.candidates.map(candidate => (
    candidate.kind === 'user' ? `u:${candidate.url}` : `g:${candidate.id}`
  ))
  return `${plan.fallbackEmoji}|${parts.join('|')}`
}
