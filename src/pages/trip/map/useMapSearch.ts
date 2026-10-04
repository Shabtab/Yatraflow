/**
 * #420, slice 8 — the map's route-aware search as a hook.
 *
 * The rail's search box and the map omnibar share one runner. It lived as
 * closures in `MapTab`. It is a hook now. Behaviour is unchanged.
 *
 * What this hook owns: both queries, both row lists, the omnibar pick, the
 * spinner, the show-all flag, the quota flag, the seq token and the abort
 * controller. What it does not own: the corridor fetch, the slot search, or
 * the list refs. Those stay in the page.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from '../../../components/ui'
import {
  asymmetricDetourKm,
  searchPlacesText,
  type PlaceHit,
} from '../../../lib/geocode'
import { QuotaExhaustedError } from '../../../lib/providers/google'

/** One ranked row: the hit plus its road position (null when unknown). */
export type MapSearchHit = { h: PlaceHit; km: number | null; off: number | null }

/** Every page value the shared runner reads. */
export type UseMapSearchDeps = {
  /** Flat [lng, lat] road geometry for Search-Along-Route bias. */
  routeGeometry: [number, number][] | null
  /** Corridor anchors for the detour measure. */
  anchors: { lat: number; lng: number }[]
  /** Drawn-road polyline for the detour measure. */
  routePolyline: { lat: number; lng: number }[] | null
  /** Detour scope in km — out-of-scope rows render muted. */
  scopeKm: number
  /** Along-route km for a point (null off-polyline). */
  routeKmOf: (lat: number, lng: number) => number | null
}

