// ============ Trip workspace — Overview tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
import { daySlots, tripDayAttribution, type DaySlotsDeps } from '../../lib/daySlots'
import { mapRoadViewFromLegs, type TripRoadView } from '../../lib/tripRoad'
import type { SegmentHit } from '../../lib/geocode'
import { useEffect, useMemo, useState } from 'react'
import { CircleCheck, CloudSun, Droplets, Lightbulb, Pin, Siren, TriangleAlert } from 'lucide-react'
import type { Trip } from '../../data/types'
import { useDb, userById, activityFor } from '../../store/store'
import { computeHealth, computeTotals, formatInr, minutesToHM, countHotelNights, isRoundTrip } from '../../lib/engine'
import { healthBandClass, healthBandTone } from '../../lib/healthBand'
import { overviewRoutePoints, routeWeatherAnchor } from '../../lib/overviewTruth'
import { useTimeFormat, formatHM } from '../../lib/timefmt'
import { fetchDailyWeather, forecastAvailable, wmoInfo } from '../../lib/weather'
import type { DayWeather } from '../../lib/weather'
import { timeAgo } from './shared'
import { Avatar, Chip, StatTile, RouteSnapshot } from '../../components/ui'
import { InlineIcon, wmoIcon } from '../../components/icons'

// ================= Overview =================

