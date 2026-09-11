// ============ Trip route map ============
// Real slippy-map rendering via mapcn (MapLibre GL): OpenFreeMap basemaps that follow
// light/dark theme, numbered stop markers in timeline order, and a polyline
// connecting each day's stops. Distances/durations still come from the engine.
import { useMemo, useState, useEffect, useRef, Fragment } from 'react'
import type { Trip } from '../data/types'
import type { PlaceHit } from '../lib/geocode'
import { resolveHitCoords } from '../lib/geocode'
import { hasCoords, mappablePois } from '../lib/providers/hits'
import { routePath } from '../lib/routing'
import { buildJourney, getAssumptions, isRoundTrip } from '../lib/engine'
import { googleMapsDirectionsUrl } from '../lib/externalMaps'
import { openExternal } from '../lib/native'
import { titleCase } from '../lib/labels'
import { haptic } from '../lib/haptics'
import { nativeWatch } from '../lib/native'
import { loadFlag, saveFlag } from '../lib/uiPrefs'
import type { MapRef } from './mapcn/map'
import { CatIcon } from './icons'
import {
  Flag, Home, Info, Lightbulb, LocateFixed, Map as MapIcon, Navigation, PlaneTakeoff,
  RotateCcw, TriangleAlert, X,
} from 'lucide-react'
import { prefersReducedMotion } from '../lib/motion'
import {
  Map as MapLibreMap,
  MapMarker,
  MarkerContent,
  MarkerTooltip,
  MapRoute,
  MapControls,
  prefersCooperativeGestures,
  useMap,
} from './mapcn/map'

const DAY_COLORS = ['#0D8D82', '#F59E2D', '#7C5CFC', '#E2557B', '#2D9CDB', '#6BBF59', '#B7791F']

// Basemaps come from the mapcn <Map> default (OpenFreeMap — see mapcn/map.tsx).
// The old CARTO Voyager / dark-matter and Esri World Imagery style URLs that
// used to live here were dead code (never referenced) and carried a licensing
// exposure, so they are gone as of issue #23 — there is no satellite layer.

/**
 * Live location: "show me on the map" as a persistent, toggleable layer —
 * the standard Android maps pattern. While on, the user renders as a
 * pulsing blue dot and the camera follows the latest fix (until the user
 * pans away themselves). The watch is driven by the native plugin inside
 * the app (system permission dialog + fused provider) or the browser watch
 * on the web. Toggling off stops the watch entirely — no idle GPS burn.
 */
function LiveLocationLayer({ active }: { active: boolean }) {
  const { map, isLoaded } = useMap()
  const [fix, setFix] = useState<GeolocationPosition | null>(null)
  const [denied, setDenied] = useState(false)
  // Camera follow is released the first time the user pans/pinches the map
  // themselves; our own easeTo (below) flips this true around its call so
  // the movestart it triggers isn't misread as a user pan.
  const userPanned = useRef(false)
  const selfMove = useRef(false)

  useEffect(() => {
    if (!active) { setFix(null); setDenied(false); return }
    userPanned.current = false
    const handle = nativeWatch(pos => {
      if (!pos) { setDenied(true); return }
      setDenied(false)
      setFix(pos)
    })
    const onMoveStart = () => { if (!selfMove.current) userPanned.current = true }
    map?.on('movestart', onMoveStart)
    return () => {
      handle.stop()
      map?.off('movestart', onMoveStart)
    }
  }, [active, map])

  useEffect(() => {
    if (!isLoaded || !map || !fix) return
    const center: [number, number] = [fix.coords.longitude, fix.coords.latitude]
    if (!userPanned.current) {
      selfMove.current = true
      map.easeTo({ center, zoom: Math.max(map.getZoom(), 14), duration: 600 })
      // movestart fires synchronously-ish inside easeTo setup; release on
      // the next frame so subsequent user pans still count.
      requestAnimationFrame(() => { selfMove.current = false })
    }
  }, [isLoaded, map, fix])

  if (!active || !fix) return null
  return (
    <MapMarker longitude={fix.coords.longitude} latitude={fix.coords.latitude}>
      <MarkerContent>
        <span className={`yf-live-dot${denied ? ' yf-live-dot--denied' : ''}`} aria-label="Your live location" role="img">
          <span className="yf-live-pulse" />
          <span className="yf-live-core" />
        </span>
      </MarkerContent>
    </MapMarker>
  )
}

/**
 * Direction chevrons along the route — a symbol layer fed by the same line
 * geometry, rendered with a tiny dependency-free triangle icon (addImage from
 * raw pixel data, so no font/glyph dependency on the basemap).
 */
