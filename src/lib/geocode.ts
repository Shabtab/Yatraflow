import { haversineKm } from './geo'

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
  /** stop category hint (e.g. from a Mappls nearby category) — used by the add flows */
  category?: string
}

const MAPPLS_KEY = ((import.meta.env.VITE_MAPPLS_KEY as string | undefined) ?? '').trim()
export const mapplsEnabled = (): boolean => MAPPLS_KEY.length > 0
/**
 * Mappls has no CORS headers, so the browser can't read its responses directly.
 * We proxy through our own origin: Vite dev proxy in dev, a Vercel external
 * rewrite (`vercel.json`) in production. Both strip the `/mappls` prefix.
 */
const MAPPLS_SEARCH = '/mappls/search/places'

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
    `${MAPPLS_SEARCH}/autosuggest/json?query=${encodeURIComponent(q)}&access_token=${MAPPLS_KEY}`,
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

/** Nearby categories — a stoppage can be an attraction, a meal, a hotel or a pit stop. */
const NEARBY_CATEGORIES = [
  { kw: 'tourist attraction', label: 'Attraction', cat: 'sightseeing' },
  { kw: 'food', label: 'Food', cat: 'food' },
  { kw: 'restaurant', label: 'Restaurant', cat: 'food' },
  { kw: 'cafe', label: 'Cafe', cat: 'food' },
  { kw: 'hotel', label: 'Hotel', cat: 'hotel' },
  { kw: 'fuel', label: 'Petrol pump', cat: 'transport-hub' },
  { kw: 'atm', label: 'ATM', cat: 'shopping' },
]

// ============ Nearby stoppage points ============
// Verified coordinates only. Mappls' free-tier Nearby API lists great Indian
// POIs but returns NO coordinates — pins used to be guessed by a global name
// search, which often landed on a same-named place in a different state (the
// "odd suggestions" bug). The engines below all pin real, nearby positions:
//  1. OpenStreetMap via Overpass — restaurants, hotels, fuel, ATMs, attractions
//  2. Wikipedia geosearch — attractions, junk-filtered
//  3. Mappls Nearby — India-rich listings, kept only when a same-named place
//     is confirmed near the anchor (Photon geocoder, proximity-biased)

/** Distance in meters between a hit and the nearest route anchor. */
function distToNearest(h: PlaceHit, anchors: { lat: number; lng: number }[]): number {
  return Math.min(...anchors.map(a => haversineKm(h.latitude, h.longitude, a.lat, a.lng) * 1000))
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

function classifyOsmTags(tags: Record<string, string>): { cat: string; label: string } {
  const a = tags.amenity
  const t = tags.tourism
  if (a === 'fuel') return { cat: 'transport-hub', label: 'Petrol pump' }
  if (a === 'atm') return { cat: 'shopping', label: 'ATM' }
  if (a === 'restaurant' || a === 'fast_food' || a === 'food_court') return { cat: 'food', label: 'Restaurant' }
  if (a === 'cafe' || a === 'ice_cream') return { cat: 'food', label: 'Cafe' }
  if (t === 'museum') return { cat: 'museum', label: 'Museum' }
  if (t === 'hotel' || t === 'guest_house' || t === 'hostel' || t === 'resort' || t === 'motel') return { cat: 'hotel', label: 'Hotel' }
  if (t) return { cat: 'sightseeing', label: 'Attraction' }
  if (tags.historic) return { cat: 'sightseeing', label: 'Historic site' }
  return { cat: 'sightseeing', label: 'Place' }
}

const OVERPASS_NEARBY_SELECTORS = [
  'amenity~"^(restaurant|cafe|fast_food|food_court|ice_cream)$"',
  'tourism~"^(hotel|guest_house|hostel|resort|motel)$"',
  'amenity=fuel',
  'amenity=atm',
  'tourism~"^(attraction|viewpoint|zoo|theme_park|aquarium|museum)$"',
  'historic~"^(monument|fort|castle|memorial|archaeological_site)$"',
]

async function fetchOverpass(query: string): Promise<OverpassElement[]> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) continue
      const data = (await res.json()) as { elements?: OverpassElement[] }
      return data.elements ?? []
    } catch { /* try next mirror */ }
  }
  return []
}

