// ============ tripThumb — cover images for trip cards ============
// Per product decision a trip's cover should prefer a popular photo of the
// destination. We resolve a place name to its Wikipedia lead image and cache
// the verdict (hit OR miss) in localStorage so a "no photo" result doesn't
// become permanent, while still avoiding a refetch storm on every render.
//
// Two layers:
//   1. `coverImageUrl` on the Trip/PublishedItinerary — the OWNER's explicit
//      choice (persisted, carried over on fork/publish). Always wins.
//   2. The Wikipedia auto-image below — the default when no explicit cover is
//      set. We try the REST summary endpoint first (it returns the lead image
//      for almost every place) and fall back to the pageimages API, then walk
//      an ordered list of candidate queries (last destination → other stops →
//      start location) so a single miss doesn't blank the card.
import type { Trip } from '../data/types'

const CACHE_KEY = 'yatraflow_trip_thumbs'
// A "no photo" verdict stays cached for a week, then we retry (a place may
// later get a lead image, or the API may recover).
const NEG_TTL_MS = 7 * 24 * 60 * 60 * 1000

type CacheEntry = { u?: string; ts?: number }
type CacheMap = Record<string, CacheEntry>

// ---------- localStorage guards (node tests have none) ----------
function readRaw(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(CACHE_KEY) : null
  } catch {
    return null
  }
}
function writeRaw(json: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CACHE_KEY, json)
  } catch {
    /* storage full / unavailable — covers are best-effort */
  }
}

// ---------- query picking ----------
/** Which place name to image-search for first. The card advertises start → last,
 *  so the headline destination (the final stop) is the most representative. */
export function pickTripQuery(trip: {
  name: string
  startLocation?: string
  destinations?: string[]
}): string {
  const dests = trip.destinations
  if (Array.isArray(dests) && dests.length) {
    const last = dests[dests.length - 1]
    if (typeof last === 'string' && last.trim()) return last.trim()
  }
  const start = (trip.startLocation ?? '').trim()
  if (start) return start
  return (trip.name ?? '').trim()
}

/**
 * Ordered list of candidate queries to try when fetching the auto cover.
 * Later entries are fallback positions; the first one that resolves to a
 * Wikipedia lead image wins. The headline destination is preferred (it best
 * matches the card caption "start → last stop"), then earlier stops in
 * itinerary order, then the start city, then the trip name itself.
 */
export function pickTripQueryCandidates(trip: {
  name: string
  startLocation?: string
  destinations?: string[]
}): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s?: string | null) => {
    const v = (s ?? '').trim()
    if (!v) return
    const k = v.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push(v)
  }
  const dests = Array.isArray(trip.destinations) ? trip.destinations : []
  // Headline (last) destination first.
  if (dests.length) push(dests[dests.length - 1])
  // Then earlier stops, in reverse order so the next-most-recent is next.
  for (let i = dests.length - 2; i >= 0; i--) push(dests[i])
  // Then the start city.
  push(trip.startLocation)
  // Then the trip name itself as a last resort (often contains a place name).
  push(trip.name)
  return out
}

// ---------- cache parsing (defensive) ----------
/** Parse the raw cache string, keeping only well-formed positive/negative
 *  entries and dropping anything malformed (regression-proof). */
export function parseThumbCache(raw: string | null): CacheMap {
  if (!raw) return {}
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const out: CacheMap = {}
  for (const [k, v] of Object.entries(obj)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const e = v as CacheEntry
    if (typeof e.u === 'string') out[k] = { u: e.u }
    else if (typeof e.ts === 'number') out[k] = { ts: e.ts }
  }
  return out
}

// ---------- Wikipedia response extraction ----------
/** Pull the best lead-image URL out of a Wikipedia REST `summary` response. */
export function extractRestThumbUrl(data: unknown): string | null {
  const d = data as { thumbnail?: { source?: string }; originalimage?: { source?: string } }
  if (d?.originalimage?.source) return d.originalimage.source
  if (d?.thumbnail?.source) return d.thumbnail.source
  return null
}

