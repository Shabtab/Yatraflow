// ============ The 100% free stack — Mappls · Open-Meteo · Wikipedia · OSM ============
// The original engines (moved verbatim from src/lib/geocode.ts when Google
// Places arrived behind the facade in src/lib/geocode.ts). Every facade entry
// point falls back to this module when VITE_GOOGLE_MAPS_API_KEY is absent, a
// Google call fails, or the Phase-B quota guard trips (providers/quota.ts) —
// with the free stack in charge the app behaves exactly as it always has.
import { haversineKm } from '../geo'
import { hasCoords, distToNearest, normWords, rankAndCap, type NearbyOpts, type PlaceHit, type HaltPurpose } from './hits'
import { queriesForPurpose } from '../purposeQueries'

// Mappls autosuggest (when VITE_MAPPLS_KEY is set) → India's best place/POI
// coverage. Results carry an eLoc but no coordinates; they are resolved on
// pick (see resolveHitCoords) because Mappls' free tier doesn't return coords.
//  - Open-Meteo geocoding → cities/towns/villages (strong on populated places)
//  - Wikipedia search API → POIs (waterfalls, forts, temples…) with coords,
//    descriptions and thumbnails. Verified CORS-friendly via origin=*.
const MAPPLS_KEY = ((import.meta.env.VITE_MAPPLS_KEY as string | undefined) ?? '').trim()
export const mapplsEnabled = (): boolean => MAPPLS_KEY.length > 0
/**
 * Mappls has no CORS headers, so the browser can't read its responses directly.
 * We proxy through our own origin: Vite dev proxy in dev, a Vercel external
 * rewrite (`vercel.json`) in production. Both strip the `/mappls` prefix.
 */
const MAPPLS_SEARCH = '/mappls/search/places'

const DEBOUNCE_MS = 280
export { DEBOUNCE_MS }

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
    source: 'open-meteo' as const,
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
      source: 'wikipedia' as const,
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
        source: 'mappls' as const,
      }
    })
}

/**
 * Resolve coordinates for a picked Mappls hit. Mappls' free key doesn't expose
 * coordinates, so eLoc hits fall back to keyless OSM Nominatim on the
 * place's name + address. Returns the original hit untouched on any failure —
 * callers treat a miss as "manual entry" exactly like an unmatched text.
 * (Google hits carry coordinates via the facade's resolver instead.)
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
 * Search cities AND points of interest at once (free stack).
 * Mappls suggestions first (best India coverage, when a key is configured),
 * then populated places, then POIs — deduped by name.
 */
