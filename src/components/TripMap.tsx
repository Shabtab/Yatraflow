// ============ Trip route map ============
// Real slippy-map rendering via mapcn (MapLibre GL): OpenFreeMap basemaps that follow
// light/dark theme, numbered stop markers in timeline order, and a polyline
// connecting each day's stops. Distances/durations still come from the engine.
import { useMemo, useState, useEffect, useRef } from 'react'
import type { Trip } from '../data/types'
import type { PlaceHit } from '../lib/geocode'
import { routePath } from '../lib/routing'
import { getAssumptions, isRoundTrip } from '../lib/engine'
import type { MapRef } from './mapcn/map'
import { CatIcon } from './icons'
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

// Basemaps come from the mapcn <Map> default (OpenFreeMap — see mapcn/map.tsx).
// The old CARTO Voyager / dark-matter and Esri World Imagery style URLs that
// used to live here were dead code (never referenced) and carried a licensing
// exposure, so they are gone as of issue #23 — there is no satellite layer.

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
function labelCat(c: string): string {
  return c.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
}

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

export function TripMap({ trip, onOpenStop, nearbyPois = [], onAddNearby }: {
  trip: Trip
  onOpenStop?: (stopId: string) => void
  /** potential POIs to show as gold "idea" markers */
  nearbyPois?: PlaceHit[]
  /** when set, idea markers get a + button to add the POI straight from the map */
  onAddNearby?: (hit: PlaceHit) => void
}) {
  const [dayFilter, setDayFilter] = useState<number | 'all'>('all')
  const [showReturn, setShowReturn] = useState(true)
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
  const visiblePois = useMemo(
    () => (hiddenIdeaCats.size === 0
      ? nearbyPois
      : nearbyPois.filter(h => !hiddenIdeaCats.has(h.category ?? 'sightseeing'))),
    [nearbyPois, hiddenIdeaCats],
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
  }, [chainKey, dayFilter, returnLeg]) // eslint-disable-line react-hooks/exhaustive-deps

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
          {returnLeg && (
            <button
              className={`map-day-chip ${showReturn ? 'on' : ''}`}
              onClick={() => setShowReturn(s => !s)}
              title="Show or hide the drive back home"
            >
             ↩ Return home
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
                  onClick={() => toggleIdeaCat(cat)}
                  title={hiddenIdeaCats.has(cat) ? `Show ${count} ${labelCat(cat).toLowerCase()} idea${count === 1 ? '' : 's'}` : `Hide ${labelCat(cat).toLowerCase()} ideas`}
                >
                  <CatIcon category={cat} size={13} className="yf-idea-chip-ico" />
                  {labelCat(cat)}
                  <span className="yf-idea-chip-count">{count}</span>
                </button>
              ))}
            </>
          )}
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
                        className={`yf-map-pin yf-map-tear${p.status === 'maybe' ? ' yf-map-maybe' : ''}`}
                        style={{ '--pin-color': colorForDay(p.dayIndex) } as React.CSSProperties}
                        onClick={() => onOpenStop?.(p.id)}
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
                  <span className="yf-map-pin yf-map-flag" title={trip.startLocation}>🏠</span>
                </MarkerContent>
                <MarkerTooltip>Home — return drive ends here ({trip.startLocation})</MarkerTooltip>
              </MapMarker>
            )}
            {/* nearby idea markers — gold, dashed, with a quick-add button */}
            {visiblePois.map(hit => (
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
            ? <>blue line = whole route{returnLeg ? ' · dashed = drive back home' : ''} · </> 
            : <>colours = day · </>}
          pin icon = stop type · number = timeline order · dashed pin = "maybe" · 🛫/🏁 = start & final destination · 💡 gold markers = nearby ideas{onAddNearby ? ' (+ to add)' : ''}{ideaCats.length > 0 ? ' · chips filter ideas by type' : ''} · click a pin for details
        </div>
      </div>
      <p className="hint-text" style={{ marginTop: 8 }}>
        ⚠️ Route lines follow real roads (© OSRM/OpenStreetMap) when available; distances/durations in the plan are real-road estimates for ground travel, falling back to transparent haversine assumptions when offline/other modes — no live traffic data.
      </p>
    </div>
  )
}
