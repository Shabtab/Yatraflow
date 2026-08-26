// ============ Trip route map ============
// Real slippy-map rendering via mapcn (MapLibre GL): CARTO basemaps that follow
// light/dark theme, numbered stop markers in timeline order, and a polyline
// connecting each day's stops. Distances/durations still come from the engine.
import { useMemo, useState, useEffect, useRef } from 'react'
import type { Trip } from '../data/types'
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

export function TripMap({ trip, onOpenStop }: { trip: Trip; onOpenStop?: (stopId: string) => void }) {
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
            {/* connect consecutive stops of each plotted day */}
            {daysToPlot.map(d => (
              <MapRoute
                key={d.index}
                coordinates={d.stops.map(s => [s.lng, s.lat] as [number, number])}
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
          </MapLibreMap>
        )}

        <div className="map-legend">
          {dayFilter === 'all' && <>colours = days · </>}
          numbers follow timeline order · click a pin for details
        </div>
      </div>
      <p className="hint-text" style={{ marginTop: 8 }}>
        ⚠️ Distances/durations are transparent estimates from sample coordinates and fixed assumptions — not live routing or traffic data.
      </p>
    </div>
  )
}
