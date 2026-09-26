// ============ Trip workspace — Timeline DaySpark (extracted from TimelineTab.tsx,
// restructure Phase 3) — tiny inline SVG of a day's route shape.
// ============ Trip workspace — Timeline tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes DaySection, DayWeatherChip, TravelPanel, HaltPlanRow, DaySpark,
// MoveStopModal and ClampedText — the whole timeline hot path.
import React, {  } from 'react'
import type { ItineraryStop } from '../../../data/types'
export function DaySpark({ stops }: { stops: ItineraryStop[] }) {
  // A day with no stops has no shape — bail out before Math.min() on an empty
  // spread turns into ±Infinity and the polyline renders `NaN` coordinates.
  // Non-finite coordinates are dropped for the same reason one step in: a
  // hydrated row can carry `lat/lng = undefined | NaN` (the #343 family, same
  // class as the `visitMinutes` bug), and a single bad pair poisons min/max,
  // the px/py scale and the polyline. Fewer than two real points draw no shape.
  const points = stops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng))
  if (points.length < 2) return null
  const lats = points.map(s => s.lat)
  const lngs = points.map(s => s.lng)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const spanLat = Math.max(1e-4, maxLat - minLat)
  const spanLng = Math.max(1e-4, maxLng - minLng)
  const px = (s: ItineraryStop) => 6 + ((s.lng - minLng) / spanLng) * 68
  const py = (s: ItineraryStop) => 38 - ((s.lat - minLat) / spanLat) * 32
  return (
    <svg className="day-spark" viewBox="0 0 80 44" width={80} height={44} aria-hidden="true">
      <polyline
        points={points.map(s => `${px(s)},${py(s)}`).join(' ')}
        fill="none" stroke="var(--teal)" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round"
      />
      {points.map((s, i) => (
        <circle key={i} cx={px(s)} cy={py(s)}
          r={i === 0 ? 3.4 : i === points.length - 1 ? 3 : 2.3}
          fill={i === 0 ? 'var(--saffron)' : 'var(--teal-deep)'} />
      ))}
    </svg>
  )
}
