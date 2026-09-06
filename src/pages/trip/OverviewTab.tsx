// ============ Trip workspace — Overview tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
import { useEffect, useMemo, useState } from 'react'
import { CircleCheck, CloudSun, Droplets, Lightbulb, Pin, Siren, TriangleAlert } from 'lucide-react'
import type { Trip } from '../../data/types'
import { useDb, userById, activityFor } from '../../store/store'
import { computeHealth, computeTotals, formatInr, minutesToHM, countHotelNights, isRoundTrip } from '../../lib/engine'
import { useTimeFormat, formatHM } from '../../lib/timefmt'
import { fetchDailyWeather, forecastAvailable, wmoInfo } from '../../lib/weather'
import type { DayWeather } from '../../lib/weather'
import { timeAgo } from './shared'
import { Avatar, Chip, StatTile, RouteSnapshot } from '../../components/ui'
import { wmoIcon } from '../../components/icons'

// ================= Overview =================

export function OverviewTab({ trip, editable, onOpenDecisions, onOpenTimeline, onOpenMap, onInvite, health, totals }: {
  trip: Trip
  editable: boolean
  onOpenDecisions: () => void
  onOpenTimeline: () => void
  onOpenMap: () => void
  onInvite: () => void
  health: ReturnType<typeof computeHealth>
  totals: ReturnType<typeof computeTotals>
}) {
  const db = useDb()
  const timeFormat = useTimeFormat()
  const unresolvedDecisions = db.decisions.filter(d => d.tripId === trip.id && d.status === 'open').length
  const nextCommitment = [...trip.fixedCommitments]
    .sort((a, b) => a.dayIndex - b.dayIndex || a.time.localeCompare(b.time))[0]
  const crew = trip.members ?? []
  // Real-geometry snapshot: ordered stop coordinates (rejected stops excluded),
  // each tagged with its day index so badges land on each day's first stop.
  const routePoints = useMemo(() => {
    const pts: Array<{ lat: number; lng: number; day: number }> = []
    if (trip.startLocationCoords) pts.push({ lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng, day: 0 })
    for (const day of [...trip.days].sort((a, b) => a.index - b.index)) {
      for (const s of [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)) {
        if (s.status !== 'rejected' && Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
          pts.push({ lat: s.lat, lng: s.lng, day: day.index })
        }
      }
    }
    return pts.length >= 2 ? pts : undefined
  }, [trip.days, trip.startLocationCoords])
  // Bento briefing (CTI §6.2): lead with the most consequential issues.
  const severityRank = { high: 0, medium: 1, low: 2 } as const
  const priorityActions = [...health.warnings]
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, 3)

  return (
    <div className="two-col bento">
      <div>
        <div className="page-head" style={{ marginTop: 0 }}>
          <h2>Trip briefing</h2>
          <p className="page-head-sub">What needs attention before this road trip starts.</p>
        </div>

        <div className="card">
          <div className="row-between">
            <h3>Trip health</h3>
            <Chip tone={health.band === 'Comfortable' ? 'ok' : health.band === 'Manageable' ? 'teal' : health.band === 'Tight' ? 'saffron' : 'danger'}>
              {health.band}
            </Chip>
          </div>
          <hr className="divider" />
          <div className="health-big">
            <div className={`health-num-big ${health.band === 'Tight' ? 'mid' : health.band === 'Comfortable' || health.band === 'Manageable' ? 'ok' : 'bad'}`}>{health.score}</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="health-bar">
                <i className={health.band === 'Tight' ? 'mid' : health.band === 'Comfortable' || health.band === 'Manageable' ? 'ok' : 'bad'} style={{ width: `${health.score}%` }} />
              </div>
              <ul className="health-reasons">
                {health.warnings.length === 0
                  ? <li>No schedule issues detected — buffers look healthy.</li>
                  : health.warnings.slice(0, 3).map(w => (
                    <li key={w.code + w.title}>{w.severity === 'high'
                      ? <><Siren size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} /></>
                      : w.severity === 'medium'
                      ? <><TriangleAlert size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} /></>
                      : <><Lightbulb size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} /></>}{w.title}</li>
                  ))}
              </ul>
            </div>
          </div>
          <button className="health-rec" onClick={onOpenTimeline}>View health recommendations →</button>
        </div>

        {/* Bento stat cluster: cost / per-person / effort / stops at a glance */}
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 14 }}>
          <StatTile label="Total cost" value={formatInr(totals.totalCostInr)} sub={`${formatInr(totals.costPerDayInr)}/day · estimates`} />
          <StatTile label="Per person" value={formatInr(totals.costPerPersonInr)} sub={`vs ${formatInr(trip.budgetPerPersonInr)} target`} />
          <StatTile label="Travel effort" value={minutesToHM(totals.totalTravelMinutes)} sub={`≈${Math.round(totals.totalDistanceKm)} km route`} />
          <StatTile label="Stops planned" value={totals.stopCount} sub={`${countHotelNights(trip)} overnight base${countHotelNights(trip) !== 1 ? 's' : ''}`} />
        </div>

        {/* Priority actions: the most consequential issues with a direct fix link */}
        <div className="card">
          <div className="row-between">
            <h3>Priority actions</h3>
            {health.warnings.length > 0 && <span className="chip chip-saffron">{health.warnings.length} to review</span>}
          </div>
          <hr className="divider" />
          {priorityActions.length === 0 ? (
            <p className="muted small">Nothing needs fixing right now — the plan flows.</p>
          ) : (
            <div className="warn-list">
              {priorityActions.map(w => (
                <div key={w.code + w.title} className={`warn-item ${w.severity === 'high' ? 'sev-high' : w.severity === 'low' ? 'sev-low' : ''}`}>
                  <span className="warn-icon">{w.severity === 'high' ? <Siren size={13} aria-hidden /> : w.severity === 'medium' ? <TriangleAlert size={13} aria-hidden /> : <Lightbulb size={13} aria-hidden />}</span>
                  <div>
                    <div className="warn-title">{w.title}</div>
                    <div className="warn-fix"><CircleCheck size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{w.fix}</div>
                  </div>
                </div>
              ))}
              {health.warnings.length > 3 && <span className="small muted">+{health.warnings.length - 3} more — see Timeline.</span>}
            </div>
          )}
          <button className="link-btn teal" style={{ marginTop: 12 }} onClick={onOpenTimeline}>Open Timeline to resolve →</button>
        </div>
      </div>

      <div>
        <div className="card route-snap">
          <h3>Route snapshot</h3>
          <RouteSnapshot
            count={trip.days.length}
            startLabel={trip.startLocation}
            endLabel={trip.destinations[trip.destinations.length - 1]}
            roundTripNote={isRoundTrip(trip) ? `↩ returns to ${trip.startLocation}` : undefined}
            points={routePoints}
          />
          <p style={{ margin: '4px 0 0', fontSize: 12.5, opacity: .85, lineHeight: 1.6 }}>
            <b>{trip.startLocation}</b>
            {trip.destinations.map((d, i) => <span key={i}> → {d}</span>)}
            {isRoundTrip(trip) && <> → {trip.startLocation}</>}
          </p>
          <div className="route-snap-meta">
            <span>{trip.days.length} days · ≈{Math.round(totals.totalDistanceKm)} km · {totals.stopCount} stops</span>
            <button className="link-btn teal" onClick={onOpenMap}>Open map →</button>
          </div>
        </div>

        <div className="card">
          <div className="row-between">
            <h3>Fixed commitments</h3>
            <span className="chip chip-info">{trip.fixedCommitments.length}</span>
          </div>
          <hr className="divider" />
          {nextCommitment ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="warn-item sev-low">
                <span className="warn-icon"><Pin size={13} aria-hidden /></span>
                <div>
                  <div className="warn-title">Next: {nextCommitment.title}</div>
                  <div className="warn-fix">Day {nextCommitment.dayIndex + 1} at {formatHM(nextCommitment.time, timeFormat)}{nextCommitment.notes ? ` — ${nextCommitment.notes}` : ''}</div>
                </div>
              </div>
              {trip.fixedCommitments.filter(fc => fc !== nextCommitment).map(fc => (
                <div key={fc.id} className="row-between small" style={{ padding: '4px 0' }}>
                  <span><b>{fc.title}</b> <span className="muted">· Day {fc.dayIndex + 1}, {formatHM(fc.time, timeFormat)}</span></span>
                  <Chip tone="info">{labelCommitType(fc.type)}</Chip>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">None saved yet. Add check-ins, trains or flights so the planner can protect them.</p>
          )}
        </div>

        <div className="card">
          <h3>Recent activity</h3>
          <hr className="divider" />
          {activityFor(trip.id).slice(0, 6).map(a => (
            <div key={a.id} className="feed-item">
              <Avatar user={userById(a.actorId)} />
              <span><b>{userById(a.actorId)?.profile.name}</b> {a.verb}{a.target ? ` · ${a.target}` : ''}</span>
              <span className="feed-time">{timeAgo(a.at)}</span>
            </div>
          ))}
        </div>

        <WeatherCard trip={trip} />
      </div>

      <div className="card pulse-bar">
        <span className="pulse-label">Group pulse</span>
        <span className="pulse-item"><b>{crew.length}</b> member{crew.length !== 1 ? 's' : ''}</span>
        <span className="pulse-dot">·</span>
        <span className="pulse-item"><b>{unresolvedDecisions}</b> open decision{unresolvedDecisions !== 1 ? 's' : ''}</span>
        <span className="pulse-dot">·</span>
        <span className="pulse-item">{trip.fixedCommitments.length ? <><b>{trip.fixedCommitments.length}</b> fixed commitment{trip.fixedCommitments.length !== 1 ? 's' : ''}</> : 'No fixed commitments yet'}</span>
        <button className="link-btn teal pulse-link" onClick={onInvite}>Invite travellers →</button>
      </div>
    </div>
  )
}

