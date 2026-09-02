import { useEffect, useState } from 'react'
import { fetchTripThumbUrl, fetchFirstAvailableThumb, getCachedThumb } from '../lib/tripThumb'

/**
 * Resolve the auto (Wikipedia) cover image for a place query, using the
 * localStorage cache so a result (or a "no photo" verdict) isn't refetched on
 * every render. Returns null until resolved — callers fall back to the trip
 * emoji. Never throws.
 *
 * When given a single string, the first Wikipedia lead image for that query
 * is used. When given an array, candidates are tried in order and the first
 * hit wins — useful for "last stop → other stops → start city" fallbacks so
 * a single miss doesn't blank the cover.
 */
export function useDestinationCover(query?: string | string[] | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  // Stabilize array identity so React doesn't refetch on every render.
  const key = Array.isArray(query) ? query.filter(Boolean).join('|') : (query ?? '')
  useEffect(() => {
    if (!key) { setUrl(null); return }
    let alive = true
    // Array of candidates: try each in order.
    if (Array.isArray(query)) {
      const candidates = query.filter(Boolean).map(s => s!.trim()).filter(Boolean)
      if (!candidates.length) { setUrl(null); return }
      // Short-circuit on cached hits.
      for (const c of candidates) {
        const cached = getCachedThumb(c)
        if (cached && !cached.stale && cached.url) { setUrl(cached.url); return }
      }
      fetchFirstAvailableThumb(candidates).then(u => { if (alive) setUrl(u) })
      return () => { alive = false }
    }
    // Single query.
    const q = (query as string).trim()
    if (!q) { setUrl(null); return }
    const cached = getCachedThumb(q)
    if (cached && !cached.stale) { setUrl(cached.url); return }
    fetchTripThumbUrl(q).then(u => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [key])
  return url
}
