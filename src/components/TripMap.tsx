// ============ Trip route map ============
// Real slippy-map rendering via mapcn (MapLibre GL): OpenFreeMap basemaps that follow
// light/dark theme, numbered stop markers in timeline order, and a polyline
// connecting each day's stops. Distances/durations still come from the engine.
import { useMemo, useState, useEffect, useRef, Fragment, type ComponentProps } from 'react'
import { useInView, usePageVisible } from './ui'
import type { Trip } from '../data/types'
import type { PlaceHit } from '../lib/geocode'
import { resolveHitCoords } from '../lib/geocode'
import { hasCoords, mappablePois, projectOntoPolyline } from '../lib/providers/hits'
import { buildRoadChain, measureDayRide, roadChainSig, routeDrawGrade } from '../lib/tripRoad'
import { buildJourney, getAssumptions, isRoundTrip } from '../lib/engine'
import { clockHM, type ClockMilestone } from '../lib/clockOverlay'
import { pointAtKm } from '../lib/geo'
import { useTimeFormat, formatHM } from '../lib/timefmt'
import { extraJourneyMarkers } from '../lib/journeyMarkers'
import { allViewFitPoints, boundsOf, type LatLng } from '../lib/mapFit'
import { coincidentPinOffsets } from '../lib/pinOffsets'
import { googleMapsDirectionsUrl } from '../lib/externalMaps'
import { openExternal } from '../lib/native'
import { titleCase } from '../lib/labels'
import { haptic } from '../lib/haptics'
import { nativeWatch } from '../lib/native'
import { loadFlag, saveFlag } from '../lib/uiPrefs'
import {
  applyViewModeOnMap, HERO_3D_CAMERA, MAP_VIEW_MODES, MAP_VIEW_MODE_META,
  heroBearingForRoute, heroCameraMove,
  type MapViewMode,
} from '../lib/mapViewModes'
import type { MapRef } from './mapcn/map'
import { InlineIcon, CatIcon } from './icons'
import {
  Box, CircleDot, Clock, Flag, Home, Info, Lightbulb, LocateFixed, Map as MapIcon, Mountain, Navigation, PlaneTakeoff,
  RotateCcw, Search, TriangleAlert, X,
} from 'lucide-react'
import { prefersReducedMotion, motionTiming } from '../lib/motion'
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

// Observe the marker itself: panning a pin outside the map also pauses its
// decoration. GPS ownership remains in LiveLocationLayer, independent of this.
function VisiblePulse({ children, ...props }: ComponentProps<'span'>) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref)
  const visible = usePageVisible()
  return <span {...props} ref={ref} data-motion-paused={!inView || !visible}>{children}</span>
}

const DAY_COLORS = ['#0D8D82', '#F59E2D', '#7C5CFC', '#E2557B', '#2D9CDB', '#6BBF59', '#B03A2E'] // #B7791F sat 1.6° from #F59E2D (two orange days); brick clears it by 28°

// #370: a line that is NOT a measured road is drawn dashed and in the --warn
// ink the detour spur already uses (read at paint time, with this file's hex
// fallback). Same treatment on every surface, so an unresolved measurement can
// never wear road paint — and the dash plus the missing chevrons say so without
// a word, which matters because this component cannot tell "still measuring"
// from "the measurement failed" (its host owns the status and says it).
const ROUGH_DASH: [number, number] = [2, 2]

// How long the map's ready gate waits for the style's 'load' event before
// opening anyway (see the mapLoaded effect). The fit behind that gate is a
// camera operation — resize + fitBounds need the instance and its container,
// not a resolved style — so a stalled style must never leave it permanently
// dead. The stall is real: a hidden webview can hold a style mid-load forever.
const STYLE_LOAD_WATCHDOG_MS = 4000

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
        <VisiblePulse className={`yf-live-dot${denied ? ' yf-live-dot--denied' : ''}`} aria-label="Your live location" role="img">
          <span className="yf-live-pulse" aria-hidden />
          <span className="yf-live-core" aria-hidden />
        </VisiblePulse>
      </MarkerContent>
    </MapMarker>
  )
}

/**
 * Per-instance id for a map layer's source/layer/image names (#332 R2).
 * `getRandomValues` rather than `Math.random()` — it is the repo-wide rule for
 * minting identity (and it resolves outside a secure context); the counter keeps
 * two instances created in the same tick apart even where `crypto` is missing.
 */
let arrowInstanceSeq = 0
function arrowInstanceId(): string {
  const bytes = new Uint8Array(4)
  globalThis.crypto?.getRandomValues?.(bytes)
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  arrowInstanceSeq += 1
  return `${hex}-${arrowInstanceSeq}`
}

/**
 * Direction chevrons along the route — a symbol layer fed by the same line
 * geometry, rendered with a tiny dependency-free triangle icon (addImage from
 * raw pixel data, so no font/glyph dependency on the basemap).
 */
function RouteArrows({ coordinates, dark }: { coordinates: [number, number][]; dark: boolean }) {
  const { map, isLoaded } = useMap()
  const instId = useRef(arrowInstanceId()).current
  useEffect(() => {
    if (!isLoaded || !map || coordinates.length < 2) return
    // Per-instance source/layer ids — a single shared id made concurrent
    // instances (main line + return drive) overwrite each other's geometry.
    const SRC = `yf-arrows-src-${instId}`
    const LAYER = `yf-arrows-${instId}`
    // The IMAGE is per-instance too (#332 R2). One shared `yf-arrow` leaked: the
    // cleanup below removed layer+source and nothing else, so every map open
    // added a 9×9 image the session never released. Removing it on unmount is
    // only safe per-instance — a shared image taken away by whichever instance
    // unmounted first would strip the icon from the sibling still on screen,
    // which re-adds it only behind `if (!map.hasImage(...))`.
    const IMAGE = `yf-arrow-${instId}`
    if (!map.hasImage(IMAGE)) {
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
      map.addImage(IMAGE, { width: size, height: size, data })
    }
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } } })
      map.addLayer({
        id: LAYER, type: 'symbol', source: SRC,
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 130,
          'icon-image': IMAGE,
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
        if (map.hasImage(IMAGE)) map.removeImage(IMAGE)
      } catch { /* style swapped mid-flight */ }
    }
  }, [map, isLoaded, coordinates, dark])
  return null
}

// minimal structural typing so we don't need to import maplibre-gl directly here
declare module './mapcn/map' {}
type GeoJSONSourceLike = { setData(d: unknown): void }

// ============ Road milestone labels on the map (requested redesign) ============

/**
 * The clock drawn as clean ROAD LABELS — no pins, no dots, no circles. Each
 * planned anchor (meal / overnight / destination) is a zero-size anchor ON the
 * route with two text chips flanking it: the wall-clock time + calendar date on
 * the LEFT of the road and the road km on the RIGHT. Replaces the old soft
 * circles / evening band / moon glyphs: nothing here is an area or an icon,
 * every label is a planned stop.
 *
 * Return-leg labels follow the Return home toggle: with it off, only the
 * outbound half renders, so the going-home readings never clutter the map the
 * traveller hasn't asked to see.
 */
