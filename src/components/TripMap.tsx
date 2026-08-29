// ============ Trip route map ============
// Real slippy-map rendering via mapcn (MapLibre GL): CARTO basemaps that follow
// light/dark theme, numbered stop markers in timeline order, and a polyline
// connecting each day's stops. Distances/durations still come from the engine.
import { useMemo, useState, useEffect, useRef } from 'react'
import type { Trip } from '../data/types'
import type { PlaceHit } from '../lib/geocode'
import { routePath } from '../lib/routing'
import { getAssumptions } from '../lib/engine'
import type { MapRef } from './mapcn/map'
import {
  Map as MapLibreMap,
  MapMarker,
  MarkerContent,
  MarkerTooltip,
  MapRoute,
  MapControls,
  useMap,
} from './mapcn/map'

const DAY_COLORS = ['#149A90', '#F59E2D', '#7C5CFC', '#E2557B', '#2D9CDB', '#6BBF59', '#B7791F']

// Basemaps — CARTO Voyager reads warmer/cleaner for travel than the default
// Positron; Esri World Imagery gives a free satellite toggle.
const STYLE_VOYAGER = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const STYLE_SAT = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
// Esri's World_Imagery TileJSON (so MapLibre gets attribution + maxzoom right)
const STYLE_SAT_JSON = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tilemap?blank=false'

/**
 * Direction chevrons along the route — a symbol layer fed by the same line
 * geometry, rendered with a tiny dependency-free triangle icon (addImage from
 * raw pixel data, so no font/glyph dependency on the basemap).
 */
function RouteArrows({ coordinates, dark }: { coordinates: [number, number][]; dark: boolean }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!isLoaded || !map || coordinates.length < 2) return
    const SRC = 'yf-arrows-src'
    const LAYER = 'yf-arrows'
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
    const src = map.getSource(SRC) as maplibreGLTypes.GeoJSONSource
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
const maplibreGLTypes = { GeoJSONSource: null as unknown as GeoJSONSourceLike }

/** Drop consecutive duplicate points (shared endpoints between legs). */
function dedupeConsecutive(coords: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const c of coords) {
    const last = out[out.length - 1]
    if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c)
  }
  return out
}

