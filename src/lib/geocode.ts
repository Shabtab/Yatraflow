// ============ Place search ============
// Two free, keyless sources merged into one result list:
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
}

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
 * Search cities AND points of interest at once.
 * Populated places come first (better trip anchors), POIs after, deduped by name.
 */
export async function searchPlaces(q: string, opts?: { indiaOnly?: boolean }): Promise<PlaceHit[]> {
  const indiaOnly = opts?.indiaOnly ?? true
  const needle = q.trim()
  if (needle.length < 2) return []
  const [places, pois] = await Promise.all([
    searchOpenMeteo(needle, indiaOnly, 5).catch(() => [] as PlaceHit[]),
    searchWikipediaPois(needle, 5).catch(() => [] as PlaceHit[]),
  ])
  const seen = new Set<string>()
  const out: PlaceHit[] = []
  for (const hit of [...places, ...pois]) {
    const key = hit.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
  }
  return out.slice(0, 7)
}

export { DEBOUNCE_MS }