function RouteArrows({ coordinates, dark }: { coordinates: [number, number][]; dark: boolean }) {
  const { map, isLoaded } = useMap()
  const instId = useRef(`inst-${Math.random().toString(36).slice(2)}`).current
  useEffect(() => {
    if (!isLoaded || !map || coordinates.length < 2) return
    // Per-instance source/layer ids — a single shared id made concurrent
    // instances (main line + return drive) overwrite each other's geometry.
    const SRC = `yf-arrows-src-${instId}`
    const LAYER = `yf-arrows-${instId}`
    if (!map.hasImage('yf-arrow')) {
      // 9×9 solid triangle pointing up, drawn into raw RGBA pixels
      const size = 9
      const data = new Uint8Array(size * size * 4)
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          // a filled isoceles triangle: wide base at bottom, apex top-centre
          const within = Math.abs(x - (size - 1) / 2) <= (y / (size - 1)) * ((size - 1) / 2) + 0.5
          const i = (y * size + x) * 4
          if (within) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 230 }
        }
      }
      map.addImage('yf-arrow', { width: size, height: size, data })
    }
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } })
      map.addLayer({
        id: LAYER, type: 'symbol', source: SRC,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 130,
          'icon-image': 'yf-arrow',
          'icon-rotate': 0,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': dark ? 0.75 : 0.6 },
      })
    }
    const src = map.getSource(SRC) as unknown as GeoJSONSourceLike
    src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })
    map.setPaintProperty(LAYER, 'icon-opacity', dark ? 0.75 : 0.6)
    return () => {
      try {
        if (map.getLayer(LAYER)) map.removeLayer(LAYER)
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch { /* style swapped mid-flight */ }
    }
  }, [map, isLoaded, coordinates, dark])
  return null
}

// minimal structural typing so we don't need to import maplibre-gl directly here
declare module './mapcn/map' {}
type GeoJSONSourceLike = { setData(d: unknown): void }

/**
 * Gesture mode follows the layout AND the device. An inline map is embedded in
 * a scrolling page, so on a coarse pointer it keeps MapLibre's cooperative
 * gestures (one finger scrolls the page, two fingers pan — see the mapcn
 * default); the expanded overlay owns the whole viewport, so it hands back
 * normal one-finger pan/zoom. The option is read once at construction, hence
 * the runtime switch through MapLibre's own handler — enable()/disable() add
 * and remove the two-finger hint overlay and are idempotent, so re-running this
 * effect (StrictMode included) is safe.
 *
 * The device gate is the SAME predicate the constructor calls
 * (`prefersCooperativeGestures`, exported by mapcn), never the layout alone:
 * with the handler enabled, `ScrollZoomHandler.wheel()` bails before zooming
 * unless ctrl/meta is held, and the two-finger hint is injected into the canvas
 * container — so calling enable() on a fine pointer would take plain wheel-zoom
 * away from a mouse desktop. When the predicate is false this effect therefore
 * touches nothing: the constructed state is already the right one, and disable()
 * is not needed either (there is nothing to undo).
 */
function CooperativeGestures({ enabled }: { enabled: boolean }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    if (!prefersCooperativeGestures()) return
    if (enabled) map.cooperativeGestures.enable()
    else map.cooperativeGestures.disable()
  }, [map, isLoaded, enabled])
  return null
}

/** Drop consecutive duplicate points (shared endpoints between legs). */
function dedupeConsecutive(coords: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const c of coords) {
    const last = out[out.length - 1]
    if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c)
  }
  return out
}

/** "transport-hub" → "Transport Hub" for chip labels. */

