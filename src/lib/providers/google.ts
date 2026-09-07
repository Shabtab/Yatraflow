// ============ Google Places provider — data-only usage (report §3) ============
// Exactly three data pieces, nothing more:
//   1. Autocomplete for location picking — cheap Autocomplete Requests SKU;
//      picked suggestions get coordinates via one Place Details Essentials
//      call (Autocomplete itself returns predictions, never coordinates).
//   2. Nearby POIs for the tourist engine — Text Search Pro events, in two
//      flavours: Search-Along-Route (whole-route polyline, real road detours
//      via routingSummaries) for multi-anchor corridor scans, and circular
//      locationBias (Text Search, same SKU) for single-anchor flows like the
//      Timeline's empty-day chips.
//   3. Opening hours on the SAME Text Search events — requested via FieldMask
//      (places.regularOpeningHours + places.currentOpeningHours), so they cost
//      zero extra SKU events and need no Place Details calls. Rendered as
//      "reported", never persisted.
// Routing stays OSRM, weather Open-Meteo, rendering MapLibre. Every entry
// point throws on failure — the facade (src/lib/geocode.ts) falls back to the
// free stack (providers/free.ts) — and the Phase-B quota guard
// (providers/quota.ts) gates every request BEFORE it goes out.
//
// NOTE (verified live 2026-08-29): all three FieldMask strings below were
// executed against the live Places API with a real key — autocomplete,
// Place Details and Text Search Along-Route all return HTTP 200. One fix was
// applied from that run: routingSummaries paths are legs-scoped
// (`routingSummaries.legs.distanceMeters`). See scripts/verify-google-places.mjs.
import { normWords, hasCoords, type PlaceHit, type HaltPurpose } from './hits'
import { quotaAllows, quotaCount, type QuotaSku } from './quota'
import { queriesForPurpose } from '../purposeQueries'

const PLACES = 'https://places.googleapis.com/v1'
const REGION_CODE = 'IN'

