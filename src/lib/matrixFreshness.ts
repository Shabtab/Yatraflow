// ============ Slot-matrix freshness (#404, lane E's half) ============
// The matrix re-derives slot suggestions with today's settings over the
// corridor scan the Map tab wrote — possibly under older settings — while
// claiming "same helper, same inputs". The gate is the Map's own published
// pair (inputs hash + scope), consumed through `isMapCacheFresh`: one hash,
// not two rival ones.
//
// The load-bearing contract (lane A publishes, lane E consumes): a missing
// pair is UNKNOWN, never stale and never fresh. The Map tab is lazy and
// conditionally mounted, so a first-visit Overview has published nothing —
// branding that "stale" would cry wolf on every first visit, and treating it
// as fresh would repeat the bug. Unknown renders the numbers QUALIFIED.
import { isMapCacheFresh } from '../hooks/useSuggestionCache'

export type MatrixFreshness = 'empty' | 'unknown' | 'stale' | 'fresh'

export function matrixFreshness(input: {
  /** Whether the corridor scan the matrix reads has any segments at all. */
  hasCorridor: boolean
  /** The cache entry the matrix reads (`suggestionCache.cache.map`). */
  mapCache: { scopeKm: number; inputsHash: string } | null
  /** The pair the Map tab published for the scan it actually wrote — null
   *  when the tab never mounted this session. */
  mapInputs: { hash: string; scopeKm: number } | null
}): MatrixFreshness {
  if (!input.hasCorridor) return 'empty'
  if (!input.mapInputs) return 'unknown'
  return isMapCacheFresh(input.mapCache, input.mapInputs.scopeKm, input.mapInputs.hash)
    ? 'fresh'
    : 'stale'
}