export function useMapSearch({
  routeGeometry,
  anchors,
  routePolyline,
  scopeKm,
  routeKmOf,
}: UseMapSearchDeps): {
  searchQ: string
  setSearchQ: (q: string) => void
  searchResults: MapSearchHit[]
  setSearchResults: (rows: MapSearchHit[]) => void
  searching: boolean
  showAllResults: boolean
  setShowAllResults: (v: boolean | ((v: boolean) => boolean)) => void
  omniQ: string
  setOmniQ: (q: string) => void
  omniResults: MapSearchHit[]
  setOmniResults: (rows: MapSearchHit[]) => void
  omniPicked: MapSearchHit | null
  setOmniPicked: (row: MapSearchHit | null) => void
  searchQuotaOut: boolean
  runRouteSearch: (raw: string) => Promise<MapSearchHit[] | null>
  onSearch: (e: FormEvent) => Promise<void>
  onOmniSearch: () => Promise<void>
} {
  // In-map place search (§6.5): a free-text query over the provider facade,
  // plus the results to add straight from the Map tab.
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<MapSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  // "show all N" — the rail lists 5 by default; this unfolds the rest.
  const [showAllResults, setShowAllResults] = useState(false)
  // #418: the map's OWN search — its query, its rows, and the hit the user picked
  // from them. The pick is deliberately its own state rather than `activeHitId`:
  // the rail's rows move that one on hover, so keying the placement step off it
  // would let the omnibar inherit the context of whatever rail was last active.
  const [omniQ, setOmniQ] = useState('')
  const [omniResults, setOmniResults] = useState<MapSearchHit[]>([])
  const [omniPicked, setOmniPicked] = useState<MapSearchHit | null>(null)
  const [searchQuotaOut, setSearchQuotaOut] = useState(false)
  // Monotonic search token: a slow earlier query must never clobber the rows of
  // a newer one that resolved first (out-of-order responses).
  const searchSeq = useRef(0)
  const searchAbort = useRef<AbortController | null>(null)
  useEffect(() => () => {
    searchAbort.current?.abort()
  }, [])

  /** #418: ONE route-aware search, shared by the rail's corridor box and the map
   *  omnibar — same query, same ranking, same quota and abort discipline — so the
   *  two surfaces cannot disagree about what a search found or what it cost. The
   *  caller decides where the rows live; `null` means a newer search superseded
   *  this one (or it failed), so a caller never renders stale rows. */
  async function runRouteSearch(raw: string): Promise<MapSearchHit[] | null> {
    const q = raw.trim()
    if (q.length < 2) return null
    // Claim this as the latest search; a slower earlier query that resolves
    // later is ignored so it can never overwrite the newer rows.
    const mySeq = ++searchSeq.current
    searchAbort.current?.abort()
    const controller = new AbortController()
    searchAbort.current = controller
    setSearching(true)
    try {
      // searchPlacesText (NOT searchPlaces): this surface ranks and annotates
      // every row by road position BEFORE any pick, so hits must carry real
      // coordinates — autocomplete placeholders measure Null Island
      // (live 2026-09-14: five different places all read "~1675 km · 8448 km
      // off-route" because they shared the placeholder).
      // Route-aware bias (found live 2026-09-24): the trip's road is the
      // spatial signal — without it Google IP-biases results to wherever the
      // user is typing from, not the corridor they're planning.
      const hits = await searchPlacesText(q, { routeCoords: routeGeometry, anchors, signal: controller.signal })
      if (mySeq !== searchSeq.current) return null // a newer search superseded this one
      // Trip/route/map aware (user ask): "coffee on my route", not coffee
      // everywhere in India. Each hit is projected onto this trip's road and
      // ranked by detour (then road position); anything beyond the current
      // detour scope renders muted and the toast says why.
      // asymmetricDetourKm measures the perpendicular spur against the DRAWN
      // polyline (road-true) and only falls back to straight-line-to-anchor
      // when the road isn't measured — detourKm over-counts hits that sit
      // between two anchors.
      const ranked = hits
        .map(h => ({ h, km: routeKmOf(h.latitude, h.longitude), off: asymmetricDetourKm(h, anchors, routePolyline) }))
        .sort((a, b) => {
          const ao = a.off == null ? Number.POSITIVE_INFINITY : a.off
          const bo = b.off == null ? Number.POSITIVE_INFINITY : b.off
          return ao - bo || (a.km == null ? Number.POSITIVE_INFINITY : a.km) - (b.km == null ? Number.POSITIVE_INFINITY : b.km)
        })
      const onScope = ranked.filter(en => en.off != null && en.off <= scopeKm)
      if (hits.length === 0) toast('No places found for that search.')
      else if (onScope.length === 0) toast(`Nothing for “${q}” within your ${scopeKm} km detour scope - widen the detour-scope slider to see them.`)
      return ranked
    } catch (err) {
      if (mySeq !== searchSeq.current || controller.signal.aborted) return null
      if (err instanceof QuotaExhaustedError) { setSearchQuotaOut(true); toast('Google Places 80% safety pause reached - search resumes next UTC month. Remove the key in Settings and reload to use the free stack.', 'err') } else {
        toast('Search failed - try again.', 'err')
      }
      return null
    } finally {
      // Only the newest search owns the spinner; a superseded one leaves the
      // newer request's "searching" state untouched.
      if (mySeq === searchSeq.current) setSearching(false)
    }
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault()
    const ranked = await runRouteSearch(searchQ)
    if (ranked) {
      setShowAllResults(false)
      setSearchResults(ranked)
    }
  }

  /** #418: the omnibar's own submit. Its rows live in their own state so the
   *  rail's list is not silently replaced by a search made on the map. */
  async function onOmniSearch() {
    const ranked = await runRouteSearch(omniQ)
    if (ranked) {
      setOmniResults(ranked)
      setOmniPicked(null)
    }
  }

  return {
    searchQ,
    setSearchQ,
    searchResults,
    setSearchResults,
    searching,
    showAllResults,
    setShowAllResults,
    omniQ,
    setOmniQ,
    omniResults,
    setOmniResults,
    omniPicked,
    setOmniPicked,
    searchQuotaOut,
    runRouteSearch,
    onSearch,
    onOmniSearch,
  }
}
