// ============ Live Google Places verification (first-build checklist) ============
// Replicates the app's EXACT three call paths (src/lib/providers/google.ts)
// against the live API with the real key from .env.local:
//   1. places:autocomplete          (AUTOCOMPLETE_MASK)
//   2. Place Details resolution     ('id,location,formattedAddress')
//   3. places:searchText            (NEARBY_FIELD_MASK, Search-Along-Route)
// The key is read from .env.local and NEVER printed.
//
// If the key is HTTP-referrer-restricted (expected), a plain Node call gets
// 403 — the script then retries the same request with the production Referer
// (emulating the browser context) and reports both results separately.
//
// Usage:  node scripts/verify-google-places.mjs
import { readFileSync } from 'node:fs'

function readEnvKey() {
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^VITE_GOOGLE_MAPS_API_KEY=(.*)$/)
      if (m) return m[1].trim()
    }
  } catch { /* fall through */ }
  return ''
}

const KEY = readEnvKey()
if (!KEY) {
  console.error('FAIL: VITE_GOOGLE_MAPS_API_KEY not set in .env.local')
  process.exit(1)
}

const PLACES = 'https://places.googleapis.com/v1'

// ---- exact masks from src/lib/providers/google.ts ----
const AUTOCOMPLETE_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text.text',
  'suggestions.placePrediction.structuredFormat.mainText.text',
  'suggestions.placePrediction.structuredFormat.secondaryText.text',
  'suggestions.placePrediction.types',
].join(',')

const NEARBY_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.formattedAddress',
  'places.primaryTypeDisplayName',
  'places.regularOpeningHours',
  'places.currentOpeningHours',
  'routingSummaries.distanceMeters',
  'routingSummaries.duration',
].join(',')

// ---- the app's encodePolyline (copied verbatim so the wire format matches) ----
function encVal(v) {
  let out = ''
  let n = v < 0 ? ~(v << 1) : (v << 1)
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63)
    n >>= 5
  }
  out += String.fromCharCode(n + 63)
  return out
}
function encodePolyline(coords) {
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

// Kochi → Munnar road-ish line (lng, lat) — enough for Search-Along-Route.
const ROUTE = [
  [76.2673, 9.9312],   // Kochi
  [76.35, 10.05],
  [76.55, 10.15],
  [76.72, 10.25],
  [76.87, 10.35],
  [77.06, 10.089],     // Munnar
]

const PROD_REFERER = 'https://yatraflow-blond.vercel.app/'
let usedReferer = false

async function call(name, path, init) {
  const tryOnce = async (extra) => {
    const res = await fetch(`${PLACES}${path}`, {
      ...init,
      headers: { ...init.headers, ...(extra ?? {}) },
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* keep text */ }
    return { res, json, text }
  }
  let { res, json, text } = await tryOnce()
  let retried = false
  if (res.status === 403) {
    usedReferer = true
    retried = true
    ;({ res, json, text } = await tryOnce({ Referer: PROD_REFERER }))
  }
  if (res.status !== 200) {
    console.log(`[FAIL] ${name}: HTTP ${res.status}`)
    console.log('       body:', (text || '').slice(0, 400).replace(KEY, '***'))
    return null
  }
  console.log(`[PASS] ${name}: HTTP 200${retried ? ' (with production Referer)' : ''}`)
  return json
}

console.log('=== 1. Autocomplete (AUTOCOMPLETE_MASK) — query "munnar" ===')
const ac = await call('autocomplete', '/places:autocomplete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': AUTOCOMPLETE_MASK },
  body: JSON.stringify({ input: 'munnar', languageCode: 'en', includedRegionCodes: ['IN'] }),
})
const preds = (ac?.suggestions ?? []).map(s => s.placePrediction).filter(p => p?.placeId)
console.log(`  predictions: ${preds.length}`)
for (const p of preds.slice(0, 3)) {
  console.log(`   - ${p.structuredFormat?.mainText?.text ?? p.text?.text}  (${(p.types ?? []).slice(0, 3).join(', ')})`)
}

console.log('\n=== 2. Place Details Essentials — resolve the first prediction ===')
if (preds.length > 0) {
  const pid = preds[0].placeId
  const det = await call('placeDetails', `/places/${encodeURIComponent(pid)}?languageCode=en`, {
    headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'id,location,formattedAddress' },
  })
  if (det?.location) console.log(`  coords: ${det.location.latitude}, ${det.location.longitude}`)
  if (det?.formattedAddress) console.log(`  addr:   ${det.formattedAddress}`)
} else {
  console.log('  (skipped — no predictions from step 1)')
}

console.log('\n=== 3. Text Search Pro — Search-Along-Route ("tourist attractions") ===')
const encoded = encodePolyline(ROUTE)
console.log(`  polyline: ${encoded.length} chars, ${ROUTE.length} points`)
const st = await call('searchText', '/places:searchText', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': NEARBY_FIELD_MASK },
  body: JSON.stringify({
    textQuery: 'tourist attractions',
    searchAlongRouteParameters: { polyline: { encodedPolyline: encoded } },
    maxResultCount: 10,
    languageCode: 'en',
    regionCode: 'IN',
  }),
})
if (st) {
  const places = st.places ?? []
  const sums = st.routingSummaries ?? []
  console.log(`  places: ${places.length}, routingSummaries: ${sums.length}`)
  let withHours = 0
  let withDetour = 0
  places.forEach((p, i) => {
    if (p.regularOpeningHours || p.currentOpeningHours) withHours++
    if (sums[i]?.distanceMeters != null) withDetour++
  })
  console.log(`  opening hours present on: ${withHours}/${places.length} results`)
  console.log(`  real road detours present on: ${withDetour}/${places.length} results`)
  for (const [i, p] of places.slice(0, 5).entries()) {
    const km = sums[i]?.distanceMeters != null ? `${(sums[i].distanceMeters / 1000).toFixed(1)} km off route` : 'no detour'
    console.log(`   - ${p.displayName?.text}  (${km})`)
  }
}

console.log('\n=== summary ===')
console.log(`referer-restricted key: ${usedReferer ? 'YES — plain calls got 403, browser Referer required (expected per report §5)' : 'no 403s on plain calls'}`)
console.log('FieldMask acceptance: any [FAIL] line above means that mask/SKU needs a fix before shipping')
