// ============ My-Trips card thumbnails (Wikipedia lead images) ============
// Trip cards show a 16:7 banner; when a real photo is available it replaces the
// cover-emoji gradient. Images come from English Wikipedia's lead-image API —
// keyless, CORS-open (`origin=*`), same free-stack philosophy as geocoding.
// Same design rules as uiPrefs: pure parsing lives here so it is unit-testable
// in node, the localStorage wrapper degrades to a no-op when storage is
// missing/private, and this cache is view decoration — NEVER trip data.
// Persistence is the contract: the cache is only written after a resolved
// fetch (positive url, or a stamped negative), so a My-Trips refresh never
// re-fetches entries it already knows about (see AGENTS.md §4 suggestion rule).

import type { Trip } from '../data/types'

const THUMB_CACHE_KEY = 'yatraflow_trip_thumbs'
/** A negative (no-image) result is retried after a week — articles get photos. */
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface ThumbEntry {
  /** lead-image URL (upload.wikimedia.org); absent = "no image found" */
  u?: string
  /** when the entry was written (epoch ms) — only meaningful for negatives */
  ts?: number
}

/**
 * The trip's headline place, most-relevant-first: the last destination (the
 * card itself advertises "start → last"), then the start location, then the
 * trip name (covers single-destination trips whose name IS the place).
 */
export function pickTripQuery(trip: Pick<Trip, 'name' | 'startLocation' | 'destinations'>): string {
  const last = trip.destinations?.[trip.destinations.length - 1]?.trim()
  if (last) return last
  const start = trip.startLocation?.trim()
  if (start) return start
  return trip.name.trim()
}

/** Parse a stored thumb cache. Keeps only well-formed entries; junk is dropped. */
export function parseThumbCache(raw: string | null | undefined): Record<string, ThumbEntry> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, ThumbEntry> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) continue
      const e = v as Record<string, unknown>
      if (typeof e.u === 'string' && e.u) out[k] = { u: e.u }
      else if (typeof e.ts === 'number' && Number.isFinite(e.ts)) out[k] = { ts: e.ts }
    }
    return out
  } catch {
    return {}
  }
}

export interface CachedThumb {
  /** image URL when a positive entry is cached; null for negative/missing */
  url: string | null
  /** true when a negative entry aged past NEGATIVE_TTL_MS — worth refetching */
  stale: boolean
}

/** Read one trip's cached thumb; unknown trip = null (fetch allowed). */
export function getCachedThumb(tripId: string): CachedThumb | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const entry = parseThumbCache(localStorage.getItem(THUMB_CACHE_KEY))[tripId]
    if (!entry) return null
    if (entry.u) return { url: entry.u, stale: false }
    const ts = entry.ts ?? 0
    return { url: null, stale: Date.now() - ts > NEGATIVE_TTL_MS }
  } catch {
    return null
  }
}

/** Persist a resolved lookup. url=null writes a stamped negative. Best-effort. */
export function setCachedThumb(tripId: string, url: string | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    const map = parseThumbCache(localStorage.getItem(THUMB_CACHE_KEY))
    map[tripId] = url ? { u: url } : { ts: Date.now() }
    localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(map))
  } catch {
    // Private mode / quota exceeded — persistence is best-effort by design.
  }
}

/**
 * Pull the first usable lead-image URL out of a Wikipedia `generator=search`
 * response (`prop=pageimages`). Prefers a page whose title matches the query
 * exactly (case-insensitive — "Leh" beats "Leh district"), else the first
 * page that has a thumbnail at all.
 */
export function extractThumbUrl(data: unknown, query: string): string | null {
  const pages = (data as { query?: { pages?: Record<string, { title?: string; thumbnail?: { source?: string } }> } })
    ?.query?.pages
  if (!pages || typeof pages !== 'object') return null
  const q = query.trim().toLowerCase()
  let fallback: string | null = null
  for (const page of Object.values(pages)) {
    const url = page?.thumbnail?.source
    if (!url || typeof url !== 'string') continue
    if (page.title?.trim().toLowerCase() === q) return url
    fallback ??= url
  }
  return fallback
}

/** Fetch the trip's cover image from Wikipedia. Returns null when none found. */
export async function fetchTripThumbUrl(query: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '5',
    gsrnamespace: '0',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: '640',
    redirects: '1',
    format: 'json',
    origin: '*',
  })
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(6000) })
  if (!res.ok) return null
  return extractThumbUrl(await res.json(), query)
}