function ClockMilestoneLayer({ overlay, showReturn, onOpenDay }: { overlay: ClockMilestone[]; showReturn: boolean; onOpenDay?: (dayIndex: number) => void }) {
  const { isLoaded } = useMap()
  const timeFormat = useTimeFormat()
  if (!isLoaded || overlay.length === 0) return null
  return (
    <>
      {overlay.filter(m => m.leg === 'outbound' || showReturn).map((m, i) => {
        // Phase 3: an overnight halt is a decision ("where do we sleep"), so it
        // is the one label that earns a tap — it opens that day's plan. Every
        // other label stays decorative context. The tap target must carry an
        // honest itinerary day (itineraryDay): the walk's return pass indexes
        // its days past the itinerary, and a value no timeline day matches
        // would open nothing (or, worse, the wrong day).
        const halts = m.kind === 'overnight' && typeof onOpenDay === 'function' && m.itineraryDay != null
        const chip = (
          <span className={`yf-milestone yf-milestone--${m.kind}${m.leg === 'return' ? ' yf-milestone--return' : ''} yf-milestone--${m.dayState}`}>
            <span className="yf-milestone-when">
              {m.haltName && <b className="yf-milestone-halt">{m.haltName}</b>}
              <b className="yf-milestone-time">{formatHM(clockHM(m.etaMin), timeFormat)}</b>
              {m.dateLabel && <em className="yf-milestone-date">{m.dateLabel}</em>}
            </span>
            <em className="yf-milestone-km">{m.kmLabel}</em>
          </span>
        )
        return (
          <MapMarker key={`cm-${m.kind}-${m.dayNo}-${m.kmIn}-${i}`} longitude={m.lng} latitude={m.lat} anchor="center">
            <MarkerContent className="yf-milestone-anchor">
              {halts ? (
                <button
                  type="button"
                  className="yf-milestone-hit"
                  onClick={() => onOpenDay(m.itineraryDay!)}
                  title={`Open day ${m.itineraryDay! + 1} in the timeline${m.haltName ? ` - ${m.haltName}` : ''}`}
                  aria-label={`Open day ${m.itineraryDay! + 1} in the timeline${m.haltName ? ` - overnight at ${m.haltName}` : ''}`}
                >{chip}</button>
              ) : chip}
            </MarkerContent>
            <MarkerTooltip>
              {`${m.kind === 'mealtime' ? 'Meal break' : m.kind === 'overnight' ? 'Overnight halt' : 'Destination'}${m.haltName ? ` - ${m.haltName}` : ''} - day ${m.dayNo}${m.dateLabel ? ` (${m.dateLabel})` : ''}: ${formatHM(clockHM(m.etaMin), timeFormat)} at ${m.kmLabel} on the road${m.leg === 'return' ? ', drive home' : ''}${halts ? ', tap for the day' : ''}`}
            </MarkerTooltip>
          </MapMarker>
        )
      })}
    </>
  )
}

/**
 * The suggestion engine's placed stops as DISTANCE labels on the road: one
 * "Km N" chip per placed place that carries a road km, sitting at that km ON
 * the route line (not at the place's own coords, which can sit off the road).
 * No dot — just the label, flanked right of the road like the clock's km half.
 * On a round trip the placed stops are all outbound (the drive home plans no
 * sightseeing), so no return gate is needed here.
 */
function SuggestionDistanceLayer({ places, road }: { places: PlaceHit[]; road: [number, number][] | null }) {
  const { isLoaded } = useMap()
  const pins = useMemo(() => {
    if (!road || road.length < 2) return [] as Array<{ id: string; name: string; km: number; lat: number; lng: number }>
    const poly = road.map(c => ({ lat: c[1], lng: c[0] }))
    const out: Array<{ id: string; name: string; km: number; lat: number; lng: number }> = []
    for (const p of places) {
      const km = p.cumKm
      if (km == null || !(km > 0)) continue
      const at = pointAtKm(poly, km)
      if (!at) continue
      out.push({ id: String(p.id), name: p.name, km, lat: at.lat, lng: at.lng })
    }
    return out
  }, [places, road])
  if (!isLoaded || pins.length === 0) return null
  return (
    <>
      {pins.map(pin => (
        <MapMarker key={`sd-${pin.id}`} longitude={pin.lng} latitude={pin.lat} anchor="center">
          <MarkerContent className="yf-milestone-anchor">
            <span className="yf-milestone yf-milestone--place">
              <em className="yf-milestone-km">{`Km ${Math.round(pin.km)}`}</em>
            </span>
          </MarkerContent>
          <MarkerTooltip>{`${pin.name} - ${Math.round(pin.km)} km into the trip`}</MarkerTooltip>
        </MapMarker>
      ))}
    </>
  )
}

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

/**
 * Map view modes (2D · Terrain · 3D hero) — docs/FEATURE-REQUEST-MAP-VIEWS.md.
 * Mounts inside <Map> (it needs the mapcn context) and reconciles the terrain
 * stack to the mode. Keyed on `isLoaded` (= loaded AND style-loaded), so a
 * theme flip's full style reload — which wipes sources, layers AND terrain —
 * is repaired the moment the new style settles. Camera moves stay out of that
 * effect: setStyle preserves the camera, and the pitch/bearing ride belongs
 * to mode transitions only.
 */
function MapViewModeController({ mode, bearing }: { mode: MapViewMode; bearing?: number | null }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    try {
      applyViewModeOnMap(map, mode)
    } catch { /* style swapped mid-flight — the next isLoaded edge re-applies */ }
  }, [map, isLoaded, mode])
  const prevMode = useRef<MapViewMode>('2d')
  const prevBearing = useRef<number | null>(null)
  useEffect(() => {
    // Gate on `isLoaded` exactly as the reconcile effect above does (#332 R1):
    // easing a camera the incoming style is about to disturb leaves it wrong.
    if (!map || !isLoaded) return
    const duration = prefersReducedMotion() ? 0 : 700
    const { move, bearing: heroBearing } = heroCameraMove(mode, prevMode.current, bearing, prevBearing.current)
    if (move === 'enter') {
      // Dynamic hero cam: look along THIS trip's road (initial route bearing);
      // the prototype's fixed bearing stays only as a geometry-less fallback.
      map.easeTo({ pitch: HERO_3D_CAMERA.pitch, bearing: heroBearing, duration })
    } else if (move === 're-aim') {
      // The road resolved AFTER 3D opened: the fallback bearing was eased, and
      // the edge trigger alone would leave the camera stuck on it forever.
      // Bearing only — the pitch the user is looking at must not jump.
      map.easeTo({ bearing: heroBearing, duration })
    } else if (move === 'flatten') {
      // Leaving 3D: flat camera again, and the terrain stack is dropped by
      // the reconcile effect (map.getTerrain() null is the acceptance check).
      map.easeTo({ pitch: 0, bearing: 0, duration })
    }
    prevMode.current = mode
    prevBearing.current = heroBearing
  }, [map, isLoaded, mode, bearing])
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

/** m2: distinct glyphs for the empty-part pins. Keyed on the PART, not the
 *  label's first letter — Stay and Stretch both read "S" that way, so two
 *  different kinds wore one badge. */
const SLOT_PIN_GLYPH: Record<string, string> = {
  breakfast: 'B', lunch: 'L', fuel: 'F', stretch: 'S', dinner: 'D', stay: 'N',
}

