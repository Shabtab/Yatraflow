// ============ Google Places provider — data-only usage (report §3) ============
// Exactly three data pieces, nothing more:
//   1. Autocomplete for location picking — cheap Autocomplete Requests SKU;
//      picked suggestions get coordinates via one Place Details Essentials
//      call (Autocomplete itself returns predictions, never coordinates).
//   2. Nearby POIs for the tourist engine — Text Search Pro events, in two
//      flavours: Search-Along-Route (whole-route polyline; road position from
//      routingSummaries leg0, detour from the geometric spur against that
//      polyline) for multi-anchor corridor scans, and circular
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
import { normWords, hasCoords, spurKm, type PlaceHit, type HaltPurpose } from './hits'
import { quotaAllows, quotaCount, type QuotaSku } from './quota'
import { queriesForPurpose } from '../purposeQueries'
import { encodePolyline } from './polyline'

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

function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  if (signal?.aborted) return AbortSignal.abort()
  const timeout = AbortSignal.timeout(8000)
  if (!signal) return timeout
  const Any = AbortSignal as unknown as { any?: (sigs: AbortSignal[]) => AbortSignal }
  return Any.any ? Any.any([signal, timeout]) : timeout
}

async function placesPost(path: string, sku: QuotaSku, body: unknown, fieldMask: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!quotaAllows(sku)) throw new QuotaExhaustedError(sku)
  const res = await fetch(`${PLACES}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
    signal: requestSignal(signal),
  })
  if (!res.ok) throw new Error(`places ${path} → HTTP ${res.status}`)
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError')
  quotaCount(sku) // count the event only once a non-aborted request completed
  return res.json()
}

// ============ Google encoded polyline ============
// The codec lives in ./polyline. It re-exports encodePolyline, so existing imports keep working.
export { encodePolyline }

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
export async function googleAutocomplete(q: string, indiaOnly = true, signal?: AbortSignal): Promise<PlaceHit[]> {
  const input = q.trim()
  if (input.length < 2) return []
  const data = await placesPost('/places:autocomplete', 'autocomplete', {
    input,
    languageCode: 'en',
    ...(indiaOnly ? { includedRegionCodes: [REGION_CODE] } : {}),
  }, AUTOCOMPLETE_MASK, signal)
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

export async function googleResolveHitCoords(hit: PlaceHit, signal?: AbortSignal): Promise<PlaceHit> {
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
      signal: requestSignal(signal),
    },
  )
  if (!res.ok) throw new Error(`places details → HTTP ${res.status}`)
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError')
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
   * destination (live-verified 2026-08-29). leg[0] is the hit's POSITION along
   * the corridor (alongRouteKm). The legs are NOT used for detours: Google
   * routes start→place→end independently of the polyline, so (leg0 + leg1) −
   * <foreign route total> inflates by the two engines' route-variant
   * difference — measured live at +47 km on a 1,400 km corridor (every
   * on-road petrol pump read "50 km off"). Detours are measured geometrically
   * against the same polyline instead (spurKm).
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
  count: number
  includeFuel?: boolean
  /** When provided, searches use purpose-specific queries instead of the static tourist set. */
  purposes?: HaltPurpose[]
  signal?: AbortSignal
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
 * deduped across queries. `routePolyline` is only present for
 * Search-Along-Route (hits get their road position from routingSummaries leg0
 * and their detour from the geometric spur against the polyline); point
 * searches pass null.
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
  routePolyline: { lat: number; lng: number }[] | null,
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
      // legs[0] = route origin → place: the hit's road POSITION along the
      // corridor (card labels + segment assignment). The legs are NOT a
      // detour source — see the RoutingSummary note above.
      const legs = summary?.legs ?? []
      const l0 = legs[0]?.distanceMeters
      // Detour = the hit's perpendicular spur against the same polyline the
      // search ran along — engine-free, so an on-road petrol pump reads ~0
      // regardless of which provider measured the polyline.
      const spur = routePolyline ? spurKm({ latitude: lat, longitude: lng }, routePolyline) : null
      out.push({
        id: `google_${p.id}`,
        name: p.displayName.text,
        latitude: lat,
        longitude: lng,
        kind: 'poi',
        description: p.primaryTypeDisplayName?.text ?? p.formattedAddress ?? undefined,
        placeId: p.id,
        source: 'google',
        fromGoogleAlongRoute: routePolyline != null,
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
        ...(spur != null ? { offRouteKm: spur } : {}),
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
    }, NEARBY_FIELD_MASK, args.signal) as Promise<{ places?: GooglePlace[]; routingSummaries?: RoutingSummary[] }>,
  ))
  // {lat,lng} form of the same polyline the search ran along — the detour
  // reference for every hit (spurKm). Engine-free: the polyline may have been
  // measured by Google Routes OR the OSRM fallback; the spur is honest either way.
  const polyline = args.routeCoords
    .filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(c => ({ lat: c[1], lng: c[0] }))
  return hitsFromResponses(responses, queries, polyline.length >= 2 ? polyline : null)
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

// Essentials-only mask for the Nearby Search city layer (places:searchNearby)
// — requesting hours/rating fields here would upgrade every event to the Pro
// or Enterprise SKU, and localities carry none of them anyway.
const NEARBY_SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.primaryType',
  'places.types',
].join(',')

export interface AtPointArgs {
  lat: number
  lng: number
  radiusM: number
  count: number
  includeFuel?: boolean
  signal?: AbortSignal
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
    }, POINT_FIELD_MASK, args.signal) as Promise<{ places?: GooglePlace[] }>,
  ))
  return hitsFromResponses(responses, queries, null)
}

// ============ 5. Free-form Text Search (search-to-add surfaces) ============
// Autocomplete hits are DELIBERATELY coordinate placeholders — resolving one
// picked suggestion via a single Place Details call is the quota economy
// (see section 1). But a surface that RANKS or ANNOTATES by coordinates
// BEFORE any pick cannot use them: projecting a (0,0) placeholder onto the
// route measures Null Island (found live 2026-09-14 — every Map-tab search
// result showed the identical "~1675 km into the trip · 8448 km off-route"
// because all five hits shared the placeholder). Text Search returns real
// locations in the SAME single Text Search Pro event the corridor scan
// already pays — so the search-to-add box ranks on truth.
export interface SearchTextArgs {
  /**
   * The trip's route geometry ([lng, lat][], OSRM format). When present the
   * search runs as Search-Along-Route — results are biased to the actual road
   * the trip drives — instead of the default free-form Text Search, whose
   * only spatial signal is the caller's IP address (a user planning a Kerala
   * trip from Bangalore got 8 Bangalore restaurants for "lunch", found live
   * 2026-09-24). Same Text Search Pro SKU either way.
   */
  routeCoords?: [number, number][] | null
  signal?: AbortSignal
}

export async function googleSearchText(q: string, args?: SearchTextArgs): Promise<PlaceHit[]> {
  const needle = q.trim()
  if (needle.length < 2) return []
  // Route geometry present → Search-Along-Route: one request, biased to the
  // road. Without it the request carries NO spatial constraint and Google
  // applies its implicit IP-based location bias — results land in the
  // searcher's city, not on the trip's corridor.
  const routeCoords = (args?.routeCoords ?? []).filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))
  const encoded = routeCoords.length >= 2 ? encodePolyline(routeCoords) : null
  // POINT_FIELD_MASK: no routingSummaries — they exist only for
  // Search-Along-Route, and requesting inapplicable mask paths risks a 400.
  // (The along-route variant below uses NEARBY_FIELD_MASK, which carries them.)
  const responses = [await (placesPost('/places:searchText', 'textSearchPro', {
    textQuery: needle,
    ...(encoded ? { searchAlongRouteParameters: { polyline: { encodedPolyline: encoded } } } : {}),
    maxResultCount: 8,
    languageCode: 'en',
    regionCode: REGION_CODE,
  }, POINT_FIELD_MASK, args?.signal) as Promise<{ places?: GooglePlace[] }>)]
  // No along-route geometry → no road detours; callers annotate with their
  // own route (routeKmOf/detourKm) exactly like the point-search surface.
  return hitsFromResponses(responses, [{ textQuery: needle, cat: 'sightseeing' }], null)
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
  signal?: AbortSignal,
): Promise<PlaceHit[]> {
  const capped = anchors.filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng)).slice(0, 6)
  if (capped.length === 0) return []
  // Nearby Search with the locality TYPE — Text Search matches text against
  // POI NAMES ("Top N Town Ice Cream"), so a textQuery like 'towns and
  // cities' returns zero real localities (live-verified 2026-09-14: the
  // app's exact query returned 200 with zero places, and every text variant
  // returned name-matched junk the CITY_TYPES filter then dropped — night
  // halts starved everywhere). searchNearby + includedTypes returns actual
  // populated places. Essentials fields only (id/name/location/type), so the
  // event bills as Nearby Search Essentials.
  const responses = await Promise.all(capped.map(a =>
    placesPost('/places:searchNearby', 'nearbySearch', {
      // `locality` ONLY. searchNearby accepts a narrow type list, and one
      // unsupported member 400s the WHOLE request — `administrative_area_level_3`
      // (valid in Text Search) and `town` both fail here, and because the caller
      // catches, that 400 presented as "no cities anywhere": every night halt
      // silently starved while the layer looked merely empty (live-verified
      // 2026-09-15, halts on a 1,400 km corridor returning 0 localities).
      includedTypes: ['locality'],
      locationRestriction: {
        circle: { center: { latitude: a.lat, longitude: a.lng }, radius: Math.min(radiusM, 50000) },
      },
      maxResultCount: 8,
      languageCode: 'en',
      regionCode: REGION_CODE,
    }, NEARBY_SEARCH_FIELD_MASK, signal) as Promise<{ places?: GooglePlace[] }>,
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
