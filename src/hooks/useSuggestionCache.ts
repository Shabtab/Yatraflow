// ============ Trip-scoped suggestion cache ============
// Persists suggestion results across tab switches in TripWorkspace.
// Hydration never refetches — only explicit user actions (↻ Refresh, the
// detour-scope slider, 📍 Suggest) re-run the expensive corridor searches.

import { useCallback, useMemo, useState } from 'react'
import type { SegmentHit, HaltPlanItem } from '../lib/ridePlan'

export interface SuggestionCache {
  map: { segments: SegmentHit[]; anchorsHash: string; scopeKm: number; ts: number } | null
  /** per-day manual halt planner: the user's {km, minutes, purpose} list + best real spots */
  halts: Record<number, { segments: SegmentHit[]; plan: HaltPlanItem[]; ts: number }>
}

const CACHE_TTL_MS = 1000 * 60 * 60 * 4 // 4 hours
/**
 * Cache schema/provider version. Bumped with the 2026-09-07 Google-only
 * directive (Wikipedia/Mappls results must not survive the provider switch) —
 * a bump invalidates every previously persisted cache in one shot. Bumped
 * again the same day: Google hits now carry real categories (was: purpose
 * strings), so cached 'meal'/'fuel'/'overnight' categories are junk.
 */
const CACHE_VERSION = 3

/**
 * A cached map plan is reusable only when the detour scope AND the anchor
 * set match: editing stops moves anchors, so a scope-only check serves
 * stale suggestions for the old route.
 */
export function isMapCacheFresh(
  cached: SuggestionCache['map'],
  scopeKm: number,
  anchorsHash: string,
): boolean {
  return !!cached && cached.scopeKm === scopeKm && cached.anchorsHash === anchorsHash
}

function cacheKey(tripId: string) {
  return `yatraflow_suggestions_v${CACHE_VERSION}_${tripId}`
}

function load(tripId: string): SuggestionCache {
  try {
    const raw = localStorage.getItem(cacheKey(tripId))
    if (!raw) return { map: null, halts: {} }
    const parsed = JSON.parse(raw) as Partial<SuggestionCache>
    const now = Date.now()
    // evict stale entries on load
    const halts: SuggestionCache['halts'] = {}
    for (const [k, v] of Object.entries(parsed.halts ?? {})) {
      if (now - v.ts < CACHE_TTL_MS) halts[Number(k)] = v
    }
    const map = parsed.map && (now - parsed.map.ts < CACHE_TTL_MS) ? parsed.map : null
    return { map, halts }
  } catch {
    return { map: null, halts: {} }
  }
}

function save(tripId: string, cache: SuggestionCache) {
  try {
    localStorage.setItem(cacheKey(tripId), JSON.stringify(cache))
  } catch { /* quota or private mode — silently drop */ }
}

export function useSuggestionCache(tripId: string) {
  const [cache, setCache] = useState<SuggestionCache>(() => load(tripId))

  const setMapCache = useCallback((segments: SegmentHit[], anchorsHash: string, scopeKm: number) => {
    setCache(prev => {
      const next: SuggestionCache = {
        ...prev,
        map: { segments, anchorsHash, scopeKm, ts: Date.now() },
      }
      save(tripId, next)
      return next
    })
  }, [tripId])

  const setHaltCache = useCallback((dayIndex: number, segments: SegmentHit[], plan: HaltPlanItem[]) => {
    setCache(prev => {
      const next: SuggestionCache = {
        ...prev,
        halts: { ...prev.halts, [dayIndex]: { segments, plan, ts: Date.now() } },
      }
      save(tripId, next)
      return next
    })
  }, [tripId])

  const clearMap = useCallback(() => {
    setCache(prev => {
      const next: SuggestionCache = { ...prev, map: null }
      save(tripId, next)
      return next
    })
  }, [tripId])

  // Memoized so consumers (TimelineTab → memoized DaySection, MapTab) can take
  // this object as a prop without re-rendering on every parent render — the
  // reference only changes when the cache contents (or tripId) actually do.
  return useMemo(() => ({ cache, setMapCache, setHaltCache, clearMap }),
    [cache, setMapCache, setHaltCache, clearMap])
}
