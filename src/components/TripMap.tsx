// ============ Trip route map ============
// Real slippy-map rendering via mapcn (MapLibre GL): OpenFreeMap basemaps that follow
// light/dark theme, numbered stop markers in timeline order, and a polyline
// connecting each day's stops. Distances/durations still come from the engine.
import { useId, useMemo, useState, useEffect, useRef, useCallback, Fragment, type ComponentProps } from 'react'
import { useInView, usePageVisible } from './ui'
import type { Trip } from '../data/types'
import type { PlaceHit } from '../lib/geocode'
import { resolveHitCoords } from '../lib/geocode'
import { hasCoords, mappablePois } from '../lib/providers/hits'
import { buildRoadChain, measureDayRide, roadChainSig, routeDrawGrade } from '../lib/tripRoad'
import { dayColor } from '../lib/mapStyles/dayColors'
import { buildJourney, coLocates, getAssumptions, isRoundTrip, isAirMode, type LegEstimate } from '../lib/engine'
import { buildStopClock } from '../lib/stopClock'
import type { RouteMark } from '../lib/map/routeMarks'
import { cardCloseFromEventWithin } from '../pages/trip/map/editing/cardClose'
import { clockHM, type ClockMilestone } from '../lib/clockOverlay'
import { pointAtKm } from '../lib/geo'
import { useTimeFormat, formatHM } from '../lib/timefmt'
import { extraJourneyMarkers } from '../lib/journeyMarkers'
import { allViewFitPoints, boundsOf, type LatLng } from '../lib/mapFit'
import { coincidentPinOffsets } from '../lib/pinOffsets'
import { clusterCandidates, clusterCountLabel, clusterFeatureCollection, clusterSummary, clearOfMarks, splitByCluster } from '../lib/mapCluster'
import { googleMapsDirectionsUrl } from '../lib/externalMaps'
import { openExternal } from '../lib/native'
import { titleCase } from '../lib/labels'
import { haptic } from '../lib/haptics'
import { isNative, nativeWatch } from '../lib/native'
import {
  deriveLiveLocationState, drawsLiveDot, livePositionAllowed, resolveLiveCamera,
  liveErrorSignal, type LiveErrorSignal,
  LIVE_FIX_STALE_MS, LIVE_LOCATION_COPY, toISODate,
} from '../lib/liveLocation'
import { loadFlag, saveFlag } from '../lib/uiPrefs'
import { normalizeMapTarget, validMapCoordinate, type MapTarget } from '../lib/mapTarget'
import { visibleMapPadding, type MapInsets } from '../lib/mapVisiblePadding'
import { stayFrameAction, stayRingsDependencyKey } from '../lib/map/stayRings'
import { WORKSPACE_MAP_STYLES } from '../lib/workspaceMapStyles'
import { applyWorkspaceViewMode } from '../lib/mapStyles'
import { dayRoadSlices, ROUTE_PAINT } from '../lib/mapStyles/routeTreatment'
import { DayRouteLayers } from './map/DayRouteLayers'
import { PlaceSubtypeMark, WarningDiamond } from './map/MapWorkspaceMarks'
import { ghostInk, ghostLegPaint, layoutMarks, pickLetter, placeSubtype, type GhostLeg, type GhostRoad, type LayoutMark, type MarkBounds, type MarkSpot } from '../lib/mapStyles/placeMarks'
import { BASE_TAG_GAP, CORRIDOR_PAINT, STAY_RING_CANVAS_FRACTION, NUMBER_TAG_GAP, baseTagBox, baseTagText, clampBoundsWithin, corridorEdgeGeoJson, corridorEdgeOffset, drawsCorridor, smoothCorridorLine, thinCorridorLine, pickBandClass, ringCaptionMode, ringCaptionPoint, showsHotelTag, showsStopTag, stayFrameBounds, stayRingsFillGeoJson, stayRingsGeoJson, stopTagBox } from '../lib/mapStyles/lensMarks'
import { firstFitPadding, mergeInsets, coverInsets, settleStep, settlePadding, safeRect, type FrameBox, type FrameInsets } from '../lib/mapStyles/cameraFrame'
import {
  applyViewModeOnMap, HERO_3D_CAMERA, MAP_VIEW_MODES, MAP_VIEW_MODE_META,
  heroBearingForRoute, heroCameraMove,
  type MapViewMode,
} from '../lib/mapViewModes'
import type { MapRef } from './mapcn/map'
import { InlineIcon, CatIcon } from './icons'
import {
  Box, Car, CircleDot, Clock, Compass, Crosshair, Flag, Home, Info, Layers, Lightbulb, LocateFixed, Map as MapIcon, Maximize2, Minus, MoreHorizontal, Mountain, Navigation, PersonStanding, PlaneTakeoff, Plus,
  RotateCcw, Search, TriangleAlert, X,
} from 'lucide-react'
import { prefersReducedMotion, motionExitTiming, motionTiming } from '../lib/motion'
import { StateBlock } from './page/StateBlock'
import { MapStopSymbol, MapWorkspaceKey } from './map/MapWorkspaceMarks'
import { standsOnLastNightStay } from './map/railModel'
import { MapBasemapStatus, useWorkspaceBasemapStatus } from './map/MapBasemapStatus'
import { DetourSpurOverlay } from './map/DetourSpurOverlay'
import {
  Map as MapLibreMap,
  MapMarker,
  MarkerContent,
  MarkerTooltip,
  MapRoute,
  MapGeoJSON,
  type MapGeoJSONData,
  MapClusterLayer,
  type ClusterBadge,
  MapControls,
  prefersCooperativeGestures,
  wantsCooperativeGestures,
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


// #370: a line that is NOT a measured road is drawn dashed and in the --warn
// ink the detour spur already uses (read at paint time, with this file's hex
// fallback). Same treatment on every surface, so an unresolved measurement can
// never wear road paint — and the dash plus the missing chevrons say so without
// a word, which matters because this component cannot tell "still measuring"
// from "the measurement failed" (its host owns the status and says it).
const ROUGH_DASH: [number, number] = [2, 2]

// #417: the suggestion family's cluster badge. The planning teal family, because a
// badge is a group of IDEAS rather than a stop — the numbered stop pins and the
// ambers keep their own colours, so the badge reads as a different kind of thing at
// a glance. Thresholds step at 10 and 30 (MapLibre's own default of 100/750 would
// leave every real group at the smallest size), and the badge is drawn on the
// basemap rather than on an app surface, so it carries literal ink like the rest of
// this file's map paint. That ink is chosen for the COMPOSITED pair: the circle is
// painted at 0.85 (MapClusterLayer), so on the light basemap the land shows through
// the white count — the plain planning teal #0E7A72 measures 5.19:1 alone but only
// 3.97:1 over positron's land, under AA for a 12px glyph. These three composite to
// 4.69 / 6.51 / 7.44:1 there, pinned by tests/map-cluster.test.ts.
const IDEA_CLUSTER_COLORS: [string, string, string] = ['#0B6B63', '#0F4C4C', '#123F49']
const IDEA_CLUSTER_THRESHOLDS: [number, number] = [10, 30]
/** A soft start and a soft end for a long camera glide. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
/** Close every open map tool menu that does not hold `keep`. */
function closeToolMenus(keep: Element | null): void {
  document.querySelectorAll<HTMLDetailsElement>('.mv2-tool-menu[open]').forEach(menu => { if (!keep || !menu.contains(keep)) menu.open = false })
}
// The clear room a road tick keeps around itself, in px, so two shown ticks never touch.
const TICK_ROOM = 36
// The workspace badge: a white chip with a sea ring and a soft halo, like the idea pins.
const WORKSPACE_CLUSTER_COLORS: [string, string, string] = ['#FFFFFF', '#FFFFFF', '#FFFFFF']
// A group draws as a DOM pin: a pile of pick tiles with its count. It is a mark
// like any other, so it slides off a stop instead of hiding under it.
const GROUP_BOX = { w: 42, h: 46 }
const GROUP_MAX_TRAVEL = 64
/** The size band of a group, by the same thresholds as the clusterer. */
function groupSize(count: number): 's' | 'm' | 'l' {
  return count >= IDEA_CLUSTER_THRESHOLDS[1] ? 'l' : count >= IDEA_CLUSTER_THRESHOLDS[0] ? 'm' : 's'
}
/** The workspace chrome hands the cluster layer no point, so no canvas badge can
 *  stand under a stop pin. One object, so the layer's data effect does not churn. */

// The map's ready gate (mapLoaded) is a camera latch. Every effect behind it
// runs camera work: fitBounds, resize, project, DOM listeners. None of that
// needs a resolved style. The style-sensitive layers (the road line, the
// clusterer) gate on mapcn's own isLoaded instead. So the latch opens the
// moment the instance exists, and the first fit runs while tiles load.
// Overlays that cover the map in the workspace. The camera keeps marks clear of them.
const WORKSPACE_COVER_SELECTOR = '.mv2-itinerary, .poi-col, .mv2-detail, .mv2-ribbon, .mv2-omnibar, .mv2-lenses, .mv2-phone-day, .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-bottom-left'
// Drawn size of the marks the camera must keep inside the open map area.
// Every box is a hit box: an interactive mark owns at least 44 by 44 px (see mapMarks.css).
const STOP_BOX = { w: 44, h: 44, drawW: 36, drawH: 36 }
const CLOCK_BOX = { w: 96, h: 26, dy: 33 }
const WARN_BOX = { w: 44, h: 44, drawW: 38, drawH: 38 }
const SLOT_BOX = { w: 44, h: 44, drawW: 38, drawH: 38 }
const PICK_BOX = { w: 44, h: 44 }
// The glyph fills two thirds of the 30 px pick tile, with a heavier line, so the
// umbrella or the waterfall reads at a glance and not only the coloured tile.
const MAP_PICK_GLYPH = { size: 20, stroke: 2.4 }
// A pick with its add button is a column. The pick pad reaches 14px above it and the add pad 26px below.
const PICK_ADD_BOX = { w: 44, h: 91 }
const PICK_ADD_SHIFT = 6

// Basemaps come from the mapcn <Map> default (OpenFreeMap — see mapcn/map.tsx).
// The old CARTO Voyager / dark-matter and Esri World Imagery style URLs that
// used to live here were dead code (never referenced) and carried a licensing
// exposure, so they are gone as of issue #23 — there is no satellite layer.

/**
 * Map V2 ticket 23. The dot is opt-in and draws on an actual trip day only.
 * The fix stays in this component. No code writes it to a store, a network,
 * a log or a URL. Each state gets its own status line.
 */
function LiveLocationLayer({
  active, startDate, endDate, today, focusDay, recenterSignal,
}: {
  active: boolean
  startDate: string
  endDate: string
  today: string
  focusDay: number | 'all' | undefined
  recenterSignal: number
}) {
  const { map, isLoaded } = useMap()
  const [fix, setFix] = useState<GeolocationPosition | null>(null)
  const [error, setError] = useState<LiveErrorSignal>(null)
  const [now, setNow] = useState(() => Date.now())
  const userPanned = useRef(false)
  const selfMove = useRef(false)
  const lastRecenter = useRef(recenterSignal)

  const supported = isNative || (typeof navigator !== 'undefined' && 'geolocation' in navigator)
  const dayAllowed = livePositionAllowed({ optedIn: active, startDate, endDate, today, focusDay })
  const fixAgeMs = fix ? Math.max(0, now - fix.timestamp) : null
  const state = deriveLiveLocationState({
    optedIn: active,
    dayAllowed,
    supported,
    hasFix: fix != null,
    fixAgeMs,
    staleAfterMs: LIVE_FIX_STALE_MS,
    error,
  })

  useEffect(() => {
    if (!active || !dayAllowed || !supported) {
      setFix(null)
      setError(null)
      return
    }
    userPanned.current = false
    const handle = nativeWatch(
      pos => {
        setError(null)
        setFix(pos)
        setNow(Date.now())
      },
      code => setError(liveErrorSignal(code)),
    )
    const onMoveStart = () => { if (!selfMove.current) userPanned.current = true }
    map?.on('movestart', onMoveStart)
    return () => {
      handle.stop()
      map?.off('movestart', onMoveStart)
    }
  }, [active, dayAllowed, supported, map])

  // A clock tick only re-labels an ageing fix. It reads no location.
  useEffect(() => {
    if (!active || !dayAllowed || !fix) return
    const id = setInterval(() => setNow(Date.now()), LIVE_FIX_STALE_MS)
    return () => clearInterval(id)
  }, [active, dayAllowed, fix])

  useEffect(() => {
    const recentered = lastRecenter.current !== recenterSignal
    lastRecenter.current = recenterSignal
    const camera = resolveLiveCamera({ hasFix: fix != null, userPanned: userPanned.current, recentered })
    if (camera.clearPan) userPanned.current = false
    if (!isLoaded || !map || !fix || !camera.follow) return
    const center: [number, number] = [fix.coords.longitude, fix.coords.latitude]
    selfMove.current = true
    map.easeTo({ center, zoom: Math.max(map.getZoom(), 14), duration: prefersReducedMotion() ? 0 : motionTiming('--motion-med').duration })
    requestAnimationFrame(() => { selfMove.current = false })
  }, [isLoaded, map, fix, recenterSignal])

  if (state === 'off') return null
  const showDot = drawsLiveDot(state) && fix != null
  return (
    <>
      {showDot && (
        <MapMarker longitude={fix.coords.longitude} latitude={fix.coords.latitude}>
          <MarkerContent>
            <VisiblePulse className={`yf-live-dot yf-live-dot--${state}`} aria-label={LIVE_LOCATION_COPY[state]} role="img">
              <span className="yf-live-pulse" aria-hidden />
              <span className="yf-live-core" aria-hidden />
            </VisiblePulse>
          </MarkerContent>
        </MapMarker>
      )}
      <div className="yf-live-status" data-state={state} role="status">
        {LIVE_LOCATION_COPY[state]}
      </div>
    </>
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

/** The road labels the layer draws: the outbound half always, the return half with the toggle. */
function visibleMilestones(overlay: ClockMilestone[], showReturn: boolean): ClockMilestone[] {
  return overlay.filter(m => m.leg === 'outbound' || showReturn)
}
const milestoneMarkId = (index: number) => `ms:${index}`
// A road label is one pill pair around its point. The time is on the left and the km is on the right.
// The box is an estimate of the drawn size, so the layout can keep two labels apart.
function milestoneBox(m: ClockMilestone, timeText: string): { w: number; h: number; x: number } {
  // Per-char widths match the drawn 10.5px bold chips; a box narrower than the
  // drawn pill lets the resolver place two chips that then cover each other.
  const whenW = Math.max(timeText.length * 6.8, (m.haltName?.length ?? 0) * 7.2, m.dateLabel.length * 6.2) + 16
  const kmW = m.kmLabel.length * 6.2 + 16
  const lines = 1 + (m.haltName ? 1 : 0) + (m.dateLabel ? 1 : 0)
  return { w: whenW + kmW + 10, h: 6 + lines * 13, x: (kmW - whenW) / 2 }
}
// A stop clock pill draws "h:mm AM (est.) km N": the time half, the km half and
// the gap between them. The layout box must carry the drawn width, or two pills
// the layout thinks are apart still cover each other on screen.
function stopClockBox(arriveText: string, kmText: string): { w: number } {
  return { w: arriveText.length * 6.8 + kmText.length * 5.8 + 44 }
}
/** One distance chip per placed place that has a road km, on the route line. */
function suggestionDistancePins(places: PlaceHit[], road: [number, number][] | null): Array<{ id: string; name: string; km: number; lat: number; lng: number }> {
  if (!road || road.length < 2) return []
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
}
// A pill that yields to the stops: it slides a little, or it hides. The layout owns where it lands.
type PillSpots = { spots: ReadonlyMap<string, MarkSpot>; moving: boolean }
const pillStyle = (spot: MarkSpot | undefined): React.CSSProperties | undefined => spot && !spot.hidden && (spot.dx || spot.dy) ? { transform: `translate(${spot.dx}px, ${spot.dy}px)` } : undefined
const pillHidden = (pills: PillSpots, id: string): 'true' | undefined => pills.moving || pills.spots.get(id)?.hidden ? 'true' : undefined

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
function ClockMilestoneLayer({ overlay, showReturn, onOpenDay, pills }: { overlay: ClockMilestone[]; showReturn: boolean; onOpenDay?: (dayIndex: number) => void; pills: PillSpots }) {
  const { isLoaded } = useMap()
  const timeFormat = useTimeFormat()
  if (!isLoaded || overlay.length === 0) return null
  return (
    <>
      {visibleMilestones(overlay, showReturn).map((m, i) => {
        // Phase 3: an overnight halt is a decision ("where do we sleep"), so it
        // is the one label that earns a tap — it opens that day's plan. Every
        // other label stays decorative context. The tap target must carry an
        // honest itinerary day (itineraryDay): the walk's return pass indexes
        // its days past the itinerary, and a value no timeline day matches
        // would open nothing (or, worse, the wrong day).
        const halts = m.kind === 'overnight' && typeof onOpenDay === 'function' && m.itineraryDay != null
        const chip = (
          <span className={`yf-milestone yf-milestone--${m.kind}${m.leg === 'return' ? ' yf-milestone--return' : ''} yf-milestone--${m.dayState}`} data-collapsed={pillHidden(pills, milestoneMarkId(i))} style={pillStyle(pills.spots.get(milestoneMarkId(i)))}>
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
function SuggestionDistanceLayer({ places, road, pills }: { places: PlaceHit[]; road: [number, number][] | null; pills: PillSpots }) {
  const { isLoaded } = useMap()
  const pins = useMemo(() => suggestionDistancePins(places, road), [places, road])
  if (!isLoaded || pins.length === 0) return null
  return (
    <>
      {pins.map(pin => (
        <MapMarker key={`sd-${pin.id}`} longitude={pin.lng} latitude={pin.lat} anchor="center">
          <MarkerContent className="yf-milestone-anchor">
            <span className="yf-milestone yf-milestone--place" data-collapsed={pillHidden(pills, `sd:${pin.id}`)} style={pillStyle(pills.spots.get(`sd:${pin.id}`))}>
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
const WORKSPACE_3D_PITCH = 40 // The boards show 3D at pitch 30 to 40.
function MapViewModeController({ mode, bearing, workspace = false }: { mode: MapViewMode; bearing?: number | null; workspace?: boolean }) {
  const { map, isLoaded, resolvedTheme } = useMap()
  useEffect(() => {
    if (!map || !isLoaded) return
    try {
      // The supplied styles carry their own DEM and hillshade, so the Map tab
      // changes their paint instead of adding a second source.
      if (workspace) applyWorkspaceViewMode(map, mode, resolvedTheme)
      else applyViewModeOnMap(map, mode)
    } catch { /* style swapped mid-flight — the next isLoaded edge re-applies */ }
  }, [map, isLoaded, mode, workspace, resolvedTheme])
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
      map.easeTo({ pitch: workspace ? WORKSPACE_3D_PITCH : HERO_3D_CAMERA.pitch, bearing: heroBearing, duration })
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
  }, [map, isLoaded, mode, bearing, workspace])
  return null
}

/** One road of an edit preview. A replaced road dims. An estimate is thin and dotted. */
function GhostLegRoute({ id, leg, role }: { id: string; leg: GhostLeg; role: 'new' | 'replaced' }) {
  const paint = ghostLegPaint(leg, role)
  if (leg.coordinates.length < 2) return null
  return <MapRoute id={id} coordinates={leg.coordinates} color={role === 'replaced' ? '#64748B' : '#7D5EFC'} width={paint.width} opacity={paint.opacity} dashArray={role === 'replaced' ? undefined : paint.dash} interactive={false} />
}

/**
 * The add preview's road: one dashed line in the board's ghost ink. A proven
 * unmeasured leg draws dotted, so an estimate cannot read as a road.
 */
function PreviewRoadRoute({ road, dark }: { road: PreviewRoadView; dark: boolean }) {
  const coordinates = road.path.filter(validMapCoordinate).map(point => [point.lng, point.lat] as [number, number])
  if (coordinates.length < 2) return null
  const measured = (road.legInMeasured ?? true) && (road.legOutMeasured ?? true)
  const paint = ghostLegPaint({ measured }, 'new')
  return <MapRoute id="yf-preview-road" coordinates={coordinates} color={ghostInk(dark)} width={paint.width} opacity={paint.opacity} dashArray={paint.dash} interactive={false} />
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

/** The lagoon ink of a stay reach ring. A map paint cannot read a CSS token. */
const STAY_RING_INK = '#0D8D82'

/**
 * The edit preview's proposed road, as the map layer reads it. `path` runs
 * through the new stop. A null leg flag means the day has no such leg, so only
 * a proven unmeasured leg draws as an estimate.
 */
export interface PreviewRoadView {
  dayIndex: number
  path: Array<{ lat: number; lng: number }>
  legInMeasured: boolean | null
  legOutMeasured: boolean | null
}

export function TripMap({ trip, onOpenStop, nearbyPois = [], onAddNearby, focusDay, onDayFilterChange, tripReadinessRows = [], showToolbar = true, enableMapViewModes = false, dedicated = false, activeHitId = null, onActivateHit, onOpenInTimeline, onOpenInBoard, onDeleteStop, mainRouteGeometry = null, returnRouteGeometry = null, allowSelfMeasurement = true, clockMilestones = null, onOpenHaltDay, onShowReturnChange, slotPins = [], onOpenSlot, hitCosts, searchHitIds, legCorrections, mapTarget = null, onMapTargetConsumed, workspaceChrome = false, overlayInsets, instantTarget = false, journeyCursor = null, selectedDay = null, ghostRoad = null, previewRoad = null, stayRings = [], frameStayRing = false, gapRings = [], onGapRing, pickBands, pickTags, routeMarks = [], pickLetters, warningMarks = [], stopWarning = null, corridorDay = null, onBlankMapClick }: {
  trip: Trip
  onOpenStop?: (stopId: string) => void
  /** potential POIs to show as gold "idea" markers */
  nearbyPois?: PlaceHit[]
  /** when set, idea markers get a + button to add the POI straight from the map */
  onAddNearby?: (hit: PlaceHit) => void
  /** external day-focus driver (Board column select): a day index shows just that
      day's route, 'all' resets to the whole trip. Undefined = map owns its filter. */
  focusDay?: number | 'all'
  /** The day the all-days view stresses. Other days draw behind it at 2px and 40%. */
  selectedDay?: number | null
  /** The one day that draws the Drive corridor wash. Null draws no corridor. */
  corridorDay?: number | null
  /** A tap on bare map, after the map closed its own floating parts. */
  onBlankMapClick?: () => void
  /** An edit preview's roads. New roads draw dashed, the replaced road draws dim. */
  ghostRoad?: GhostRoad | null
  /** The add preview's proposed road. It draws dashed in the day colour, under
   *  the real route, so the plan the traveller owns stays the top line. */
  previewRoad?: PreviewRoadView | null
  /** The stay lens's reach rings. Absent or empty draws nothing. */
  stayRings?: Array<{ id: string; label: string; ring: [number, number][]; active?: boolean }>
  /** True only when the Stay lens is active and the day has a stay base. The
   *  ring camera framing never runs for another lens or a missing base. */
  frameStayRing?: boolean
  /** The parts of the day that are still open, as hollow rings on the road point.
   *  Absent or empty draws nothing. */
  gapRings?: Array<{ key: string; lat: number; lng: number; windowText: string | null }>
  /** A tap on an open-part ring opens that part in the plan rail. Without it
   *  the ring is a mark, not a button. */
  onGapRing?: (key: string) => void
  /** The band of each pick, keyed by the pick id the map already uses. */
  pickBands?: Record<string, 'just-past' | 'over-budget'>
  /** The words beside a pick that lies past the scope, keyed like `pickBands`. */
  pickTags?: Record<string, string>
  /** Clock ticks and the lunch window, drawn on the route. The parent reads the plan. */
  routeMarks?: RouteMark[]
  /** A rank letter for each pick, keyed by the pick id the map already uses. */
  pickLetters?: Record<string, 'A' | 'B' | 'C'>
  /** Real problems to mark with a diamond. The parent supplies each fact. */
  warningMarks?: { id: string; lat: number; lng: number; label: string; severe?: boolean; onOpen?: () => void }[]
  /** One problem that belongs to a plotted stop. The badge sits on that stop. */
  stopWarning?: { stopId: string; label: string; text: string | null; severe?: boolean } | null
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
  /** The surface owns its own area rather than sitting in a scrolling page —
   *  the dedicated Map tab. A coarse pointer gets one-finger pan and pinch
   *  there; an embed keeps cooperative gestures so page scrolling is not
   *  trapped. A fine pointer is unaffected in both cases. */
  dedicated?: boolean
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
  /** The workspace's measured road data (#611). Pin clocks derive from the
   *  same corrected journey the Timeline rows read; legs it does not cover
   *  stay estimates and say so. Absent = every clock is an estimate. */
  legCorrections?: Record<string, LegEstimate>
  /** Delete the stop straight from the map (popup action) — wired by MapTab. */
  onDeleteStop?: (stopId: string, stop: { title: string; dayIndex: number }) => void
  /** The Return-home toggle's direction state, reported up so the suggestion
   *  rails read the same road the map shows (#polylines): on = the loop (out +
   *  back, the plan's road), off = the outbound road alone. */
  onShowReturnChange?: (show: boolean) => void
  /** One-shot Overview request: select a stop, centre a point, or fit bounds. */
  mapTarget?: MapTarget | null
  /** Clears the one-shot request after the camera and selection settle. */
  onMapTargetConsumed?: () => void
  workspaceChrome?: boolean
  overlayInsets?: MapInsets
  instantTarget?: boolean
  journeyCursor?: { coordinate: { lat: number; lng: number }; label: string } | null
}) {
  const [dayFilter, setDayFilter] = useState<number | 'all'>('all')
  // The settled map zoom. Other days' base tags appear only at zoom 9 or more.
  const [mapZoom, setMapZoom] = useState(5)
  // The map moved. A ring caption reads the camera, so it draws again after every move.
  const [, setViewTick] = useState(0)
  // The compass shows the map's own bearing and resets it to north.
  const [bearing, setBearing] = useState(0)
  const toolbarId = useId()
  // A host drives the day filter through the prop (Board columns, the slots
  // rail's day strip); the map's own chips report their choice back through
  // `onDayFilterChange`, so the two selectors agree whichever one was touched.
  // The effect stays out of that loop: it sets state directly and never calls
  // back, and React bails on an identical value.
  // #425 PR 2: an inbound prop value is validated against THIS trip's days
  // before it can move the filter — a stale or foreign value reads as 'all'
  // (the clock walk numbers its own drive days), never another day's route.
  useEffect(() => {
    if (focusDay === undefined) return
    if (focusDay !== 'all' && !trip.days.some(d => d.index === focusDay)) {
      setDayFilter('all')
      return
    }
    setDayFilter(focusDay)
  }, [focusDay, trip.days])
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
  const [liveRecenterNonce, setLiveRecenterNonce] = useState(0)
  const toggleLive = () => {
    haptic(liveOn ? 'toggle' : 'select')
    setLiveOn(v => !v)
  }
  // Map key (legend) visibility — hidden by default so it stops covering the
  // bottom-right of the map; the choice persists per browser via uiPrefs.
  const [legendOpen, setLegendOpen] = useState(() => loadFlag('map_legend_open', false))
  const keyId = useId()
  const keyToggle = useRef<HTMLButtonElement>(null)
  function closeWorkspaceKey() {
    setLegendOpen(false)
    saveFlag('map_legend_open', false)
    keyToggle.current?.focus()
  }
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
  // The popup's own dialog element, for the Escape decision (cardClose.ts).
  const stopJumpRef = useRef<HTMLDivElement | null>(null)
  // The control that opened the popup. Escape puts focus back on it.
  const stopJumpOpener = useRef<HTMLElement | null>(null)
  const stopJumpOpen = selectedStop != null && (onOpenInTimeline != null || onOpenInBoard != null || onDeleteStop != null)
  // Escape closes the popup through the same card-close decision the stop edit
  // card uses: a key that starts in an open menu, another dialog or a text
  // field keeps its own surface. The popup is itself a role="dialog", so it is
  // the decision's card root — a key that starts inside it still closes it.
  useEffect(() => {
    if (!stopJumpOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (!cardCloseFromEventWithin(event, stopJumpRef.current)) return
      setSelectedStop(null)
      requestAnimationFrame(() => {
        const opener = stopJumpOpener.current
        if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true })
      })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [stopJumpOpen])
  // Collapse plays a short scale-down first (mapCollapse) so expand/collapse
  // both glide; the class is transient and the timer is cleared on unmount.
  const [closing, setClosing] = useState(false)
  const collapseTimer = useRef<number | undefined>(undefined)
  // One Expand button. The tools column and the phone menu draw the same control.
  function mapExpandButton(extraClass = '') {
    return <button type="button" className={`mv2-map-tools-btn map-expand-chip${extraClass ? ` ${extraClass}` : ''}${expanded ? ' on' : ''}`} aria-pressed={expanded}
      onClick={() => { if (expanded) collapseExpanded(); else setExpanded(true) }}
      title={expanded ? 'Shrink the map back into the page (Esc)' : 'Expand the map to fill the screen'}
      aria-label={expanded ? 'Shrink the map back into the page' : 'Expand the map to fill the screen'}>
      {expanded ? <X size={17} aria-hidden /> : <Maximize2 size={17} aria-hidden />}
    </button>
  }
  function collapseExpanded() {
    if (!expanded || closing) return
    setClosing(true)
    // The unmount rides the same token as mapCollapse's animation, so retiming
    // the CSS retimes the timer; reduced motion skips the glide entirely.
    collapseTimer.current = window.setTimeout(
      () => { setExpanded(false); setClosing(false) },
      prefersReducedMotion() ? 0 : motionExitTiming('--motion-slow').duration,
    )
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
  const shownIdeaCats = ideaCats.filter(([cat]) => !hiddenIdeaCats.has(cat)).length
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
  // #417: which suggestion pins the map is currently drawing as cluster badges.
  // The layer reports the member ids it read from its own source; every pin NOT
  // in that set keeps its DOM marker, and a pin the user is working with is never
  // offered to the clusterer at all (the rules live in lib/mapCluster).
  const [clusteredIds, setClusteredIds] = useState<ReadonlySet<string>>(() => new Set<string>())
  // Stable identity matters: a new callback re-subscribes the layer's reporting
  // effect and re-reports on every render.
  const onClustersChange = useCallback((ids: Set<string>) => { setClusteredIds(ids) }, [])
  // The workspace draws each group as its own pin, from the place and count the layer reports.
  const [clusterBadges, setClusterBadges] = useState<ClusterBadge[]>([])
  const onClusterBadges = useCallback((badges: ClusterBadge[]) => { setClusterBadges(badges) }, [])
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
  const basemapStatus = useWorkspaceBasemapStatus(theme)
  const mapRef = useRef<MapRef | null>(null)
  // A host can pass 0 when measured covers own an edge. The fallback keeps
  // maps without workspace chrome clear of the attribution and controls.
  const { top = 70, bottom = 70, left = 70, right = 70 } = overlayInsets ?? {}
  // The workspace panels, the journey bar and the attribution sit over the map.
  // The camera reads their live size, so a late layout change cannot hide a mark.
  const measureFrame = useCallback((): { size: { width: number; height: number }; insets: FrameInsets } => {
    const container = mapRef.current?.getContainer()
    const size = { width: container?.clientWidth ?? 800, height: container?.clientHeight ?? 600 }
    let insets: FrameInsets = { top, bottom, left, right }
    if (workspaceChrome && container) {
      const root = container.closest('.mv2-workspace') ?? document
      const covers = Array.from(root.querySelectorAll(WORKSPACE_COVER_SELECTOR)).map(el => el.getBoundingClientRect())
      insets = mergeInsets(insets, coverInsets(container.getBoundingClientRect(), covers))
      // F1: a narrow bar still hides a stop that sits under it. The search bar and the lens switch
      // reserve the map above their lower edge, and the control column reserves the map beside it.
      const canvasBox = container.getBoundingClientRect()
      const bars = Array.from(root.querySelectorAll('.mv2-omnibar, .mv2-lenses, .mv2-phone-day')).map(el => el.getBoundingClientRect())
        .filter(r => r.width > 0 && r.height > 0 && r.bottom > canvasBox.top && r.top < canvasBox.top + canvasBox.height / 3)
      const column = Array.from(root.querySelectorAll('.mv2-map-tools-card')).map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0)
      const reserved: FrameInsets = { top: 0, bottom: 0, left: 0, right: 0 }
      for (const r of bars) reserved.top = Math.max(reserved.top, r.bottom - canvasBox.top)
      if (column.length) {
        const colLeft = Math.min(...column.map(r => r.left))
        const colRight = Math.max(...column.map(r => r.right))
        if ((colLeft + colRight) / 2 > canvasBox.left + canvasBox.width / 2) reserved.right = Math.max(0, canvasBox.right - colLeft)
        else reserved.left = Math.max(0, colRight - canvasBox.left)
      }
      insets = mergeInsets(insets, reserved)
      // W14: the scope band sits in one corner, so the generic rule ignores it. A
      // mark or a clock pill under it would be cut. Reserve the map above its top edge.
      const band = root.querySelector('.mv2-lens-scope-band')
      if (band) {
        const bandRect = band.getBoundingClientRect()
        const canvasRect = container.getBoundingClientRect()
        if (bandRect.height > 0 && bandRect.top > canvasRect.top && bandRect.top < canvasRect.bottom) {
          insets = mergeInsets(insets, { top: 0, left: 0, right: 0, bottom: Math.max(0, canvasRect.bottom - bandRect.top) })
        }
      }
    }
    return { size, insets }
  }, [top, bottom, left, right, workspaceChrome])
  const cameraPadding = useCallback(() => {
    const { size, insets } = measureFrame()
    return workspaceChrome ? firstFitPadding(size, insets) : visibleMapPadding(size, insets)
  }, [measureFrame, workspaceChrome])
  const [mapLoaded, setMapLoaded] = useState(false)
  // A target camera stays authoritative for its day until the user moves the
  // map or chooses another day. Late road geometry must not steal the camera.
  const targetCameraActive = useRef(false)
  const targetCameraDay = useRef<number | 'all' | null>(null)
  // The route frame is automatic until the user moves the map. A new day frames again.
  const frameReleased = useRef(false)
  const frameKey = useRef('')
  const [frameTick, setFrameTick] = useState(0)

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

  // A food stop on last night's stay (the breakfast before the drive) draws as a
  // stay mark and takes no number, as the rail row does.
  const lastNightStayIds = useMemo(() => {
    const ids = new Set<string>()
    const ordered = [...trip.days].sort((a, b) => a.index - b.index)
    ordered.forEach((day, at) => {
      const hotel = [...(ordered[at - 1]?.stops ?? [])].reverse().find(stop => stop.category === 'hotel' && stop.status !== 'rejected')
      if (hotel == null) return
      for (const stop of day.stops) if (standsOnLastNightStay(stop, hotel)) ids.add(String(stop.id))
    })
    return ids
  }, [trip.days])

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
    for (const d of trip.days) {
      const j = buildJourney(trip, d, legCorrections)
      if (!(j.distanceKm >= 0.5 || j.driveMinutes > 0)) { out[String(d.index)] = null; continue }
      const pts = j.points
        .map(p => ({ lat: p.lat, lng: p.lng }))
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      out[String(d.index)] = pts.length >= 2 ? pts : null
    }
    return { dayRoutePoints: out, stopClock: buildStopClock(trip, legCorrections) }
  }, [trip, legCorrections])
  // W14: a single day reads its own kilometres, as the board's clock pills do.
  // The trip total stays in the tooltip. The day starts where the day before ended.
  const dayKmBase = useMemo(() => {
    if (dayFilter === 'all') return 0
    let base = 0
    for (const d of [...trip.days].sort((x, y) => x.index - y.index)) {
      if (d.index >= dayFilter) break
      for (const st of [...d.stops].sort((x, y) => x.orderInDay - y.orderInDay)) {
        const entry = stopClock.get(st.id)
        if (entry) base = entry.cumKm
      }
    }
    return base
  }, [dayFilter, stopClock, trip.days])
  // #613: whether the map has anything to draw. A day can carry a real derived
  // journey without stored stops, so the single-day gate reads the journey —
  // the pins alone would hide a driving day behind the no-stops message. The
  // all-days view still needs plotted stops for its shared stop chain.
  const canDrawRoute = dayFilter === 'all'
    ? allPoints.length > 0
    : allPoints.length > 0 || dayRoutePoints[String(dayFilter)] != null
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
    const j = buildJourney(trip, day, legCorrections)
    const plotted = daysToPlot.find(d => d.index === dayFilter)?.stops ?? []
    return extraJourneyMarkers(j.points, plotted, j.direction)
  }, [trip, dayFilter, daysToPlot, legCorrections])

  // A stop mark or a start/end flag owns its place on the map. A suggestion at
  // that same place gets no map mark: it would either cluster into a canvas
  // badge under the pin (the stray dark circle at the route start) or stack a
  // second pin on the first. Its rail card stays. The engine's under-1-km rule
  // decides "same place".
  const markClearPoints = useMemo(
    () => [
      ...allPoints.map(p => ({ lat: p.lat, lng: p.lng })),
      ...dayEndpointMarkers.map(m => m.position),
    ],
    [allPoints, dayEndpointMarkers],
  )
  const markPois = useMemo(
    () => clearOfMarks(visiblePois, markClearPoints, coLocates, new Set(Object.keys(pickLetters ?? {}))),
    [visiblePois, markClearPoints, pickLetters],
  )
  const clusterPins = useMemo(
    () => clusterCandidates(
      markPois.filter(h => !slotPinIds.has(String(h.id))),
      { activeId: activeHitId, searchIds: searchHitIds, keepIds: pickLetters ? new Set(Object.keys(pickLetters)) : null },
    ),
    [markPois, slotPinIds, activeHitId, searchHitIds, pickLetters],
  )
  const clusterData = useMemo(() => clusterFeatureCollection(clusterPins), [clusterPins])
  const { individual: individualClusterPins } = useMemo(
    () => splitByCluster(clusterPins, clusteredIds),
    [clusterPins, clusteredIds],
  )
  const individualPinIds = useMemo(
    () => new Set(individualClusterPins.map(c => c.id)),
    [individualClusterPins],
  )
  const clusterNote = clusterSummary(clusterPins.length - individualClusterPins.length)

  // Close marks must not overlap on screen. Marks keep their real coordinates.
  // The spread only moves how they are drawn, after each camera move.
  // A stop wins over a problem, an empty part, a pick and a clock pill, in that order.
  const [markSpots, setMarkSpots] = useState<Map<string, MarkSpot>>(new Map())
  // While the camera zooms, turns or tilts, the laid-out pills and tags belong to the old view. They
  // hide until the move ends. A stop never takes part: it stays on its coordinate the whole time.
  const [camMoving, setCamMoving] = useState(false)
  // The drawn road per day. The road labels read it, so it is declared before the layout below.
  const [geom, setGeom] = useState<Record<string, [number, number][]>>({})
  // W14: a reach ring wider than the view has its caption point off the map. The
  // camera pass parks the caption at the nearest edge of the clear map area. It is
  // computed here, never read from a ref during render.
  const [ringCaptionSpots, setRingCaptionSpots] = useState<Record<string, { lat: number; lng: number; edge: boolean }>>({})
  const ringCaptionSpotsRef = useRef<Record<string, { lat: number; lng: number; edge: boolean }>>({})
  // The home leg of a round trip. The road labels read it, so it is declared before the layout.
  const returnLeg = useMemo(() => {
    if (!isRoundTrip(trip) || !trip.startLocationCoords) return null
    const last = allPoints[allPoints.length - 1]
    if (!last) return null
    const h = trip.startLocationCoords
    if (Math.abs(h.lat - last.lat) < 1e-4 && Math.abs(h.lng - last.lng) < 1e-4) return null
    return { from: { lat: last.lat, lng: last.lng }, home: { lat: h.lat, lng: h.lng } }
  }, [trip, allPoints])
  // A stop name tag follows the active day. The stay base keeps its tag on every day,
  // so the house mark always says where tonight's base is.
  const activeTagDay = dayFilter === 'all' ? selectedDay ?? null : dayFilter
  const spreadMarks: (LayoutMark & { lat: number; lng: number; ox: number; oy: number })[] = []
  if (workspaceChrome) {
    // A pill of the active day is placed first. It wins a free spot over a pill of another day.
    const layoutOrder = [...allPoints].sort((a, b) => Number(b.dayIndex === activeTagDay) - Number(a.dayIndex === activeTagDay))
    for (const p of layoutOrder) {
      const off = pinOffsets.get(p.id)
      const base = { lat: p.lat, lng: p.lng, ox: off?.dx ?? 0, oy: off?.dy ?? 0 }
      spreadMarks.push({ id: `stop:${p.id}`, layer: 'stop', x: 0, y: 0, w: p.auto ? 30 : STOP_BOX.w, h: p.auto ? 30 : STOP_BOX.h, drawW: p.auto ? 30 : STOP_BOX.drawW, drawH: p.auto ? 30 : STOP_BOX.drawH, ...base })
      const isBase = p.category === 'hotel'
      const warned = stopWarning?.stopId === p.id
      const showTag = !warned && (isBase ? showsHotelTag(p, activeTagDay, mapZoom) : showsStopTag(p, activeTagDay))
      // A tag is a pill: it never takes a tap and it yields to every badge. The
      // clock pill already gives way first, so the tag keeps its place.
      if (showTag) {
        const tag = stopTagBox(isBase ? baseTagText(p.title) : p.title)
        // The base tag sits beside its mark. Its box starts there, so a spread
        // slide stays next to the stop instead of pushing the tag far left.
        const box = baseTagBox({ x: 0, y: 0, w: STOP_BOX.drawW, h: STOP_BOX.drawH }, tag.w, tag.h, isBase ? BASE_TAG_GAP : NUMBER_TAG_GAP)
        // A name tag belongs to its own pin. A free side of the same mark wins
        // over a long collision slide that lands the name on another stop.
        const sideX = (STOP_BOX.drawW + tag.w) / 2 + BASE_TAG_GAP
        const belowY = (STOP_BOX.drawH + tag.h) / 2 + BASE_TAG_GAP
        spreadMarks.push({
          id: `tag:${p.id}`, layer: 'clock', follows: `stop:${p.id}`, x: box.x, y: box.y, w: tag.w, h: tag.h, ...base,
          maxTravel: belowY,
          alternates: [[sideX, 0], [-sideX, 0], [0, belowY], [0, -belowY]],
        })
      }
      // The Stay board hides the clock pill while the base tag shows. Hiding it
      // here keeps the two pills from ever colliding on one mark.
      if (!p.auto && !warned && !(showTag && isBase) && clockMilestones && clockOn && stopClock.has(p.id)) {
        const c = stopClock.get(p.id)!
        const arriveText = `${c.arrive}${c.estimated ? ' (est.)' : ''}`
        const kmText = `Km ${Math.max(0, c.cumKm - dayKmBase)}`
        spreadMarks.push({ id: `clock:${p.id}`, layer: 'clock', follows: `stop:${p.id}`, x: 0, y: CLOCK_BOX.dy, w: stopClockBox(arriveText, kmText).w, h: CLOCK_BOX.h, ...base })
      }
      if (stopWarning?.stopId === p.id && stopWarning.text != null && stopWarning.text.trim() !== '') {
        const tag = stopTagBox(stopWarning.text, 260)
        // The board puts the tag beside the badge, on its left, like the base tag.
        // The box starts there. Below and above come next, then the right side,
        // so the map controls on the right never cover it.
        const box = baseTagBox({ x: 0, y: 0, w: STOP_BOX.drawW, h: STOP_BOX.drawH }, tag.w, tag.h)
        const rightDx = STOP_BOX.drawW + BASE_TAG_GAP * 2 + tag.w
        spreadMarks.push({
          id: `fix-tag:${p.id}`, layer: 'clock', follows: `stop:${p.id}`, x: box.x, y: box.y, w: tag.w, h: tag.h, ...base,
          maxTravel: 500,
          alternates: [
            [0, (STOP_BOX.drawH + tag.h) / 2 + 2],
            [0, -((STOP_BOX.drawH + tag.h) / 2 + 2)],
            [rightDx, 0],
          ],
        })
      }
    }
    for (const m of dayEndpointMarkers) spreadMarks.push({ id: `endpoint:${m.kind}:${m.position.lat}:${m.position.lng}`, layer: 'stop', x: 0, y: 0, w: 30, h: 30, lat: m.position.lat, lng: m.position.lng, ox: 0, oy: 0 })
    for (const w of warningMarks) if (validMapCoordinate({ lat: w.lat, lng: w.lng })) spreadMarks.push({ id: `warn:${w.id}`, layer: 'warn', x: 0, y: 0, ...WARN_BOX, lat: w.lat, lng: w.lng, ox: 0, oy: 0 })
    for (const pin of slotPins) {
      const fix = coordFixes[pin.hit.id as string]
      const lat = fix ? fix.lat : pin.hit.latitude
      const lng = fix ? fix.lng : pin.hit.longitude
      if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) spreadMarks.push({ id: `slot:${pin.key}`, layer: 'slot', x: 0, y: 0, ...SLOT_BOX, lat, lng, ox: 0, oy: 0 })
    }
    // Lens: an open part of the day joins the layout as a slot mark, so its ring
    // keeps the same 44px hit box the empty-part pins use.
    for (const ring of gapRings) {
      if (!Number.isFinite(ring.lat) || !Number.isFinite(ring.lng) || (ring.lat === 0 && ring.lng === 0)) continue
      spreadMarks.push({ id: `gap:${ring.key}`, layer: 'slot', x: 0, y: 0, ...SLOT_BOX, lat: ring.lat, lng: ring.lng, ox: 0, oy: 0 })
    }
    for (const hit of markPois) {
      if (slotPinIds.has(String(hit.id)) || !individualPinIds.has(String(hit.id))) continue
      const hasAdd = !!onAddNearby && !workspaceChrome
      spreadMarks.push({ id: `pick:${hit.id}`, layer: 'pick', x: 0, y: 0, ...(hasAdd ? PICK_ADD_BOX : PICK_BOX), lat: hit.latitude, lng: hit.longitude, ox: 0, oy: hasAdd ? PICK_ADD_SHIFT : 0 })
    }
    if (workspaceChrome) for (const badge of clusterBadges) spreadMarks.push({ id: `group:${badge.id}`, layer: 'group', x: 0, y: 0, ...GROUP_BOX, lat: badge.lat, lng: badge.lng, ox: 0, oy: 0, maxTravel: GROUP_MAX_TRAVEL })
  }
  // The road labels, the route ticks and the pick words are pills too. They yield to the stops,
  // slide a short way, or hide. They come after the stop pills, so a stop's own pill wins a spot.
  if (workspaceChrome) {
    if (clockMilestones && clockOn && dayFilter === 'all') {
      visibleMilestones(clockMilestones, !returnLeg || showReturn).forEach((m, i) => {
        if (!validMapCoordinate({ lat: m.lat, lng: m.lng })) return
        const box = milestoneBox(m, formatHM(clockHM(m.etaMin), timeFormat))
        spreadMarks.push({ id: milestoneMarkId(i), layer: 'clock', x: box.x, y: 0, w: box.w, h: box.h, lat: m.lat, lng: m.lng, ox: 0, oy: 0 })
      })
      for (const pin of suggestionDistancePins(nearbyPois, geom.all ?? null)) {
        spreadMarks.push({ id: `sd:${pin.id}`, layer: 'clock', x: 30, y: 0, w: `Km ${Math.round(pin.km)}`.length * 6.2 + 18, h: 19, lat: pin.lat, lng: pin.lng, ox: 0, oy: 0 })
      }
    }
    // The lunch window is placed before the time ticks. It may slide further along the road, so a tick never takes its spot.
    for (const mark of [...routeMarks].sort((a, b) => Number(a.kind === 'tick') - Number(b.kind === 'tick'))) {
      if (!validMapCoordinate({ lat: mark.lat, lng: mark.lng })) continue
      const text = mark.label + (mark.sub ?? '')
      // A road tick never slides: a slid tick reads as a wrong place, and a crowd of them stacked
      // into a column. It hides when its own spot is taken, and it claims extra room, so the
      // ticks that stay are spaced out. The density follows the zoom with no extra rule.
      spreadMarks.push({ id: `route:${mark.id}`, layer: 'clock', x: 0, y: 0, w: mark.kind === 'tick' ? CLOCK_BOX.w + TICK_ROOM : text.length * 7.4 + 28, h: mark.kind === 'tick' ? CLOCK_BOX.h + TICK_ROOM : CLOCK_BOX.h, lat: mark.lat, lng: mark.lng, ox: 0, oy: 0, maxTravel: mark.kind === 'tick' ? 0 : 160 })
    }
    for (const hit of markPois) {
      const tagText = pickTags?.[String(hit.id)]
      if (tagText == null || slotPinIds.has(String(hit.id)) || !individualPinIds.has(String(hit.id))) continue
      const w = tagText.length * 7.2 + 26
      spreadMarks.push({ id: `pick-tag:${hit.id}`, layer: 'clock', follows: `pick:${hit.id}`, x: (PICK_BOX.w + w) / 2 + 4, y: 0, w, h: 24, lat: hit.latitude, lng: hit.longitude, ox: 0, oy: 0 })
    }
  }
  // The Layers button shows a dot while a layer differs from its default. A hidden layer is never a secret.
  const layersChanged = (!!clockMilestones && !clockOn) || (!!returnLeg && !showReturn) || shownIdeaCats < ideaCats.length
  const spreadKey = spreadMarks.map(m => `${m.id}@${m.lat.toFixed(5)},${m.lng.toFixed(5)}`).join('|')
  const spreadMarksRef = useRef(spreadMarks)
  // Effects run top to bottom, so this one feeds the spread and camera effects below it in the same commit.
  useEffect(() => { spreadMarksRef.current = spreadMarks })
  // Lay out the marks for the camera as it is now. The boxes are where stops and pills end up.
  const layoutOnMap = useCallback((map: MapRef, bounds?: MarkBounds) => {
    const marks: LayoutMark[] = spreadMarksRef.current.map(m => {
      const { x, y } = map.project([m.lng, m.lat])
      return {
        id: m.id, layer: m.layer, follows: m.follows, w: m.w, h: m.h, drawW: m.drawW, drawH: m.drawH,
        x: x + m.ox + (m.layer === 'clock' ? m.x : 0), y: y + m.oy + (m.layer === 'clock' ? m.y : 0),
        ...(m.alternates ? { alternates: m.alternates } : {}),
        ...(m.maxTravel != null ? { maxTravel: m.maxTravel } : {}),
      }
    })
    const spots = layoutMarks(marks, { bounds })
    if (typeof window !== 'undefined') (window as unknown as { __spotDebug?: Record<string, unknown> }).__spotDebug = Object.fromEntries(spots)
    // The boxes carry their layer. The settle pass uses stop badges alone.
    // A pill that slid or hid adds no padding.
    const boxes: (FrameBox & { layer: string })[] = marks.filter(m => m.layer === 'stop' || (m.layer === 'clock' && m.follows?.startsWith('stop:'))).flatMap(m => {
      const spot = spots.get(m.id)
      if (!spot || spot.hidden) return []
      const anchor = m.follows ? spots.get(m.follows) : undefined
      return [{ layer: m.layer, x: m.x + spot.dx + (anchor?.dx ?? 0), y: m.y + spot.dy + (anchor?.dy ?? 0), w: m.w, h: m.h }]
    })
    return { spots, boxes }
  }, [])
  // The ring dependency is CONTENT, not array identity — see lib/map/stayRings.
  const stayRingsKey = stayRingsDependencyKey(stayRings)
  const stayRingsRef = useRef(stayRings)
  // Effects run top to bottom, so the ref is current before the spread effect.
  useEffect(() => { stayRingsRef.current = stayRings }, [stayRings])
  useEffect(() => {
    const map = mapRef.current
    if (!workspaceChrome || !map || !mapLoaded) return
    // The rings arrive as a new array on every render (the page builds them
    // inline and the default below is a new `[]`). Reading them through a ref
    // and depending on their key keeps this state-writing effect from running
    // again after every commit, which was the render loop itself.
    const rings = stayRingsRef.current
    const spread = () => {
      try {
        // A ring caption reads the camera, but an unchanged camera and an
        // unchanged mark layout need no new render. A tick on every moveend
        // makes this effect feed itself when the camera settles.
        const zoom = Math.round(map.getZoom() * 100) / 100
        setMapZoom(prev => prev === zoom ? prev : zoom)
        setCamMoving(false)
        const { size, insets } = measureFrame()
        // The pills may use the whole canvas except the map buttons column:
        // the 44px pads around the zoom and compass buttons sit at one edge,
        // and a pill under them is unreachable. A 6px edge pad keeps a placed
        // pill fully inside the canvas, so no chip is half cut by the viewport.
        const padded = { ...insets }
        const ctrls = map.getContainer().querySelector('.yf-map-ctrls')
        if (ctrls) {
          const box = ctrls.getBoundingClientRect()
          const canvasBox = map.getContainer().getBoundingClientRect()
          if (box.width > 0 && box.height > 0) padded.right = Math.max(padded.right, canvasBox.right - box.left)
        }
        padded.left = Math.max(padded.left, 6)
        padded.top = Math.max(padded.top, 6)
        padded.bottom = Math.max(padded.bottom, 6)
        padded.right = Math.max(padded.right, 6)
        const safe = safeRect(size, padded)
        const { spots: next } = layoutOnMap(map, safe)
        setMarkSpots(prev => {
          const same = prev.size === next.size && [...next].every(([id, spot]) => { const old = prev.get(id); return old && Math.round(old.dx) === Math.round(spot.dx) && Math.round(old.dy) === Math.round(spot.dy) && old.hidden === spot.hidden })
          return same ? prev : next
        })
        // A ring caption stands on the ring's foot point. When that point is off
        // the clear map area, keep the caption at the nearest edge instead.
        const captions: Record<string, { lat: number; lng: number; edge: boolean }> = {}
        for (const ring of rings) {
          const foot = ringCaptionPoint(ring.ring)
          if (!foot) continue
          const projected = map.project(foot)
          const x = Math.min(Math.max(projected.x, safe.left + 80), safe.right - 80)
          const y = Math.min(Math.max(projected.y, safe.top + 16), safe.bottom - 40)
          if (x !== projected.x || y !== projected.y) {
            const moved = map.unproject([x, y])
            captions[ring.id] = { lat: moved.lat, lng: moved.lng, edge: true }
          } else {
            captions[ring.id] = { lat: foot[1], lng: foot[0], edge: false }
          }
        }
        const captionsChanged = JSON.stringify(ringCaptionSpotsRef.current) !== JSON.stringify(captions)
        ringCaptionSpotsRef.current = captions
        setRingCaptionSpots(captionsChanged ? captions : prevState => prevState)
        if (captionsChanged) setViewTick(tick => tick + 1)
      } catch { /* the map was removed while measuring */ }
    }
    // A pan keeps every relative distance, so only a zoom, a turn or a tilt makes the layout stale.
    const startMove = () => setCamMoving(true)
    spread()
    map.on('zoomstart', startMove)
    map.on('rotatestart', startMove)
    map.on('pitchstart', startMove)
    map.on('moveend', spread)
    map.on('resize', spread)
    return () => { map.off('zoomstart', startMove); map.off('rotatestart', startMove); map.off('pitchstart', startMove); map.off('moveend', spread); map.off('resize', spread) }
  }, [workspaceChrome, mapLoaded, spreadKey, measureFrame, layoutOnMap, stayRingsKey])

  useEffect(() => {
    const map = mapRef.current
    if (!workspaceChrome || !map || !mapLoaded) return
    const read = () => setBearing(Math.round(map.getBearing()))
    read()
    map.on('rotate', read)
    return () => { map.off('rotate', read) }
  }, [workspaceChrome, mapLoaded])

  // The map mounts lazily inside a Suspense boundary, so mapRef may be null on
  // the first render(s). Poll until the instance exists, then open the camera
  // latch. The fit is a camera operation: it needs the instance and its
  // container, not a resolved style. The style-sensitive layers gate on
  // mapcn's isLoaded, so a stalled style cannot leave the camera dead.
  const pointsKey = useMemo(
    () => allPoints.map(p => `${p.dayIndex}:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|'),
    [allPoints],
  )
  useEffect(() => {
    if (!canDrawRoute) { setMapLoaded(false); return }
    let cancelled = false
    const tick = setInterval(() => {
      if (cancelled) return
      if (mapRef.current) { setMapLoaded(true); clearInterval(tick) }
    }, 60)
    return () => { cancelled = true; clearInterval(tick) }
  }, [pointsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real road geometry from OSRM. In "all days" mode a single connected chain —
  // the stops in timeline order — is drawn as one main line. In single-day mode
  // each day gets its own coloured line. Falls back to straight lines.
  // Declared HERE, above the fit, because the all-days fit now frames the drawn
  // road itself (#330) — a render-scoped useState has no forward reference, and
  // hoisting the declaration is what makes the line available to the camera.

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

  // A deliberate map gesture releases the target camera. Programmatic camera
  // moves use MapLibre events, so they do not clear this guard.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    const canvas = mapRef.current.getCanvas()
    const releaseTargetCamera = () => { targetCameraActive.current = false; frameReleased.current = true }
    canvas.addEventListener('pointerdown', releaseTargetCamera)
    canvas.addEventListener('wheel', releaseTargetCamera, { passive: true })
    return () => {
      canvas.removeEventListener('pointerdown', releaseTargetCamera)
      canvas.removeEventListener('wheel', releaseTargetCamera)
    }
  }, [mapLoaded])

  // Light dismiss. A tap on bare map closes what floats over it: the open tool menu, the stop
  // card, the map key, the credit line, and the caller's place card. MapLibre fires no click
  // after a drag, so a pan never closes anything. A tap on a group badge zooms in and keeps them.
  const onBlankMapClickRef = useRef(onBlankMapClick)
  useEffect(() => { onBlankMapClickRef.current = onBlankMapClick })
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !workspaceChrome) return
    const map = mapRef.current
    const onClick = (event: { point: { x: number; y: number }; originalEvent?: Event }) => {
      // Markers sit inside the map container, so a tap on a pin also reaches
      // here. Only a tap on the bare map is a blank click.
      const target = event.originalEvent?.target
      if (target instanceof Element && target.closest('.maplibregl-marker, .maplibregl-popup')) return
      const onBadge = map.queryRenderedFeatures([event.point.x, event.point.y]).some(f => f.layer.id.startsWith('clusters-') || f.layer.id.startsWith('cluster-count-'))
      if (onBadge) return
      closeToolMenus(null)
      setSelectedStop(null)
      setLegendOpen(open => { if (open) saveFlag('map_legend_open', false); return false })
      map.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show')
      onBlankMapClickRef.current?.()
    }
    map.on('click', onClick)
    return () => { map.off('click', onClick) }
  }, [mapLoaded, workspaceChrome])
  // A press outside an open tool menu closes it, so opening one menu closes the other.
  useEffect(() => {
    if (!workspaceChrome) return
    const onPointerDown = (event: PointerEvent) => closeToolMenus(event.target instanceof Element ? event.target : null)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [workspaceChrome])

  // The Stay lens frames its own reach ring. While it does, the route fit below
  // yields: a later resize would otherwise pull the camera back out to the day.
  const stayOwnsCamera = frameStayRing && stayRings.length > 0
  // fit the viewport to everything the view draws, whenever the map is ready
  // and that extent changes. A snap re-frame window makes those fits jump.
  const [snapRefitUntil, setSnapRefitUntil] = useState(0)
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return
    if (mapTarget) return
    if (stayOwnsCamera) return
    if (targetCameraActive.current) {
      if (targetCameraDay.current === dayFilter) return
      targetCameraActive.current = false
    }
    // The route extent is the widest camera fit this view allows. A scope chip
    // click or a lens change never adds a wider extent, so the camera stays here.
    const bounds = boundsOf(fitPoints)
    if (!bounds) return
    const m = mapRef.current
    // A new day or a new route frames again. A resize keeps a user's own camera.
    if (frameKey.current !== `${dayFilter}|${fitPointsKey}`) { frameKey.current = `${dayFilter}|${fitPointsKey}`; frameReleased.current = false }
    else if (frameReleased.current) return
    const timers: number[] = []
    // Frame, then check stop boxes against the covered rect. A settle pass
    // keeps the first open area. Pills that slide or hide add no padding.
    const settle = (attempt: number, extra: FrameInsets) => {
      if (frameReleased.current || targetCameraActive.current) return
      const { size, insets } = measureFrame()
      const currentPadding = settlePadding(size, insets, extra)
      const { boxes } = layoutOnMap(m, safeRect(size, currentPadding))
      const grown = settleStep(size, insets, extra, boxes.filter(box => box.layer === 'stop'))
      if (!grown || attempt >= 3) return
      // The correction glides too. A snap at the end of the day glide read as a jerk.
      const nudge = prefersReducedMotion() ? 0 : motionTiming('--motion-med').duration
      m.fitBounds(bounds, { padding: settlePadding(size, insets, grown), maxZoom: 12, duration: nudge, easing: easeInOutCubic })
      if (nudge === 0) settle(attempt + 1, grown)
      else m.once('moveend', () => settle(attempt + 1, grown))
    }
    const run = () => {
      m.resize()
      // A new day is a long move across the map. It takes the slower glide, with a soft start and end.
      // A snap re-frame jumps instead: the sheet's layout noise cancels a glide
      // mid-flight, so the re-frame window after an inset change uses jumps.
      const instant = Date.now() < snapRefitUntil
      const duration = instant || prefersReducedMotion() ? 0 : motionTiming('--motion-slower').duration
      const base = cameraPadding()
      m.fitBounds(bounds, { padding: base, maxZoom: 12, duration, easing: easeInOutCubic })
      if (!workspaceChrome) return
      if (duration === 0) settle(0, { top: 0, bottom: 0, left: 0, right: 0 })
      else m.once('moveend', () => settle(0, { top: 0, bottom: 0, left: 0, right: 0 }))
      // The journey bar and the panels can mount after the first fit. Check again.
      timers.push(window.setTimeout(() => settle(0, { top: 0, bottom: 0, left: 0, right: 0 }), 1500))
    }
    const frame = requestAnimationFrame(run)
    return () => { cancelAnimationFrame(frame); timers.forEach(window.clearTimeout) }
  }, [fitPointsKey, mapLoaded, mapTarget, dayFilter, frameTick, stayOwnsCamera, snapRefitUntil]) // eslint-disable-line react-hooks/exhaustive-deps

  // A stored inset that changes after mount (the phone sheet snap animates)
  // re-frames the route, unless the user moved the map. The first values
  // arm the baseline; the fit effect above already ran with them.
  // The re-frame runs on a short interval: the sheet, the day strip and the
  // lens pill settle on their own transitions, in any order. Each frame
  // jumps (a glide through the layout noise gets canceled) and lands where
  // the covers then stand, so the last one carries the final rects.
  const lastInsets = useRef('')
  useEffect(() => {
    const key = `${top}|${bottom}|${left}|${right}`
    if (!lastInsets.current) { lastInsets.current = key; return }
    if (lastInsets.current === key) return
    lastInsets.current = key
    if (!workspaceChrome || !mapLoaded) return
    // The first frame arms the jump window; a timeout callback may set state,
    // a synchronous call in the effect body may not.
    const frames = [260, 760, 1260, 1760, 2260, 2760].map(delay => window.setTimeout(() => {
      if (delay === 260) setSnapRefitUntil(Date.now() + 2500)
      setFrameTick(n => n + 1)
    }, delay))
    return () => frames.forEach(window.clearTimeout)
  }, [top, bottom, left, right, workspaceChrome, mapLoaded])

  // A new container size frames the route again, unless the user moved the map.
  // The chrome covers above the map also re-frame it: the phone day strip grows
  // when its journey content arrives, and the search row slides down with it.
  useEffect(() => {
    const container = mapRef.current?.getContainer()
    if (!workspaceChrome || !mapLoaded || !container) return
    let last = { w: container.clientWidth, h: container.clientHeight }
    let timer = 0
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setFrameTick(n => n + 1), 200)
    }
    const observer = new ResizeObserver(() => {
      const next = { w: container.clientWidth, h: container.clientHeight }
      if (Math.abs(next.w - last.w) < 2 && Math.abs(next.h - last.h) < 2) return
      last = next
      schedule()
    })
    observer.observe(container)
    const root = container.closest('.mv2-workspace')
    const covers = root ? Array.from(root.querySelectorAll(WORKSPACE_COVER_SELECTOR)) : []
    const coverObserver = new ResizeObserver(schedule)
    covers.forEach(cover => coverObserver.observe(cover))
    return () => { observer.disconnect(); coverObserver.disconnect(); window.clearTimeout(timer) }
  }, [workspaceChrome, mapLoaded])

  // W9c: frame the active stay reach ring when the Stay lens opens one. The
  // flag comes from the page: only the Stay lens with a stay base frames it.
  // The ring fills a measured fraction of the visible canvas, so the fit is
  // scale-free. Clamping keeps the frame inside the day's route extent.
  const stayFramedKey = useRef<string | null>(null)
  useEffect(() => {
    if (!stayOwnsCamera) { stayFramedKey.current = null; return }
    if (!mapLoaded || !mapRef.current) return
    // One fit per lens open or base move. The key is the ring's content, so a
    // caption change or a fresh array never frames again.
    const action = stayFrameAction({
      framing: frameStayRing, hasRing: stayRings.length > 0, key: stayRingsKey,
      framedKey: stayFramedKey.current, released: frameReleased.current,
    })
    if (action === 'skip') return
    if (stayFramedKey.current !== stayRingsKey) frameReleased.current = false
    stayFramedKey.current = stayRingsKey
    const first = stayRings[0]
    if (!first) return
    const framed = stayFrameBounds(first.ring, STAY_RING_CANVAS_FRACTION)
    if (!framed) return
    // A base at the end of the route would slide the ring into a corner of the
    // route extent. The clamp holds only when it keeps most of the ring's frame.
    const clamped = clampBoundsWithin(framed, boundsOf(fitPoints)) ?? framed
    const area = (b: [[number, number], [number, number]]) => (b[1][0] - b[0][0]) * (b[1][1] - b[0][1])
    const bounds = area(clamped) >= area(framed) * 0.8 ? clamped : framed
    const m = mapRef.current
    m.fitBounds(bounds, { padding: cameraPadding(), maxZoom: 15, duration: prefersReducedMotion() ? 0 : motionTiming('--motion-slow').duration })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stayRingsKey, mapLoaded, frameStayRing, stayOwnsCamera, frameTick])

  useEffect(() => {
    if (!mapTarget || !mapLoaded || !mapRef.current) return
    const normalized = normalizeMapTarget(mapTarget)
    const m = mapRef.current
    if (!normalized) {
      onMapTargetConsumed?.()
      return
    }
    if (normalized.kind === 'stop') {
      const sourceStop = trip.days
        .flatMap(day => day.stops)
        .find(stop => stop.id === normalized.stopId)
      if (!sourceStop || !validMapCoordinate(sourceStop) || sourceStop.lat === 0) {
        onMapTargetConsumed?.()
        return
      }
      const stop = allPoints.find(point => point.id === normalized.stopId)
      // The day filter has not caught up to the request yet.
      if (!stop) return
      // The map target is an imperative camera request. Selection follows only
      // after the requested day filter and rendered points agree on the stop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedStop({ id: stop.id, title: stop.title, dayIndex: stop.dayIndex })
      m.easeTo({
        center: [stop.lng, stop.lat],
        padding: cameraPadding(),
        zoom: Math.max(m.getZoom(), 14),
        duration: prefersReducedMotion() ? 0 : motionTiming('--motion-med').duration,
      })
    } else if (normalized.kind === 'coordinate') {
      m.easeTo({
        center: [normalized.coordinate.lng, normalized.coordinate.lat],
        padding: cameraPadding(),
        zoom: Math.max(m.getZoom(), 12),
        duration: instantTarget || prefersReducedMotion() ? 0 : motionTiming('--motion-med').duration,
      })
    } else {
      const bounds = boundsOf(normalized.points)
      if (!bounds) {
        onMapTargetConsumed?.()
        return
      }
      m.resize()
      m.fitBounds(bounds, {
        padding: cameraPadding(),
        maxZoom: 12,
        duration: prefersReducedMotion() ? 0 : motionTiming('--motion-slow').duration,
      })
    }
    targetCameraActive.current = true
    targetCameraDay.current = dayFilter
    onMapTargetConsumed?.()
  }, [mapTarget, mapLoaded, allPoints, trip.days, dayFilter, onMapTargetConsumed, cameraPadding, instantTarget])

  // Panel → map highlight: when a suggestion card is hovered/selected in the
  // side panels, glide the camera to its pin so the user sees where it is.
  useEffect(() => {
    if (activeHitId == null || !mapLoaded || !mapRef.current) return
    const hit = nearbyPois.find(h => h.id === activeHitId)
    if (!hit || !hasCoords(hit)) return
    const m = mapRef.current
    const duration = prefersReducedMotion() ? 0 : motionTiming('--motion-slow').duration
    // F1: while the camera still frames the route, a selected pick joins that frame. Every stop of the
    // view stays in the clear map area. A user who moved the map keeps the old glide to the pick.
    const framed = frameReleased.current ? null : boundsOf([...fitPoints, { lat: hit.latitude, lng: hit.longitude }])
    if (workspaceChrome && framed) {
      m.fitBounds(framed, { padding: cameraPadding(), maxZoom: 12, duration })
      return
    }
    m.easeTo({
      center: [hit.longitude, hit.latitude],
      padding: cameraPadding(),
      zoom: Math.max(m.getZoom(), 7),
      duration,
    })
  }, [activeHitId, mapLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Panel to map detour, drawn: the spur is a map CHILD (DetourSpurOverlay), not
  // an effect here. Its readiness signal is mapcn's `isLoaded`, which closes for
  // a theme swap. This component's `mapLoaded` is a camera latch: the watchdog
  // opens it on a stalled style, where a style write throws.

  function fitToTrip() {
    // With live on, recenter arms the camera follow again.
    if (liveOn) { setLiveRecenterNonce(n => n + 1); return }
    const m = mapRef.current
    const bounds = boundsOf(fitPoints)
    if (!m || !bounds) return
    m.resize()
    m.fitBounds(bounds, { padding: cameraPadding(), maxZoom: 12, duration: prefersReducedMotion() ? 0 : motionTiming('--motion-slow').duration })
  }

  // A mark moved by the spread keeps its real coordinate. Only the drawing moves.
  function offsetWrap(id: string, node: React.ReactNode): React.ReactNode {
    if (!workspaceChrome) return node
    const spot = camMoving ? undefined : markSpots.get(id)
    return <span className="mv2-pin-offset" data-mark={id} style={spot && (spot.dx || spot.dy) ? { transform: `translate(${spot.dx}px, ${spot.dy}px)` } : undefined}>{node}</span>
  }

  function colorForDay(i: number): string {
    return dayColor(i)
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
  // The route the spur snaps to: the measured road when it resolved, the stop
  // chain when it did not. Memoised so a re-render alone never re-writes it.
  const spurRoute = useMemo(
    () => (geom.all?.length ? geom.all : allStraight) ?? [],
    [geom.all, allStraight],
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
  const returnStraight = useMemo(
    () => (returnLeg ? [[returnLeg.from.lng, returnLeg.from.lat], [returnLeg.home.lng, returnLeg.home.lat]] as [number, number][] : null),
    [returnLeg],
  )

  useEffect(() => {
    if (!canDrawRoute) { setGeom({}); return }
    // AbortSignal, not just a flag: a cancelled effect must STOP the in-flight
    // fetches (they eat the shared OSRM rate-limit budget and their results
    // were being thrown away anyway) — #polylines.
    const ac = new AbortController()
    const { signal } = ac
    let cancelled = false
    ;(async () => {
      const asm = getAssumptions(trip)
      // A flight trip's line is the great-circle arc the workspace's journey
      // supplies, never a road measurement. Google Routes has no FLYING
      // travelMode and OSRM's endpoint is hardcoded to `/driving/`, so asking
      // either for a flight trip answers with ROAD directions — which is
      // exactly the defect this branch replaces.
      if (isAirMode(trip.transportMode)) {
        if (!cancelled) {
          setGeom(mainRouteGeometry && mainRouteGeometry.length > 1
            ? { all: dedupeConsecutive(mainRouteGeometry) }
            : {})
        }
        return
      }
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

  const nextViewMode = MAP_VIEW_MODES[(MAP_VIEW_MODES.indexOf(viewMode) + 1) % MAP_VIEW_MODES.length]
  function cycleViewMode() { haptic('select'); setViewMode(nextViewMode) }
  function viewModeGlyph(mode: typeof viewMode): React.ReactNode {
    return mode === 'terrain' ? <Mountain size={16} aria-hidden /> : MAP_VIEW_MODE_META[mode].label
  }

  return (
    <div className={`map-shell${workspaceChrome ? ' map-shell--workspace' : ''}${expanded ? ' map-shell--expanded' : ''}${closing ? ' map-shell--closing' : ''}`} data-tools-open="true">
      {showToolbar && (
      <div className="map-toolbar" id={toolbarId}>
        {workspaceChrome ? (
        <div className="mv2-map-tools" role="group" aria-label="Map tools">
          <div className="mv2-map-tools-card mv2-map-tools-card--zoom" role="group" aria-label="Zoom and recentre">
            <button type="button" className="mv2-map-tools-btn mv2-zoom" aria-label="Zoom in" title="Zoom in" onClick={() => { const m = mapRef.current; if (m) m.zoomTo(m.getZoom() + 1, { duration: motionTiming('--motion-med').duration }) }}><Plus size={17} aria-hidden /></button>
            <button type="button" className="mv2-map-tools-btn mv2-zoom" aria-label="Zoom out" title="Zoom out" onClick={() => { const m = mapRef.current; if (m) m.zoomTo(m.getZoom() - 1, { duration: motionTiming('--motion-med').duration }) }}><Minus size={17} aria-hidden /></button>
            <button type="button" className="mv2-map-tools-btn map-recenter" onClick={fitToTrip} aria-label="Recentre the map on the trip route" title="Recentre the map on the trip route"><Crosshair size={17} aria-hidden /></button>
            {bearing !== 0 && <button type="button" className="mv2-map-tools-btn map-compass" data-bearing={bearing} onClick={() => mapRef.current?.resetNorth({ duration: motionTiming('--motion-med').duration })} aria-label="Turn the map back to north" title="Turn the map back to north"><Compass size={17} aria-hidden style={{ rotate: `${-45 - bearing}deg` }} /></button>}
          </div>
          {enableMapViewModes && (
          // One button cycles flat, relief and 3D. It shows the view that is on now.
          <div className="mv2-map-tools-card mv2-map-view" role="group" aria-label="Map view mode">
            <button
              type="button"
              className="mv2-map-tools-btn mv2-map-view-cycle"
              data-mode={viewMode}
              aria-label={`Map view: ${MAP_VIEW_MODE_META[viewMode].aria}. Switch to ${MAP_VIEW_MODE_META[nextViewMode].aria}`}
              title={`${MAP_VIEW_MODE_META[viewMode].aria} · Click for ${MAP_VIEW_MODE_META[nextViewMode].aria}`}
              onClick={cycleViewMode}
            >
              <span key={viewMode} className="mv2-map-view-glyph">{viewModeGlyph(viewMode)}</span>
            </button>
          </div>
          )}
          {/* Expand is one tap on a tablet or desktop, not hidden in the menu. */}
          <div className="mv2-map-tools-card mv2-map-expand" role="group" aria-label="Map size">
            {mapExpandButton()}
          </div>
          <details className="mv2-tool-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.stopPropagation() } }}>
            <summary className="mv2-icon-btn" aria-label="Layers" title="Layers"><Layers size={18} aria-hidden />{layersChanged && <span className="mv2-layers-dot" aria-hidden="true" />}</summary>
            <div className="mv2-tool-menu-body popover mv2-layers" aria-label="Map layers">
            {(clockMilestones || returnLeg) && (
              <section className="mv2-layers-sec">
                <h4 className="mv2-layers-title">On the map</h4>
                {clockMilestones && (
                  <button type="button" className="mv2-layer-row" aria-pressed={clockOn} onClick={toggleClock}
                    aria-label="Road milestones" title="Show or hide each planned stop's time and distance on the road">
                    <Clock size={15} aria-hidden /><span className="mv2-layer-name">Road milestones</span><span className="mv2-switch" aria-hidden="true" />
                  </button>
                )}
                {returnLeg && (
                  <button type="button" className="mv2-layer-row" aria-pressed={showReturn} onClick={() => setShowReturn(s => !s)}
                    aria-label="Return leg" title={showReturn
                      ? 'Return leg shown. The loop km (out + back) feed the plan; hide to read the outbound road alone.'
                      : 'Return leg hidden - the corridor and km labels read the OUTBOUND road only.'}>
                    <RotateCcw size={15} aria-hidden /><span className="mv2-layer-name">Return leg</span><span className="mv2-switch" aria-hidden="true" />
                  </button>
                )}
              </section>
            )}
            {ideaCats.length > 0 && (
              <section className="mv2-layers-sec" role="group" aria-label="Nearby idea categories">
                <h4 className="mv2-layers-title">Ideas<span className="mv2-layers-count">{shownIdeaCats} / {ideaCats.length} shown</span></h4>
                {ideaCats.map(([cat, count]) => (
                  <button key={cat} type="button" className="mv2-layer-row" aria-pressed={!hiddenIdeaCats.has(cat)} onClick={() => toggleIdeaCat(cat)}>
                    <CatIcon category={cat} size={15} aria-hidden />
                    <span className="mv2-layer-name">{titleCase(cat)}</span>
                    <span className="mv2-layer-n">{count}</span>
                    <span className="mv2-switch" aria-hidden="true" />
                  </button>
                ))}
              </section>
            )}
            </div>
          </details>
          <details className="mv2-tool-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.stopPropagation() } }}>
            <summary className="mv2-icon-btn" aria-label="More map tools" title="More map tools"><MoreHorizontal size={18} aria-hidden /></summary>
            <div className="mv2-tool-menu-body popover" aria-label="More map tools">
            {/* The phone keeps the view switch in this menu, so the tools column stays short. */}
            {enableMapViewModes && <button type="button" className="mv2-map-tools-btn mv2-map-view-menu" data-mode={viewMode}
              aria-label={`Map view: ${MAP_VIEW_MODE_META[viewMode].aria}`} title={`Click for ${MAP_VIEW_MODE_META[nextViewMode].aria}`} onClick={cycleViewMode}>{viewModeGlyph(viewMode)}</button>}
            {dayDirectionsUrl && (
              <><span className="mv2-map-tools-divider" aria-hidden="true" />
                <button type="button" className="mv2-map-tools-btn" onClick={() => openExternal(dayDirectionsUrl)}
                  aria-label="Directions for this day in Google Maps" title="Open this day's ride with turn-by-turn directions in Google Maps"><Navigation size={17} aria-hidden /></button></>
            )}
            <span className="mv2-map-tools-divider" aria-hidden="true" />
            {/* The phone keeps Expand in this menu too, so the tools column stays short. */}
            {mapExpandButton('mv2-map-expand-menu')}
            <button type="button" className={`mv2-map-tools-btn${liveOn ? ' on' : ''}`}
              onClick={toggleLive} aria-pressed={liveOn}
              aria-label={liveOn ? 'Stop showing my live location' : 'Show my live location on the map'}
              title={liveOn ? 'Stop showing my live location' : 'Show my live location on the map'}>
              <LocateFixed size={17} aria-hidden />
            </button>
            <span className="mv2-map-tools-divider" aria-hidden="true" />
            <button type="button" ref={keyToggle} className="mv2-map-tools-btn"
              onClick={toggleLegend} aria-expanded={legendOpen} aria-controls={keyId}
              aria-label={legendOpen ? 'Hide the map key' : 'Show the map key'}
              title={legendOpen ? 'Hide the map key' : 'Show the map key'}>
              {legendOpen ? <X size={17} aria-hidden /> : <Info size={17} aria-hidden />}
            </button>
            </div>
          </details>
        </div>
        ) : (
        <>
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
                title={hiddenIdeaCats.size > 0 ? `Idea filters: ${hiddenIdeaCats.size} hidden` : 'Filter nearby ideas by type'}
              >
                Filters{hiddenIdeaCats.size > 0 ? ` (${hiddenIdeaCats.size})` : ''}
              </button>
              {filtersOpen && (
                /* `popover` carries the glass pair (background + backdrop-filter) and
                   the entrance. This panel used to restate them and shipped
                   see-through, so the class is the one way to frost a panel. */
                <div className="map-filters-pop popover" role="group" aria-label="Nearby idea categories">
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
        </>
        )}
        </div>
      )}

      <div className="map-frame">
        {!canDrawRoute ? (
          <div className="tm-state">
            <StateBlock kind="empty" size="compact" icon={<MapIcon size={38} aria-hidden />}
              title="No confirmed stops to plot yet" body="Add some in the Timeline." />
          </div>
        ) : (
          <MapLibreMap
            ref={mapRef}
            theme={theme}
            styles={workspaceChrome ? WORKSPACE_MAP_STYLES : undefined}
            onMapError={workspaceChrome ? basemapStatus.onMapError : undefined}
            className="yf-maplibre"
            center={[76.5, 10.5]}
            zoom={5}
          >
            {/* yf-map-ctrls: mapcn ships this group in Tailwind utilities this
                app doesn't compile — the class hooks the hand-ported CSS. */}
            <MapControls position="top-right" className="yf-map-ctrls" />
            {/* Terrain stack reconcile (2D · Terrain · 3D hero) — no-op on a
                hard-2D surface like the Board. */}
            {enableMapViewModes && <MapViewModeController mode={viewMode} bearing={heroBearing} workspace={workspaceChrome} />}
            {/* Inline on a coarse pointer: one finger scrolls the page.
                Expanded (or a mouse): normal gestures. */}
            <CooperativeGestures enabled={wantsCooperativeGestures({ dedicated, expanded })} />
            <LiveLocationLayer
              active={liveOn}
              startDate={trip.startDate}
              endDate={trip.endDate}
              today={toISODate(new Date())}
              focusDay={focusDay}
              recenterSignal={liveRecenterNonce}
            />
            {workspaceChrome && <MapBasemapStatus failure={basemapStatus.failure} onRetry={basemapStatus.onRetry} onSourceReady={basemapStatus.onSourceReady} />}
            {journeyCursor && validMapCoordinate(journeyCursor.coordinate) && <MapMarker longitude={journeyCursor.coordinate.lng} latitude={journeyCursor.coordinate.lat}>
              <MarkerContent><span className="mv2-map-clock" aria-hidden="true"><Clock size={13} />{journeyCursor.label}</span></MarkerContent>
            </MapMarker>}
            {/* The add preview's road is the lower line: the plan the traveller
                owns must stay above a road that is only proposed. */}
            {previewRoad && <PreviewRoadRoute road={previewRoad} dark={theme === 'dark'} />}
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
              // A selected day stands out only on a measured road. A chord
              // fallback keeps the single rough line, so nothing is invented.
              const focused = selectedDay != null && !rough ? dayRoadSlices(geom.all, dayRoutePoints, selectedDay) : []
              return (
                <>
                  {focused.length > 0 ? <>
                    {corridorDay != null && focused.filter(slice => slice.selected && slice.dayIndex === corridorDay).map(slice => (
                      <MapRoute key={`yf-all-corridor-${slice.dayIndex}`} id={`yf-all-corridor-${slice.dayIndex}`} coordinates={slice.coordinates} color={colorForDay(slice.dayIndex)} width={CORRIDOR_PAINT.width} tolerance={CORRIDOR_PAINT.tolerance} opacity={CORRIDOR_PAINT.opacity} interactive={false} />
                    ))}
                    <DayRouteLayers slices={focused} dark={dark} colorFor={colorForDay} />
                    {focused.filter(slice => slice.selected).map(slice => <RouteArrows key={slice.dayIndex} coordinates={slice.coordinates} dark={dark} />)}
                  </> : <>
                    <MapRoute
                      id="yf-main-casing"
                      coordinates={coords}
                      color={dark ? '#0B2545' : '#FFFFFF'}
                      width={ROUTE_PAINT.selectedCasingWidth}
                      opacity={dark ? 0.6 : 0.75}
                      interactive={false}
                    />
                    <MapRoute coordinates={coords} color={rough ? warnInk : dark ? '#2A6FDB' : '#0B2545'} width={rough ? 3.5 : ROUTE_PAINT.selectedWidth} opacity={rough ? 0.9 : 0.95} dashArray={rough ? ROUGH_DASH : undefined} />
                    {!rough && <RouteArrows coordinates={coords} dark={dark} />}
                  </>}
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
                    {/* The Drive corridor wash: a wide band of the day colour. It
                        sits over the white casing and under the route line, so the
                        day reads as a corridor, as the Drive board shows. */}
                    <MapRoute
                      id={`yf-day-casing-${d.index}`}
                      coordinates={coords}
                      color={theme === 'dark' ? '#0B2545' : '#FFFFFF'}
                      width={ROUTE_PAINT.selectedCasingWidth}
                      opacity={theme === 'dark' ? 0.6 : 0.75}
                      interactive={false}
                    />
                    {!rough && drawsCorridor(corridorDay, d.index) && (() => {
                      // The wash narrows at low zoom. Dashed edges appear from zoom 9.
                      const wash = smoothCorridorLine(thinCorridorLine(coords), 3)
                      const edges = corridorEdgeGeoJson(wash)
                      return <>
                        <MapRoute id={`yf-day-corridor-${d.index}`} coordinates={wash} color={colorForDay(d.index)} width={CORRIDOR_PAINT.width} tolerance={CORRIDOR_PAINT.tolerance} opacity={CORRIDOR_PAINT.opacity} interactive={false} />
                        {([-1, 1] as const).map(side => (
                          <MapGeoJSON
                            key={`yf-day-edge-${d.index}-${side}`}
                            id={`yf-day-edge-${d.index}-${side}`}
                            data={edges}
                            fillPaint={false}
                            linePaint={{
                              'line-color': colorForDay(d.index),
                              'line-width': CORRIDOR_PAINT.edgeWidth,
                              'line-opacity': CORRIDOR_PAINT.edgeOpacity,
                              'line-dasharray': CORRIDOR_PAINT.edgeDash,
                              'line-offset': corridorEdgeOffset(side),
                            }}
                          />
                        ))}
                      </>
                    })()}
                    <MapRoute
                      coordinates={coords}
                      color={rough ? warnInk : colorForDay(d.index)}
                      width={rough ? 3.5 : ROUTE_PAINT.selectedWidth}
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
            {/* The panel → map detour spur. It sits INSIDE the provider so it
                reads mapcn's `isLoaded` (loaded AND style loaded), and a theme
                swap re-adds it on the incoming style. TripMap's own gate is a
                camera latch and cannot say when a style write is safe. */}
            {/* Lens: the stay reach rings sit under the stop marks - a dashed
                lagoon line, with the walk or drive label chipped at the ring's
                top point. */}
            {stayRings.length > 0 && <MapGeoJSON
              id="yf-stay-rings-fill"
              data={stayRingsFillGeoJson(stayRings.filter(ring => ring.active !== false)) as unknown as MapGeoJSONData}
              fillPaint={{ 'fill-color': STAY_RING_INK, 'fill-opacity': 0.16 }}
              linePaint={false}
              interactive={false}
            />}
            {stayRings.length > 0 && stayRingsGeoJson(stayRings).features.map(ring => ring.geometry.coordinates.length > 1 && (
              <MapRoute key={`yf-stay-ring-${ring.properties.id}`} id={`yf-stay-ring-${ring.properties.id}`} coordinates={ring.geometry.coordinates} color={STAY_RING_INK} width={2} opacity={0.95} dashArray={[2, 1.5]} interactive={false} />
            ))}
            {stayRings.map(ring => {
              const foot = ringCaptionPoint(ring.ring)
              if (!foot) return null
              const Icon = ringCaptionMode(ring.id) === 'drive' ? Car : PersonStanding
              // A ring wider than the view has its caption off the map edge. The
              // camera pass parks it at the nearest edge of the clear area.
              const spot = ringCaptionSpots[ring.id]
              const at: [number, number] = spot ? [spot.lng, spot.lat] : foot
              return (
                <MapMarker key={`yf-stay-ring-label-${ring.id}`} longitude={at[0]} latitude={at[1]} anchor="top">
                  <MarkerContent><span className={`mv2-lens-ring-label${spot?.edge ? ' is-edge' : ''}`} data-ring={ring.id}><Icon size={13} aria-hidden />{ring.label}</span></MarkerContent>
                </MapMarker>
              )
            })}
            {/* Lens: an open part of the day is a hollow marigold ring on its road
                point. It is a button only when the host can open the part. */}
            {gapRings.map(ring => {
              if (!Number.isFinite(ring.lat) || !Number.isFinite(ring.lng) || (ring.lat === 0 && ring.lng === 0)) return null
              const note = ring.windowText
              const name = note ? `Open part of the day, ${note}` : 'Open part of the day'
              const mark = onGapRing
                ? <button type="button" className="mv2-lens-gap-ring" aria-label={name} title={note ?? undefined} onClick={() => onGapRing(ring.key)} />
                : <span className="mv2-lens-gap-ring" role="img" aria-label={name} title={note ?? undefined} />
              return (
                <MapMarker key={`yf-gap-ring-${ring.key}`} longitude={ring.lng} latitude={ring.lat} anchor="center">
                  <MarkerContent>{offsetWrap(`gap:${ring.key}`, mark)}</MarkerContent>
                </MapMarker>
              )
            })}
            {ghostRoad && <>
              {ghostRoad.replaced && <GhostLegRoute id="yf-ghost-replaced" leg={ghostRoad.replaced} role="replaced" />}
              {ghostRoad.legIn && <GhostLegRoute id="yf-ghost-in" leg={ghostRoad.legIn} role="new" />}
              {ghostRoad.legOut && <GhostLegRoute id="yf-ghost-out" leg={ghostRoad.legOut} role="new" />}
            </>}
            {warningMarks.filter(w => validMapCoordinate({ lat: w.lat, lng: w.lng })).map(w => (
              <MapMarker key={`warn-${w.id}`} longitude={w.lng} latitude={w.lat}>
                <MarkerContent>{offsetWrap(`warn:${w.id}`, <WarningDiamond label={w.label} severe={w.severe} onOpen={w.onOpen} />)}</MarkerContent>
                <MarkerTooltip>{w.label}</MarkerTooltip>
              </MapMarker>
            ))}
            {routeMarks.filter(mark => validMapCoordinate({ lat: mark.lat, lng: mark.lng })).map(mark => (
              <MapMarker key={`route-${mark.id}`} longitude={mark.lng} latitude={mark.lat}>
                <MarkerContent>
                  {mark.kind === 'tick'
                    ? <span className="mv2-pin-clock mv2-route-tick" data-collapsed={camMoving || markSpots.get(`route:${mark.id}`)?.hidden ? 'true' : undefined} style={pillStyle(markSpots.get(`route:${mark.id}`))} aria-label={`${mark.label}, ${mark.sub ?? ''}`}>{mark.label}{mark.sub != null && <small>{mark.sub}</small>}</span>
                    : <span className="mv2-route-window" data-collapsed={camMoving || markSpots.get(`route:${mark.id}`)?.hidden ? 'true' : undefined} style={pillStyle(markSpots.get(`route:${mark.id}`))}>{mark.label}</span>}
                </MarkerContent>
              </MapMarker>
            ))}
            <DetourSpurOverlay activeHitId={activeHitId} nearbyPois={nearbyPois} route={spurRoute} ink={warnInk} />
            {/* The travel clock as road labels: one text pair per planned anchor
                (meal / overnight / destination) — time + date left of the road,
                km right — plus the suggestion engine's placed stops as distance
                labels. Return-leg labels follow the Return home toggle.
                Whole-trip only — filtering to a day drops it with the loop
                geometry. */}
            {clockMilestones && clockOn && dayFilter === 'all' && (
              <>
                <ClockMilestoneLayer overlay={clockMilestones} showReturn={!returnLeg || showReturn} onOpenDay={onOpenHaltDay} pills={{ spots: markSpots, moving: camMoving }} />
                <SuggestionDistanceLayer places={nearbyPois} road={geom.all ?? null} pills={{ spots: markSpots, moving: camMoving }} />
              </>
            )}
            {/* #417: the suggestion family the map groups. `unclusteredVisible`
                false because every pin the map did NOT group keeps its own DOM
                marker below — tooltip, role, keyboard activation and all — so a
                GL circle for it would be a second, dead copy.
                The workspace groups its picks too. A pick never slides off its
                place, so a crowd shows as one count bubble that splits on zoom.
                The workspace draws each group as a DOM pin (below), so the
                pin slides off a stop like any mark. Lettered picks stay single. */}
            <MapClusterLayer
              data={clusterData}
              clusterColors={workspaceChrome ? WORKSPACE_CLUSTER_COLORS : IDEA_CLUSTER_COLORS}
              drawBadges={!workspaceChrome}
              onClusterBadges={workspaceChrome ? onClusterBadges : undefined}
              clusterThresholds={IDEA_CLUSTER_THRESHOLDS}
              unclusteredVisible={false}
              onClustersChange={onClustersChange}
            />
            {workspaceChrome && clusterBadges.map(badge => {
              const label = clusterCountLabel(badge.count)
              return (
                <MapMarker key={`group_${badge.id}`} longitude={badge.lng} latitude={badge.lat}>
                  <MarkerContent>
                    {offsetWrap(`group:${badge.id}`, <button
                      type="button"
                      className="mv2-stack"
                      data-size={groupSize(badge.count)}
                      aria-label={`${label}. Zoom in to open`}
                      title={`${label} · Click to open`}
                      onClick={e => {
                        e.stopPropagation()
                        mapRef.current?.easeTo({ center: [badge.lng, badge.lat], zoom: Math.max(badge.expandZoom, (mapRef.current?.getZoom() ?? 0) + 1), duration: prefersReducedMotion() ? 0 : motionTiming('--motion-slow').duration, easing: easeInOutCubic })
                      }}
                    >{badge.count}</button>)}
                  </MarkerContent>
                </MapMarker>
              )
            })}
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
                    {offsetWrap(`slot:${pin.key}`, <button
                      type="button"
                      className="yf-map-pin yf-map-pin--slot"
                      aria-label={label}
                      onClick={() => onOpenSlot?.(pin.key)}
                    >
                      {SLOT_PIN_GLYPH[pin.key] ?? pin.label.slice(0, 1)}
                      {workspaceChrome && (() => { const letter = pickLetter(slotPins.filter(other => other.key === pin.key).indexOf(pin)); return letter ? <span className="mv2-pick-letter" aria-hidden="true">{letter}</span> : null })()}
                    </button>)}
                  </MarkerContent>
                  <MarkerTooltip>{label}</MarkerTooltip>
                </MapMarker>
              )
            })}
            {(() => {
              let num = 0
              const showClockChips = !!(clockMilestones && clockOn)
              // The pill hangs from the badge, so the badge stays on its coordinate.
              const anchorWrap = (kids: React.ReactNode) => workspaceChrome ? <span className="mv2-pin-anchor">{kids}</span> : kids
              return allPoints.map((p, idx) => {
                // Auto anchor stops (trip start / final destination) render as
                // distinct start/end badges instead of numbered pins.
                const isLast = idx === allPoints.length - 1
                const off = pinOffsets.get(p.id)
                const spot = workspaceChrome ? markSpots.get(`stop:${p.id}`) : undefined
                const clockSpot = workspaceChrome ? markSpots.get(`clock:${p.id}`) : undefined
                const tagSpot = workspaceChrome ? markSpots.get(`tag:${p.id}`) : undefined
                const warn = workspaceChrome && stopWarning?.stopId === p.id ? stopWarning : null
                const warnTagSpot = workspaceChrome ? markSpots.get(`fix-tag:${p.id}`) : undefined
                const isBase = p.category === 'hotel'
                const showTag = !warn && workspaceChrome && (isBase ? showsHotelTag(p, activeTagDay, mapZoom) : showsStopTag(p, activeTagDay))
                const dx = (off?.dx ?? 0) + (spot?.dx ?? 0)
                const dy = (off?.dy ?? 0) + (spot?.dy ?? 0)
                const offsetStyle = dx || dy ? { transform: `translate(${dx}px, ${dy}px)` } : undefined
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
                        {c && <span className="yf-pin-time">{formatHM(c.arrive, timeFormat)}{c.estimated ? ' (est.)' : ''}</span>}
                      </MarkerContent>
                      <MarkerTooltip>{isLast ? `Final destination - ${p.title}` : `Trip start - ${p.title}`}{c ? `, arrives ${formatHM(c.arrive, timeFormat)}, ~${c.cumKm} km into the trip${c.estimated ? ' (estimate)' : ''}` : ''}</MarkerTooltip>
                    </MapMarker>
                  )
                }
                const onLastNight = workspaceChrome && lastNightStayIds.has(String(p.id))
                if (!onLastNight) num += 1
                const c = showClockChips ? stopClock.get(p.id) : undefined
                return (
                  <MapMarker key={p.id} longitude={p.lng} latitude={p.lat}>
                    <MarkerContent>
                      {anchorWrap(<>
                      <span className="yf-pin-cluster" style={offsetStyle}>
                      <button
                        className={`yf-map-pin ${workspaceChrome ? `mv2-map-stop${p.category === 'hotel' || onLastNight ? ' is-stay' : ''}${isBase && frameStayRing ? ' is-stay-hero' : ''}${p.status === 'maybe' ? ' is-tentative' : ''}` : 'yf-map-tear'}${p.status === 'maybe' ? ' yf-map-maybe' : ''}`}
                        style={{ '--pin-color': colorForDay(p.dayIndex), ...(workspaceChrome ? { '--mv2-marker-ink': '#FFFFFF' } : {}) } as React.CSSProperties}
                        onClick={event => { stopJumpOpener.current = event.currentTarget; onOpenStop?.(p.id); if (onOpenInTimeline || onOpenInBoard || onDeleteStop) setSelectedStop({ id: p.id, title: p.title, dayIndex: p.dayIndex }) }}
                        data-active-day={workspaceChrome && activeTagDay != null && p.dayIndex === activeTagDay ? 'true' : undefined}
                        aria-label={`Stop ${num}: ${p.title}${workspaceChrome && trip.fixedCommitments?.some(lock => lock.stopId === p.id && lock.dayIndex === p.dayIndex) ? ', fixed time' : ''}`}
                        title={p.title}
                      >
                        {workspaceChrome ? <MapStopSymbol order={num} stay={p.category === 'hotel' || onLastNight} fixed={trip.fixedCommitments?.some(lock => lock.stopId === p.id && lock.dayIndex === p.dayIndex)} warn={!!warn} /> : <span className="yf-pin-face">
                          <span className="yf-pin-ico" aria-hidden><CatIcon category={p.category} size={15} className="yf-pin-svg" /></span>
                          <i className="yf-pin-num">{num}</i>
                        </span>}
                      </button>
                      </span>
                      {showTag && <span className={`mv2-stop-tag${isBase ? ' mv2-stop-tag--base' : ''}`} data-collapsed={camMoving || tagSpot?.hidden ? 'true' : undefined} style={tagSpot && !tagSpot.hidden ? { transform: `translate(${tagSpot.dx + dx}px, ${tagSpot.dy + dy}px)` } : undefined}>{isBase ? baseTagText(p.title) : p.title}</span>}
                      {warn?.text != null && <span className="mv2-stop-tag mv2-stop-tag--fix" data-collapsed={camMoving || warnTagSpot?.hidden ? 'true' : undefined} style={warnTagSpot && !warnTagSpot.hidden ? { transform: `translate(${warnTagSpot.dx + dx}px, ${warnTagSpot.dy + dy}px)` } : undefined}>{warn.text}</span>}
                      {c && !warn && !(showTag && isBase) && (workspaceChrome
                        ? <span className="mv2-pin-clock" data-collapsed={camMoving || clockSpot?.hidden ? 'true' : undefined} style={clockSpot && !clockSpot.hidden ? { transform: `translate(${clockSpot.dx + dx}px, ${clockSpot.dy + dy}px)` } : undefined}>{formatHM(c.arrive, timeFormat)}{c.estimated ? ' (est.)' : ''} <small>Km {Math.max(0, c.cumKm - dayKmBase)}</small></span>
                        : <span className="yf-pin-time">{formatHM(c.arrive, timeFormat)}{c.estimated ? ' (est.)' : ''}</span>)}
                      </>)}
                    </MarkerContent>
                    <MarkerTooltip>{p.title}{c ? `, arrives ${formatHM(c.arrive, timeFormat)}, ~${c.cumKm} km into the trip${c.estimated ? ' (estimate)' : ''}` : ''}</MarkerTooltip>
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
                  {offsetWrap(`endpoint:${m.kind}:${m.position.lat}:${m.position.lng}`, <span
                    className="yf-map-pin yf-map-flag"
                    title={m.label}
                  >
                    {m.kind === 'start'
                      ? (trip.transportMode === 'flight'
                        ? <PlaneTakeoff size={13} aria-hidden />
                        : <CircleDot size={13} aria-hidden />)
                      : <Flag size={13} aria-hidden />}
                  </span>)}
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
            {markPois.map(hit => {
              // S4: an empty-part pin already stands here for this exact hit —
              // it carries more (the part it would fill, plus the cost line) and
              // its tap opens the plan, so it is the one that stays.
              if (slotPinIds.has(String(hit.id))) return null
              // #417: the map is drawing this pin inside a cluster badge. It has
              // no DOM node of its own right now; it comes back the moment the
              // badge is expanded (zoom in), and the badge's count says how many
              // are there. Confirmed stops are never filtered — they are their own
              // family and stay individually tappable at every zoom.
              if (!individualPinIds.has(String(hit.id))) return null
              const active = activeHitId != null && activeHitId === hit.id
              // A current search hit reads differently from a corridor idea:
              // solid teal, no attention pulse, "Search result" affordance. Its
              // tap selects it (glow + row highlight) instead of only locating.
              const isSearchHit = searchHitIds?.has(hit.id as string | number) ?? false
              // Lens bands: a pick past today's scope or budget says so on its face.
              const band = pickBands?.[String(hit.id)]
              const bandClass = pickBandClass(band)
              return (
                <MapMarker key={`nearby_${hit.id}`} longitude={hit.longitude} latitude={hit.latitude}>
                  <MarkerContent>
                    {offsetWrap(`pick:${hit.id}`, <VisiblePulse className="yf-map-idea" title={isSearchHit ? `${hit.name} - click to select this search result` : `${hit.name} - click to locate in the suggestions panel`}>
                      <span
                        className={`yf-map-pin yf-map-pin-idea${isSearchHit ? ' yf-map-pin-search' : ''}${active ? (isSearchHit ? ' yf-map-pin-search--active' : ' yf-map-pin-idea--active') : ''}${bandClass ? ` ${bandClass}` : ''}`}
                        style={isSearchHit || workspaceChrome ? undefined : { background: ideaPinColor(hit.category) } as React.CSSProperties}
                        data-family={workspaceChrome && !isSearchHit ? placeSubtype({ category: hit.category, name: hit.name }).family : undefined}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSearchHit ? active : undefined}
                        aria-description={band === 'over-budget' ? "Over today's budget" : undefined}
                        aria-label={isSearchHit ? `Select ${hit.name}` : `Locate ${hit.name} in the suggestions panel`}
                        onClick={() => onActivateHit?.(hit.id as string | number)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivateHit?.(hit.id as string | number) } }}
                      >
                        {isSearchHit ? <Search size={14} aria-hidden /> : workspaceChrome ? <PlaceSubtypeMark category={hit.category} name={hit.name} size={MAP_PICK_GLYPH.size} strokeWidth={MAP_PICK_GLYPH.stroke} letter={pickLetters?.[String(hit.id)] ?? null} /> : <CatIcon category={hit.category} size={14} />}
                      </span>
                      {pickTags?.[String(hit.id)] != null && <span className="mv2-pick-tag" data-band={band} data-collapsed={camMoving || markSpots.get(`pick-tag:${hit.id}`)?.hidden ? 'true' : undefined} style={(() => { const t = markSpots.get(`pick-tag:${hit.id}`); return t && !t.hidden && (t.dx || t.dy) ? { translate: `${t.dx}px ${t.dy}px` } : undefined })()}>{pickTags[String(hit.id)]}</span>}
                      {onAddNearby && !workspaceChrome && (
                        <button
                          type="button"
                          className="yf-map-idea-add"
                          onClick={e => { e.stopPropagation(); onAddNearby(hit) }}
                          aria-label={`Add ${hit.name} to the trip`}
                          title={`Add ${hit.name} to the trip`}
                        >+</button>
                      )}
                    </VisiblePulse>)}
                  </MarkerContent>
                  <MarkerTooltip>
                    {isSearchHit && <><InlineIcon icon={Search} size={12} gap={3} vAlign="-1px" />Search result: </>}
                    {!isSearchHit && <InlineIcon icon={Lightbulb} size={12} gap={3} vAlign="-1px" />}
                    {hit.name}{hit.haltPurpose ? `, ${hit.haltPurpose === 'overnight' ? 'Overnight option' : hit.haltPurpose}` : ''}{hit.cumKm != null ? `, ~${hit.cumKm} km in` : ''}{hit.nearestCity ? `, near ${hit.nearestCity}` : ''}{hitCosts?.[String(hit.id)] ? `, ${hitCosts[String(hit.id)]}` : ''}
                  </MarkerTooltip>
                </MapMarker>
              )
            })}
          </MapLibreMap>
        )}

        {selectedStop && (onOpenInTimeline || onOpenInBoard || onDeleteStop) && (
          <div ref={stopJumpRef} className="yf-stop-jump" role="dialog" aria-label={`Selected stop: ${selectedStop.title}`}
            style={{ position: 'absolute', left: '50%', bottom: 'calc(var(--mv2-sheet-height, 0px) + 14px)', transform: 'translateX(-50%)', zIndex: 5, display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-soft)', maxWidth: 'calc(100% - 24px)' }}>
            {/* #612: the name gets its own row. It used to share one flex row
                with every action, so at phone width the buttons kept their
                minimum widths and squeezed the name to zero. */}
            <span className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedStop.title}</span>
            {/* The actions wrap inside the popup's own bounds instead of pushing
                past them — Close stays visible at 320px. Touch targets do not
                change: the buttons keep their sizes, they only reflow. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {onOpenInTimeline && (
              <button className="btn btn-sm btn-primary" onClick={() => { onOpenInTimeline(selectedStop.id); setSelectedStop(null) }}>Open in Timeline</button>
            )}
            {onOpenInBoard && (
              <button className="btn btn-sm btn-outline" onClick={() => { onOpenInBoard(selectedStop.id); setSelectedStop(null) }}>Open in Board</button>
            )}
            {onDeleteStop && (
              <button className="btn btn-sm btn-danger" onClick={() => { onDeleteStop(selectedStop.id, { title: selectedStop.title, dayIndex: selectedStop.dayIndex }); setSelectedStop(null) }}>Remove</button>
            )}
            <button className="icon-btn" onClick={() => setSelectedStop(null)} aria-label="Close" style={{ flex: '0 0 auto', marginLeft: 'auto', minWidth: 44, minHeight: 44 }}><X size={14} aria-hidden /></button>
            </div>
          </div>
        )}

        <div className="map-legend">
          {!workspaceChrome && <>
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
              ref={keyToggle}
              className="map-legend-toggle"
              onClick={toggleLegend}
              aria-expanded={legendOpen}
              title={legendOpen ? 'Hide the map key' : 'Show the map key'}
              aria-label={legendOpen ? 'Hide the map key' : 'Show the map key'}
            >
              {legendOpen ? <><InlineIcon icon={X} size={12} gap={3} />Hide key</> : <><InlineIcon icon={Info} size={12} gap={3} />Key</>}
            </button>
          </>}
          {legendOpen && (workspaceChrome ? <MapWorkspaceKey id={keyId} onClose={closeWorkspaceKey} /> : (
            <div className="map-legend-body">
              {dayFilter === 'all'
                ? <>Main line · Whole route{returnLeg ? ' · dashed = drive back home' : ''} · </>
                : <>Colours · Day · </>}
              Pin · Stop type · Number · Timeline order · Dashed pin · Tentative · Flag · Endpoint · Gold bulb · Nearby picks{onAddNearby ? ' (+ to add)' : ''}{ideaCats.length > 0 ? ' · chips filter ideas by type' : ''} · Teal count · Nearby picks · Pin · Place details · Hollow amber pin · Unplanned part
            </div>
          ))}
        </div>
      </div>
      {/* #417: the badges are drawn on the canvas, which the accessibility tree
          cannot see — so the grouped count is said in words here, or a keyboard
          or screen-reader user simply loses those suggestions at overview zoom. */}
      {clusterNote && (
        <p className="hint-text tm-note" role="status">
          <InlineIcon icon={Lightbulb} size={12} gap={3} />{clusterNote}
        </p>
      )}
      <p className="hint-text tm-note">
        <InlineIcon icon={TriangleAlert} size={12} gap={3} />Roads · OSRM/OpenStreetMap · Offline routes · Estimated · Traffic · Unavailable
      </p>
    </div>
  )
}