export function TripMap({ trip, onOpenStop, nearbyPois = [], onAddNearby, focusDay, onDayFilterChange, tripReadinessRows = [], showToolbar = true, enableMapViewModes = false, activeHitId = null, onActivateHit, onOpenInTimeline, onOpenInBoard, onDeleteStop, mainRouteGeometry = null, returnRouteGeometry = null, allowSelfMeasurement = true, clockMilestones = null, onOpenHaltDay, onShowReturnChange, slotPins = [], onOpenSlot, hitCosts, searchHitIds }: {
  trip: Trip
  onOpenStop?: (stopId: string) => void
  /** potential POIs to show as gold "idea" markers */
  nearbyPois?: PlaceHit[]
  /** when set, idea markers get a + button to add the POI straight from the map */
  onAddNearby?: (hit: PlaceHit) => void
  /** external day-focus driver (Board column select): a day index shows just that
      day's route, 'all' resets to the whole trip. Undefined = map owns its filter. */
  focusDay?: number | 'all'
  /** the map's own day chips report the day they just filtered to, so a host
      whose plan rail carries the same choice can follow it. A host that cannot
      represent 'all' (the slots rail always plans one day) simply ignores it. */
  onDayFilterChange?: (day: number | 'all') => void
  tripReadinessRows?: ReadonlyArray<{ dayIndex: number; filled: number; required: number }>
  /** false = no in-map toolbar (day chips / Recentre / Expand). The Board hides
      it: those controls sit at the top of the map shell, which is an absolute
      backdrop there, so the chips peeked out from behind the Board's info card.
      The Board provides the equivalents (column-click focus + 🎯 Fit route). */
  showToolbar?: boolean
  /** Map view modes (2D · Terrain · 3D hero) — the toolbar gains the mode
      switcher and the saved preference drives the map. The Board stays hard
      2D: it's a pinned backdrop, it must never spend GPU on terrain, and one
      surface's mode choice shouldn't hijack the other. */
  enableMapViewModes?: boolean
  /** the suggestion currently highlighted in the side panel — its pin glows and
      the camera eases to it, so a card hover answers "where is this?" */
  activeHitId?: string | number | null
  /** pin hover/click raises the activation so the panel row highlights + scrolls into view */
  onActivateHit?: (id: string | number | null) => void
  /** stop-pin click offers a jump to the Timeline/Board tabs (Map tab §6.5) */
  onOpenInTimeline?: (stopId: string) => void
  /** #184 shared road measurement — MapTab's already-measured whole-trip
      outbound geometry. When present, all-days reuses it. */
  mainRouteGeometry?: [number, number][] | null
  /** The measured drive-home geometry, when the workspace chain contains it. */
  returnRouteGeometry?: [number, number][] | null
  /** Board owns its fallback; the workspace-backed Map tab sets this false so
      it never races a pending shared measurement. */
  allowSelfMeasurement?: boolean
  onOpenInBoard?: (stopId: string) => void
  /** the travel clock projected onto the route as road milestones — one pin per
      planned anchor with its wall-clock time and road km on the side, plus the
      suggestion engine's placed stops as distance milestones. Only the trip Map
      tab supplies it; with it present the toolbar gains the Clock toggle and
      stop pins show their planned arrival. The Board never passes it. */
  clockMilestones?: ClockMilestone[] | null
  /** Phase 3: tapping an overnight halt label opens that day's plan — the
   *  handler the workspace wires to the Timeline's day accordion. Undefined
   *  leaves every label decorative (Board view, tests). */
  onOpenHaltDay?: (dayIndex: number) => void
  /** P5.3: an empty part of the day's top candidates - hollow amber pins.
   *  Their tooltip carries P5.2's cost line (arrive / detour / budget share). */
  slotPins?: Array<{ key: string; label: string; name: string; meta: string; hit: PlaceHit }>
  /** Tapping a slot pin opens that part in the plan rail. */
  onOpenSlot?: (key: string) => void
  /** Ids of the CURRENT text search's hits — drawn as distinct selectable
   *  markers (solid teal, "Search result" tooltip) instead of dashed gold
   *  ideas. The host clears its search results when the box empties, so the
   *  markers disappear with them. Undefined = every idea keeps its old look. */
  searchHitIds?: Set<string | number> | null
  hitCosts?: Record<string, string>
  /** Delete the stop straight from the map (popup action) — wired by MapTab. */
  onDeleteStop?: (stopId: string, stop: { title: string; dayIndex: number }) => void
  /** The Return-home toggle's direction state, reported up so the suggestion
   *  rails read the same road the map shows (#polylines): on = the loop (out +
   *  back, the plan's road), off = the outbound road alone. */
  onShowReturnChange?: (show: boolean) => void
}) {
  const [dayFilter, setDayFilter] = useState<number | 'all'>('all')
  // A host drives the day filter through the prop (Board columns, the slots
  // rail's day strip); the map's own chips report their choice back through
  // `onDayFilterChange`, so the two selectors agree whichever one was touched.
  // The effect stays out of that loop: it sets state directly and never calls
  // back, and React bails on an identical value.
  useEffect(() => {
    if (focusDay !== undefined) setDayFilter(focusDay)
  }, [focusDay])
  const [showReturn, setShowReturn] = useState(true)
  // The clock overlay's visibility — on by default when a surface supplies
  // it; the choice persists per browser via uiPrefs, like the map key.
  const [clockOn, setClockOn] = useState(() => loadFlag('map_clock_on', true))
  function toggleClock() {
    haptic('toggle')
    setClockOn(on => {
      saveFlag('map_clock_on', !on)
      return !on
    })
  }
  const timeFormat = useTimeFormat()
  useEffect(() => { onShowReturnChange?.(showReturn) }, [showReturn, onShowReturnChange])
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
  // Map view mode (2D / Terrain / 3D). ALWAYS opens 2D — a stale saved 3D
  // pref used to greet every trip with the hero camera (user ask, PR #105
  // follow-up). The switcher is per-session; a disabled surface (Board) pins
  // 2d outright.
  const [viewMode, setViewMode] = useState<MapViewMode>('2d')
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
    // The unmount rides the same token as mapCollapse's animation, so retiming
    // the CSS retimes the timer; reduced motion skips the glide entirely.
    collapseTimer.current = window.setTimeout(() => { setExpanded(false); setClosing(false) }, prefersReducedMotion() ? 0 : motionTiming('--motion-slow').duration)
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
  // The categories fold into one Filters popover — nine chips sitting beside the
  // day filter is the "twenty same-weight pills" the critique flagged (P1).
  const [filtersOpen, setFiltersOpen] = useState(false)
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
  // Slot pins carry placeholder hits too, and they were read here but missing
  // from the dep list: switching the day changed `slotPins` while `nearbyPois`
  // stayed identical, so the effect never re-ran, the pin never resolved, and a
  // (0,0) placeholder fell through the render guard below and disappeared
  // silently — the Null Island class this file already documents as found live.
  //
  // Ideas and slot pins also get SEPARATE budgets. One shared 10-item queue
  // ordered ideas-first meant a slot pin only got a turn after every unresolved
  // idea, which on a fresh load is never.
  useEffect(() => {
    let cancelled = false
    const seen = new Set<string>()
    const take = (list: PlaceHit[], cap: number) => list
      .filter(h => !hasCoords(h) && coordFixes[h.id as string] == null)
      .slice(0, cap)
    const pending = [...take(nearbyPois, 10), ...take(slotPins.map(p => p.hit), 4)]
      .filter(h => {
        const id = String(h.id)
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `coordFixes` is read
    // to skip what is already fixed; depending on it would restart the queue on
    // every landing and re-attempt hits that can never resolve.
  }, [nearbyPois, slotPins])
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
  /** S4: the hits an empty-part pin is already standing on. Every slot
   *  candidate is drawn from the same corridor pool as the ideas, so without
   *  this the slot pin landed exactly on the idea pin — two markers, one
   *  coordinate, an ambiguous click target. */
  const slotPinIds = useMemo(() => new Set(slotPins.map(p => String(p.hit.id))), [slotPins])
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
          // #polylines plot-boundary guard: a stored (0,0)/mixed placeholder or
          // other absurd coordinate stretches the LineString across the globe,
          // which reads on screen as "the line only connects the first few
          // stops". Same rule as the suggestion rail's hasCoords: lat 0 is
          // never a real pick for an India trip-planner.
          .filter(s => !(s.lat === 0 && s.lng === 0) && s.lat !== 0 && Math.abs(s.lng) <= 180 && Math.abs(s.lat) <= 90)
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

  // Stops sharing one place (a meal at your night's base, or two stops the user
  // added in the same town) would otherwise draw as a single pin — the second
  // stop invisible and unclickable. Nudge each one apart for drawing only; the
  // markers keep their real coordinates. See lib/pinOffsets.ts.
  const pinOffsets = useMemo(() => coincidentPinOffsets(allPoints), [allPoints])

  // A day's ride as the ENGINE plans it: origin → stops → synthesized
  // destination (an outbound continuation, or the final day's ride home).
  // Day routes must follow this, not raw stored stops — an anchor-only day's
  // ride (Day 1 outbound from the start anchor, the last day's drive back to
  // home) exists only in the synthesis, and drawing stored stops alone left
  // those days with no route on the map at all. Null = no drive (stay day).
  // stopClock doubles as the itinerary clock for the pin chips: arrival
  // "HH:MM" and km-into-the-trip (journey legs accumulate in day order), so a
  // pin can say when the PLAN says you get there — the engine's clock zones
  // say when the ROUTE demands it; the two never claim to be one source.
  const { dayRoutePoints, stopClock } = useMemo(() => {
    const out: Record<string, { lat: number; lng: number }[] | null> = {}
    const clock = new Map<string, { arrive: string; cumKm: number }>()
    let cum = 0
    for (const d of trip.days) {
      const j = buildJourney(trip, d)
      if (!(j.distanceKm >= 0.5 || j.driveMinutes > 0)) { out[String(d.index)] = null; continue }
      const pts = j.points
        .map(p => ({ lat: p.lat, lng: p.lng }))
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      out[String(d.index)] = pts.length >= 2 ? pts : null
      let legKm = 0
      for (const p of j.points) {
        legKm += p.legIn?.distanceKm ?? 0
        if (!p.synthesized) clock.set(p.stop.id, { arrive: p.arrive, cumKm: Math.round(cum + legKm) })
      }
      cum += j.distanceKm
    }
    return { dayRoutePoints: out, stopClock: clock }
  }, [trip])
  const dayRoutesKey = useMemo(
    () => Object.entries(dayRoutePoints)
      .map(([k, v]) => `${k}:${(v ?? []).map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('>')}`)
      .join('|'),
    [dayRoutePoints],
  )

  // A synthesized day-endpoint that the drawn line touches but no plotted
  // stop pins (the previous night's place ahead, or the ride home / next
  // destination beyond) renders as its own unnumbered endpoint marker, so
  // the line never starts or ends at a bare spot. All-days view draws the
  // shared stop chain and doesn't need them. Dedupe: the engine's own
  // same-place rule (`coLocates`, < 1 km) against the plotted stops.
  const dayEndpointMarkers = useMemo(() => {
    if (dayFilter === 'all') return []
    const day = trip.days.find(d => d.index === dayFilter)
    if (!day) return []
    const j = buildJourney(trip, day)
    const plotted = daysToPlot.find(d => d.index === dayFilter)?.stops ?? []
    return extraJourneyMarkers(j.points, plotted, j.direction)
  }, [trip, dayFilter, daysToPlot])

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
    let watchdog = 0
    const tick = setInterval(() => {
      if (cancelled) return
      const m = mapRef.current
      if (!m) return
      if (!attached) {
        attached = true
        const onLoad = () => { if (!cancelled) setMapLoaded(true) }
        if (m.isStyleLoaded()) onLoad()
        else {
          m.once('load', onLoad)
          // Watchdog: a style that never reports 'load' (a hidden tab holding
          // it mid-load, a stalled or blocked tile host) must not leave the
          // auto-fit permanently dead behind this gate — the fit is a camera
          // operation and does not need the style. A late 'load' changes
          // nothing: opening the gate is idempotent.
          watchdog = window.setTimeout(onLoad, STYLE_LOAD_WATCHDOG_MS)
        }
        clearInterval(tick)
      }
    }, 120)
    return () => { cancelled = true; clearInterval(tick); window.clearTimeout(watchdog) }
  }, [pointsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real road geometry from OSRM. In "all days" mode a single connected chain —
  // the stops in timeline order — is drawn as one main line. In single-day mode
  // each day gets its own coloured line. Falls back to straight lines.
  // Declared HERE, above the fit, because the all-days fit now frames the drawn
  // road itself (#330) — a render-scoped useState has no forward reference, and
  // hoisting the declaration is what makes the line available to the camera.
  const [geom, setGeom] = useState<Record<string, [number, number][]>>({})

  // EVERYTHING the current view draws — the fit frames the drawing, not just
  // the stop pins. A day's journey chain carries its synthesized origin (last
  // night's town), drawn as an endpoint flag and as the road line's far end,
  // but it is NOT a stop: fitting stop bounds alone glued the camera to a stop
  // cluster at maxZoom while the route ran off-screen — the reported case is
  // Day 2 of the sample Rajasthan trip, two pins inside Jodhpur framed at
  // zoom 12 while 280 km of drawn road to Jaipur sat16,000 px outside the
  // canvas. Nearby-suggestion pins stay OUT on purpose: another day's ideas
  // would balloon the fit.
  //
  // #330: the ALL-days view used to fit the pins plus home-when-shown, which is
  // less than the line it draws — the trip-start leg had no point in the set at
  // all, the destination tail (buildRoadChain's hasDestTail) was drawn but never
  // fitted, and a road bowing around a ghat or a lake left the 70px padding the
  // old comment promised it stayed inside (an assertion, never a measurement).
  // The endpoints now come from the chain builder itself and the drawn road is
  // sampled in — see allViewFitPoints. The DAY branch is deliberately untouched:
  // there the polyline arrives after the fit, and mixing it in would frame a
  // previous day's line while this one is still measuring.
  const fitPoints = useMemo(() => {
    if (dayFilter === 'all') {
      return allViewFitPoints({
        stops: allPoints.map(p => ({ lat: p.lat, lng: p.lng })),
        chainPoints: trip ? buildRoadChain(trip).points : null,
        roadGeometry: geom.all,
      })
    }
    const pts: LatLng[] = allPoints.map(p => ({ lat: p.lat, lng: p.lng }))
    for (const p of dayRoutePoints[String(dayFilter)] ?? []) pts.push(p)
    return pts
  }, [allPoints, dayFilter, dayRoutePoints, trip, geom.all])
  const fitPointsKey = useMemo(
    () => fitPoints.map(p => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|'),
    [fitPoints],
  )

  // fit the viewport to everything the view draws, whenever the map is ready
  // and that extent changes
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const bounds = boundsOf(fitPoints)
    if (!bounds) return
    const m = mapRef.current
    const run = () => {
      m.resize()
      m.fitBounds(
        bounds,
        { padding: 70, maxZoom: 12, duration: prefersReducedMotion() ? 0 : 400 },
      )
    }
    requestAnimationFrame(run)
  }, [fitPointsKey, mapLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Panel to map detour, drawn: the active suggestion gets a dashed spur from the
  // nearest point on the route to its pin, so "how far off is this?" is answered
  // on the map itself and not only by the number on the card.
  useEffect(() => {
    const m = mapRef.current
    if (!m || !mapLoaded) return
    const SRC = 'yf-spur-src'
    const LAYER = 'yf-spur'
    if (!m.getSource(SRC)) {
      m.addSource(SRC, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      m.addLayer({
        id: LAYER,
        type: 'line',
        source: SRC,
        // #153: paint from the --warn token (resolved once — MapLibre can't
        // read CSS vars) instead of a hardcoded hex that silently drifts.
        paint: { 'line-color': getComputedStyle(document.documentElement).getPropertyValue('--warn').trim() || '#B47207', 'line-width': 2, 'line-dasharray': [2, 2] },
        layout: { 'line-cap': 'round' },
      })
    }
    const hit = activeHitId == null ? null : nearbyPois.find(h => h.id === activeHitId)
    const route: [number, number][] = (geom.all?.length ? geom.all : allStraight) ?? []
    const features: Array<{ type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: [number, number][] } }> = []
    if (hit && hasCoords(hit) && route.length > 1) {
      const pin: [number, number] = [hit.longitude, hit.latitude]
      // #158: snap with the SAME segment projection the card's detour minutes
      // use (projectOntoPolyline), not a raw nearest-vertex walk in degree
      // space — the spur now lands where the card's math says it should.
      const poly = route.map(([lng, lat]) => ({ lat, lng }))
      const snap = projectOntoPolyline({ latitude: pin[1], longitude: pin[0] }, poly)
      const anchor: [number, number] = snap ? snap.lngLat : route[0]
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [anchor, pin] } })
    }
    const src = m.getSource(SRC) as { setData?: (d: unknown) => void } | undefined
    src?.setData?.({ type: 'FeatureCollection', features })
  }, [activeHitId, mapLoaded, nearbyPois]) // eslint-disable-line react-hooks/exhaustive-deps

  function fitToTrip() {
    const m = mapRef.current
    const bounds = boundsOf(fitPoints)
    if (!m || !bounds) return
    m.resize()
    m.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: prefersReducedMotion() ? 0 : 400 })
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

  // Measured day geometry, keyed by day index and the ride's points-hash —
  // revisiting a day chip redraws from cache instead of re-measuring (#polylines).
  // A ref, not state: cache validity never drives rendering on its own.
  const dayGeomCache = useRef<Record<string, { key: string; coords: [number, number][] }>>({})
  // ONE chain identity (#370): the workspace's own geometry-only signature
  // (`roadChainSig` — start + every stop + the drive home + the destination
  // tail + mode), not a private stops-only hash. The same trip had two cache
  // keys: this one missed a start-point or destination change that the
  // measurement it gates did depend on.
  const chainKey = useMemo(
    () => roadChainSig(trip),
    [trip.startLocationCoords, trip.days, trip.destinationCoords, trip.roundTrip, trip.transportMode],
  )
  // The map's “cannot vouch for this” ink — the --warn token the spur layer
  // resolves at paint time (#153), read here for the rough-route line (#370).
  const warnInk = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue('--warn').trim() || '#B47207',
    [theme],
  )
  // straight-line fallback geometry for the sequential path (all mode)
  const allStraight = useMemo(
    () => allPoints.map(p => [p.lng, p.lat] as [number, number]),
    [allPoints],
  )

  // The 3D hero frames THIS trip's road: initial bearing of the main route
  // (GeoJSON [lng,lat] → lat/lng for the pure helper). Geometry-less trips
  // keep the prototype's fixed bearing as the fallback.
  const heroBearing = useMemo(() => {
    const coords = geom.all?.length ? geom.all : allStraight
    return heroBearingForRoute(coords?.map(c => ({ lat: c[1], lng: c[0] })))
  }, [geom.all, allStraight])

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
    // AbortSignal, not just a flag: a cancelled effect must STOP the in-flight
    // fetches (they eat the shared OSRM rate-limit budget and their results
    // were being thrown away anyway) — #polylines.
    const ac = new AbortController()
    const { signal } = ac
    let cancelled = false
    ;(async () => {
      const asm = getAssumptions(trip)
      if (dayFilter === 'all') {
        const pts: { lat: number; lng: number }[] = allPoints.map(p => ({ lat: p.lat, lng: p.lng }))
        if (pts.length < 2) return
        const next: Record<string, [number, number][]> = {}
        // #323: the workspace-backed Map tab never measures here. Board has no
        // shared chain, so it alone may use the same tripRoad measurement helper
        // for its fallback. The return line is also supplied by the workspace
        // chain when available, avoiding a second round-trip fetch.
        if (mainRouteGeometry && mainRouteGeometry.length > 1) {
          const shared = dedupeConsecutive(mainRouteGeometry)
          if (shared.length > 1) next.all = shared
        } else if (allowSelfMeasurement) {
          const outcome = await measureDayRide(pts, asm, { signal })
          if (!cancelled && outcome.ok) {
            const coords = outcome.legs.flatMap(l => l.geometry)
            if (coords.length > 1) next.all = dedupeConsecutive(coords)
          }
        }
        if (returnLeg) {
          if (returnRouteGeometry && returnRouteGeometry.length > 1) {
            const coords = dedupeConsecutive(returnRouteGeometry)
            if (coords.length > 1) next.return = coords
          } else if (allowSelfMeasurement) {
            const outcome = await measureDayRide([returnLeg.from, returnLeg.home], asm, { signal })
            if (!cancelled && outcome.ok) {
              const coords = outcome.legs.flatMap(l => l.geometry)
              if (coords.length > 1) next.return = dedupeConsecutive(coords)
            }
          }
        }
        if (!cancelled) setGeom(next)
      } else {
        // Day-filter contract: measure ONLY the selected day's ride. The old
        // loop re-measured every day on every chip click (35+ serial fetches
        // to see one line on a 7-day trip) and painted only after all of
        // them finished. Now: one measurement for the day on screen, cached
        // by the ride's points-hash so revisiting a chip is instant, and the
        // shared leg cache means legs already measured for the whole-trip
        // chain resolve without any fetch at all.
        const ride = dayRoutePoints[String(dayFilter)]
        if (!ride || ride.length < 2) { setGeom({}); return }
        const rideKey = ride.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('>')
        const cached = dayGeomCache.current[String(dayFilter)]
        if (cached && cached.key === rideKey && cached.coords.length > 1) {
          setGeom({ [String(dayFilter)]: cached.coords })
          return
        }
        const outcome = await measureDayRide(ride, asm, { signal })
        if (cancelled || signal.aborted) return
        if (outcome.ok) {
          const coords = dedupeConsecutive(outcome.legs.flatMap(l => l.geometry))
          if (coords.length > 1) {
            dayGeomCache.current[String(dayFilter)] = { key: rideKey, coords }
            setGeom({ [String(dayFilter)]: coords })
            return
          }
        }
        // unresolved (rate-limited both attempts): keep the straight-line
        // fallback visible rather than wiping the day's line entirely
        setGeom({})
      }
    })()
    return () => { cancelled = true; ac.abort() }
  }, [chainKey, dayRoutesKey, dayFilter, returnLeg, mainRouteGeometry, returnRouteGeometry, allowSelfMeasurement]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="map-day-filter" role="group" aria-label="Which day the map draws">
          <span className="map-scope-lbl">Show on map</span>
          <button className={`map-day-chip ${dayFilter === 'all' ? 'on' : ''}`} aria-pressed={dayFilter === 'all'} onClick={() => { setDayFilter('all'); onDayFilterChange?.('all') }}>All days</button>
          {trip.days.map(d => {
            const rd = tripReadinessRows.find(x => x.dayIndex === d.index)
            return (
              <button key={d.index} className={`map-day-chip ${dayFilter === d.index ? 'on' : ''}`} aria-pressed={dayFilter === d.index} onClick={() => { setDayFilter(d.index); onDayFilterChange?.(d.index) }}
                aria-label={`Day ${d.index + 1}${rd ? `, ${rd.filled} of ${rd.required} planned` : ''}`}>
                Day {d.index + 1}
                {rd && <span className="map-day-chip-rd">{rd.filled}/{rd.required}</span>}
              </button>
            )
          })}
        </div>
        <div className="map-toolbar-mid" role="group" aria-label="What the map shows">
          {/* The utilities read as one family, held apart from the day filter by
              the same hairline the view modes use: the chips around them answer
              "which day am I looking at", these four answer "what is drawn" and
              "where do I go next". */}
          <div className="map-util-group" role="group" aria-label="Map layers and day actions">
          <button className="map-day-chip map-day-chip--util map-recenter" onClick={fitToTrip} aria-label="Recentre the map on the trip route" title="Recentre the map on the trip route"><LocateFixed size={13} aria-hidden /></button>
          {clockMilestones && (
            <button
              className={`map-day-chip map-day-chip--util ${clockOn ? 'on' : ''}`}
              aria-pressed={clockOn}
              onClick={toggleClock}
              title="Show or hide the road milestones - each planned stop's time and distance on the road"
            >
              <InlineIcon icon={Clock} size={13} gap={4} />Milestones
            </button>
          )}
          {returnLeg && (
            <button
              className={`map-day-chip map-day-chip--util ${showReturn ? 'on' : ''}`}
              aria-pressed={showReturn}
              onClick={() => setShowReturn(s => !s)}
              title={showReturn
                ? 'Return leg shown. The loop km (out + back) feed the plan; hide to read the outbound road alone.'
                : 'Return leg hidden - the corridor and km labels read the OUTBOUND road only.'}
            >
              <InlineIcon icon={RotateCcw} size={13} gap={4} />Return home
            </button>
          )}
          </div>
          {/* Map view modes — three first-class states, none "off", so a
              segmented role="group" (AGENTS' segmented-control rule), same
              chip styling as the day filter. The long form lives in the
              aria-label; the short one must survive a narrow phone. */}
          {enableMapViewModes && (
            <div className="map-mode-group" role="group" aria-label="Map view mode">
              {MAP_VIEW_MODES.map(m => (
                <button
                  key={m}
                  className={`map-day-chip${viewMode === m ? ' on' : ''}`}
                  aria-pressed={viewMode === m}
                  aria-label={MAP_VIEW_MODE_META[m].aria}
                  title={MAP_VIEW_MODE_META[m].aria}
                  onClick={() => { haptic('select'); setViewMode(m) }}
                >
                  {m === '2d' ? <InlineIcon icon={MapIcon} size={13} gap={4} />
                    : m === 'terrain' ? <InlineIcon icon={Mountain} size={13} gap={4} />
                      : <InlineIcon icon={Box} size={13} gap={4} />}
                  {MAP_VIEW_MODE_META[m].label}
                </button>
              ))}
            </div>
          )}
          {ideaCats.length > 0 && (
            <div className="map-filters">
              <button
                className="map-day-chip map-day-chip--util"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(o => !o)}
                title={hiddenIdeaCats.size > 0 ? `Idea filters — ${hiddenIdeaCats.size} hidden` : 'Filter nearby ideas by type'}
              >
                Filters{hiddenIdeaCats.size > 0 ? ` (${hiddenIdeaCats.size})` : ''}
              </button>
              {filtersOpen && (
                <div className="map-filters-pop" role="group" aria-label="Nearby idea categories">
                  {ideaCats.map(([cat, count]) => (
                    <button
                      key={cat}
                      className="map-filters-row"
                      aria-pressed={!hiddenIdeaCats.has(cat)}
                      onClick={() => toggleIdeaCat(cat)}
                    >
                      <CatIcon category={cat} size={13} aria-hidden />
                      {titleCase(cat)}
                      <span className="n">{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="map-toolbar-end">
          {dayDirectionsUrl && (
            <button
              className="map-day-chip map-day-chip--util map-day-chip--ghost"
              onClick={() => openExternal(dayDirectionsUrl)}
              title="Open this day's ride with turn-by-turn directions in Google Maps"
              aria-label="Directions for this day in Google Maps"
            >
              <Navigation size={13} aria-hidden />
            </button>
          )}
          <button
            className={`map-day-chip map-day-chip--util map-day-chip--ghost map-expand-chip${expanded ? ' on' : ''}`}
            aria-pressed={expanded}
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
          <div className="empty-state"><div className="big"><MapIcon size={38} aria-hidden /></div><p>No confirmed stops to plot yet - add some in the Timeline.</p></div>
        ) : (
          <MapLibreMap
            ref={mapRef}
            theme={theme}
            className="yf-maplibre"
            center={[76.5, 10.5]}
            zoom={5}
          >
            {/* yf-map-ctrls: mapcn ships this group in Tailwind utilities this
                app doesn't compile — the class hooks the hand-ported CSS. */}
            <MapControls position="top-right" className="yf-map-ctrls" />
            {/* Terrain stack reconcile (2D · Terrain · 3D hero) — no-op on a
                hard-2D surface like the Board. */}
            {enableMapViewModes && <MapViewModeController mode={viewMode} bearing={heroBearing} />}
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
              // #370: grade what is DRAWN. The chord fallback wears the rough
              // paint and loses its chevrons, so "no road resolved" cannot read
              // as a road while the numbers beside it are haversine estimates.
              const rough = routeDrawGrade(geom.all) === 'rough'
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
                  <MapRoute coordinates={coords} color={rough ? warnInk : dark ? '#2A6FDB' : '#0B2545'} width={rough ? 3.5 : 4.5} opacity={rough ? 0.9 : 0.95} dashArray={rough ? ROUGH_DASH : undefined} />
                  {!rough && <RouteArrows coordinates={coords} dark={dark} />}
                </>
              )
            })() : (
              trip.days
                // Single-day view draws EXACTLY the selected day's journey —
                // dayRoutePoints is keyed by every trip day (an anchor-only
                // outbound exists only in the synthesis), but the day chips'
                // contract is one day in, one day out. Filtering by route
                // existence alone draws all days at once (the regression from
                // the engine-journeys change).
                .filter(d => d.index === dayFilter && dayRoutePoints[String(d.index)])
                .map(d => {
                  const ride = dayRoutePoints[String(d.index)]!
                  const coords = geom[String(d.index)]?.length
                    ? geom[String(d.index)]
                    : ride.map(p => [p.lng, p.lat] as [number, number])
                // #370: this day's ride is honest when measured, and says so
                // when it is not — the chords wear the rough paint.
                const rough = routeDrawGrade(geom[String(d.index)]) === 'rough'
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
                      color={rough ? warnInk : colorForDay(d.index)}
                      width={rough ? 3.5 : 4}
                      opacity={rough ? 0.9 : 0.95}
                      dashArray={rough ? ROUGH_DASH : undefined}
                    />
                    {!rough && <RouteArrows coordinates={coords} dark={theme === 'dark'} />}
                  </Fragment>
                )
              })
            )}
            {/* Round-trip return drive home — dashed slate line so "coming back"
                reads differently from the outbound day colours. Toggleable. */}
            {dayFilter === 'all' && returnLeg && showReturn && (() => {
              const rCoords = geom.return?.length ? geom.return : returnStraight!
              const dark = theme === 'dark'
              const rough = routeDrawGrade(geom.return) === 'rough'
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
                    color={rough ? warnInk : dark ? '#94A3B8' : '#64748B'}
                    width={3.5}
                    opacity={0.95}
                    dashArray={rough ? ROUGH_DASH : [1.8, 1.6]}
                  />
                  {!rough && <RouteArrows coordinates={rCoords} dark={dark} />}
                </>
              )
            })()}
            {/* The travel clock as road labels: one text pair per planned anchor
                (meal / overnight / destination) — time + date left of the road,
                km right — plus the suggestion engine's placed stops as distance
                labels. Return-leg labels follow the Return home toggle.
                Whole-trip only — filtering to a day drops it with the loop
                geometry. */}
            {clockMilestones && clockOn && dayFilter === 'all' && (
              <>
                <ClockMilestoneLayer overlay={clockMilestones} showReturn={!returnLeg || showReturn} onOpenDay={onOpenHaltDay} />
                <SuggestionDistanceLayer places={nearbyPois} road={geom.all ?? null} />
              </>
            )}
            {/* P5.3: the day's empty parts stand on the map - hollow amber pins at
                their top candidate's real position (placeholder hits resolve via
                the same coord-fix pass as the ideas), the cost line in the tooltip. */}
            {slotPins.map(pin => {
              const fix = coordFixes[pin.hit.id as string]
              const lat = fix ? fix.lat : pin.hit.latitude
              const lng = fix ? fix.lng : pin.hit.longitude
              if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
              // m3: one string, used as the accessible name and the tooltip.
              // It used to be a `title` AND a MarkerTooltip with identical text,
              // so hovering showed two tooltips saying the same thing.
              const label = `${pin.label}: ${pin.name} - ${pin.meta}. Tap to open this part in the plan.`
              return (
                <MapMarker key={`slot-${pin.key}`} longitude={lng} latitude={lat} anchor="center">
                  <MarkerContent>
                    <button
                      type="button"
                      className="yf-map-pin yf-map-pin--slot"
                      aria-label={label}
                      onClick={() => onOpenSlot?.(pin.key)}
                    >
                      {SLOT_PIN_GLYPH[pin.key] ?? pin.label.slice(0, 1)}
                    </button>
                  </MarkerContent>
                  <MarkerTooltip>{label}</MarkerTooltip>
                </MapMarker>
              )
            })}
            {(() => {
              let num = 0
              const showClockChips = !!(clockMilestones && clockOn)
              return allPoints.map((p, idx) => {
                // Auto anchor stops (trip start / final destination) render as
                // distinct start/end badges instead of numbered pins.
                const isLast = idx === allPoints.length - 1
                const off = pinOffsets.get(p.id)
                const offsetStyle = off ? { transform: `translate(${off.dx}px, ${off.dy}px)` } : undefined
                if (p.auto) {
                  const label = isLast ? <Flag size={13} aria-hidden />
                    : trip.transportMode === 'flight'
                      ? <PlaneTakeoff size={13} aria-hidden />
                      : <CircleDot size={13} aria-hidden />
                  const c = showClockChips ? stopClock.get(p.id) : undefined
                  return (
                    <MapMarker key={p.id} longitude={p.lng} latitude={p.lat}>
                      <MarkerContent>
                        <span className="yf-pin-cluster" style={offsetStyle}>
                          <span className="yf-map-pin yf-map-flag" title={p.title}>{label}</span>
                        </span>
                        {c && <span className="yf-pin-time">{formatHM(c.arrive, timeFormat)}</span>}
                      </MarkerContent>
                      <MarkerTooltip>{isLast ? `Final destination - ${p.title}` : `Trip start - ${p.title}`}{c ? `, arrives ${formatHM(c.arrive, timeFormat)}, ~${c.cumKm} km into the trip` : ''}</MarkerTooltip>
                    </MapMarker>
                  )
                }
                num += 1
                const c = showClockChips ? stopClock.get(p.id) : undefined
                return (
                  <MapMarker key={p.id} longitude={p.lng} latitude={p.lat}>
                    <MarkerContent>
                      <span className="yf-pin-cluster" style={offsetStyle}>
                      <button
                        className={`yf-map-pin yf-map-tear${p.status === 'maybe' ? ' yf-map-maybe' : ''}`}
                        style={{ '--pin-color': colorForDay(p.dayIndex) } as React.CSSProperties}
                        onClick={() => { onOpenStop?.(p.id); if (onOpenInTimeline || onOpenInBoard || onDeleteStop) setSelectedStop({ id: p.id, title: p.title, dayIndex: p.dayIndex }) }}
                        aria-label={`Stop ${num}: ${p.title}`}
                        title={p.title}
                      >
                        <span className="yf-pin-face">
                          <span className="yf-pin-ico" aria-hidden><CatIcon category={p.category} size={15} className="yf-pin-svg" /></span>
                          <i className="yf-pin-num">{num}</i>
                        </span>
                      </button>
                      </span>
                      {c && <span className="yf-pin-time">{formatHM(c.arrive, timeFormat)}</span>}
                    </MarkerContent>
                    <MarkerTooltip>{p.title}{c ? `, arrives ${formatHM(c.arrive, timeFormat)}, ~${c.cumKm} km into the trip` : ''}</MarkerTooltip>
                  </MapMarker>
                )
              })
            })()}
            {/* synthesized day-journey endpoints the line touches but no stop
                pins — the previous night's place ahead, or the ride home / next
                destination beyond (single-day view only). Not numbered, not
                clickable-to-edit: nothing is stored behind them. */}
            {dayEndpointMarkers.map(m => (
              <MapMarker key={`yf-endpoint-${m.kind}-${m.position.lat}-${m.position.lng}`} longitude={m.position.lng} latitude={m.position.lat}>
                <MarkerContent>
                  <span
                    className="yf-map-pin yf-map-flag"
                    title={m.label}
                  >
                    {m.kind === 'start'
                      ? (trip.transportMode === 'flight'
                        ? <PlaneTakeoff size={13} aria-hidden />
                        : <CircleDot size={13} aria-hidden />)
                      : <Flag size={13} aria-hidden />}
                  </span>
                </MarkerContent>
                <MarkerTooltip>{m.label}</MarkerTooltip>
              </MapMarker>
            ))}
            {/* home anchor for round trips — the return drive ends here; gated on
                the same Return home toggle as the line it belongs to */}
            {dayFilter === 'all' && returnLeg && showReturn && (
              <MapMarker longitude={returnLeg.home.lng} latitude={returnLeg.home.lat}>
                <MarkerContent>
                  <span className="yf-map-pin yf-map-flag" title={trip.startLocation}><Home size={13} aria-hidden /></span>
                </MarkerContent>
                <MarkerTooltip>Home - return drive ends here ({trip.startLocation})</MarkerTooltip>
              </MapMarker>
            )}
            {/* nearby idea markers — category-coloured, dashed, with quick-add.
                Pin click/hover = select: the panel row highlights and scrolls
                into view; adding moved to the explicit + chip beside the pin. */}
            {visiblePois.map(hit => {
              // S4: an empty-part pin already stands here for this exact hit —
              // it carries more (the part it would fill, plus the cost line) and
              // its tap opens the plan, so it is the one that stays.
              if (slotPinIds.has(String(hit.id))) return null
              const active = activeHitId != null && activeHitId === hit.id
              // A current search hit reads differently from a corridor idea:
              // solid teal, no attention pulse, "Search result" affordance. Its
              // tap selects it (glow + row highlight) instead of only locating.
              const isSearchHit = searchHitIds?.has(hit.id as string | number) ?? false
              return (
                <MapMarker key={`nearby_${hit.id}`} longitude={hit.longitude} latitude={hit.latitude}>
                  <MarkerContent>
                    <VisiblePulse className="yf-map-idea" title={isSearchHit ? `${hit.name} - click to select this search result` : `${hit.name} - click to locate in the suggestions panel`}>
                      <span
                        className={`yf-map-pin yf-map-pin-idea${isSearchHit ? ' yf-map-pin-search' : ''}${active ? (isSearchHit ? ' yf-map-pin-search--active' : ' yf-map-pin-idea--active') : ''}`}
                        style={isSearchHit ? undefined : { background: ideaPinColor(hit.category) } as React.CSSProperties}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSearchHit ? active : undefined}
                        aria-label={isSearchHit ? `Select ${hit.name}` : `Locate ${hit.name} in the suggestions panel`}
                        onClick={() => onActivateHit?.(hit.id as string | number)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivateHit?.(hit.id as string | number) } }}
                      >
                        {isSearchHit ? <Search size={14} aria-hidden /> : <CatIcon category={hit.category} size={14} />}
                      </span>
                      {onAddNearby && (
                        <button
                          className="yf-map-idea-add"
                          onClick={e => { e.stopPropagation(); onAddNearby(hit) }}
                          aria-label={`Add ${hit.name} to the trip`}
                          title={`Add ${hit.name} to the trip`}
                        >+</button>
                      )}
                    </VisiblePulse>
                  </MarkerContent>
                  <MarkerTooltip>
                    {isSearchHit && <><InlineIcon icon={Search} size={11} gap={3} vAlign="-1px" />Search result: </>}
                    {!isSearchHit && <InlineIcon icon={Lightbulb} size={11} gap={3} vAlign="-1px" />}
                    {hit.name}{hit.haltPurpose ? `, ${hit.haltPurpose === 'overnight' ? 'overnight option' : hit.haltPurpose}` : ''}{hit.cumKm != null ? `, ~${hit.cumKm} km in` : ''}{hit.nearestCity ? `, near ${hit.nearestCity}` : ''}{hitCosts?.[String(hit.id)] ? `, ${hitCosts[String(hit.id)]}` : ''}
                  </MarkerTooltip>
                </MapMarker>
              )
            })}
          </MapLibreMap>
        )}

        {selectedStop && (onOpenInTimeline || onOpenInBoard || onDeleteStop) && (
          <div className="yf-stop-jump" role="dialog" aria-label={`Selected stop: ${selectedStop.title}`}
            style={{ position: 'absolute', left: '50%', bottom: 14, transform: 'translateX(-50%)', zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-soft)', maxWidth: 'calc(100% - 24px)' }}>
            <span className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{selectedStop.title}</span>
            {onOpenInTimeline && (
              <button className="btn btn-sm btn-primary" onClick={() => { onOpenInTimeline(selectedStop.id); setSelectedStop(null) }}>Open in Timeline</button>
            )}
            {onOpenInBoard && (
              <button className="btn btn-sm btn-outline" onClick={() => { onOpenInBoard(selectedStop.id); setSelectedStop(null) }}>Open in Board</button>
            )}
            {onDeleteStop && (
              <button className="btn btn-sm btn-danger" onClick={() => { onDeleteStop(selectedStop.id, { title: selectedStop.title, dayIndex: selectedStop.dayIndex }); setSelectedStop(null) }}>Remove</button>
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
            <InlineIcon icon={LocateFixed} size={12} gap={3} />{liveOn ? 'Live on' : 'Locate me'}
          </button>
          <button
            className="map-legend-toggle"
            onClick={toggleLegend}
            aria-expanded={legendOpen}
            title={legendOpen ? 'Hide the map key' : 'Show the map key'}
            aria-label={legendOpen ? 'Hide the map key' : 'Show the map key'}
          >
            {legendOpen ? <><InlineIcon icon={X} size={12} gap={3} />Hide key</> : <><InlineIcon icon={Info} size={12} gap={3} />Key</>}
          </button>
          {legendOpen && (
            <div className="map-legend-body">
              {dayFilter === 'all'
                ? <>main line = whole route{returnLeg ? ' · dashed = drive back home' : ''} · </>
                : <>colours = day · </>}
              pin icon = stop type · number = timeline order · dashed pin = "maybe" · plane/flag pins = start & final destination · plane/flag pins on a single day = that day's start and end where no stop is pinned · gold bulb markers = nearby ideas{onAddNearby ? ' (+ to add)' : ''}{ideaCats.length > 0 ? ' · chips filter ideas by type' : ''} · click a pin for details · hollow amber pin = an unplanned part · tap to open it
            </div>
          )}
        </div>
      </div>
      <p className="hint-text" style={{ marginTop: 8 }}>
        <InlineIcon icon={TriangleAlert} size={12} gap={3} />Route lines follow real roads (© OSRM/OpenStreetMap) when available; distances/durations in the plan are real-road estimates for ground travel, falling back to transparent haversine assumptions when offline/other modes - no live traffic data.
      </p>
    </div>
  )
}
