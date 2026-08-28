// ============ Place search ============
// Sources merged into one result list:
//  - Mappls autosuggest (when VITE_MAPPLS_KEY is set) → India's best place/POI
//    coverage. Results carry an eLoc but no coordinates; they are resolved on
//    pick (see resolveHitCoords) because Mappls' free tier doesn't return coords.
//  - Open-Meteo geocoding → cities/towns/villages (strong on populated places)
//  - Wikipedia search API → POIs (waterfalls, forts, temples…) with coords,
//    descriptions and thumbnails. Verified CORS-friendly via origin=*.
export interface PlaceHit {
  id: number | string
  name: string
  latitude: number
  longitude: number
  admin1?: string          // state/region (populated places)
  country?: string
  country_code?: string
  kind: 'place' | 'poi'
  description?: string     // e.g. "Waterfall in Athirapilly, India"
  thumb?: string           // small image URL (Wikipedia only)
  /** Mappls place id — present when the hit came from Mappls (coords pending) */
  eLoc?: string
}

const MAPPLS_KEY = ((import.meta.env.VITE_MAPPLS_KEY as string | undefined) ?? '').trim()
export const mapplsEnabled = (): boolean => MAPPLS_KEY.length > 0

const DEBOUNCE_MS = 280

async function searchOpenMeteo(q: string, indiaOnly: boolean, count: number): Promise<PlaceHit[]> {
  const cc = indiaOnly ? '&countryCode=IN' : ''
  const res = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${count}&language=en&format=json${cc}`,
  )
  const data = await res.json()
  return (data.results ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    name: r.name as string,
    latitude: r.latitude as number,
    longitude: r.longitude as number,
    admin1: r.admin1 as string | undefined,
    country: r.country as string | undefined,
    country_code: r.country_code as string | undefined,
    kind: 'place' as const,
  }))
}

interface WikiPage {
  pageid: number
  title: string
  description?: string
  coordinates?: { lat: number; lon: number }[]
  thumbnail?: { source: string }
}

async function searchWikipediaPois(q: string, count: number): Promise<PlaceHit[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: q,
    gsrlimit: String(count),
    gsrnamespace: '0',
    prop: 'coordinates|pageimages|description',
    format: 'json',
    origin: '*',
  })
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`)
  const data = await res.json()
  const pages: Record<string, WikiPage> = data.query?.pages ?? {}
  return Object.values(pages)
    .filter(p => p.coordinates?.[0]) // only geo-located articles are useful on a map
    .map(p => ({
      id: `wiki_${p.pageid}`,
      name: p.title,
      latitude: p.coordinates![0].lat,
      longitude: p.coordinates![0].lon,
      country: undefined,
      kind: 'poi' as const,
      description: p.description,
      thumb: p.thumbnail?.source,
    }))
}

/**
 * Mappls autosuggest — India-first place/POI search. Results have an eLoc but
 * no coordinates (a premium parameter); LocationInput resolves them on pick.
 */
async function searchMappls(q: string, count: number): Promise<PlaceHit[]> {
  const res = await fetch(
    `https://search.mappls.com/search/places/autosuggest/json?query=${encodeURIComponent(q)}&access_token=${MAPPLS_KEY}`,
    { signal: AbortSignal.timeout(6000) },
  )
  if (!res.ok) return []
  const data = await res.json()
  return ((data.suggestedLocations ?? []) as Record<string, string>[])
    .filter(l => l.eLoc && l.placeName)
    .slice(0, count)
    .map(l => {
      const isPoi = (l.type ?? '').toUpperCase() === 'POI'
      // last comma segment of the address is usually the state — decent admin label
      const segs = (l.placeAddress ?? '').split(',').map(s => s.trim()).filter(Boolean)
      return {
        id: `mappls_${l.eLoc}`,
        name: l.placeName,
        latitude: 0, longitude: 0,   // resolved on pick via resolveHitCoords
        admin1: segs[segs.length - 1],
        kind: (isPoi ? 'poi' : 'place') as PlaceHit['kind'],
        description: l.placeAddress || undefined,
        eLoc: l.eLoc,
      }
    })
}

/** true when a hit already carries usable coordinates */
function hasCoords(h: PlaceHit): boolean {
  return Number.isFinite(h.latitude) && Number.isFinite(h.longitude) && (h.latitude !== 0 || h.longitude !== 0)
}

/**
 * Resolve coordinates for a picked hit. Mappls' free key doesn't expose
 * coordinates, so eLoc hits fall back to keyless OSM Nominatim on the
 * place's name + address. Returns the original hit untouched on any failure —
 * callers treat a miss as "manual entry" exactly like an unmatched text.
 */