/** Pull the best lead-image URL out of a Wikipedia `query.pages` response.
 *  Prefers the page whose title matches the query exactly (case-insensitive);
 *  falls back to the first page that actually has a thumbnail, skipping
 *  thumbnail-less pages (e.g. disambiguation stubs). */
export function extractThumbUrl(data: unknown, query: string): string | null {
  const d = data as { query?: { pages?: Record<string, { title?: string; thumbnail?: { source?: string } }> } }
  const pages = d?.query?.pages
  if (!pages) return null
  const list = Object.values(pages)
  if (!list.length) return null
  const q = query.trim().toLowerCase()
  const exact = list.find(p => !!p?.title && p.title.trim().toLowerCase() === q && !!p.thumbnail?.source)
  if (exact?.thumbnail?.source) return exact.thumbnail.source
  const any = list.find(p => !!p?.thumbnail?.source)
  return any?.thumbnail?.source ?? null
}

// ---------- cache read/write ----------
export function getCachedThumb(query: string): { url: string | null; stale: boolean } | null {
  const map = parseThumbCache(readRaw())
  const entry = map[query]
  if (!entry) return null
  if (typeof entry.u === 'string') return { url: entry.u, stale: false }
  const ts = entry.ts ?? 0
  return { url: null, stale: Date.now() - ts > NEG_TTL_MS }
}

export function setCachedThumb(query: string, url: string | null): void {
  let map: CacheMap = {}
  try {
    map = parseThumbCache(readRaw())
  } catch {
    map = {}
  }
  if (url) map[query] = { u: url }
  else map[query] = { ts: Date.now() }
  try {
    writeRaw(JSON.stringify(map))
  } catch {
    /* no-op: best-effort cache */
  }
}

// ---------- network fetch (runtime only) ----------
/** Try the REST summary endpoint for a single query. Returns the lead image
 *  URL or null. Never throws. */
async function tryRestSummary(query: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const data = await res.json()
  return extractRestThumbUrl(data)
}

/** Try the legacy pageimages API for a single query. Returns the lead image
 *  URL or null. Never throws. */
async function tryPageImages(query: string): Promise<string | null> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages` +
    `&piprop=original|thumbnail&pithumbsize=800&titles=${encodeURIComponent(query)}` +
    `&format=json&origin=*`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  return extractThumbUrl(data, query)
}

/** Fetch a popular image for a place name from Wikipedia, using the cache.
 *  Tries the REST summary first (much higher hit rate for lead images), then
 *  the pageimages API. Returns null when nothing resolves — callers fall back
 *  to the trip emoji. Never throws. */
export async function fetchTripThumbUrl(query: string): Promise<string | null> {
  const q = query.trim()
  if (!q) return null
  const cached = getCachedThumb(q)
  if (cached && !cached.stale) return cached.url
  try {
    const rest = await tryRestSummary(q)
    if (rest) { setCachedThumb(q, rest); return rest }
    const legacy = await tryPageImages(q)
    setCachedThumb(q, legacy)
    return legacy
  } catch {
    setCachedThumb(q, null)
    return null
  }
}

/** Try each candidate query in order; return the first lead image that
 *  resolves. Each candidate uses the same per-query cache as `fetchTripThumbUrl`,
 *  so a previously-resolved entry short-circuits and a previously-missed entry
 *  is skipped without a refetch (until its negative cache expires). */
export async function fetchFirstAvailableThumb(queries: string[]): Promise<string | null> {
  for (const raw of queries) {
    const q = (raw ?? '').trim()
    if (!q) continue
    const url = await fetchTripThumbUrl(q)
    if (url) return url
  }
  return null
}

/** Convenience: image for a trip's headline destination (used by cards). */
export function pickThumbQuery(trip: Trip): string {
  return pickTripQuery(trip)
}