export function OverviewTab({ trip, onOpenTimeline, onOpenMap, onInvite, health, totals, road, corridorSegments }: {
  trip: Trip
  editable: boolean
  onOpenDecisions: () => void
  onOpenTimeline: () => void
  onOpenMap: () => void
  onInvite: () => void
  health: ReturnType<typeof computeHealth>
  totals: ReturnType<typeof computeTotals>
  /** The workspace's ONE road measurement, so the matrix attributes days by the
   *  same road-true km the Map rail does. */
  road?: TripRoadView | null
  /** The corridor scan's segments, shared with the Map rail (from the cache). */
  corridorSegments?: SegmentHit[]
}) {
  const db = useDb()
  const timeFormat = useTimeFormat()
  const unresolvedDecisions = db.decisions.filter(d => d.tripId === trip.id && d.status === 'open').length
  const nextCommitment = [...trip.fixedCommitments]
    .sort((a, b) => a.dayIndex - b.dayIndex || a.time.localeCompare(b.time))[0]
  const crew = trip.members ?? []
  // Real-geometry snapshot, read from the ONE road chain (#403). This used to
  // be a second walk over `startLocationCoords` + the stops, which meant the
  // Overview drew a different road from the Map: `buildRoadChain` also appends
  // the round-trip return leg and the trailing destination, so a round trip
  // rendered OPEN here and as a closed loop there. The chain is also filtered
  // through the coord-validity boundary, so a `(0,0)` placeholder stop can no
  // longer stretch the snapshot across the Atlantic. `[]` means there is no
  // route honest to draw — the card below says so rather than falling back to
  // the shared component's illustrative curve, which wore real day badges.
  const routePoints = useMemo(() => overviewRoutePoints(trip), [trip])
  // Bento briefing (CTI §6.2): lead with the most consequential issues.
  const severityRank = { high: 0, medium: 1, low: 2 } as const
  const priorityActions = [...health.warnings]
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, 3)

  return (
    <div className="two-col bento">
      <div>
        <div className="overview-head">
          <h2>Trip briefing</h2>
          <p className="muted small">What needs attention before this road trip starts.</p>
        </div>

        <div className="card">
          <div className="row-between card-head">
            <h3>Trip health</h3>
            <Chip tone={healthBandTone(health.band)}>
              {health.band}
            </Chip>
          </div>
          <div className="health-big">
            <div className={`health-num-big ${healthBandClass(health.band)}`}>{health.score}</div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="health-bar">
                <i className={healthBandClass(health.band)} style={{ width: `${health.score}%` }} />
              </div>
              <ul className="health-reasons">
                {health.warnings.length === 0
                  ? <li>No schedule issues detected — buffers look healthy.</li>
                  : health.warnings.slice(0, 3).map(w => (
                    <li key={w.code + w.title}>{w.severity === 'high'
                      ? <><InlineIcon icon={Siren} size={12} gap={3} /></>
                      : w.severity === 'medium'
                      ? <><InlineIcon icon={TriangleAlert} size={12} gap={3} /></>
                      : <><InlineIcon icon={Lightbulb} size={12} gap={3} /></>}{w.title}</li>
                  ))}
              </ul>
            </div>
          </div>
          <button className="health-rec" onClick={onOpenTimeline}>View health recommendations →</button>
        </div>

        {/* Bento stat cluster: cost / per-person / effort / stops at a glance */}
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginTop: 14, marginBottom: 14 }}>
          <StatTile label="Total cost" value={formatInr(totals.totalCostInr)} sub={`${formatInr(totals.costPerDayInr)}/day · estimates`} />
          <StatTile label="Per person" value={formatInr(totals.costPerPersonInr)} sub={`vs ${formatInr(trip.budgetPerPersonInr)} target`} />
          <StatTile label="Travel effort" value={minutesToHM(totals.totalTravelMinutes)} sub={`≈${Math.round(totals.totalDistanceKm)} km route`} />
          <StatTile label="Stops planned" value={totals.stopCount} sub={`${countHotelNights(trip)} overnight base${countHotelNights(trip) !== 1 ? 's' : ''}`} />
        </div>

        {/* Priority actions: the most consequential issues with a direct fix link */}
        <div className="card">
          <div className="row-between card-head">
            <h3>Priority actions</h3>
            {health.warnings.length > 0 && <span className="chip chip-saffron">{health.warnings.length} warning{health.warnings.length !== 1 ? 's' : ''} to review</span>}
          </div>
          {priorityActions.length === 0 ? (
            <p className="muted small">Nothing needs fixing right now — the plan flows.</p>
          ) : (
            <div className="warn-list">
              {priorityActions.map(w => (
                <div key={w.code + w.title} className={`warn-item ${w.severity === 'high' ? 'sev-high' : w.severity === 'low' ? 'sev-low' : ''}`}>
                  <span className="warn-icon">{w.severity === 'high' ? <Siren size={13} aria-hidden /> : w.severity === 'medium' ? <TriangleAlert size={13} aria-hidden /> : <Lightbulb size={13} aria-hidden />}</span>
                  <div>
                    <div className="warn-title">{w.title}</div>
                    <div className="warn-fix"><InlineIcon icon={CircleCheck} size={12} gap={3} />{w.fix}</div>
                  </div>
                </div>
              ))}
              {/* Honest cross-link: the Timeline carries every warning this
                  count includes — its days AND its trip-wide block (#402). */}
              {health.warnings.length > 3 && <span className="small muted">+{health.warnings.length - 3} more warning{health.warnings.length - 3 !== 1 ? 's' : ''} — see Timeline.</span>}
            </div>
          )}
          <button className="link-btn teal" style={{ marginTop: 12 }} onClick={onOpenTimeline}>Open Timeline to resolve →</button>
        </div>
      </div>

      <div>
        <div className="card route-snap">
          <h3>Route snapshot</h3>
          {/* #403: `RouteSnapshot`'s fallback is an ILLUSTRATIVE curve, so handing
              it nothing drew a mockup road wearing this trip's real day badges —
              a route for a trip that has none. `points` is `[]` when fewer than
              two coordinates are valid, and the honest absence is rendered here
              in the Overview's own branch rather than by changing the shared
              component (PublicItinerary is its second caller). */}
          {/* `RouteSnapshot` takes a non-null `day` badge index. The chain's start,
              return leg and destination tail carry `null` because no day owns them;
              `?? 0` restores exactly the old badge placement (the start used to be
              pushed as day 0), and the component's own dedupe means those later
              points add no second badge. */}
          {routePoints.length >= 2
            ? <RouteSnapshot
                count={trip.days.length}
                startLabel={trip.startLocation}
                endLabel={trip.destinations[trip.destinations.length - 1]}
                roundTripNote={isRoundTrip(trip) ? `↩ returns to ${trip.startLocation}` : undefined}
                points={routePoints.map(p => ({ lat: p.lat, lng: p.lng, day: p.day ?? 0 }))}
              />
            : <p className="muted small" style={{ margin: 0 }}>
                No route to draw yet — this plan needs at least two places with confirmed
                coordinates. Add a stop, or pin the ones that are missing, and the shape appears here.
              </p>}
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

        <SlotMatrix trip={trip} road={road} corridorSegments={corridorSegments} />

        <div className="card">
          <div className="row-between card-head">
            <h3>Fixed commitments</h3>
            <span className="chip chip-info">{trip.fixedCommitments.length}</span>
          </div>
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
          <h3 className="card-head">Recent activity</h3>
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

  // #403: the anchor is the centroid of the trip's VALID, non-rejected stops.
  // It used to average every non-rejected stop with no validity check, so ONE
  // `(0,0)` placeholder moved the centroid halfway to Null Island — and the
  // forecast fetch then SUCCEEDED for the wrong ocean under the heading
  // "Weather along the route", which is worse than showing nothing. No valid
  // stop is now null, and the card hides rather than inventing a city.
  const anchor = useMemo(() => routeWeatherAnchor(trip), [trip])

  useEffect(() => {
    if (!anchor || !forecastAvailable(trip.startDate)) { setState('unavailable'); return }
    let cancelled = false
    fetchDailyWeather(anchor.lat, anchor.lng, trip.startDate, trip.days.length || 1)
      .then(w => { if (!cancelled) { setByDate(w); setState('ready') } })
      .catch(() => { if (!cancelled) setState('unavailable') })
    return () => { cancelled = true }
  }, [anchor, trip.startDate, trip.days.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'loading') {
    return <div className="card"><h3 className="card-head"><InlineIcon icon={CloudSun} size={14} gap={4} />Weather</h3><p className="muted small">Loading forecast…</p></div>
  }
  if (state !== 'ready') return null

  const entries = Object.values(byDate)
  const wetDays = entries.filter(w => w.rainChancePct >= 60).length
  return (
    <div className="card">
      <div className="row-between card-head">
        <h3><InlineIcon icon={CloudSun} size={14} gap={4} />Weather along the route</h3>
        <span className="small muted">Open-Meteo · forecasts ±15 days</span>
      </div>
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
              <div className="small muted"><InlineIcon icon={Droplets} size={11} gap={2} />{w.rainChancePct}%</div>
            </div>
          )
        })}
      </div>
      {wetDays > 0 && (
        <p className="hint-text" style={{ marginTop: 8 }}>
          <InlineIcon icon={TriangleAlert} size={12} gap={3} />High rain chance on {wetDays} day{wetDays > 1 ? 's' : ''} — consider indoor alternatives for weather-sensitive stops (beaches, viewpoints, treks).
        </p>
      )}
    </div>
  )
}