async function searchNearbyOverpass(anchors: { lat: number; lng: number }[], radiusM: number, count: number): Promise<PlaceHit[]> {
  const radius = Math.min(Math.max(radiusM, 2000), 20000)
  const stmts = OVERPASS_NEARBY_SELECTORS.flatMap(sel =>
    anchors.map(a => `nwr(around:${radius},${a.lat},${a.lng})[${sel}];`)
  ).join('')
  const elements = await fetchOverpass(`[out:json][timeout:20];(${stmts});out center tags ${Math.max(60, count * 6)};`)
  const byName = new Map<string, PlaceHit>() // of same-named POIs keep only the nearest
  for (const el of elements) {
    const tags = el.tags ?? {}
    const name = tags.name?.trim()
    if (!name) continue // unnamed POIs are useless as suggestions
    const lat = el.lat ?? el.center?.lat
    const lng = el.lon ?? el.center?.lon
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const cls = classifyOsmTags(tags)
    const hit: PlaceHit = {
      id: `osm_${el.type}_${el.id}`,
      name,
      latitude: lat,
      longitude: lng,
      kind: 'poi',
      description: cls.label,
      category: cls.cat,
    }
    const prev = byName.get(hit.name.toLowerCase())
    if (!prev || distToNearest(hit, anchors) < distToNearest(prev, anchors)) {
      byName.set(hit.name.toLowerCase(), hit)
    }
  }
  return [...byName.values()]
}

// Wikipedia geosearch covers attractions well, but returns ANY geo-located
// article — villages, railway stations, districts. Drop the obvious non-places.
const WIKI_JUNK =
  /village|\btown\b|\bcity\b|municipality|settlement|hamlet|suburb|census|railway|station|district|tehsil|taluk|taluka|mandal|highway|\broad\b|bridge|canal|airport|constituency/

async function searchNearbyWikipedia(anchors: { lat: number; lng: number }[], radiusM: number, count: number): Promise<PlaceHit[]> {
  const per = Math.max(3, Math.ceil((count * 2) / anchors.length))
  const lists = await Promise.all(anchors.map(a => searchNearbyPoisWikipedia(a.lat, a.lng, radiusM, per)))
  return lists
    .flat()
    .filter(h => !WIKI_JUNK.test(h.description ?? ''))
    .map(h => ({ ...h, category: 'sightseeing' }))
}
// Mappls Nearby listings join only when a same-named place is CONFIRMED near
// the anchor via the proximity-biased Photon geocoder (OSM data). An
// unresolved hit is dropped — a guessed pin in the wrong city is worse than
// no suggestion.

const PHOTON_URL = 'https://photon.komoot.io/api'
const GENERIC_NAME_TOKENS = new Set([
  'hotel', 'hotels', 'restaurant', 'restaurants', 'cafe', 'the', 'and', 'atm', 'atms',
  'bank', 'food', 'tourist', 'home', 'stay', 'house', 'lodge', 'resort', 'dhaba',
  'bakery', 'store', 'shop', 'petrol', 'fuel', 'pump', 'station', 'sri', 'new',
  'star', 'park', 'museum', 'temple', 'church', 'masjid', 'mosque', 'indian',
  'kerala', 'taste', 'point', 'villa', 'inn', 'view',
])

function normWords(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)
}

/** do the two names share a distinctive (non-generic) token, e.g. "queens"? */
function sameDistinctiveName(a: string, b: string): boolean {
  const wb = new Set(normWords(b))
  return normWords(a).some(w => w.length >= 4 && !GENERIC_NAME_TOKENS.has(w) && wb.has(w))
}
async function resolveMapplsHitNear(hit: PlaceHit, anchor: { lat: number; lng: number }, maxM: number): Promise<PlaceHit | null> {
  if (!hit.eLoc || !hit.name) return null
  try {
    const segs = (hit.description ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const town = segs.length >= 3 ? segs[segs.length - 3] : '' // "…, Munnar, Kerala, 685565"
    const res = await fetch(
      `${PHOTON_URL}?q=${encodeURIComponent(town ? `${hit.name}, ${town}` : hit.name)}&lat=${anchor.lat}&lon=${anchor.lng}&limit=5`,
      { signal: AbortSignal.timeout(5000) },
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      features?: { geometry: { coordinates: [number, number] }; properties: { name?: string } }[]
    }
    for (const f of data.features ?? []) {
      const [lng, lat] = f.geometry.coordinates
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !f.properties.name) continue
      if (!sameDistinctiveName(hit.name, f.properties.name)) continue
      if (haversineKm(lat, lng, anchor.lat, anchor.lng) * 1000 > maxM) continue
      return { ...hit, latitude: lat, longitude: lng }
    }
  } catch { /* unresolved → dropped */ }
  return null
}