export async function searchPlacesFree(q: string, opts?: { indiaOnly?: boolean }): Promise<PlaceHit[]> {
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

// Nearby categories — what a tourist plans into an itinerary: things to see & do, meals, stays.
const NEARBY_CATEGORIES = [
  { kw: 'tourist attraction', label: 'Attraction', cat: 'sightseeing' },
  { kw: 'restaurant', label: 'Restaurant', cat: 'food' },
  { kw: 'cafe', label: 'Cafe', cat: 'food' },
  { kw: 'hotel', label: 'Hotel', cat: 'hotel' },
  { kw: 'park', label: 'Park', cat: 'nature' },
  // fetched only for self-drive trips, capped at a couple of pit stops
  { kw: 'fuel', label: 'Petrol pump', cat: 'transport-hub' },
]

// ============ Nearby stoppage points (free engines) ============
// Verified coordinates only. Mappls' free-tier Nearby API lists great Indian
// POIs but returns NO coordinates — pins used to be guessed by a global name
// search, which often landed on a same-named place in a different state (the
// "odd suggestions" bug). The engines below all pin real, nearby positions:
//  1. OpenStreetMap via Overpass — attractions, nature, temples, meals, stays
//  2. Wikipedia geosearch — attractions, junk-filtered
//  3. Mappls Nearby — India-rich listings, kept only when a same-named place
//     is confirmed near the anchor (Photon geocoder, proximity-biased)

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

/**
 * Map an OSM POI's tags onto the app's real stop categories, from a tourist's
 * point of view: things to see & do first, meals, stays. Utility points
 * (fuel) are labelled distinctly; ATMs are not fetched at all — nobody plans
 * an ATM into an itinerary.
 */
function classifyOsmTags(tags: Record<string, string>): { cat: string; label: string } {
  const a = tags.amenity
  const t = tags.tourism
  const nat = tags.natural
  const l = tags.leisure
  const cap = (s: string) => s.split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ')
  if (a === 'fuel') return { cat: 'transport-hub', label: 'Petrol pump' }
  if (a === 'place_of_worship') {
    const label = tags.religion === 'muslim' ? 'Mosque' : tags.religion === 'christian' ? 'Church' : 'Temple'
    return { cat: 'temple', label }
  }
  if (nat === 'beach') return { cat: 'beach', label: 'Beach' }
  if (nat === 'waterfall') return { cat: 'nature', label: 'Waterfall' }
  if (nat) return { cat: 'nature', label: cap(nat) }
  if (l === 'park') return { cat: 'nature', label: 'Park' }
  if (l === 'garden') return { cat: 'nature', label: 'Garden' }
  if (l === 'nature_reserve') return { cat: 'nature', label: 'Nature reserve' }
  if (a === 'restaurant' || a === 'fast_food' || a === 'food_court') return { cat: 'food', label: 'Restaurant' }
  if (a === 'cafe' || a === 'ice_cream') return { cat: 'food', label: 'Cafe' }
  if (t === 'museum') return { cat: 'museum', label: 'Museum' }
  if (t === 'gallery') return { cat: 'museum', label: 'Art gallery' }
  if (t === 'zoo') return { cat: 'sightseeing', label: 'Zoo' }
  if (t === 'theme_park') return { cat: 'sightseeing', label: 'Theme park' }
  if (t === 'aquarium') return { cat: 'sightseeing', label: 'Aquarium' }
  if (t === 'viewpoint') return { cat: 'sightseeing', label: 'Viewpoint' }
  if (t === 'hotel' || t === 'guest_house' || t === 'hostel' || t === 'resort' || t === 'motel') return { cat: 'hotel', label: 'Hotel' }
  if (t) return { cat: 'sightseeing', label: 'Attraction' }
  if (tags.historic) {
    const h = tags.historic
    const label = h === 'fort' || h === 'castle' ? 'Fort'
      : h === 'monument' ? 'Monument'
      : h === 'memorial' ? 'Memorial'
      : h === 'ruins' ? 'Ruins'
      : h === 'archaeological_site' || h === 'stupa' ? 'Historic site'
      : 'Historic site'
    return { cat: 'sightseeing', label }
  }
  return { cat: 'sightseeing', label: 'Place' }
}

/**
 * Tourist-worthy OSM selectors. Fuel is appended conditionally (self-drive
 * pit stops only); ATMs/banks/post offices are deliberately absent — they are
 * errands, not itinerary items.
 */
const OVERPASS_NEARBY_SELECTORS = [
  'tourism~"^(attraction|viewpoint|zoo|theme_park|aquarium|museum|gallery)$"',
  'historic~"^(monument|fort|castle|memorial|archaeological_site|ruins|stupa)$"',
  'natural~"^(beach|waterfall|peak|cape|hot_spring|spring|geyser|cliff)$"',
  'leisure~"^(park|garden|nature_reserve)$"',
  'amenity=place_of_worship',
  'amenity~"^(restaurant|cafe|fast_food|food_court|ice_cream)$"',
  'tourism~"^(hotel|guest_house|hostel|resort|motel)$"',
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

async function searchNearbyOverpass(anchors: { lat: number; lng: number }[], radiusM: number, count: number, includeFuel = false, selectors?: string[]): Promise<PlaceHit[]> {
  const radius = Math.min(Math.max(radiusM, 2000), 120000)
  const baseSelectors = selectors ?? (includeFuel ? [...OVERPASS_NEARBY_SELECTORS, 'amenity=fuel'] : OVERPASS_NEARBY_SELECTORS)
  const stmts = baseSelectors.flatMap(sel =>
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
      source: 'osm',
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

async function searchNearbyMappls(anchor: { lat: number; lng: number }, radiusM: number, count: number, includeFuel = false): Promise<PlaceHit[]> {
  if (!mapplsEnabled()) return []
  const cats = NEARBY_CATEGORIES.filter(c => includeFuel || c.cat !== 'transport-hub')
  const results = await Promise.all(
    cats.map(async (c) => {
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
            source: 'mappls' as const,
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
      source: 'wikipedia' as const,
    }))
}

// ============ Opening hours from OpenStreetMap ============
// In free mode (no Google key) hours come from OSM's free Overpass API
// (ODbL — attribution in-app not required for this use, but we credit it in
// the UI hint anyway). In Google mode the facade's nearby search already
// returns hours on the hits (zero extra SKU events); this Overpass lookup
// stays as the free-mode path for manually typed stops.
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

/** Single-anchor convenience wrapper (empty-day chips) — free stack path. */
export async function searchNearbyPoisFree(lat: number, lng: number, radiusM = 10000, count = 10, opts: NearbyOpts = {}): Promise<PlaceHit[]> {
  return searchNearbyPoisMultiFree([{ lat, lng }], radiusM, count, opts)
}

export async function searchNearbyPoisMultiFree(
  anchors: { lat: number; lng: number }[],
  radiusM = 10000,
  count = 10,
  opts: NearbyOpts = {},
  purposes?: HaltPurpose[],
): Promise<PlaceHit[]> {
  const capped = anchors.filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng)).slice(0, 12)
  if (capped.length === 0) return []
  // When purposes are given, merge all their Overpass selectors into one scan
  const selectors = purposes && purposes.length > 0
    ? [...new Set(purposes.flatMap(p => queriesForPurpose(p).overpassSelectors))]
    : undefined
  const [osm, wiki, mappls] = await Promise.all([
    searchNearbyOverpass(capped, radiusM, count, opts.includeFuel, selectors).catch(() => [] as PlaceHit[]),
    searchNearbyWikipedia(capped, radiusM, Math.min(count, 6)).catch(() => [] as PlaceHit[]),
    searchNearbyMappls(capped[0], radiusM, count, opts.includeFuel).catch(() => [] as PlaceHit[]),
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
  // home-zone filter + tourist ranking + per-category caps (shared with the Google path)
  return rankAndCap(merged, capped, radiusM, count, opts)
}

/**
 * Key cities/towns along the ride corridor — the anchor layer for long-drive
 * and cross-day overnight planning. Overpass `place=city|town` nodes
 * (authoritative, with OSM `population` when mapped), merged with Wikipedia
 * geosearch populated-place articles, deduped by name (larger population wins).
 * Best-effort: any failure → [] — the ride planner degrades to pure cadence.
 */
export async function searchCitiesAlong(
  anchors: { lat: number; lng: number }[],
  radiusM = 35000,
  count = 8,
): Promise<PlaceHit[]> {
  const radius = Math.min(Math.max(radiusM, 5000), 60000)
  const stmts = anchors
    .filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng))
    .map(a => `node(around:${radius},${a.lat},${a.lng})[place~"^(city|town)$"];`)
    .join('')
  const byName = new Map<string, PlaceHit>()
  if (stmts) {
    const elements = await fetchOverpass(`[out:json][timeout:20];(${stmts});out center tags 120;`)
    for (const el of elements) {
      const tags = el.tags ?? {}
      const name = tags.name?.trim()
      if (!name) continue
      const lat = el.lat ?? el.center?.lat
      const lng = el.lon ?? el.center?.lon
      if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const pop = tags.population ? Number(String(tags.population).replace(/,/g, '')) : undefined
      const hit: PlaceHit = {
        id: `osm_city_${el.type}_${el.id}`,
        name,
        latitude: lat,
        longitude: lng,
        kind: 'place',
        category: 'rest',
        description: tags.place,
        source: 'osm',
        isPopulatedPlace: true,
        ...(typeof pop === 'number' && Number.isFinite(pop) && pop > 0 ? { population: pop } : {}),
      }
      const prev = byName.get(name.toLowerCase())
      if (!prev || (pop ?? 0) > (prev.population ?? 0)) byName.set(name.toLowerCase(), hit)
    }
  }
  // Wikipedia geosearch adds notable populated places Overpass may miss.
  const per = Math.max(3, Math.ceil((count * 2) / Math.max(1, anchors.length)))
  const wiki = (
    await Promise.all(
      anchors.slice(0, 6).map(a => searchNearbyPoisWikipedia(a.lat, a.lng, radius, per)),
    )
  ).flat()
  for (const h of wiki) {
    const desc = (h.description ?? '').toLowerCase()
    if (!/(city|town|capital|municipal|settlement)/.test(desc)) continue
    if (byName.has(h.name.toLowerCase())) continue
    byName.set(h.name.toLowerCase(), { ...h, category: 'rest', isPopulatedPlace: true })
  }
  return [...byName.values()].slice(0, count)
}