/** P6.3: which parts each day holds, at a glance - the trip's own plan read
 *  day by day, in the rail's own grammar.
 *
 *  This reads the SAME corridor halts and the SAME day attribution the Map
 *  rail does. It used to pass `haltSegments: []` and `anchors: []`, which had
 *  two consequences: the F and S columns could never fill (fuel and stretch are
 *  engine-derived parts — `addSkeleton` deliberately never invents them, so
 *  with no engine segments those two of the six columns were decorative), and
 *  the day's `total` disagreed with the rail's for the same day. A second
 *  derivation of the same day is the bug, so there is no longer one. */
function SlotMatrix({ trip, road, corridorSegments }: {
  trip: Trip
  road?: TripRoadView | null
  /** The corridor scan's segments — the same array the Map rail reads. */
  corridorSegments?: SegmentHit[]
}) {
  const kinds: Array<{ key: 'breakfast' | 'lunch' | 'fuel' | 'stretch' | 'dinner' | 'stay'; label: string; name: string }> = [
    { key: 'breakfast', label: 'B', name: 'breakfast' },
    { key: 'lunch', label: 'L', name: 'lunch' },
    { key: 'fuel', label: 'F', name: 'fuel' },
    { key: 'stretch', label: 'S', name: 'a stretch break' },
    { key: 'dinner', label: 'D', name: 'dinner' },
    { key: 'stay', label: 'N', name: 'the night' },
  ]
  const deps = useMemo<Omit<DaySlotsDeps, 'dayStops'>>(() => {
    // Same helper, same inputs as the Map tab, so the attribution cannot differ.
    const dayRoadKm = mapRoadViewFromLegs(road?.chain ?? null, road?.legs ?? null, trip.days.map(d => d.index)).dayRoadKm
    const attribution = tripDayAttribution(trip, dayRoadKm)
    return {
      haltSegments: corridorSegments ?? [],
      anchors: [],
      dayOfSegment: attribution.dayOfSegment,
      daySpanKm: attribution.daySpanKm,
      fillSkeleton: true,
      travelStyle: trip.travelStyle,
      transportMode: trip.transportMode,
      memberCount: (trip.members ?? []).length,
      existingNames: new Set(trip.days.flatMap(d => d.stops.map(s => s.title.toLowerCase()))),
      // The matrix reads slot STATES only, so candidate scoring (two geometry
      // projections per hit across the whole corridor pool) is pure waste here.
      limit: 0,
    }
  }, [trip, road, corridorSegments])
  const rows = useMemo(
    () => trip.days.map(d => ({ day: d, slots: daySlots(d.index, { ...deps, dayStops: d.stops }) })),
    [trip.days, deps],
  )
  const hasCorridor = (corridorSegments?.length ?? 0) > 0
  // S11: a day with no slots at all is the EMPTIEST day, and the old
  // `total > 0` filter dropped it — so the callout could never name the one day
  // that most needed naming.
  const thinnest = rows
    .map(r => ({ index: r.day.index, filled: r.slots.filter(s => s.state === 'filled').length, total: r.slots.length }))
    .sort((a, b) => (a.filled / Math.max(1, a.total)) - (b.filled / Math.max(1, b.total)))[0]
  return (
    <div className="card">
      <h3 className="card-head">What each day holds</h3>
      <div className="slotmatrix" role="table" aria-label="Planned parts per day">
        <div className="slotmatrix-row slotmatrix-head" role="row">
          <span className="slotmatrix-day" role="columnheader"><span className="sr-only">Day</span></span>
          {kinds.map(k => (
            <span key={k.key} className="slotmatrix-cell" role="columnheader" aria-label={k.name}>{k.label}</span>
          ))}
          <span className="slotmatrix-total" role="columnheader">filled</span>
        </div>
        {rows.map(({ day, slots }) => {
          const filled = slots.filter(s => s.state === 'filled').length
          return (
            <div key={day.index} className="slotmatrix-row" role="row">
              <span className="slotmatrix-day" role="rowheader">Day {day.index + 1}</span>
              {kinds.map(k => {
                const slot = slots.find(x => x.key === k.key)
                const state = slot ? slot.state : 'none'
                // S10: the cell was a bare glyph with the meaning in a `title`,
                // which assistive tech does not reliably announce — the whole
                // grid read as punctuation. The glyph is now decorative and the
                // cell carries the sentence.
                const meaning = slot
                  ? `${slot.label}: ${slot.state === 'filled'
                    ? (slot.filledStop?.title ?? 'planned')
                    : slot.state === 'auto' ? 'engine-managed' : 'still open'}`
                  : `${k.name}: not part of this day`
                return (
                  <span
                    key={k.key}
                    className={`slotmatrix-cell is-${state}`}
                    role="cell"
                    aria-label={`Day ${day.index + 1} ${meaning}`}
                  >
                    <span aria-hidden>{state === 'filled' ? '●' : state === 'auto' ? '○' : state === 'empty' ? '·' : ''}</span>
                  </span>
                )
              })}
              <span className="slotmatrix-total" role="cell">{filled}/{slots.length}</span>
            </div>
          )
        })}
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>
        Solid = planned, hollow = engine-managed, dot = still open.
        {thinnest ? ` Thinnest day: Day ${thinnest.index + 1}${thinnest.total === 0 ? ' (nothing planned yet)' : ` (${thinnest.filled} of ${thinnest.total})`}.` : ''}
      </p>
      {!hasCorridor && (
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Partial: this trip&apos;s corridor hasn&apos;t been scanned yet, so the fuel and stretch breaks the engine
          derives aren&apos;t counted here. Open the Map tab once and this fills in.
        </p>
      )}
    </div>
  )
}

function labelCommitType(t: string): string {
  const map: Record<string, string> = { 'hotel-checkin': 'Check-in', 'train-departure': 'Train', 'flight-departure': 'Flight', event: 'Event', other: 'Other' }
  return map[t] ?? t
}
