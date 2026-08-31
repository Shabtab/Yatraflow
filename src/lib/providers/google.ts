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
import { normWords, hasCoords, type PlaceHit } from './hits'
import { quotaAllows, quotaCount, type QuotaSku } from './quota'

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
    super(`Google Places quota soft-cap reached for ${sku} — falling back to the free stack`)
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
  regularOpeningHours?: { periods?: GooglePeriod[] }
  currentOpeningHours?: { periods?: GooglePeriod[] }
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
const NEARBY_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.formattedAddress',
  'places.primaryTypeDisplayName',
  'places.regularOpeningHours',
  'places.currentOpeningHours',
  'routingSummaries.legs.distanceMeters',
].join(',')

const ALONG_ROUTE_QUERIES: { textQuery: string; cat: string }[] = [
  { textQuery: 'tourist attractions', cat: 'sightseeing' },
  { textQuery: 'restaurants and cafes', cat: 'food' },
  { textQuery: 'hotels', cat: 'hotel' },
]
// appended only for self-drive trips (includeFuel), capped at 2 by rankAndCap
const FUEL_QUERY = { textQuery: 'petrol pumps', cat: 'transport-hub' }

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
function hitsFromResponses(
  responses: { places?: GooglePlace[]; routingSummaries?: RoutingSummary[] }[],
  queries: { textQuery: string; cat: string }[],
  routeTotalKm: number | null | undefined,
): PlaceHit[] {
  const seen = new Set<string>()
  const out: PlaceHit[] = []
  for (let qi = 0; qi < responses.length; qi++) {
    const { places = [], routingSummaries = [] } = responses[qi]
    for (let i = 0; i < places.length; i++) {
      const p = places[i]
      if (!p.id || !p.displayName?.text) continue
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
        category: queries[qi].cat,
        ...hoursFrom(p),
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
  const queries = args.includeFuel ? [...ALONG_ROUTE_QUERIES, FUEL_QUERY] : ALONG_ROUTE_QUERIES
  const responses = await Promise.all(queries.map(qv =>
    placesPost('/places:searchText', 'textSearchPro', {
      textQuery: qv.textQuery,
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
