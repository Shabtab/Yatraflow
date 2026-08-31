// ============ Trip-scoped suggestion cache ============
// Persists suggestion results across tab switches in TripWorkspace.
// Invalidated when the trip's anchor geometry changes (anchorHash mismatch).

import { useCallback, useState } from 'react'
import type { SegmentHit, RideSegment } from '../lib/ridePlan'
import type { PlaceHit } from '../lib/providers/hits'

export interface SuggestionCache {
  map: { segments: SegmentHit[]; anchorsHash: string; ts: number } | null
  days: Record<number, { nearby: PlaceHit[]; anchorHash: string; ts: number }>
}

const CACHE_TTL_MS = 1000 * 60 * 60 * 4 // 4 hours

function cacheKey(tripId: string) {
  return `yatraflow_suggestions_${tripId}`
}

function load(tripId: string): SuggestionCache {
  try {
    const raw = localStorage.getItem(cacheKey(tripId))
    if (!raw) return { map: null, days: {} }
    const parsed = JSON.parse(raw) as SuggestionCache
    const now = Date.now()
    // evict stale entries on load
    const days: SuggestionCache['days'] = {}
    for (const [k, v] of Object.entries(parsed.days ?? {})) {
      if (now - v.ts < CACHE_TTL_MS) days[Number(k)] = v
    }
    const map = parsed.map && (now - parsed.map.ts < CACHE_TTL_MS) ? parsed.map : null
    return { map, days }
  } catch {
    return { map: null, days: {} }
  }
}

function save(tripId: string, cache: SuggestionCache) {
  try {
    localStorage.setItem(cacheKey(tripId), JSON.stringify(cache))
  } catch { /* quota or private mode — silently drop */ }
}

export function useSuggestionCache(tripId: string) {
  const [cache, setCache] = useState<SuggestionCache>(() => load(tripId))

  const setMapCache = useCallback((segments: SegmentHit[], anchorsHash: string) => {
    setCache(prev => {
      const next: SuggestionCache = {
        ...prev,
        map: { segments, anchorsHash, ts: Date.now() },
      }
      save(tripId, next)
      return next
    })
  }, [tripId])

  const setDayCache = useCallback((dayIndex: number, nearby: PlaceHit[], anchorHash: string) => {
    setCache(prev => {
      const next: SuggestionCache = {
        ...prev,
        days: { ...prev.days, [dayIndex]: { nearby, anchorHash, ts: Date.now() } },
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

  const clearDay = useCallback((dayIndex: number) => {
    setCache(prev => {
      const days = { ...prev.days }
      delete days[dayIndex]
      const next: SuggestionCache = { ...prev, days }
      save(tripId, next)
      return next
    })
  }, [tripId])

  const clearAll = useCallback(() => {
    const next: SuggestionCache = { map: null, days: {} }
    save(tripId, next)
    setCache(next)
  }, [tripId])

  return { cache, setMapCache, setDayCache, clearMap, clearDay, clearAll }
}