/** Read lazily (not at module load) so tests can stub the env. */
function apiKey(): string {
  return ((import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '').trim()
}

export function googleEnabled(): boolean {
  return apiKey().length > 0
}

/** Thrown when the Phase-B soft cap says no more events for a SKU this month. */
export class QuotaExhaustedError extends Error {
  constructor(sku: QuotaSku) {
    super(`Google Places quota soft-cap reached for ${sku} — Google-mode suggestions stay paused until the counter rolls over (next UTC month). Remove the key to serve the free stack instead.`)
    this.name = 'QuotaExhaustedError'
  }
}

async function placesPost(path: string, sku: QuotaSku, body: unknown, fieldMask: string): Promise<Record<string, unknown>> {
  if (!quotaAllows(sku)) throw new QuotaExhaustedError(sku)
  const res = await fetch(`${PLACES}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`places ${path} → HTTP ${res.status}`)
  quotaCount(sku) // count the event only once a request actually went out
  return res.json()
}

// ============ Google encoded-polyline encoding ============
// OSRM hands us [lng, lat][] geometry; Search-Along-Route wants a Google
// encoded polyline (1e5 precision, signed varint deltas). ~20 lines, no deps.

function encVal(v: number): string {
  let out = ''
  let n = v < 0 ? ~(v << 1) : (v << 1)
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63)
    n >>= 5
  }
  out += String.fromCharCode(n + 63)
  return out
}

/** Encode OSRM-style [lng, lat][] coordinates as a Google encoded polyline. */
export function encodePolyline(coords: [number, number][]): string {
  let out = ''
  let prevLat = 0
  let prevLng = 0
  for (const [lng, lat] of coords) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const ilat = Math.round(lat * 1e5)
    const ilng = Math.round(lng * 1e5)
    out += encVal(ilat - prevLat) + encVal(ilng - prevLng)
    prevLat = ilat
    prevLng = ilng
  }
  return out
}

// ============ 1. Autocomplete (location picking) ============

const AUTOCOMPLETE_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text.text',
  'suggestions.placePrediction.structuredFormat.mainText.text',
  'suggestions.placePrediction.structuredFormat.secondaryText.text',
  'suggestions.placePrediction.types',
].join(',')

/** prediction types that mean "a populated place", not a POI */
const GEO_TYPES = new Set([
  'locality', 'sublocality', 'sublocality_level_1', 'neighborhood',
  'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3',
  'postal_town', 'postal_code', 'country', 'geocode',
])

interface PlacePrediction {
  placeId?: string
  text?: { text?: string }
  structuredFormat?: {
    mainText?: { text?: string }
    secondaryText?: { text?: string }
  }
  types?: string[]
}

/**
 * Type-ahead place suggestions. Returns PlaceHits WITHOUT coordinates (the
 * Autocomplete API never returns them) — the facade resolves the picked one
 * via Place Details. Sessionless by design: India pricing bills per-request
 * (70k free/month) and session usage is unlimited-free, so no session tokens.
 */
export async function googleAutocomplete(q: string, indiaOnly = true): Promise<PlaceHit[]> {
  const input = q.trim()
  if (input.length < 2) return []
  const data = await placesPost('/places:autocomplete', 'autocomplete', {
    input,
    languageCode: 'en',
    ...(indiaOnly ? { includedRegionCodes: [REGION_CODE] } : {}),
  }, AUTOCOMPLETE_MASK)
  const preds = ((data.suggestions ?? []) as { placePrediction?: PlacePrediction }[])
    .map(s => s.placePrediction)
    .filter((p): p is PlacePrediction => !!p?.placeId)
  return preds.slice(0, 5).map(p => {
    const secondary = p.structuredFormat?.secondaryText?.text ?? ''
    const segs = secondary.split(',').map(s => s.trim()).filter(Boolean)
    const types = p.types ?? []
    const isPlace = types.some(t => GEO_TYPES.has(t))
    return {
      id: `gpred_${p.placeId}`,
      name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      latitude: 0, longitude: 0,  // resolved on pick via googleResolveHitCoords
      admin1: segs[segs.length - 1],
      kind: (isPlace ? 'place' : 'poi') as PlaceHit['kind'],
      description: secondary || undefined,
      placeId: p.placeId,
      source: 'google' as const,
    }
  })
}

// ============ Pick resolution — Place Details (Essentials) ============
// Autocomplete never returns coordinates, so a picked Google suggestion gets
// exactly ONE Place Details call (Essentials SKU — 70k free/month in India;
// one per pick ≈ 1,500/month at the report's 100-user scale ≈ 2%).

export async function googleResolveHitCoords(hit: PlaceHit): Promise<PlaceHit> {
  if (hasCoords(hit) || !hit.placeId) return hit
  if (!quotaAllows('placeDetails')) throw new QuotaExhaustedError('placeDetails')
  const res = await fetch(
    `${PLACES}/places/${encodeURIComponent(hit.placeId)}?languageCode=en`,
    {
      headers: {
        'X-Goog-Api-Key': apiKey(),
        // Place Details masks are root-level paths (no `places.` prefix)
        'X-Goog-FieldMask': 'id,location,formattedAddress',
      },
      signal: AbortSignal.timeout(8000),
    },
  )
  if (!res.ok) throw new Error(`places details → HTTP ${res.status}`)
  quotaCount('placeDetails')
  const p = (await res.json()) as { location?: { latitude?: number; longitude?: number } }
  const lat = p.location?.latitude
  const lng = p.location?.longitude
  if (lat == null || lng == null) return hit
  return { ...hit, latitude: lat, longitude: lng }
}

// ============ 2+3. Search-Along-Route POIs + opening hours ============
// One Text Search Pro event per category query (3, +1 for fuel on self-drive
// trips), each biased along the WHOLE route polyline with routingSummaries
// giving the real road detour per place. Opening hours ride on the same
// events via the FieldMask — zero extra SKU events, no Place Details calls.

interface GooglePlace {
  id?: string
  displayName?: { text?: string }
  location?: { latitude?: number; longitude?: number }
  formattedAddress?: string
  primaryTypeDisplayName?: { text?: string }
  /** machine place type, e.g. "tourist_attraction" — used for the sight gate */
  primaryType?: string
  types?: string[]
  regularOpeningHours?: { periods?: GooglePeriod[] }
  currentOpeningHours?: { periods?: GooglePeriod[] }
  rating?: number
  userRatingCount?: number
}

interface GooglePeriod {
  open?: { hour?: number; minute?: number }
  close?: { hour?: number; minute?: number }
}

interface RoutingSummary {
  /**
   * Search-Along-Route legs: [0] = route origin → place, [1] = place → route
   * destination (live-verified 2026-08-29). The detour is the extra travel
   * over the direct route: legs[0] + legs[1] − routeTotalKm.
   */
  legs?: { distanceMeters?: number }[]
}

// FieldMask: places.* paths for the search response + ROOT-level
// routingSummaries (parallel array to places). Opening-hours fields are part
// of the same mask — they bill as part of the same Text Search event.
// NOTE: routingSummaries paths are legs-scoped — `routingSummaries.legs.
// distanceMeters`, NOT `routingSummaries.distanceMeters` (live-verified
// 2026-08-29: the latter shape 400s with INVALID_ARGUMENT). duration is
// omitted — nothing consumes it.
// Rating paths ride the same events — no extra SKU, mask-only change.
// primaryType + types ride free too — the sightseeing gate needs the machine
// type to enforce tourist_attraction-only results.
export const NEARBY_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.formattedAddress',
  'places.primaryTypeDisplayName',
  'places.primaryType',
  'places.types',
  'places.regularOpeningHours',
  'places.currentOpeningHours',
  'places.rating',
  'places.userRatingCount',
  'routingSummaries.legs.distanceMeters',
].join(',')

const ALONG_ROUTE_QUERIES: { textQuery: string; cat: string; includedType?: string }[] = [
  { textQuery: 'tourist attractions', cat: 'sightseeing', includedType: 'tourist_attraction' },
  { textQuery: 'restaurants and cafes', cat: 'food' },
  { textQuery: 'hotels', cat: 'hotel' },
]
// appended only for self-drive trips (includeFuel), capped by rankAndCap
const FUEL_QUERY: { textQuery: string; cat: string; includedType?: string } = { textQuery: 'petrol pumps', cat: 'transport-hub' }

/** "HH:MM" strings from the first Google period; open-ended → 23:59. */
function hoursFrom(p: GooglePlace): { openTime?: string; closeTime?: string } {
  // currentOpeningHours reflects the next 7 days (closures, holidays) —
  // prefer it when present, else fall back to the regular weekly pattern
  const oh = p.currentOpeningHours?.periods?.length ? p.currentOpeningHours : p.regularOpeningHours
  const first = oh?.periods?.[0]
  if (!first?.open) return {}
  const hm = (t?: { hour?: number; minute?: number }) =>
    t ? `${String(t.hour ?? 0).padStart(2, '0')}:${String(t.minute ?? 0).padStart(2, '0')}` : undefined
  return { openTime: hm(first.open) ?? '00:00', closeTime: hm(first.close) ?? '23:59' }
}

export interface AlongRouteArgs {
  /** OSRM road geometry of the whole route, [lng, lat][] */
  routeCoords: [number, number][]
  /**
   * Total road distance of routeCoords in km (OSRM leg sum). Needed to
   * derive the real detour from the routingSummaries legs; without it hits
   * keep the straight-line-to-anchor detour estimate.
   */
  routeTotalKm?: number | null
  count: number
  includeFuel?: boolean
  /** When provided, searches use purpose-specific queries instead of the static tourist set. */
  purposes?: HaltPurpose[]
}

/**
 * Nearby ideas via Places Search-Along-Route: 3–4 Text Search Pro events per
 * scan (vs 6+ per-anchor free calls), each place carrying its real road
 * detour. Note: routes whose origin ≈ destination (round trips) can
 * legitimately return zero results — the facade falls back to the free stack
 * when that happens.
 */
/**
 * Shared mapper: Text Search responses (one per category query) → PlaceHits,
 * deduped across queries. `routeTotalKm` is only present for Search-Along-Route
 * (routingSummaries legs → real road detour); point searches pass null.
 */
/**
 * Map Google's machine place type → the app's category taxonomy. The category
 * must describe WHAT THE PLACE IS, not the query that found it — queries are
 * purpose-driven ("highway dhabas"), so a dhaba's category must be 'food',
 * never the purpose string 'meal'. PURPOSE_FIT scores categories; a 'meal'
 * category scores 0 and gets rejected by the purpose-fit gate from its own
 * segment, dumping real restaurants into the leftover sight pass.
 */
const GOOGLE_TYPE_TO_CATEGORY: Record<string, string> = {
  tourist_attraction: 'sightseeing',
  aquarium: 'sightseeing', zoo: 'sightseeing', amusement_park: 'sightseeing',
  museum: 'museum', art_gallery: 'museum', cultural_center: 'museum',
  hindu_temple: 'temple', mosque: 'temple', church: 'temple', synagogue: 'temple',
  place_of_worship: 'temple', gurudwara: 'temple',
  park: 'nature', natural_feature: 'nature', botanical_garden: 'nature',
  beach: 'beach',
  hiking_area: 'adventure', campground: 'adventure',
  restaurant: 'food', cafe: 'cafe', coffee_shop: 'cafe', bar: 'food',
  bakery: 'food', meal_takeaway: 'food', food: 'food',
  hotel: 'hotel', motel: 'hotel', lodge: 'hotel', guest_house: 'hotel',
  hostel: 'hotel', bed_and_breakfast: 'hotel', resort: 'hotel', lodging: 'hotel',
  gas_station: 'transport-hub', fuel: 'transport-hub',
  ev_charging_station: 'transport-hub', charging_station: 'transport-hub',
  shopping_mall: 'shopping', store: 'shopping', market: 'shopping',
  train_station: 'travel', transit_station: 'travel', airport: 'travel',
}

/** Category from Google's primaryType (or types), else the query's category hint. */
function categoryForGooglePlace(
  p: GooglePlace,
  fallback: string,
): string {
  const primary = p.primaryType ? GOOGLE_TYPE_TO_CATEGORY[p.primaryType] : undefined
  if (primary) return primary
  for (const t of p.types ?? []) {
    const mapped = GOOGLE_TYPE_TO_CATEGORY[t]
    if (mapped) return mapped
  }
  return fallback
}

function hitsFromResponses(
  responses: { places?: GooglePlace[]; routingSummaries?: RoutingSummary[] }[],
  queries: { textQuery: string; cat: string; includedType?: string }[],
  routeTotalKm: number | null | undefined,
): PlaceHit[] {
  const seen = new Set<string>()
  const out: PlaceHit[] = []
  for (let qi = 0; qi < responses.length; qi++) {
    const { places = [], routingSummaries = [] } = responses[qi]
    for (let i = 0; i < places.length; i++) {
      const p = places[i]
      if (!p.id || !p.displayName?.text) continue
      // type gate: when the query demanded a single place type (sightseeing →
      // tourist_attraction), a hit whose primaryType AND types both miss it is
      // a stray locality/neighborhood the text match dragged in — drop it.
      const gate = queries[qi].includedType
      if (gate && p.primaryType !== gate && !(p.types ?? []).includes(gate)) continue
      const lat = p.location?.latitude
      const lng = p.location?.longitude
      if (lat == null || lng == null) continue
      const key = normWords(p.displayName.text).join(' ')
      if (!key || seen.has(key)) continue
      seen.add(key)
      const summary = routingSummaries[i]
      // legs[0] = route origin → place, legs[1] = place → route destination;
      // the detour is the extra travel over the direct route. Clamp at 0 —
      // a place can legitimately sit on the way (zero extra), and floating
      // noise should never show negative detours.
      const legs = summary?.legs ?? []
      const l0 = legs[0]?.distanceMeters
      const l1 = legs[1]?.distanceMeters
      const detourM =
        l0 != null && l1 != null && routeTotalKm != null
          ? l0 + l1 - routeTotalKm * 1000
          : null
      out.push({
        id: `google_${p.id}`,
        name: p.displayName.text,
        latitude: lat,
        longitude: lng,
        kind: 'poi',
        description: p.primaryTypeDisplayName?.text ?? p.formattedAddress ?? undefined,
        placeId: p.id,
        source: 'google',
        fromGoogleAlongRoute: routeTotalKm != null,
        // real category from the place's machine type — NEVER the purpose
        // string that built the query ('meal'/'fuel'/'overnight' are purposes,
        // not categories; they score 0 in PURPOSE_FIT)
        category: categoryForGooglePlace(p, queries[qi].cat),
        ...hoursFrom(p),
        ...(p.rating != null && Number.isFinite(p.rating) ? { rating: p.rating } : {}),
        ...(p.userRatingCount != null && Number.isFinite(p.userRatingCount) ? { ratingCount: p.userRatingCount } : {}),
        // leg0 = road km from the route origin to this place — its position
        // along the journey (ride-plan segment assignment + card labels)
        ...(l0 != null && Number.isFinite(l0) ? { alongRouteKm: Math.max(0, l0) / 1000 } : {}),
        ...(detourM != null && Number.isFinite(detourM)
          ? { offRouteKm: Math.max(0, detourM) / 1000 }
          : {}),
      })
    }
  }
  return out
}

export async function googleNearbyAlongRoute(args: AlongRouteArgs): Promise<PlaceHit[]> {
  const encoded = encodePolyline(args.routeCoords)
  if (!encoded) return []
  // Build query list: static tourist set (backward compat) OR purpose-specific dynamic set
  const staticQueries = args.includeFuel ? [...ALONG_ROUTE_QUERIES, FUEL_QUERY] : ALONG_ROUTE_QUERIES
  const queries = args.purposes && args.purposes.length > 0
    ? args.purposes.flatMap(p => queriesForPurpose(p).googleQueries.map(textQuery => ({ textQuery, cat: p, includedType: queriesForPurpose(p).includedType })))
    : staticQueries
  const responses = await Promise.all(queries.map(qv =>
    placesPost('/places:searchText', 'textSearchPro', {
      textQuery: qv.textQuery,
      ...(qv.includedType ? { includedType: qv.includedType } : {}),
      searchAlongRouteParameters: { polyline: { encodedPolyline: encoded } },
      maxResultCount: 10,
      languageCode: 'en',
      regionCode: REGION_CODE,
    }, NEARBY_FIELD_MASK) as Promise<{ places?: GooglePlace[]; routingSummaries?: RoutingSummary[] }>,
  ))
  return hitsFromResponses(responses, queries, args.routeTotalKm)
}

// Places-only mask for point searches — routingSummaries exist only for
// Search-Along-Route, and requesting inapplicable mask paths risks a 400.
const POINT_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.formattedAddress',
  'places.primaryTypeDisplayName',
  'places.primaryType',
  'places.types',
  'places.regularOpeningHours',
  'places.currentOpeningHours',
].join(',')

export interface AtPointArgs {
  lat: number
  lng: number
  radiusM: number
  count: number
  includeFuel?: boolean
}

/**
 * Nearby ideas around ONE anchor via Text Search with a circular locationBias —
 * the single-anchor counterpart of Search-Along-Route (used by the Timeline's
 * empty-day chips, which have no route geometry). Same Text Search Pro SKU and
 * the same tourist queries, so hits carry reported opening hours; no road
 * detours (routingSummaries don't exist here — hits keep straight-line
 * distance-to-anchor fallbacks via detourKm).
 */
export async function googleNearbyAtPoint(args: AtPointArgs): Promise<PlaceHit[]> {
  const queries = args.includeFuel ? [...ALONG_ROUTE_QUERIES, FUEL_QUERY] : ALONG_ROUTE_QUERIES
  const responses = await Promise.all(queries.map(qv =>
    placesPost('/places:searchText', 'textSearchPro', {
      textQuery: qv.textQuery,
      ...(qv.includedType ? { includedType: qv.includedType } : {}),
      locationBias: {
        circle: { center: { latitude: args.lat, longitude: args.lng }, radius: args.radiusM },
      },
      maxResultCount: 10,
      languageCode: 'en',
      regionCode: REGION_CODE,
    }, POINT_FIELD_MASK) as Promise<{ places?: GooglePlace[] }>,
  ))
  return hitsFromResponses(responses, queries, null)
}

// ============ 4. City/town anchor layer (Google mode) ============
// Provider directive (2026-09-07): in Google mode EVERYTHING comes from
// Google — POIs and the populated-place anchor layer. Text Search along the
// route with locality/administrative types, no routingSummaries needed. The
// free-stack searchCitiesAlong (Overpass + Wikipedia) stays as the keyless
// mode only — its Wikipedia filter accepted Indian constituency articles.

/** place types that mean "a real populated place" for the anchor layer */
const CITY_TYPES = ['locality', 'administrative_area_level_3', 'administrative_area_level_2']

export async function googleCitiesAlong(
  anchors: { lat: number; lng: number }[],
  radiusM = 35000,
  count = 8,
): Promise<PlaceHit[]> {
  const capped = anchors.filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng)).slice(0, 6)
  if (capped.length === 0) return []
  const responses = await Promise.all(capped.map(a =>
    placesPost('/places:searchText', 'textSearchPro', {
      textQuery: 'towns and cities',
      locationBias: {
        circle: { center: { latitude: a.lat, longitude: a.lng }, radius: Math.min(radiusM, 50000) },
      },
      maxResultCount: 8,
      languageCode: 'en',
      regionCode: REGION_CODE,
    }, POINT_FIELD_MASK) as Promise<{ places?: GooglePlace[] }>,
  ))
  const seen = new Set<string>()
  const out: PlaceHit[] = []
  for (const res of responses) {
    for (const p of res.places ?? []) {
      if (!p.id || !p.displayName?.text) continue
      const key = normWords(p.displayName.text).join(' ')
      if (!key || seen.has(key)) continue
      // keep only real populated places — the anchor layer labels cards with
      // "near <city>"; constituencies/blocks must never appear here
      const t = p.types ?? []
      const isCity = t.some(x => CITY_TYPES.includes(x)) || p.primaryType === 'locality'
      if (!isCity) continue
      const lat = p.location?.latitude
      const lng = p.location?.longitude
      if (lat == null || lng == null) continue
      seen.add(key)
      out.push({
        id: `google_city_${p.id}`,
        name: p.displayName.text,
        latitude: lat,
        longitude: lng,
        kind: 'place',
        description: p.primaryTypeDisplayName?.text ?? p.formattedAddress ?? undefined,
        placeId: p.id,
        source: 'google',
        isPopulatedPlace: true,
        category: 'rest',
      })
    }
  }
  return out.slice(0, count)
}