// ================= Weather =================

/** Per-day forecast strip for the Overview tab. Best-effort; hides itself when unavailable. */
function WeatherCard({ trip }: { trip: Trip }) {
  const [byDate, setByDate] = useState<Record<string, DayWeather>>({})
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  const anchor = useMemo(() => {
    const stops = trip.days.flatMap(d => d.stops).filter(s => s.status !== 'rejected')
    if (stops.length === 0) return null
    return {
      lat: stops.reduce((a, s) => a + s.lat, 0) / stops.length,
      lng: stops.reduce((a, s) => a + s.lng, 0) / stops.length,
    }
  }, [trip])

  useEffect(() => {
    if (!anchor || !forecastAvailable(trip.startDate)) { setState('unavailable'); return }
    let cancelled = false
    fetchDailyWeather(anchor.lat, anchor.lng, trip.startDate, trip.days.length || 1)
      .then(w => { if (!cancelled) { setByDate(w); setState('ready') } })
      .catch(() => { if (!cancelled) setState('unavailable') })
    return () => { cancelled = true }
  }, [anchor, trip.startDate, trip.days.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'loading') {
    return <div className="card"><h3><CloudSun size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Weather</h3><hr className="divider" /><p className="muted small">Loading forecast…</p></div>
  }
  if (state !== 'ready') return null

  const entries = Object.values(byDate)
  const wetDays = entries.filter(w => w.rainChancePct >= 60).length
  return (
    <div className="card">
      <div className="row-between">
        <h3><CloudSun size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Weather along the route</h3>
        <span className="small muted">Open-Meteo · forecasts ±15 days</span>
      </div>
      <hr className="divider" />
      <div className="weather-strip">
        {entries.map(w => {
          const info = wmoInfo(w.code)
          const dayNum = Math.round((new Date(w.date + 'T00:00').getTime() - new Date(trip.startDate + 'T00:00').getTime()) / 86400000)
          const wet = w.rainChancePct >= 60
          return (
            <div key={w.date} className={`weather-cell ${wet ? 'wet' : ''}`} title={info.label}>
              <div className="weather-day">{dayNum >= 0 ? `Day ${dayNum + 1}` : w.date}</div>
              <div className="weather-icon">{(() => { const W = wmoIcon(w.code); return <W size={15} aria-hidden /> })()}</div>
              <div className="weather-temp">{Math.round(w.tempMinC)}°–{Math.round(w.tempMaxC)}°</div>
              <div className="small muted"><Droplets size={11} aria-hidden style={{ verticalAlign: '-2px', marginRight: 2 }} />{w.rainChancePct}%</div>
            </div>
          )
        })}
      </div>
      {wetDays > 0 && (
        <p className="hint-text" style={{ marginTop: 8 }}>
          <TriangleAlert size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />High rain chance on {wetDays} day{wetDays > 1 ? 's' : ''} — consider indoor alternatives for weather-sensitive stops (beaches, viewpoints, treks).
        </p>
      )}
    </div>
  )
}

function labelCommitType(t: string): string {
  const map: Record<string, string> = { 'hotel-checkin': 'Check-in', 'train-departure': 'Train', 'flight-departure': 'Flight', event: 'Event', other: 'Other' }
  return map[t] ?? t
}
