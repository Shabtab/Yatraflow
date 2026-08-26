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
} from './mapcn/map'

const DAY_COLORS = ['#149A90', '#F59E2D', '#7C5CFC', '#E2557B', '#2D9CDB', '#6BBF59', '#B7791F']

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
  const fittedRef = useRef(false)

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

  // fit the viewport to the route once points are available
  useEffect(() => {
    if (!mapRef.current || allPoints.length === 0) return
    const lons = allPoints.map(p => p.lng)
    const lats = allPoints.map(p => p.lat)
    mapRef.current.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 70, maxZoom: 12, duration: 400 },
    )
    fittedRef.current = true
  }, [allPoints]) // eslint-disable-line react-hooks/exhaustive-deps

  function colorForDay(i: number): string {
    return DAY_COLORS[i % DAY_COLORS.length]
  }

  // Real road geometry per plotted day from OSRM; falls back to straight
  // lines when the service is unreachable. Keyed by day index.
  const [roadGeoms, setRoadGeoms] = useState<Record<number, [number, number][]>>({})
  const geomKey = useMemo(
    () => daysToPlot.map(d => `${d.index}:${d.stops.map(s => s.id).join(',')}`).join('|'),
    [daysToPlot],
  )

  useEffect(() => {
    if (daysToPlot.length === 0) { setRoadGeoms({}); return }
    let cancelled = false
    ;(async () => {
      const next: Record<number, [number, number][]> = {}
      for (const d of daysToPlot) {
        const pts = d.stops.map(s => ({ lat: s.lat, lng: s.lng }))
        if (pts.length < 2) continue
        try {
          const legs = await routePath(pts, getAssumptions(trip))
          const coords = legs.flatMap(l => l.geometry)
          if (!cancelled && coords.length > 1) next[d.index] = dedupeConsecutive(coords)
        } catch { /* keep straight line */ }
      }
      if (!cancelled) setRoadGeoms(next)
    })()
    return () => { cancelled = true }
  }, [geomKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="map-frame" style={{ height: 480 }}>
        <div className="map-day-filter">
          <button className={`map-day-chip ${dayFilter === 'all' ? 'on' : ''}`} onClick={() => setDayFilter('all')}>All days</button>
          {trip.days.map(d => (
            <button key={d.index} className={`map-day-chip ${dayFilter === d.index ? 'on' : ''}`} onClick={() => setDayFilter(d.index)}>
              Day {d.index + 1}
            </button>
          ))}
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
            {/* connect consecutive stops of each plotted day — real road shape when OSRM responds */}
            {daysToPlot.map(d => (
              <MapRoute
                key={d.index}
                coordinates={
                  roadGeoms[d.index]?.length ? roadGeoms[d.index]
                  : d.stops.map(s => [s.lng, s.lat] as [number, number])
                }
                color={colorForDay(d.index)}
                width={3.5}
                opacity={0.85}
              />
              // backtracking legs are flagged in the Timeline tab, not re-derived here
            ))}
            {(() => {
              let num = 0
              return allPoints.map(p => {
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
          {dayFilter === 'all' && <>colours = days · </>}
          numbers follow timeline order · 💡 gold markers = nearby ideas{onAddNearby ? ' (+ to add)' : ''} · click a pin for details
        </div>
      </div>
      <p className="hint-text" style={{ marginTop: 8 }}>
        ⚠️ Route lines follow real roads (© OSRM/OpenStreetMap) when available; distances/durations in the plan remain transparent estimates from fixed assumptions — no live traffic data.
      </p>
    </div>
  )
}