export function TripMap({ trip, onOpenStop, nearbyPois = [], onAddNearby }: {
  trip: Trip
  onOpenStop?: (stopId: string) => void
  /** potential POIs to show as gold "idea" markers */
  nearbyPois?: PlaceHit[]
  /** when set, idea markers get a + button to add the POI straight from the map */
  onAddNearby?: (hit: PlaceHit) => void
}) {
  const [dayFilter, setDayFilter] = useState<number | 'all'>('all')
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
        { padding: 70, maxZoom: 12, duration: 400 },
      )
    }
    requestAnimationFrame(run)
  }, [pointsKey, mapLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

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
    m.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 70, maxZoom: 12, duration: 400 })
  }

  function colorForDay(i: number): string {
    return DAY_COLORS[i % DAY_COLORS.length]
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

  useEffect(() => {
    if (allPoints.length === 0) { setGeom({}); return }
    let cancelled = false
    ;(async () => {
      const pts: { lat: number; lng: number }[] = allPoints.map(p => ({ lat: p.lat, lng: p.lng }))
      if (dayFilter === 'all') {
        if (pts.length < 2) return
        try {
          const legs = await routePath(pts, getAssumptions(trip))
          const coords = legs.flatMap(l => l.geometry)
          if (!cancelled && coords.length > 1) setGeom({ all: dedupeConsecutive(coords) })
        } catch { /* straight-line fallback below */ }
      } else {
        const next: Record<string, [number, number][]> = {}
        for (const d of daysToPlot) {
          const dpts = d.stops.map(s => ({ lat: s.lat, lng: s.lng }))
          if (dpts.length < 2) continue
          try {
            const legs = await routePath(dpts, getAssumptions(trip))
            const coords = legs.flatMap(l => l.geometry)
            if (!cancelled && coords.length > 1) next[String(d.index)] = dedupeConsecutive(coords)
          } catch { /* keep straight line */ }
        }
        if (!cancelled) setGeom(next)
      }
    })()
    return () => { cancelled = true }
  }, [chainKey, dayFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="map-frame">
        <div className="map-day-filter">
          <button className={`map-day-chip ${dayFilter === 'all' ? 'on' : ''}`} onClick={() => setDayFilter('all')}>All days</button>
          {trip.days.map(d => (
            <button key={d.index} className={`map-day-chip ${dayFilter === d.index ? 'on' : ''}`} onClick={() => setDayFilter(d.index)}>
              Day {d.index + 1}
            </button>
          ))}
          <button className="map-day-chip map-recenter" onClick={fitToTrip} title="Recentre the map on the trip route">🎯 Recentre</button>
        </div>

        {allPoints.length === 0 ? (
          <div className="empty-state"><div className="big">🗺️</div><p>No confirmed stops to plot yet — add some in the Timeline.</p></div>
        ) : (
          <MapLibreMap
            ref={mapRef}
            theme={theme}
            className="yf-maplibre"
            center={[76.5, 10.5]}
            zoom={5}
          >
            <MapControls position="top-right" showFullscreen />
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
              daysToPlot.map(d => {
                const coords = geom[String(d.index)]?.length
                  ? geom[String(d.index)]
                  : d.stops.map(s => [s.lng, s.lat] as [number, number])
                return (
                  <>
                    <MapRoute
                      key={`casing-${d.index}`}
                      id={`yf-day-casing-${d.index}`}
                      coordinates={coords}
                      color={theme === 'dark' ? '#0B2545' : '#FFFFFF'}
                      width={8}
                      opacity={theme === 'dark' ? 0.6 : 0.75}
                      interactive={false}
                    />
                    <MapRoute
                      key={d.index}
                      coordinates={coords}
                      color={colorForDay(d.index)}
                      width={4}
                      opacity={0.95}
                    />
                    <RouteArrows key={`arrows-${d.index}`} coordinates={coords} dark={theme === 'dark'} />
                  </>
                )
              })
            )}
            {(() => {
              let num = 0
              return allPoints.map((p, idx) => {
                // Auto anchor stops (trip start / final destination) render as
                // distinct start/end badges instead of numbered pins.
                const isFirst = idx === 0
                const isLast = idx === allPoints.length - 1
                if (p.auto) {
                  const label = isLast ? '🏁' : '🛫'
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
                        className="yf-map-pin"
                        style={{ background: colorForDay(p.dayIndex) }}
                        onClick={() => onOpenStop?.(p.id)}
                        aria-label={`Stop ${num}: ${p.title}`}
                        title={p.title}
                      >
                        {num}
                      </button>
                    </MarkerContent>
                    <MarkerTooltip>{p.title}</MarkerTooltip>
                  </MapMarker>
                )
              })
            })()}
            {/* nearby idea markers — gold, dashed, with a quick-add button */}
            {nearbyPois.map(hit => (
              <MapMarker key={`nearby_${hit.id}`} longitude={hit.longitude} latitude={hit.latitude}>
                <MarkerContent>
                  <span className="yf-map-idea" title={`${hit.name}${onAddNearby ? ' — click to add' : ''}`}>
                    {onAddNearby ? (
                      <button
                        className="yf-map-pin yf-map-pin-idea"
                        onClick={() => onAddNearby(hit)}
                        aria-label={`Add ${hit.name} to the trip`}
                      >
                        +
                      </button>
                    ) : (
                      <span className="yf-map-pin yf-map-pin-idea" aria-label={hit.name}>💡</span>
                    )}
                  </span>
                </MarkerContent>
                <MarkerTooltip>💡 {hit.name}</MarkerTooltip>
              </MapMarker>
            ))}
          </MapLibreMap>
        )}

        <div className="map-legend">
          {dayFilter === 'all'
            ? <>blue line = whole route · </> 
            : <>colours = day · </>}
          numbers follow timeline order · 🛫/🏁 = start & final destination · 💡 gold markers = nearby ideas{onAddNearby ? ' (+ to add)' : ''} · click a pin for details
        </div>
      </div>
      <p className="hint-text" style={{ marginTop: 8 }}>
        ⚠️ Route lines follow real roads (© OSRM/OpenStreetMap) when available; distances/durations in the plan are real-road estimates for ground travel, falling back to transparent haversine assumptions when offline/other modes — no live traffic data.
      </p>
    </div>
  )
}