/** Clean monochrome stroke icon per stop category — Lucide-style paths, no dep. */
function catIcon(cat: string | undefined): React.ReactNode {
  const paths: Record<string, string> = {
    food: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7', // utensils
    hotel: 'M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9', // bed
    rest: 'M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4ZM7 2v3M11 2v3', // coffee
    temple: 'M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2 3 7h18l-9-5Z', // landmark
    beach: 'M22 12a10 10 0 0 0-20 0ZM12 12v8a2 2 0 0 0 4 0M2 12h20', // umbrella
    nature: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10ZM2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12', // leaf
    adventure: 'm8 3 4 8 5-5 5 15H2L8 3Z', // mountains
    shopping: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0', // bag
    museum: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M6 12h12M2 22h20', // building
    travel: 'M8 19l-2 3M16 19l2 3M5 11h14M7 4h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM8.5 14.5h.01M15.5 14.5h.01', // train
    'transport-hub': 'M8 19l-2 3M16 19l2 3M5 11h14M7 4h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM8.5 14.5h.01M15.5 14.5h.01',
    event: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', // calendar
  }
  // camera — default for sightseeing and anything unmapped
  const d = paths[cat ?? ''] ?? 'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z'
  return (
    <svg className="yf-pin-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

export function TripMap({ trip, onOpenStop, nearbyPois = [], onAddNearby, focusDay, showToolbar = true, activeHitId = null, onActivateHit, onOpenInTimeline, onOpenInBoard }: {
  trip: Trip
  onOpenStop?: (stopId: string) => void
  /** potential POIs to show as gold "idea" markers */
  nearbyPois?: PlaceHit[]
  /** when set, idea markers get a + button to add the POI straight from the map */
  onAddNearby?: (hit: PlaceHit) => void
  /** external day-focus driver (Board column select): a day index shows just that
      day's route, 'all' resets to the whole trip. Undefined = map owns its filter. */
  focusDay?: number | 'all'
  /** false = no in-map toolbar (day chips / Recentre / Expand). The Board hides
      it: those controls sit at the top of the map shell, which is an absolute
      backdrop there, so the chips peeked out from behind the Board's info card.
      The Board provides the equivalents (column-click focus + 🎯 Fit route). */
  showToolbar?: boolean
  /** the suggestion currently highlighted in the side panel — its pin glows and
      the camera eases to it, so a card hover answers "where is this?" */
  activeHitId?: string | number | null
  /** pin hover/click raises the activation so the panel row highlights + scrolls into view */
  onActivateHit?: (id: string | number | null) => void
  /** stop-pin click offers a jump to the Timeline/Board tabs (Map tab §6.5) */
  onOpenInTimeline?: (stopId: string) => void
  onOpenInBoard?: (stopId: string) => void
}) {
  const [dayFilter, setDayFilter] = useState<number | 'all'>('all')
  // Board drives the day filter through the prop; the map's own chips keep working
  // independently until the next focus change (React bails on identical values).
  useEffect(() => {
    if (focusDay !== undefined) setDayFilter(focusDay)
  }, [focusDay])
  const [showReturn, setShowReturn] = useState(true)
  // Live location ("show me on the map") — off by default so GPS stays cold
  // until the user asks for it; the toggle chip sits by the map key.
  const [liveOn, setLiveOn] = useState(false)
  const toggleLive = () => {
    haptic(liveOn ? 'toggle' : 'select')
    setLiveOn(v => !v)
  }
  // Map key (legend) visibility — hidden by default so it stops covering the
  // bottom-right of the map; the choice persists per browser via uiPrefs.
  const [legendOpen, setLegendOpen] = useState(() => loadFlag('map_legend_open', false))
  function toggleLegend() {
    setLegendOpen(open => {
      saveFlag('map_legend_open', !open)
      return !open
    })
  }
  // Expanded mode — the whole map shell breaks out of the page into a fixed
  // overlay so the canvas gets the viewport. Transient by design: Escape or
  // the same chip (now "⤡ Collapse") reverts it; nothing is persisted.
  const [expanded, setExpanded] = useState(false)
  // Selected stop (stop-pin click) — powers the compact cross-link popup that
  // jumps to the Timeline/Board tabs. Null = no popup.
  const [selectedStop, setSelectedStop] = useState<{ id: string; title: string; dayIndex: number } | null>(null)
  // Collapse plays a short scale-down first (mapCollapse) so expand/collapse
  // both glide; the class is transient and the timer is cleared on unmount.
  const [closing, setClosing] = useState(false)
  const collapseTimer = useRef<number | undefined>(undefined)
  function collapseExpanded() {
    if (!expanded || closing) return
    setClosing(true)
    collapseTimer.current = window.setTimeout(() => { setExpanded(false); setClosing(false) }, 280)
  }
  useEffect(() => () => window.clearTimeout(collapseTimer.current), [])
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') collapseExpanded() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, closing])
  // Nearby-idea category filter: categories listed here are HIDDEN on the map.
  // Empty set = everything visible (the default).
  const [hiddenIdeaCats, setHiddenIdeaCats] = useState<Set<string>>(new Set())
  // Categories actually present among the ideas, most common first — chips are
  // only shown for categories that have at least one marker on the map.
  const ideaCats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const h of nearbyPois) {
      const c = h.category ?? 'sightseeing'
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [nearbyPois])
  // Coord-less ideas (Mappls eLoc hits arrive as 0,0) resolve in the
  // background — Google Place Details when a placeId exists, Nominatim
  // otherwise (1 req/s). Markers pop in as coords land; failures stay
  // panel-only. Capped at 10 per ideas batch.
  const [coordFixes, setCoordFixes] = useState<Record<string, { lat: number; lng: number }>>({})
  useEffect(() => {
    let cancelled = false
    const pending = nearbyPois.filter(h => !hasCoords(h) && coordFixes[h.id as string] == null).slice(0, 10)
    if (pending.length === 0) return
    ;(async () => {
      for (const h of pending) {
        try {
          const r = await resolveHitCoords(h)
          if (!cancelled && hasCoords(r)) {
            setCoordFixes(prev => ({ ...prev, [h.id as string]: { lat: r.latitude, lng: r.longitude } }))
          }
        } catch { /* best-effort — the panel still lists it */ }
        if (!cancelled && !h.placeId) await new Promise(res => setTimeout(res, 1100))
      }
    })()
    return () => { cancelled = true }
  }, [nearbyPois])
  const mappedPois = useMemo(
    () => nearbyPois.map(h => {
      const f = coordFixes[h.id as string]
      return f ? { ...h, latitude: f.lat, longitude: f.lng } : h
    }),
    [nearbyPois, coordFixes],
  )
  const visiblePois = useMemo(
    () => {
      const mappable = mappablePois(mappedPois)
      return hiddenIdeaCats.size === 0
        ? mappable
        : mappable.filter(h => !hiddenIdeaCats.has(h.category ?? 'sightseeing'))
    },
    [mappedPois, hiddenIdeaCats],
  )
  function toggleIdeaCat(cat: string) {
    setHiddenIdeaCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
  )
  const mapRef = useRef<MapRef | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)

  // follow the app's theme toggle
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const daysToPlot = useMemo(() => {
    return trip.days
      .filter(d => dayFilter === 'all' || d.index === dayFilter)
      .map(d => ({
        index: d.index,
        stops: [...d.stops]
          .filter(s => s.status !== 'rejected')
          .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng))
          .sort((a, b) => a.orderInDay - b.orderInDay),
      }))
      .filter(d => d.stops.length > 0)
  }, [trip, dayFilter])

  const allPoints = useMemo(
    () =>
      daysToPlot.flatMap(d =>
        d.stops.map(s => ({ ...s, dayIndex: d.index })),
      ),
    [daysToPlot],
  )

  // A day's ride as the ENGINE plans it: origin → stops → synthesized
  // destination (an outbound continuation, or the final day's ride home).
  // Day routes must follow this, not raw stored stops — an anchor-only day's
  // ride (Day 1 outbound from the start anchor, the last day's drive back to
  // home) exists only in the synthesis, and drawing stored stops alone left
  // those days with no route on the map at all. Null = no drive (stay day).
  const dayRoutePoints = useMemo(() => {
    const out: Record<string, { lat: number; lng: number }[] | null> = {}
    for (const d of trip.days) {
      const j = buildJourney(trip, d)
      if (!(j.distanceKm >= 0.5 || j.driveMinutes > 0)) { out[String(d.index)] = null; continue }
      const pts = j.points
        .map(p => ({ lat: p.lat, lng: p.lng }))
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      out[String(d.index)] = pts.length >= 2 ? pts : null
    }
    return out
  }, [trip])
  const dayRoutesKey = useMemo(
    () => Object.entries(dayRoutePoints)
      .map(([k, v]) => `${k}:${(v ?? []).map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('>')}`)
      .join('|'),
    [dayRoutePoints],
  )

  // The map mounts lazily inside a Suspense boundary, so mapRef may be null on
  // the first render(s). Poll until the instance exists, then attach to its real
  // 'load' event (checking isStyleLoaded in case it already fired) so mapLoaded
  // reflects the map actually being ready — not just the ref existing.
  const pointsKey = useMemo(
    () => allPoints.map(p => `${p.dayIndex}:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|'),
    [allPoints],
  )
  useEffect(() => {
    if (allPoints.length === 0) { setMapLoaded(false); return }
    let cancelled = false
    let attached = false
    const tick = setInterval(() => {
      if (cancelled) return
      const m = mapRef.current
      if (!m) return
      if (!attached) {
        attached = true
        const onLoad = () => { if (!cancelled) setMapLoaded(true) }
        if (m.isStyleLoaded()) onLoad()
        else m.once('load', onLoad)
        clearInterval(tick)
      }
    }, 120)
    return () => { cancelled = true; clearInterval(tick) }
  }, [pointsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // fit the viewport to the route whenever the map is ready and the points change
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || allPoints.length === 0) return
    const m = mapRef.current
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (const p of allPoints) {
      if (p.lng < minLng) minLng = p.lng
      if (p.lng > maxLng) maxLng = p.lng
      if (p.lat < minLat) minLat = p.lat
      if (p.lat > maxLat) maxLat = p.lat
    }
    // single point (or near-zero bounds) — pad so fitBounds has real area
    if (maxLng - minLng < 1e-4) { minLng -= 0.08; maxLng += 0.08 }
    if (maxLat - minLat < 1e-4) { minLat -= 0.08; maxLat += 0.08 }
    const run = () => {
      m.resize()
      m.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 70, maxZoom: 12, duration: prefersReducedMotion() ? 0 : 400 },
      )
    }
    requestAnimationFrame(run)
  }, [pointsKey, mapLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Panel → map highlight: when a suggestion card is hovered/selected in the
  // side panels, glide the camera to its pin so the user sees where it is.
  useEffect(() => {
    if (activeHitId == null || !mapLoaded || !mapRef.current) return
    const hit = nearbyPois.find(h => h.id === activeHitId)
    if (!hit || !hasCoords(hit)) return
    const m = mapRef.current
    m.easeTo({
      center: [hit.longitude, hit.latitude],
      zoom: Math.max(m.getZoom(), 7),
      duration: prefersReducedMotion() ? 0 : 500,
    })
  }, [activeHitId, mapLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  function fitToTrip() {
    const m = mapRef.current
    if (!m || allPoints.length === 0) return
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (const p of allPoints) {
      if (p.lng < minLng) minLng = p.lng
      if (p.lng > maxLng) maxLng = p.lng
      if (p.lat < minLat) minLat = p.lat
      if (p.lat > maxLat) maxLat = p.lat
    }
    if (maxLng - minLng < 1e-4) { minLng -= 0.08; maxLng += 0.08 }
    if (maxLat - minLat < 1e-4) { minLat -= 0.08; maxLat += 0.08 }
    m.resize()
    m.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 70, maxZoom: 12, duration: prefersReducedMotion() ? 0 : 400 })
  }

  function colorForDay(i: number): string {
    return DAY_COLORS[i % DAY_COLORS.length]
  }

  // Category-coloured idea pins: each suggestion type gets its own hue so the
  // map reads at a glance (hotel≠food≠fuel≠sight). Falls back to amber.
  const IDEA_PIN_COLORS: Record<string, string> = {
    hotel: '#06B6D4',
    food: '#EF4444',
    rest: '#F97316',
    'transport-hub': '#F59E0B',
    temple: '#8B5CF6',
    beach: '#0EA5E9',
    nature: '#22C55E',
    museum: '#6366F1',
    shopping: '#EC4899',
    adventure: '#F97316',
    event: '#A855F7',
    travel: '#14B8A6',
    sightseeing: '#EAB308',
  }
  function ideaPinColor(cat?: string): string {
    return IDEA_PIN_COLORS[cat ?? ''] ?? '#F59E2D'
  }

  // Real road geometry from OSRM. In "all days" mode a single connected chain —
  // the stops in timeline order — is drawn as one main line. In single-day mode
  // each day gets its own coloured line. Falls back to straight lines.
  const [geom, setGeom] = useState<Record<string, [number, number][]>>({})
  const chainKey = useMemo(
    () => allPoints.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('>'),
    [allPoints],
  )
  // straight-line fallback geometry for the sequential path (all mode)
  const allStraight = useMemo(
    () => allPoints.map(p => [p.lng, p.lat] as [number, number]),
    [allPoints],
  )

  // Round-trip return drive: last plotted point → trip start (home). Only for
  // self-drive round trips with a geocoded home, and only when home isn't
  // already the last plotted anchor. Toggleable via the map filter chips.
  const returnLeg = useMemo(() => {
    if (!isRoundTrip(trip) || !trip.startLocationCoords) return null
    const last = allPoints[allPoints.length - 1]
    if (!last) return null
    const h = trip.startLocationCoords
    if (Math.abs(h.lat - last.lat) < 1e-4 && Math.abs(h.lng - last.lng) < 1e-4) return null
    return { from: { lat: last.lat, lng: last.lng }, home: { lat: h.lat, lng: h.lng } }
  }, [trip, allPoints])
  const returnStraight = useMemo(
    () => (returnLeg ? [[returnLeg.from.lng, returnLeg.from.lat], [returnLeg.home.lng, returnLeg.home.lat]] as [number, number][] : null),
    [returnLeg],
  )

  useEffect(() => {
    if (allPoints.length === 0) { setGeom({}); return }
    let cancelled = false
    ;(async () => {
      const pts: { lat: number; lng: number }[] = allPoints.map(p => ({ lat: p.lat, lng: p.lng }))
      if (dayFilter === 'all') {
        if (pts.length < 2) return
        const next: Record<string, [number, number][]> = {}
        try {
          const legs = await routePath(pts, getAssumptions(trip))
          const coords = legs.flatMap(l => l.geometry)
          if (!cancelled && coords.length > 1) next.all = dedupeConsecutive(coords)
        } catch { /* straight-line fallback below */ }
        // return drive home — real roads when OSRM answers, straight line otherwise
        if (returnLeg) {
          try {
            const legs = await routePath([returnLeg.from, returnLeg.home], getAssumptions(trip))
            const coords = legs.flatMap(l => l.geometry)
            if (!cancelled && coords.length > 1) next.return = dedupeConsecutive(coords)
          } catch { /* keep straight line */ }
        }
        if (!cancelled) setGeom(next)
      } else {
        const next: Record<string, [number, number][]> = {}
        for (const d of trip.days) {
          const ride = dayRoutePoints[String(d.index)]
          if (!ride || ride.length < 2) continue
          try {
            const legs = await routePath(ride, getAssumptions(trip))
            const coords = legs.flatMap(l => l.geometry)
            if (!cancelled && coords.length > 1) next[String(d.index)] = dedupeConsecutive(coords)
          } catch { /* straight-line fallback below */ }
        }
        if (!cancelled) setGeom(next)
      }
    })()
    return () => { cancelled = true }
  }, [chainKey, dayRoutesKey, dayFilter, returnLeg]) // eslint-disable-line react-hooks/exhaustive-deps

  // Turn-by-turn directions for the selected day's ride in the traveller's own
  // Google Maps — the in-app map plots the route but doesn't navigate. Hidden
  // on "All days" and on stay days (no ride to hand off).
  const dayDirectionsUrl = useMemo(
    () => (dayFilter === 'all' ? null : googleMapsDirectionsUrl(dayRoutePoints[String(dayFilter)] ?? [])),
    [dayFilter, dayRoutePoints],
  )

  return (
    <div className={`map-shell${expanded ? ' map-shell--expanded' : ''}${closing ? ' map-shell--closing' : ''}`}>
      {showToolbar && (
      <div className="map-toolbar">
        <div className="map-day-filter">
          <button className={`map-day-chip ${dayFilter === 'all' ? 'on' : ''}`} aria-pressed={dayFilter === 'all'} onClick={() => setDayFilter('all')}>All days</button>
          {trip.days.map(d => (
            <button key={d.index} className={`map-day-chip ${dayFilter === d.index ? 'on' : ''}`} aria-pressed={dayFilter === d.index} onClick={() => setDayFilter(d.index)}>
              Day {d.index + 1}
            </button>
          ))}
          <button className="map-day-chip map-recenter" onClick={fitToTrip} title="Recentre the map on the trip route"><LocateFixed size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Recentre</button>
          {returnLeg && (
            <button
              className={`map-day-chip ${showReturn ? 'on' : ''}`}
              aria-pressed={showReturn}
              onClick={() => setShowReturn(s => !s)}
              title="Show or hide the drive back home"
            >
              <RotateCcw size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Return home
            </button>
          )}
          {dayDirectionsUrl && (
            <button
              className="map-day-chip"
              onClick={() => openExternal(dayDirectionsUrl)}
              title="Open this day's ride with turn-by-turn directions in Google Maps"
            >
              <Navigation size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Directions
            </button>
          )}
          {/* Nearby-idea category filters — hide/show the gold idea markers by
              type. Only rendered when there are ideas to filter. */}
          {ideaCats.length > 0 && (
            <>
              {ideaCats.map(([cat, count]) => (
                <button
                  key={cat}
                  className={`map-day-chip map-idea-chip ${hiddenIdeaCats.has(cat) ? '' : 'on'}`}
                  aria-pressed={!hiddenIdeaCats.has(cat)}
                  onClick={() => toggleIdeaCat(cat)}
                  title={hiddenIdeaCats.has(cat) ? `Show ${count} ${titleCase(cat).toLowerCase()} idea${count === 1 ? '' : 's'}` : `Hide ${titleCase(cat).toLowerCase()} ideas`}
                >
                  <CatIcon category={cat} size={13} className="yf-idea-chip-ico" />
                  {titleCase(cat)}
                  <span className="yf-idea-chip-count">{count}</span>
                </button>
              ))}
            </>
          )}
          <button
            className={`map-day-chip map-expand-chip${expanded ? ' on' : ''}`}
            onClick={() => (expanded ? collapseExpanded() : setExpanded(true))}
            title={expanded ? 'Shrink the map back into the page (Esc)' : 'Expand the map to fill the screen'}
            aria-label={expanded ? 'Shrink the map back into the page' : 'Expand the map to fill the screen'}
          >
            {expanded ? '⤡ Collapse' : '⤢ Expand'}
          </button>
        </div>
      </div>
      )}

      <div className="map-frame">
        {allPoints.length === 0 ? (
          <div className="empty-state"><div className="big"><MapIcon size={38} aria-hidden /></div><p>No confirmed stops to plot yet — add some in the Timeline.</p></div>
        ) : (
          <MapLibreMap
            ref={mapRef}
            theme={theme}
            className="yf-maplibre"
            center={[76.5, 10.5]}
            zoom={5}
          >
            <MapControls position="top-right" showFullscreen />
            {/* Inline on a coarse pointer: one finger scrolls the page.
                Expanded (or a mouse): normal gestures. */}
            <CooperativeGestures enabled={!expanded} />
            {/* Live location layer — mounted always, self-gating on `liveOn`. */}
            <LiveLocationLayer active={liveOn} />
            {/* In All-days view a single connected main line from the trip start
                through every stop to the end; in single-day view, coloured lines.
                Both get a contrasting casing underneath (road-map halo) and
                direction chevrons on top so travel order reads at a glance. */}
            {dayFilter === 'all' ? (() => {
              const coords = geom.all?.length ? geom.all : allStraight
              const dark = theme === 'dark'
              return (
                <>
                  <MapRoute
                    id="yf-main-casing"
                    coordinates={coords}
                    color={dark ? '#0B2545' : '#FFFFFF'}
                    width={9}
                    opacity={dark ? 0.6 : 0.75}
                    interactive={false}
                  />
                  <MapRoute coordinates={coords} color="#2A6FDB" width={4.5} opacity={0.95} />
                  <RouteArrows coordinates={coords} dark={dark} />
                </>
              )
            })() : (
              trip.days
                .filter(d => dayRoutePoints[String(d.index)])
                .map(d => {
                  const ride = dayRoutePoints[String(d.index)]!
                  const coords = geom[String(d.index)]?.length
                    ? geom[String(d.index)]
                    : ride.map(p => [p.lng, p.lat] as [number, number])
                return (
                  <Fragment key={`day-${d.index}`}>
                    <MapRoute
                      id={`yf-day-casing-${d.index}`}
                      coordinates={coords}
                      color={theme === 'dark' ? '#0B2545' : '#FFFFFF'}
                      width={8}
                      opacity={theme === 'dark' ? 0.6 : 0.75}
                      interactive={false}
                    />
                    <MapRoute
                      coordinates={coords}
                      color={colorForDay(d.index)}
                      width={4}
                      opacity={0.95}
                    />
                    <RouteArrows coordinates={coords} dark={theme === 'dark'} />
                  </Fragment>
                )
              })
            )}
            {/* Round-trip return drive home — dashed slate line so "coming back"
                reads differently from the outbound day colours. Toggleable. */}
            {dayFilter === 'all' && returnLeg && showReturn && (() => {
              const rCoords = geom.return?.length ? geom.return : returnStraight!
              const dark = theme === 'dark'
              return (
                <>
                  <MapRoute
                    id="yf-return-casing"
                    coordinates={rCoords}
                    color={dark ? '#0B2545' : '#FFFFFF'}
                    width={8}
                    opacity={dark ? 0.6 : 0.75}
                    interactive={false}
                  />
                  <MapRoute
                    id="yf-return-line"
                    coordinates={rCoords}
                    color={dark ? '#94A3B8' : '#64748B'}
                    width={3.5}
                    opacity={0.95}
                    dashArray={[1.8, 1.6]}
                  />
                  <RouteArrows coordinates={rCoords} dark={dark} />
                </>
              )
            })()}
            {(() => {
              let num = 0
              return allPoints.map((p, idx) => {
                // Auto anchor stops (trip start / final destination) render as
                // distinct start/end badges instead of numbered pins.
                const isFirst = idx === 0
                const isLast = idx === allPoints.length - 1
                if (p.auto) {
                  const label = isLast ? <Flag size={13} aria-hidden /> : <PlaneTakeoff size={13} aria-hidden />
                  return (
                    <MapMarker key={p.id} longitude={p.lng} latitude={p.lat}>
                      <MarkerContent>
                        <span className="yf-map-pin yf-map-flag" title={p.title}>{label}</span>
                      </MarkerContent>
                      <MarkerTooltip>{isLast ? `Final destination — ${p.title}` : `Trip start — ${p.title}`}</MarkerTooltip>
                    </MapMarker>
                  )
                }
                num += 1
                return (
                  <MapMarker key={p.id} longitude={p.lng} latitude={p.lat}>
                    <MarkerContent>
                      <button
                        className={`yf-map-pin yf-map-tear${p.status === 'maybe' ? ' yf-map-maybe' : ''}`}
                        style={{ '--pin-color': colorForDay(p.dayIndex) } as React.CSSProperties}
                        onClick={() => { onOpenStop?.(p.id); if (onOpenInTimeline || onOpenInBoard) setSelectedStop({ id: p.id, title: p.title, dayIndex: p.dayIndex }) }}
                        aria-label={`Stop ${num}: ${p.title}`}
                        title={p.title}
                      >
                        <span className="yf-pin-face">
                          <span className="yf-pin-ico" aria-hidden><CatIcon category={p.category} size={15} className="yf-pin-svg" /></span>
                          <i className="yf-pin-num">{num}</i>
                        </span>
                      </button>
                    </MarkerContent>
                    <MarkerTooltip>{p.title}</MarkerTooltip>
                  </MapMarker>
                )
              })
            })()}
            {/* home anchor for round trips — the return drive ends here */}
            {dayFilter === 'all' && returnLeg && (
              <MapMarker longitude={returnLeg.home.lng} latitude={returnLeg.home.lat}>
                <MarkerContent>
                  <span className="yf-map-pin yf-map-flag" title={trip.startLocation}><Home size={13} aria-hidden /></span>
                </MarkerContent>
                <MarkerTooltip>Home — return drive ends here ({trip.startLocation})</MarkerTooltip>
              </MapMarker>
            )}
            {/* nearby idea markers — category-coloured, dashed, with quick-add.
                Pin click/hover = select: the panel row highlights and scrolls
                into view; adding moved to the explicit + chip beside the pin. */}
            {visiblePois.map(hit => {
              const active = activeHitId != null && activeHitId === hit.id
              return (
                <MapMarker key={`nearby_${hit.id}`} longitude={hit.longitude} latitude={hit.latitude}>
                  <MarkerContent>
                    <span className="yf-map-idea" title={`${hit.name} — click to locate in the suggestions panel`}>
                      <span
                        className={`yf-map-pin yf-map-pin-idea${active ? ' yf-map-pin-idea--active' : ''}`}
                        style={{ background: ideaPinColor(hit.category) } as React.CSSProperties}
                        role="button"
                        tabIndex={0}
                        aria-label={`Locate ${hit.name} in the suggestions panel`}
                        onClick={() => onActivateHit?.(hit.id as string | number)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivateHit?.(hit.id as string | number) } }}
                      >
                        <CatIcon category={hit.category} size={14} />
                      </span>
                      {onAddNearby && (
                        <button
                          className="yf-map-idea-add"
                          onClick={e => { e.stopPropagation(); onAddNearby(hit) }}
                          aria-label={`Add ${hit.name} to the trip`}
                          title={`Add ${hit.name} to the trip`}
                        >+</button>
                      )}
                    </span>
                  </MarkerContent>
                  <MarkerTooltip>
                    <Lightbulb size={11} aria-hidden style={{ verticalAlign: '-1px', marginRight: 3 }} />{hit.name}{hit.haltPurpose ? ` · ${hit.haltPurpose === 'overnight' ? 'overnight option' : hit.haltPurpose}` : ''}{hit.cumKm != null ? ` · ~${hit.cumKm} km in` : ''}{hit.nearestCity ? ` · near ${hit.nearestCity}` : ''}
                  </MarkerTooltip>
                </MapMarker>
              )
            })}
          </MapLibreMap>
        )}

        {selectedStop && (onOpenInTimeline || onOpenInBoard) && (
          <div className="yf-stop-jump" role="dialog" aria-label={`Selected stop: ${selectedStop.title}`}
            style={{ position: 'absolute', left: '50%', bottom: 14, transform: 'translateX(-50%)', zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-soft)', maxWidth: 'calc(100% - 24px)' }}>
            <span className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{selectedStop.title}</span>
            {onOpenInTimeline && (
              <button className="btn btn-sm btn-primary" onClick={() => { onOpenInTimeline(selectedStop.id); setSelectedStop(null) }}>Open in Timeline</button>
            )}
            {onOpenInBoard && (
              <button className="btn btn-sm btn-outline" onClick={() => { onOpenInBoard(selectedStop.id); setSelectedStop(null) }}>Open in Board</button>
            )}
            <button className="icon-btn" onClick={() => setSelectedStop(null)} aria-label="Close" style={{ flex: '0 0 auto' }}><X size={14} aria-hidden /></button>
          </div>
        )}

        <div className="map-legend">
          <button
            className={`map-legend-toggle${liveOn ? ' map-live-on' : ''}`}
            onClick={toggleLive}
            aria-pressed={liveOn}
            title={liveOn ? 'Stop showing my live location' : 'Show my live location on the map'}
            aria-label={liveOn ? 'Stop showing my live location' : 'Show my live location on the map'}
          >
            <LocateFixed size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{liveOn ? 'Live on' : 'Locate me'}
          </button>
          <button
            className="map-legend-toggle"
            onClick={toggleLegend}
            aria-expanded={legendOpen}
            title={legendOpen ? 'Hide the map key' : 'Show the map key'}
            aria-label={legendOpen ? 'Hide the map key' : 'Show the map key'}
          >
            {legendOpen ? <><X size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Hide key</> : <><Info size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Key</>}
          </button>
          {legendOpen && (
            <div className="map-legend-body">
              {dayFilter === 'all'
                ? <>blue line = whole route{returnLeg ? ' · dashed = drive back home' : ''} · </>
                : <>colours = day · </>}
              pin icon = stop type · number = timeline order · dashed pin = "maybe" · plane/flag pins = start & final destination · gold bulb markers = nearby ideas{onAddNearby ? ' (+ to add)' : ''}{ideaCats.length > 0 ? ' · chips filter ideas by type' : ''} · click a pin for details
            </div>
          )}
        </div>
      </div>
      <p className="hint-text" style={{ marginTop: 8 }}>
        <TriangleAlert size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Route lines follow real roads (© OSRM/OpenStreetMap) when available; distances/durations in the plan are real-road estimates for ground travel, falling back to transparent haversine assumptions when offline/other modes — no live traffic data.
      </p>
    </div>
  )
}