async function searchNearbyMappls(anchor: { lat: number; lng: number }, radiusM: number, count: number): Promise<PlaceHit[]> {
  if (!mapplsEnabled()) return []
  const results = await Promise.all(
    NEARBY_CATEGORIES.map(async (c) => {
      try {
        const r = await fetch(
          `${MAPPLS_SEARCH}/nearby/json?keywords=${encodeURIComponent(c.kw)}` +
          `&refLocation=${anchor.lat},${anchor.lng}&distance=${Math.min(radiusM, 10000)}&access_token=${MAPPLS_KEY}`,
          { signal: AbortSignal.timeout(6000) },
        )
        if (!r.ok) return [] as PlaceHit[]
        const d = await r.json()
        return ((d.suggestedLocations ?? []) as Record<string, string>[])
          .filter(l => l.eLoc && l.placeName)
          .slice(0, 4) // bound the per-category verification lookups
          .map(l => ({
            id: `mappls_${l.eLoc}`,
            name: l.placeName,
            latitude: 0, longitude: 0,
            admin1: (l.placeAddress ?? '').split(',').map(s => s.trim()).filter(Boolean).pop(),
            kind: 'poi' as const,
            description: l.placeAddress || undefined,
            eLoc: l.eLoc,
            category: c.cat,
          }))
      } catch {
        return [] as PlaceHit[]
      }
    }),
  )
  const seen = new Set<string>()
  const candidates: PlaceHit[] = []
  for (const h of results.flat()) {
    const key = String(h.id)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(h)
  }
  const resolved = await Promise.all(
    candidates.slice(0, Math.min(12, count + 2)).map(h =>
      resolveMapplsHitNear(h, anchor, Math.round(radiusM * 1.25) + 2000),
    ),
  )
  return resolved.filter((h): h is PlaceHit => h !== null)
}
/**
 * Nearby stoppage points around a route anchor — verified coordinates only.
 * Categories are interleaved so one dominant type (e.g. hotels) can't crowd
 * out the rest; within a category results are nearest-first.
 */
export async function searchNearbyPois(lat: number, lng: number, radiusM = 10000, count = 10): Promise<PlaceHit[]> {
  return searchNearbyPoisMulti([{ lat, lng }], radiusM, count)
}

export async function searchNearbyPoisMulti(
  anchors: { lat: number; lng: number }[],
  radiusM = 10000,
  count = 10,
): Promise<PlaceHit[]> {
  const capped = anchors.filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng)).slice(0, 3)
  if (capped.length === 0) return []
  const [osm, wiki, mappls] = await Promise.all([
    searchNearbyOverpass(capped, radiusM, count).catch(() => [] as PlaceHit[]),
    searchNearbyWikipedia(capped, radiusM, Math.min(count, 6)).catch(() => [] as PlaceHit[]),
    searchNearbyMappls(capped[0], radiusM, count).catch(() => [] as PlaceHit[]),
  ])
  // merge in trust order (OSM verified → Wikipedia → Mappls), dedupe by name
  const seen = new Set<string>()
  const merged: PlaceHit[] = []
  for (const h of [...osm, ...wiki, ...mappls]) {
    const key = normWords(h.name).join(' ')
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(h)
  }
  merged.sort((a, b) => distToNearest(a, capped) - distToNearest(b, capped))
  // round-robin the categories so the list stays varied
  const byCat = new Map<string, PlaceHit[]>()
  for (const h of merged) {
    const k = h.category ?? 'sightseeing'
    if (!byCat.has(k)) byCat.set(k, [])
    byCat.get(k)!.push(h)
  }
  const queues = [...byCat.values()]
  const out: PlaceHit[] = []
  let progressed = true
  while (out.length < count && progressed) {
    progressed = false
    for (const q of queues) {
      const h = q.shift()
      if (h) {
        out.push(h)
        progressed = true
      }
      if (out.length >= count) break
    }
  }
  return out
}





async function searchNearbyPoisWikipedia(lat: number, lng: number, radiusM = 10000, count = 10): Promise<PlaceHit[]> {
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