export async function resolveHitCoords(hit: PlaceHit): Promise<PlaceHit> {
  if (hasCoords(hit)) return hit
  if (!hit.eLoc) return hit
  try {
    const q = [hit.name, hit.description].filter(Boolean).join(', ')
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=in`,
      { signal: AbortSignal.timeout(6000) },
    )
    const data = (await res.json()) as { lat: string; lon: string }[]
    const top = data[0]
    if (top && top.lat && top.lon) {
      return { ...hit, latitude: Number(top.lat), longitude: Number(top.lon) }
    }
  } catch { /* fall through — pick still works as manual entry */ }
  return hit
}

/**
 * Search cities AND points of interest at once.
 * Mappls suggestions first (best India coverage, when a key is configured),
 * then populated places, then POIs — deduped by name.
 */
export async function searchPlaces(q: string, opts?: { indiaOnly?: boolean }): Promise<PlaceHit[]> {
  const indiaOnly = opts?.indiaOnly ?? true
  const needle = q.trim()
  if (needle.length < 2) return []
  const [mappls, places, pois] = await Promise.all([
    mapplsEnabled() ? searchMappls(needle, 4).catch(() => [] as PlaceHit[]) : Promise.resolve([] as PlaceHit[]),
    searchOpenMeteo(needle, indiaOnly, 5).catch(() => [] as PlaceHit[]),
    searchWikipediaPois(needle, 5).catch(() => [] as PlaceHit[]),
  ])
  const seen = new Set<string>()
  const out: PlaceHit[] = []
  for (const hit of [...mappls, ...places, ...pois]) {
    const key = hit.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
  }
  return out.slice(0, 8)
}

export { DEBOUNCE_MS }

/**
 * Nearby POIs around a coordinate via Wikipedia geosearch — used to suggest
 * potential stops on the Map tab. Free, keyless, CORS-enabled.
 */
export async function searchNearbyPois(lat: number, lng: number, radiusM = 10000, count = 10): Promise<PlaceHit[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'geosearch',
    ggscoord: `${lat}|${lng}`,
    ggsradius: String(Math.min(radiusM, 10000)),
    ggslimit: String(count),
    prop: 'coordinates|pageimages|description',
    format: 'json',
    origin: '*',
  })
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`)
  const data = await res.json()
  const pages: Record<string, WikiPage> = data.query?.pages ?? {}
  return Object.values(pages)
    .filter(p => p.coordinates?.[0])
    .map(p => ({
      id: `wiki_${p.pageid}`,
      name: p.title,
      latitude: p.coordinates![0].lat,
      longitude: p.coordinates![0].lon,
      kind: 'poi' as const,
      description: p.description,
      thumb: p.thumbnail?.source,
    }))
}

// ============ Opening hours from OpenStreetMap ============
// Google Places would charge per lookup and needs a billing account, so hours
// come from OSM's free Overpass API instead (ODbL — attribution in-app not
// required for this use, but we credit it in the UI hint anyway).
// Mirrors tried in order; the public overpass-api.de is often saturated.

const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

export interface OpeningHours {
  openTime: string   // "HH:MM"
  closeTime: string  // "HH:MM"
}

/** Parse the common cases of OSM opening_hours into a single open/close span. */
export function parseOpeningHours(oh: string): OpeningHours | null {
  if (!oh) return null
  if (/^24\/7$/.test(oh.trim())) return { openTime: '00:00', closeTime: '23:59' }
  // take the first time range of the first weekday rule: "Mo-Sa 10:00-16:00", "10:00-12:00,15:00-17:00; Fr off"
  const m = oh.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/)
  if (!m) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return { openTime: `${pad(+m[1])}:${m[2]}`, closeTime: `${pad(+m[3])}:${m[4]}` }
}

/**
 * Look up opening hours for a place by name near its coordinates.
 * Returns null when nothing confident was found (caller keeps manual entry).
 */
export async function fetchOpeningHours(name: string, lat: number, lng: number): Promise<OpeningHours | null> {
  const clean = name.replace(/\s*,.*$/, '').trim() // strip ", Kerala" suffixes for matching
  if (clean.length < 3) return null
  const query =
    `[out:json][timeout:20];` +
    `(nwr(around:4000,${lat},${lng})["opening_hours"]["name"~"${clean.replace(/[\\"]/g, '')}",i];);` +
    `out center tags 5;`
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(25000),
      })
      if (!res.ok) continue
      const data = await res.json()
      const el = (data.elements ?? []).find((e: { tags?: Record<string, string> }) =>
        e.tags?.opening_hours && e.tags.name?.toLowerCase().includes(clean.toLowerCase().slice(0, 8)))
      const parsed = el ? parseOpeningHours(el.tags!.opening_hours) : null
      if (parsed || el) return parsed
      // element matched but unparseable → stop trying further endpoints
      return null
    } catch {
      /* try next mirror */
    }
  }
  return null
}
