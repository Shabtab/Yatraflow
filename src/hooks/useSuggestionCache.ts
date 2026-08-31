// ============ Trip-scoped suggestion cache ============
// Persists suggestion results across tab switches in TripWorkspace.
// Hydration never refetches — only explicit user actions (↻ Refresh, the
// detour-scope slider, 📍 Suggest) re-run the expensive corridor searches.

import { useCallback, useState } from 'react'
import type { SegmentHit } from '../lib/ridePlan'

export interface SuggestionCache {
  map: { segments: SegmentHit[]; anchorsHash: string; scopeKm: number; ts: number } | null
  /** per-day ride-plan halt suggestions (Timeline "Suggest halt spots") */
  halts: Record<number, { segments: SegmentHit[]; ts: number }>
}

const CACHE_TTL_MS = 1000 * 60 * 60 * 4 // 4 hours

function cacheKey(tripId: string) {
  return `yatraflow_suggestions_${tripId}`
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

  const setHaltCache = useCallback((dayIndex: number, segments: SegmentHit[]) => {
    setCache(prev => {
      const next: SuggestionCache = {
        ...prev,
        halts: { ...prev.halts, [dayIndex]: { segments, ts: Date.now() } },
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

  return { cache, setMapCache, setHaltCache, clearMap }
}
