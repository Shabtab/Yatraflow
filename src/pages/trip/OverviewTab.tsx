// ============ Trip workspace — Overview tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
import { daySlots, tripDayAttribution, type DaySlot, type DaySlotsDeps } from '../../lib/daySlots'
import { mapRoadViewFromLegs, type TripRoadView } from '../../lib/tripRoad'
import type { SegmentHit } from '../../lib/geocode'
import type { DrivingPlanDay } from '../../lib/ridePlan'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Check,
  CircleCheck,
  CloudSun,
  MessageSquare,
  TriangleAlert,
} from 'lucide-react'
import type { Trip } from '../../data/types'
import { useDb, useSliceReads, userById, activityFor, resumeSync } from '../../store/store'
import { computeHealth, computeTotals, formatInr, minutesToHM, countHotelNights, type ScheduleWarning } from '../../lib/engine'
import { healthBandClass, healthBandSentence, healthBandTone } from '../../lib/healthBand'
import { overviewRouteRows } from '../../lib/overviewTruth'
import { rankWarnings, warningKey, maxWarningSeverity, severityLead } from '../../lib/overviewWarnings'
import { matrixFreshness } from '../../lib/matrixFreshness'
import { useTimeFormat, formatHM } from '../../lib/timefmt'
import { fetchDailyWeather, forecastAvailable, isoAddDays, weatherAnchor, wmoInfo } from '../../lib/weather'
import type { DayWeather } from '../../lib/weather'
import { useWeatherRefreshTick } from '../../hooks/useWeatherRefresh'
import { useToday } from '../../hooks/useToday'
import { timeAgo } from './shared'
import { Avatar } from '../../components/ui'
import { assignAvatarTones } from '../../lib/avatarTone'
import { Surface } from '../../components/page/Surface'
import { InlineIcon, wmoIcon } from '../../components/icons'
import { StateBlock } from '../../components/page/StateBlock'
import { rowsView, sliceState, type RowsView } from '../../lib/readState'
import { OverviewRouteCard } from '../../components/trips/OverviewRouteCard'
import { TripArt } from '../../components/trips/TripArt'
import { RegionArt } from '../../components/RegionArt'
import { artIdFor } from '../../lib/regionArt'
import { regionFor } from '../../lib/tripsPage'
import { overviewPinText } from '../../lib/overviewRouteMap'
import type { MapTarget } from '../../lib/mapTarget'
import type { TimelineFocusTarget } from '../../lib/workspaceHeader'
import { firstFailedOverviewRead, overviewReadRole, type OverviewReadKey } from '../../lib/overviewReads'
import { useTripElevation } from '../../hooks/useTripElevation'
import { overviewHealthTiles } from '../../lib/overviewHealthTiles'

// ================= Overview =================

export function overviewSliceView(
  sliceReads: Record<string, 'ok' | 'failed'> | undefined,
  slice: 'activity' | 'decisions',
  rowCount: number,
): RowsView {
  return rowsView(sliceState(sliceReads, slice), rowCount)
}

export interface OverviewWeatherAnchor {
  date: string
  lat: number
  lng: number
}

export function overviewWeatherKey(anchor: OverviewWeatherAnchor): string {
  return JSON.stringify([anchor.date, anchor.lat, anchor.lng])
}

export function overviewWeatherSignature(anchors: readonly OverviewWeatherAnchor[]): string {
  return JSON.stringify(anchors.map(overviewWeatherKey))
}

export function filterOverviewWeather(
  forecasts: Record<string, DayWeather>,
  anchors: readonly OverviewWeatherAnchor[],
): Record<string, DayWeather> {
  const activeKeys = new Set(anchors.map(overviewWeatherKey))
  return Object.fromEntries(Object.entries(forecasts).filter(([key]) => activeKeys.has(key)))
}

export function mergeOverviewWeather(
  anchors: readonly OverviewWeatherAnchor[],
  results: readonly PromiseSettledResult<Record<string, DayWeather>>[],
  previous: Record<string, DayWeather>,
): { byDate: Record<string, DayWeather>; failedKeys: string[]; retainedKeys: string[] } {
  const retained = filterOverviewWeather(previous, anchors)
  const byDate: Record<string, DayWeather> = {}
  const failedKeys: string[] = []
  const retainedKeys: string[] = []

  anchors.forEach((anchor, index) => {
    const key = overviewWeatherKey(anchor)
    const result = results[index]
    if (result?.status === 'fulfilled') {
      const forecast = result.value[anchor.date]
      if (forecast?.date === anchor.date) byDate[key] = forecast
      return
    }

    failedKeys.push(key)
    const lastForecast = retained[key]
    if (lastForecast) {
      byDate[key] = lastForecast
      retainedKeys.push(key)
    }
  })

  return { byDate, failedKeys, retainedKeys }
}

export function overviewHasPlan(trip: Pick<Trip, 'days'>): boolean {
  return trip.days.some(day => day.stops.some(stop => stop.status !== 'rejected'))
}

/** Count the stops a traveller has planned, not rejected ideas. */
export function overviewPlannedStops(trip: Pick<Trip, 'days'>): number {
  return trip.days.reduce(
    (count, day) => count + day.stops.filter(stop => stop.status !== 'rejected').length,
    0,
  )
}

/** The verdict sub-line summarises the issues. It never repeats a warning title. */
export function overviewIssueSummary(warnings: readonly ScheduleWarning[]): string {
  if (warnings.length === 0) return 'No schedule issues detected.'
  const worst = maxWarningSeverity(warnings)
  const count = `${warnings.length} issue${warnings.length === 1 ? '' : 's'}`
  return worst ? `${count}, ${worst} severity.` : `${count}.`
}

export function overviewWarningTarget(warning: ScheduleWarning): TimelineFocusTarget {
  return warning.dayIndex == null
    ? { block: 'trip-wide' }
    : { dayIndex: warning.dayIndex }
}

export function OverviewTab({ trip, onOpenDecisions, onOpenTimeline, onOpenMap, onInvite, health, totals, road, corridorSegments, mapInputs, mapCache }: {
  trip: Trip
  editable: boolean
  onOpenDecisions: () => void
  onOpenTimeline?: (target?: TimelineFocusTarget) => void
  onOpenMap?: (target?: MapTarget) => void
  onInvite: () => void
  health: ReturnType<typeof computeHealth>
  totals: ReturnType<typeof computeTotals>
  /** The workspace's ONE road measurement, so the matrix attributes days by the
   *  same road-true km the Map rail does. */
  road?: TripRoadView | null
  /** The corridor scan's segments, shared with the Map rail (from the cache). */
  corridorSegments?: SegmentHit[]
  /** Freshness pair published by the Map tab (lane A) — null when never mounted. */
  mapInputs?: { hash: string; scopeKm: number } | null
  /** The cache entry the matrix reads (`suggestionCache.cache.map`). */
  mapCache?: { scopeKm: number; inputsHash: string; plan?: readonly DrivingPlanDay[] } | null
}) {
  const db = useDb()
  const sliceReads = useSliceReads()
  const timeFormat = useTimeFormat()
  const tripDecisions = db.decisions.filter(d => d.tripId === trip.id)
  const unresolvedDecisions = tripDecisions.filter(d => d.status === 'open').length
  const decisionsView = overviewSliceView(sliceReads, 'decisions', tripDecisions.length)
  const tripActivity = activityFor(trip.id)
  const activityView = overviewSliceView(sliceReads, 'activity', tripActivity.length)
  const [weatherView, setWeatherView] = useState<OverviewWeatherView>('loading')
  const retryOverviewReads = () => { void resumeSync().catch(() => undefined) }
  const nextCommitment = [...trip.fixedCommitments]
    .sort((a, b) => a.dayIndex - b.dayIndex || a.time.localeCompare(b.time))[0]
  // The next commitment's day, dated from the trip start. Without a start date the chip shows the day number only.
  const nextDate = nextCommitment && trip.startDate
    ? new Date(`${isoAddDays(trip.startDate, nextCommitment.dayIndex)}T00:00`)
    : null
  const crew = trip.members ?? []
  const hasPlan = overviewHasPlan(trip)
  const routeRows = useMemo(() => overviewRouteRows(trip, road), [trip, road])
  const rankedWarnings = rankWarnings(health.warnings)
  const [showAllWarnings, setShowAllWarnings] = useState(false)
  const visibleWarnings = showAllWarnings ? rankedWarnings : rankedWarnings.slice(0, 3)
  const verdictTarget = rankedWarnings[0] ? overviewWarningTarget(rankedWarnings[0]) : undefined
  const worstSeverity = maxWarningSeverity(health.warnings)
  const countTone = worstSeverity === 'high' ? 'ovw-count is-warn' : 'ovw-count'
  const openGenericMap = onOpenMap ? () => onOpenMap() : undefined
  const bandTone = healthBandTone(health.band)
  const bandClass = healthBandClass(health.band)
  const plannedStops = overviewPlannedStops(trip)
  const daysWithStops = trip.days.filter(day => day.stops.some(stop => stop.status !== 'rejected')).length
  const perPersonDelta = trip.budgetPerPersonInr - totals.costPerPersonInr
  const perPersonNote = trip.budgetPerPersonInr > 0
    ? perPersonDelta >= 0
      ? `${formatInr(perPersonDelta)} under the ${formatInr(trip.budgetPerPersonInr)} target`
      : `${formatInr(Math.abs(perPersonDelta))} over the ${formatInr(trip.budgetPerPersonInr)} target`
    : 'No per-person target'
  const elevation = useTripElevation(trip, routeRows)
  // Page order decides the one alert: the route card sits above the quiet
  // blocks, so a failed height read owns it before decisions or weather do.
  const failedReads = new Set<OverviewReadKey>()
  if (elevation.view === 'failed') failedReads.add('elevation')
  if (decisionsView === 'failed') failedReads.add('decisions')
  if (activityView === 'failed') failedReads.add('activity')
  if (weatherView === 'failed') failedReads.add('weather')
  const firstFailed = firstFailedOverviewRead(failedReads)
  const elevationRole = overviewReadRole('elevation', firstFailed)
  const healthTiles = overviewHealthTiles({
    transportMode: trip.transportMode,
    warnings: health.warnings,
    budgetPerPersonInr: trip.budgetPerPersonInr,
    costPerPersonInr: totals.costPerPersonInr,
    daysWithStops,
    totalDays: trip.days.length,
    formatMoney: formatInr,
  })
  const elevationResult = elevation.result
  const elevationPeak = elevationResult?.stats.peak ?? null
  // A place whose tile could not be read means the peak is the highest of the
  // places we DID read. The tile says so instead of claiming the whole trip.
  const elevationPartial = !!elevationResult && elevationResult.stats.missing > 0
  const highestTile = elevationPeak && elevationResult && elevationPeak.elevationM != null
    ? {
      label: 'Highest stop',
      value: `${Math.round(elevationPeak.elevationM).toLocaleString('en-IN')} m`,
      sub: elevationPartial
        ? `${elevationPeak.title} · ${elevationResult.stats.sampled} of ${elevationResult.stats.sampled + elevationResult.stats.missing} places read`
        : `${elevationPeak.title}${elevationPeak.dayIndex != null ? ` · Day ${elevationPeak.dayIndex + 1}` : ''}`,
    }
    : elevation.view === 'loading'
      ? { label: 'Highest stop', value: '…', sub: 'Reading heights' }
      : elevation.view === 'failed'
        ? { label: 'Highest stop', value: 'Unavailable', sub: 'Heights could not load' }
        : elevation.view === 'empty'
          ? { label: 'Highest stop', value: 'Unavailable', sub: 'No height data' }
          : null

  return (
    <div className="ovw ovw2">
      <section className="ovw2-brief" aria-label="Trip briefing">
        <Surface
          as="section"
          className="ovw-card ovw2-health"
          enterIndex={0}
          data-band={hasPlan ? bandClass : 'teal'}
          aria-labelledby="ovw-verdict-title"
        >
          <div className="ovw2-health-head">
            <span className="ovw2-kicker">Trip health</span>
            <span className={`ovw-band is-${bandTone}`}>{hasPlan ? health.band : 'Not scored yet'}</span>
          </div>
          <div className="ovw2-health-main">
            <span
              className={`ovw2-score-ring is-${bandClass}`}
              role="img"
              aria-label={hasPlan ? `Score ${health.score} of 100` : 'No score yet'}
              style={{ '--ovw-score': `${hasPlan ? health.score : 0}%` } as CSSProperties}
            >
              <span className="ovw2-score-core">
                <b>{hasPlan ? health.score : '–'}</b>
                <small>{hasPlan ? 'of 100' : 'No score'}</small>
              </span>
            </span>
            <div className="ovw2-health-copy">
              <h2 className="ovw-title ovw2-health-line" id="ovw-verdict-title">
                {hasPlan ? healthBandSentence(health.band) : 'Nothing is planned yet.'}
              </h2>
              <p className="ovw2-health-issues">
                {hasPlan ? overviewIssueSummary(rankedWarnings) : 'Add a stop and the plan gets a score.'}
              </p>
            </div>
          </div>
          <div className="ovw2-health-foot">
            <div className="ovw2-tiles" aria-label="Trip checks">
              {healthTiles.map(tile => (
                <span key={tile.key} className={`ovw2-tile is-${tile.tone}`} title={tile.note}>
                  <span className="ovw2-tile-label">{tile.label}</span>
                  <span className="ovw2-tile-value">{tile.value}</span>
                  <span className="sr-only">. {tile.note}</span>
                </span>
              ))}
            </div>
            {onOpenTimeline && (
              <div className="ovw2-health-act">
                <button type="button" className="ovw-btn ovw-btn--primary" onClick={() => onOpenTimeline(verdictTarget)}>
                  {rankedWarnings.length > 0
                    ? `Fix ${rankedWarnings.length} issue${rankedWarnings.length === 1 ? '' : 's'}`
                    : 'Open Timeline'}
                </button>
              </div>
            )}
          </div>
        </Surface>

        <div className="ovw2-metrics" aria-label="Trip metrics">
          <Surface as="article" className="ovw-card ovw2-metric" enterIndex={1}>
            <span className="ovw2-metric-label">Total cost</span>
            <span className="ovw2-metric-value">{hasPlan ? formatInr(totals.totalCostInr) : '–'}</span>
            <span className="ovw2-metric-sub">{hasPlan ? `${formatInr(totals.costPerDayInr)} a day, estimate` : 'Shows after you add a cost'}</span>
          </Surface>
          <Surface as="article" className="ovw-card ovw2-metric is-teal" enterIndex={2}>
            <span className="ovw2-metric-label">Per person</span>
            <span className="ovw2-metric-value">{hasPlan ? formatInr(totals.costPerPersonInr) : '–'}</span>
            <span className="ovw2-metric-sub">{hasPlan ? perPersonNote : 'Shows after you add a cost'}</span>
          </Surface>
          <Surface as="article" className="ovw-card ovw2-metric" enterIndex={3}>
            <span className="ovw2-metric-label">Travel effort</span>
            <span className="ovw2-metric-value">{hasPlan ? minutesToHM(totals.totalTravelMinutes) : '–'}</span>
            <span className="ovw2-metric-sub">
              {hasPlan
                ? `${countHotelNights(trip)} overnight base${countHotelNights(trip) === 1 ? '' : 's'}`
                : 'Shows after you add a stop'}
            </span>
          </Surface>
          <Surface
            as="article"
            className="ovw-card ovw2-metric"
            enterIndex={4}
            title={highestTile ? 'Estimated terrain elevation from AWS Terrain Tiles.' : undefined}
          >
            {highestTile ? (
              <>
                <span className="ovw2-metric-label">{highestTile.label}</span>
                <span className="ovw2-metric-value">{highestTile.value}</span>
                <span className="ovw2-metric-sub">{highestTile.sub}</span>
              </>
            ) : (
              <>
                <span className="ovw2-metric-label">Planned stops</span>
                <span className="ovw2-metric-value">{hasPlan ? plannedStops : '–'}</span>
                <span className="ovw2-metric-sub">
                  {hasPlan ? `${daysWithStops} of ${trip.days.length} days have stops` : 'Add a stop to count it'}
                </span>
              </>
            )}
          </Surface>
        </div>
      </section>

      <div className="ovw2-main">
        <div className="ovw2-left">
          <Surface as="section" className="ovw-card ovw-needs ovw2-issues" enterIndex={5} aria-labelledby="ovw-needs-title">
            <div className="ovw-head">
              <h2 className="ovw-title" id="ovw-needs-title">What needs you</h2>
              {rankedWarnings.length > 3 ? (
                <span className={countTone}>
                  {visibleWarnings.length} of {rankedWarnings.length} ·{' '}
                  <button
                    type="button"
                    className="ovw-more-btn"
                    aria-label={showAllWarnings ? 'Show fewer warnings' : `Show all ${rankedWarnings.length} warnings`}
                    aria-expanded={showAllWarnings}
                    aria-controls="ovw-needs-list"
                    onClick={() => setShowAllWarnings(value => !value)}
                  >
                    {showAllWarnings ? 'Show fewer' : 'Show all'}
                  </button>
                </span>
              ) : rankedWarnings.length > 0 && (
                <span className={countTone}>{rankedWarnings.length} warning{rankedWarnings.length === 1 ? '' : 's'}</span>
              )}
            </div>
            {visibleWarnings.length === 0 ? (
              <StateBlock
                kind="empty"
                size="compact"
                icon={<CircleCheck size={18} aria-hidden />}
                title={hasPlan ? 'The plan flows' : 'Nothing to check yet'}
                body={hasPlan ? 'No schedule issues need a fix.' : 'Issues appear after you add a stop.'}
              />
            ) : (
              <ul className="ovw-need-list" id="ovw-needs-list">
                {visibleWarnings.map(warning => {
                  const target = overviewWarningTarget(warning)
                  return (
                    <li key={warningKey(warning)} className={`ovw-need ovw2-issue is-${warning.severity}`}>
                      <span className="ovw2-issue-icon" aria-hidden="true">
                        {warning.severity === 'high'
                          ? (
                            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                              <circle className="ovw2-glyph-fill" cx="12" cy="13" r="8" stroke="currentColor" strokeWidth={1.9} />
                              <path d="M12 9v4l2.5 2.5M9.5 2.5h5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )
                          : warning.severity === 'medium'
                            ? (
                              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                                <path className="ovw2-glyph-fill" d="M5 16a7 7 0 0 1 14 0Z" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round" />
                                <path d="M2.5 16h19M6 20h12M12 4v2.5M4.6 8.6l1.6 1.6M19.4 8.6l-1.6 1.6" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
                              </svg>
                            )
                            : (
                              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                                <rect className="ovw2-glyph-fill" x="3.5" y="5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth={1.9} />
                                <path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
                                <rect x="7" y="13" width="4" height="3.5" rx="1" fill="none" stroke="currentColor" strokeWidth={1.9} strokeDasharray="1.6 1.4" />
                                <rect className="ovw2-glyph-accent" x="13" y="13" width="4" height="3.5" rx="1" />
                              </svg>
                            )}
                      </span>
                      <div className="ovw-need-text">
                        <div className="ovw-need-title">{warning.title}</div>
                        <div className="ovw-need-fix">
                          <span className={`ovw-sev is-${warning.severity}`}>
                            <span className="sr-only">{severityLead(warning.severity)} </span>
                            {warning.severity[0].toUpperCase() + warning.severity.slice(1)}
                          </span>
                          <span>{warning.fix}</span>
                        </div>
                      </div>
                      {onOpenTimeline && (
                        <button type="button" className={`ovw-btn ovw-btn--review ovw2-fix is-${warning.severity}`} onClick={() => onOpenTimeline(target)}>
                          {warning.dayIndex == null ? 'Fix' : `Fix Day ${warning.dayIndex + 1}`}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Surface>

          <SlotMatrix
            trip={trip}
            road={road}
            corridorSegments={corridorSegments}
            mapInputs={mapInputs}
            mapCache={mapCache}
            onRefreshMatrix={openGenericMap}
            onSelectCell={onOpenTimeline
              ? (dayIndex, stopId) => onOpenTimeline({ dayIndex, stopId: stopId ?? undefined })
              : undefined}
            onSelectDay={onOpenTimeline ? dayIndex => onOpenTimeline({ dayIndex }) : undefined}
          />
        </div>

        <div className="ovw2-right">
          <Surface as="section" className="ovw-card ovw-route ovw2-route" enterIndex={7} aria-labelledby="ovw-route-title">
            <OverviewRouteCard rows={routeRows} road={road} transportMode={trip.transportMode} coverUrl={trip.coverImageUrl} onOpenMap={onOpenMap} elevation={elevation} elevationRole={elevationRole} />
          </Surface>

          <Surface as="section" className="ovw-card ovw2-commitments" enterIndex={8} aria-labelledby="ovw-commitments-title">
            <div className="ovw-head">
              <h2 className="ovw-title" id="ovw-commitments-title">Fixed commitments</h2>
              <span className="ovw-chip">{trip.fixedCommitments.length}</span>
            </div>
            {nextCommitment ? (
              <div className="ovw-commitments">
                <div className="ovw-next">
                  <span className="ovw-next-date" aria-hidden="true">
                    {nextDate
                      ? <><span>{nextDate.toLocaleDateString('en-US', { weekday: 'short' })}</span><b>{nextDate.getDate()}</b></>
                      : <><span>Day</span><b>{nextCommitment.dayIndex + 1}</b></>}
                  </span>
                  <div className="ovw-next-copy">
                    <span className="ovw-next-kicker">Next up</span>
                    <b>{nextCommitment.title}</b>
                    <span>Day {nextCommitment.dayIndex + 1} at {formatHM(nextCommitment.time, timeFormat)}</span>
                  </div>
                </div>
                {trip.fixedCommitments.filter(commitment => commitment !== nextCommitment).map(commitment => (
                  <div key={commitment.id} className="ovw-commit">
                    <span><b>{commitment.title}</b> <span className="ovw-commit-when">Day {commitment.dayIndex + 1}, {formatHM(commitment.time, timeFormat)}</span></span>
                    <span className="ovw-chip">{labelCommitType(commitment.type)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <StateBlock kind="empty" size="compact" title="No fixed commitments yet" body="Add check-ins, trains or flights so the planner can protect them." />
            )}
          </Surface>
        </div>
      </div>

      <Surface as="section" className="ovw-block ovw2-strip" enterIndex={9} aria-labelledby="ovw-pulse-title">
        <div className="ovw2-strip-head">
          <h2 className="ovw-title" id="ovw-pulse-title">The group</h2>
          <button type="button" className="ovw-btn ovw-btn--quiet" onClick={onInvite}>Invite travellers</button>
        </div>
        <div className="ovw2-strip-grid">
          <div className="ovw2-strip-tile is-members">
            <span className="ovw-avatars" aria-label={`${crew.length} members`}>
              {(() => {
                const shown = crew.slice(0, 5)
                const tones = assignAvatarTones(shown.map(member => member.userId))
                return shown.map((member, index) => (
                  <Avatar key={member.userId} user={userById(member.userId)} tone={tones[index]} />
                ))
              })()}
            </span>
            <span className="ovw2-strip-copy">
              <b>{crew.length} member{crew.length === 1 ? '' : 's'}</b>
              <small>On this trip</small>
            </span>
          </div>

          <div className="ovw2-strip-tile is-decisions">
            {decisionsView === 'reading' && (
              <StateBlock kind="loading" size="compact" icon={<span className="spinner" aria-hidden="true" />} title="Loading decisions" />
            )}
            {decisionsView === 'failed' && (
              <StateBlock
                kind="failed"
                size="compact"
                role={overviewReadRole('decisions', firstFailed)}
                icon={<TriangleAlert size={18} aria-hidden />}
                title="Couldn’t load decisions"
                body="The request failed. It does not mean there are no open decisions."
                actions={<button className="btn btn-outline btn-sm" onClick={retryOverviewReads}>Try again</button>}
              />
            )}
            {decisionsView === 'empty' && (
              <StateBlock kind="empty" size="compact" title="No open decisions" body="Nothing is waiting for a vote." />
            )}
            {decisionsView === 'kept' && (
              <StateBlock
                kind="kept"
                size="compact"
                title="Couldn’t refresh decisions"
                body="Showing the decisions that were loaded."
                actions={<button className="btn btn-outline btn-sm" onClick={retryOverviewReads}>Try again</button>}
              />
            )}
            {(decisionsView === 'rows' || decisionsView === 'kept') && (
              <>
                <span className="ovw2-strip-chip" aria-hidden="true"><MessageSquare size={18} /></span>
              <div className="ovw2-strip-copy">
                <b>{unresolvedDecisions} open decision{unresolvedDecisions === 1 ? '' : 's'}</b>
                <button type="button" className="ovw-btn ovw-btn--quiet" onClick={onOpenDecisions}>Review decisions</button>
              </div>
              </>
            )}
          </div>

          <div className="ovw2-strip-tile is-activity">
            <h3 className="ovw2-strip-kicker">Recent activity</h3>
            {activityView === 'reading' && <StateBlock kind="loading" size="compact" icon={<span className="spinner" aria-hidden="true" />} title="Loading activity" />}
            {activityView === 'failed' && (
              <StateBlock
                kind="failed"
                size="compact"
                role={overviewReadRole('activity', firstFailed)}
                icon={<TriangleAlert size={18} aria-hidden />}
                title="Couldn’t load activity"
                body="The request failed. It does not mean there is no activity."
                actions={<button className="btn btn-outline btn-sm" onClick={retryOverviewReads}>Try again</button>}
              />
            )}
            {activityView === 'empty' && <StateBlock kind="empty" size="compact" title="No recent activity yet" body="Updates from your group will appear here." />}
            {activityView === 'kept' && (
              <StateBlock
                kind="kept"
                size="compact"
                title="Couldn’t refresh recent activity"
                body="Showing the activity that was loaded."
                actions={<button className="btn btn-outline btn-sm" onClick={retryOverviewReads}>Try again</button>}
              />
            )}
            {(activityView === 'rows' || activityView === 'kept') && (
              <ul className="ovw-feed is-strip">
                {tripActivity.slice(0, 3).map(activity => (
                  <li key={activity.id}>
                    <Avatar user={userById(activity.actorId)} />
                    <span><b>{userById(activity.actorId)?.profile.name}</b> {activity.verb}{activity.target ? ` · ${activity.target}` : ''}</span>
                    <time>{timeAgo(activity.at)}</time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Surface>

      <WeatherCard
        key={trip.id}
        trip={trip}
        failedRole={weatherView === 'loading'
          ? 'status'
          : overviewReadRole('weather', firstFailed)}
        onViewChange={setWeatherView}
      />
    </div>
  )
}

// ================= Weather =================

export type OverviewWeatherView = 'loading' | 'failed' | 'empty' | 'ready' | 'kept'

/** The parent needs one read verdict, even when the card keeps forecast rows. */
export function overviewWeatherView(input: {
  anchored: boolean
  loading: boolean
  failed: boolean
  forecastCount: number
  partialFailed: boolean
  refreshFailed: boolean
}): OverviewWeatherView {
  if (!input.anchored) return 'empty'
  if (input.loading) return 'loading'
  if (input.failed) return 'failed'
  if (input.forecastCount === 0) return 'empty'
  if (input.partialFailed) return 'failed'
  if (input.refreshFailed) return 'kept'
  return 'ready'
}

/** The one notice the weather card shows. A partial failure that also kept
 *  forecasts reports both facts in one block, so the retained days are never
 *  hidden behind the missing ones. */
export function overviewWeatherNotice(input: {
  partialFailed: boolean
  retainedDays: number
  refreshFailed: boolean
}): 'partial-retained' | 'partial' | 'retained' | null {
  if (input.partialFailed) return input.retainedDays > 0 ? 'partial-retained' : 'partial'
  if (input.refreshFailed) return 'retained'
  return null
}

/** Per-day forecast strip for the Overview tab. Hides itself when no day has a forecast.
 *  A failed read says so and offers Try again (#704). A failed refresh keeps the
 *  forecast on screen and says that it could not refresh (#704). */
function WeatherCard({
  trip,
  failedRole,
  onViewChange,
}: {
  trip: Trip
  failedRole?: 'alert' | 'status'
  onViewChange?: (view: OverviewWeatherView) => void
}) {
  const [byDate, setByDate] = useState<Record<string, DayWeather>>({})
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'failed'>('loading')
  // The ref carries forecasts for current anchors. Effects prune it before a
  // request, and cancelled requests cannot write it back.
  const byDateRef = useRef<Record<string, DayWeather>>({})
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [refreshFailedFor, setRefreshFailedFor] = useState<string | null>(null)
  const [partialFailure, setPartialFailure] = useState<{ signature: string; missingDays: number; retainedDays: number } | null>(null)
  const [resolvedSignature, setResolvedSignature] = useState<string | null>(null)
  // Bumped by Try again. A bump re-pulls the forecast past the cache.
  const [retries, setRetries] = useState(0)
  const tick = useWeatherRefreshTick()

  // Per-day anchor + per-day forecast-window gate — the SAME rule the Timeline
  // chip uses. This used to centre ONE centroid across the whole trip, so a
  // multi-city trip showed the midpoint's weather for every day (a forecast for
  // the sea between cities). Each day now asks about its OWN first placed stop;
  // a day with no anchor, or one past the forecast window, has no cell until it
  // closes in. Nothing is invented.
  const dayAnchors = useMemo(() => {
    const out: Array<{ date: string; lat: number; lng: number }> = []
    for (const day of trip.days) {
      const date = isoAddDays(trip.startDate, day.index)
      if (!forecastAvailable(date)) continue
      const a = weatherAnchor(day)
      if (a) out.push({ date, lat: a.lat, lng: a.lng })
    }
    return out
  }, [trip])
  const anchorSignature = overviewWeatherSignature(dayAnchors)
  const visibleByDate = filterOverviewWeather(byDate, dayAnchors)
  const entries = Object.values(visibleByDate)
  const readPending = resolvedSignature !== anchorSignature

  useEffect(() => {
    const requestSignature = overviewWeatherSignature(dayAnchors)
    const previous = filterOverviewWeather(byDateRef.current, dayAnchors)
    byDateRef.current = previous
    if (dayAnchors.length === 0) return
    let cancelled = false
    void Promise.resolve()
      .then(() => Promise.allSettled(dayAnchors.map(d => fetchDailyWeather(d.lat, d.lng, d.date, 1, { force: tick > 0 || retries > 0 }))))
      .then(results => {
        if (cancelled) return
        const merged = mergeOverviewWeather(dayAnchors, results, previous)
        byDateRef.current = merged.byDate
        setByDate(merged.byDate)
        setResolvedSignature(requestSignature)
        const missingDays = merged.failedKeys.length - merged.retainedKeys.length
        setPartialFailure(missingDays > 0
          ? { signature: requestSignature, missingDays, retainedDays: merged.retainedKeys.length }
          : null)
        setRefreshFailed(merged.retainedKeys.length > 0)
        setRefreshFailedFor(merged.retainedKeys.length > 0 ? requestSignature : null)
        if (merged.failedKeys.length > 0) {
          setState(Object.keys(merged.byDate).length > 0 ? 'ready' : 'failed')
        } else if (Object.keys(merged.byDate).length > 0) {
          setState('ready')
        } else {
          setState('unavailable')
        }
      })
      .catch(() => {
        if (cancelled) return
        if (Object.keys(byDateRef.current).length > 0) setRefreshFailed(true)
        else setState('failed')
        setRefreshFailedFor(Object.keys(byDateRef.current).length > 0 ? requestSignature : null)
        setPartialFailure(null)
        setResolvedSignature(requestSignature)
      })
    return () => { cancelled = true }
  }, [dayAnchors, tick, retries])

  // #704: Try again shows the loading line only while nothing has loaded. With a
  // forecast on screen, it refreshes in place.
  const retryWeather = () => {
    if (Object.keys(byDateRef.current).length === 0) setState('loading')
    setRetries(r => r + 1)
  }

  const partialNow = partialFailure && partialFailure.signature === anchorSignature && partialFailure.missingDays > 0
    ? partialFailure
    : null
  const refreshFailedNow = refreshFailed && refreshFailedFor === anchorSignature && entries.length > 0
  const readView = overviewWeatherView({
    anchored: dayAnchors.length > 0,
    loading: state === 'loading' || (readPending && entries.length === 0),
    failed: state === 'failed',
    forecastCount: entries.length,
    partialFailed: partialNow !== null,
    refreshFailed: refreshFailedNow,
  })
  const weatherNotice = overviewWeatherNotice({
    partialFailed: partialNow !== null,
    retainedDays: partialNow?.retainedDays ?? 0,
    refreshFailed: refreshFailedNow,
  })
  useEffect(() => {
    onViewChange?.(readView)
  }, [onViewChange, readView])

  // No anchored day inside the forecast window yet — a far-future trip, or one
  // with no placed stops. An empty state is honest and avoids a spinner.
  if (dayAnchors.length === 0) {
    return (
      <Surface as="section" className="ovw-block ovw-weather" enterIndex={8} aria-labelledby="ovw-weather-title">
        <div className="ovw-head">
          <h2 className="ovw-title" id="ovw-weather-title">
            <InlineIcon icon={CloudSun} size={16} gap={6} />Weather
          </h2>
        </div>
        <StateBlock
          kind="empty"
          size="compact"
          title="No forecast yet"
          body="Weather appears when a day has a placed stop inside the 15-day forecast window."
        />
      </Surface>
    )
  }
  const loadingCard = (
    <Surface as="section" className="ovw-block ovw-weather" enterIndex={8} aria-labelledby="ovw-weather-title">
      <div className="ovw-head">
        <h2 className="ovw-title" id="ovw-weather-title">
          <InlineIcon icon={CloudSun} size={16} gap={6} />Weather
        </h2>
      </div>
      <StateBlock kind="loading" size="compact" title="Loading forecast…" />
    </Surface>
  )
  if (state === 'loading') return loadingCard
  if (readPending && entries.length === 0) return loadingCard
  if (state === 'failed') {
    if (readPending) return loadingCard
    return (
      <Surface as="section" className="ovw-block ovw-weather" enterIndex={8} aria-labelledby="ovw-weather-title">
        <div className="ovw-head">
          <h2 className="ovw-title" id="ovw-weather-title">
            <InlineIcon icon={CloudSun} size={16} gap={6} />Weather
          </h2>
        </div>
        <div className="ovw-weather-failed">
          <StateBlock
            kind="failed"
            size="compact"
            role={failedRole}
            title="Couldn’t load the forecast."
            actions={<button className="btn btn-outline btn-sm" onClick={retryWeather}>Try again</button>}
          />
        </div>
      </Surface>
    )
  }
  // 'unavailable': the forecast came back with no usable day.
  if (state !== 'ready') {
    return (
      <Surface as="section" className="ovw-block ovw-weather" enterIndex={8} aria-labelledby="ovw-weather-title">
        <div className="ovw-head">
          <h2 className="ovw-title" id="ovw-weather-title">
            <InlineIcon icon={CloudSun} size={16} gap={6} />Weather
          </h2>
        </div>
        <StateBlock
          kind="empty"
          size="compact"
          title="No forecast available"
          body="The forecast returned no usable day."
          actions={<button className="btn btn-outline btn-sm" onClick={retryWeather}>Try again</button>}
        />
      </Surface>
    )
  }

  const wetDays = entries.filter(w => w.rainChancePct >= 60).length
  return (
    <Surface as="section" className="ovw-block ovw-weather" enterIndex={10} aria-labelledby="ovw-weather-title">
      <div className="ovw2-wx-row">
        <div className="ovw2-wx-head">
          <h2 className="ovw-title" id="ovw-weather-title">
            <InlineIcon icon={CloudSun} size={16} gap={6} />Weather
          </h2>
          <span className="ovw-head-meta">Open-Meteo · ±15 days</span>
        </div>
        <div className="ovw-wx">
          {entries.map(w => {
            const info = wmoInfo(w.code)
            const dayNum = Math.round((new Date(w.date + 'T00:00').getTime() - new Date(trip.startDate + 'T00:00').getTime()) / 86400000)
            const wet = w.rainChancePct >= 60
            return (
              <div key={w.date} className={`ovw-wx-cell${wet ? ' wet' : ''}`} title={info.label}>
                {(() => { const W = wmoIcon(w.code); return <W size={20} aria-hidden /> })()}
                <span className="ovw-wx-copy">
                  <span className="ovw-wx-day">
                    {dayNum >= 0 ? `Day ${dayNum + 1}` : w.date} · {wet ? `Rain ${w.rainChancePct}%` : info.label}
                  </span>
                  <span className="ovw-wx-temp">{Math.round(w.tempMaxC)}° / {Math.round(w.tempMinC)}°</span>
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {readPending && <StateBlock kind="loading" size="compact" title="Updating forecasts…" />}
      {wetDays > 0 && (
        <p className="hint-text ovw-rain-note">
          <InlineIcon icon={TriangleAlert} size={12} gap={3} />High rain chance on {wetDays} day{wetDays > 1 ? 's' : ''}. Consider indoor alternatives for weather-sensitive stops (beaches, viewpoints, treks).
        </p>
      )}
      {weatherNotice === 'partial-retained' && partialNow && (
        <div className="ovw-weather-failed"><StateBlock
          kind="failed"
          size="compact"
          role={failedRole}
          title="Couldn’t refresh some forecasts. The last saved values stay on screen."
          body={`${partialNow.missingDays} day${partialNow.missingDays === 1 ? '’s' : 's’'} forecast could not load. ${partialNow.retainedDays} day${partialNow.retainedDays === 1 ? '' : 's'} show the last saved forecast.`}
          actions={<button className="btn btn-outline btn-sm" onClick={retryWeather}>Try again</button>}
        /></div>
      )}
      {weatherNotice === 'partial' && partialNow && (
        <div className="ovw-weather-failed"><StateBlock
          kind="failed"
          size="compact"
          role={failedRole}
          title="Couldn’t load some forecasts."
          body={`${partialNow.missingDays} day${partialNow.missingDays === 1 ? '’s' : 's’'} forecast could not load. Showing available days.`}
          actions={<button className="btn btn-outline btn-sm" onClick={retryWeather}>Try again</button>}
        /></div>
      )}
      {weatherNotice === 'retained' && (
        <div className="ovw-weather-kept"><StateBlock kind="kept" size="compact" title="Couldn’t refresh the forecast. Showing the last one."
          actions={<button className="btn btn-outline btn-sm" onClick={retryWeather}>Try again</button>}
        /></div>
      )}
    </Surface>
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
/** A filled slot opens its stop. Open and auto-added slots open only their day. */
export function overviewSlotTarget(slot: Pick<DaySlot, 'state' | 'filledStop'>): string | null {
  return slot.state === 'filled' ? slot.filledStop?.id ?? null : null
}

/**
 * The day column's route label, in the source's grammar: where the day starts
 * and where it ends. A stay day shows one place. Nothing is invented — an
 * unknown origin falls back to the trip start, then to the day's own title.
 */
export function dayPlaceLabel(
  trip: Pick<Trip, 'days' | 'startLocation'>,
  dayIndex: number,
): string {
  const days = [...trip.days].sort((a, b) => a.index - b.index)
  const place = (stop: { locationName?: string; title?: string } | undefined) =>
    (stop?.locationName?.trim() || stop?.title?.trim() || '')
  const active = (index: number) =>
    (days.find(day => day.index === index)?.stops ?? [])
      .filter(stop => stop.status !== 'rejected')
      .sort((a, b) => a.orderInDay - b.orderInDay)

  const stops = active(dayIndex)
  const to = place(stops[stops.length - 1])
  let from = ''
  for (let index = dayIndex - 1; index >= 0 && !from; index--) {
    const previous = active(index)
    from = place(previous[previous.length - 1])
  }
  if (!from) from = trip.startLocation?.trim() ?? ''
  if (from && to && from !== to) return `${from} → ${to}`
  return to || from || days.find(day => day.index === dayIndex)?.title || `Day ${dayIndex + 1}`
}

function SlotMatrix({
  trip,
  road,
  corridorSegments,
  mapInputs,
  mapCache,
  onRefreshMatrix,
  onSelectCell,
  onSelectDay,
}: {
  trip: Trip
  road?: TripRoadView | null
  /** The corridor scan's segments — the same array the Map rail reads. */
  corridorSegments?: SegmentHit[]
  /** The freshness pair the Map tab published for the scan it wrote (lane A's
   *  `onInputsHash`) — null when the tab never mounted this session, which is
   *  UNKNOWN, never stale and never fresh. */
  mapInputs?: { hash: string; scopeKm: number } | null
  /** The cache entry the matrix reads (`suggestionCache.cache.map`). */
  mapCache?: { scopeKm: number; inputsHash: string; plan?: readonly DrivingPlanDay[] } | null
  /** Switch to the Map tab (the stale qualifier's Refresh target). */
  onRefreshMatrix?: () => void
  /** Open one slot. A filled slot passes its stop; every other state passes null. */
  onSelectCell?: (dayIndex: number, stopId: string | null) => void
  /** Open one day with no stop selected. */
  onSelectDay?: (dayIndex: number) => void
}) {
  const kinds = [
    { key: 'breakfast', header: 'Brk', short: 'B', name: 'breakfast' },
    { key: 'lunch', header: 'Lunch', short: 'L', name: 'lunch' },
    { key: 'fuel', header: 'Fuel', short: 'F', name: 'fuel' },
    { key: 'stretch', header: 'Stretch', short: 'S', name: 'a stretch break' },
    { key: 'dinner', header: 'Dinner', short: 'D', name: 'dinner' },
    { key: 'stay', header: 'Night', short: 'N', name: 'the night' },
  ]
  const hasCorridor = (corridorSegments?.length ?? 0) > 0
  // The day column wears the app's own region art, seeded per day so two days
  // of one trip do not repeat the same frame.
  const region = regionFor(trip)
  const hasMatrixPlan = trip.days.some(day =>
    day.stops.some(stop => stop.status !== 'rejected'),
  )
  // The matrix re-derives with today's settings over the scan the Map wrote -
  // possibly under older settings. Unknown (Map never mounted) is qualified,
  // never fresh; stale replaces the numbers, never annotates them.
  const freshness = matrixFreshness({ hasCorridor, mapCache: mapCache ?? null, mapInputs: mapInputs ?? null })
  const deps = useMemo<Omit<DaySlotsDeps, 'dayStops'>>(() => {
    // Same helper as the Map tab, over the same corridor segments — but NOT the
    // same inputs: the Map passes real anchors, routePolyline, altPool and
    // decisions, while the matrix passes none of those (lifting the Map's full
    // dep set out is explicitly out of scope — lane A/E agreement). The
    // freshness gate below is what keeps that asymmetry from printing stale
    // numbers silently: same helper + same segments + same gate, or qualified.
    const dayRoadKm = mapRoadViewFromLegs(road?.chain ?? null, road?.legs ?? null, trip.days.map(d => d.index)).dayRoadKm
    // #832: when the Map's cache is not stale, its plan projection is the same
    // boundary source the Map used. A stale cache renders nothing, so it never
    // reaches here with old boundaries.
    const attribution = tripDayAttribution(trip, dayRoadKm, freshness === 'stale' ? null : mapCache?.plan)
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
  }, [trip, road, corridorSegments, freshness, mapCache])
  const rows = useMemo(
    () => trip.days.map(d => ({ day: d, slots: daySlots(d.index, { ...deps, dayStops: d.stops }) })),
    [trip.days, deps],
  )
  // S11: a day with no slots at all is the EMPTIEST day, and the old
  // `total > 0` filter dropped it — so the callout could never name the one day
  // that most needed naming.
  const thinnest = rows
    .map(r => ({ index: r.day.index, filled: r.slots.filter(s => s.state === 'filled').length, total: r.slots.length }))
    .sort((a, b) => (a.filled / Math.max(1, a.total)) - (b.filled / Math.max(1, b.total)))[0]
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null)
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([])

  const slotFor = (slots: DaySlot[], key: string) => slots.find(slot => slot.key === key)
  const isActionable = (rowIndex: number, colIndex: number): boolean => {
    const kind = kinds[colIndex]
    const slot = rows[rowIndex] && kind ? slotFor(rows[rowIndex].slots, kind.key) : undefined
    return !!slot && !!onSelectCell
  }
  const firstActionable = (() => {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      for (let colIndex = 0; colIndex < kinds.length; colIndex++) {
        const slot = slotFor(rows[rowIndex].slots, kinds[colIndex].key)
        if (slot) return { row: rowIndex, col: colIndex }
      }
    }
    return null
  })()
  const resolvedActive = activeCell && isActionable(activeCell.row, activeCell.col)
    ? activeCell
    : firstActionable

  const focusCell = (row: number, col: number) => {
    setActiveCell({ row, col })
    cellRefs.current[row * kinds.length + col]?.focus()
  }
  const moveCell = (row: number, col: number, rowStep: number, colStep: number) => {
    let nextRow = row
    let nextCol = col
    for (let tries = 0; tries < rows.length * kinds.length; tries++) {
      if (rowStep !== 0) nextRow = (nextRow + rowStep + rows.length) % rows.length
      if (colStep !== 0) nextCol = (nextCol + colStep + kinds.length) % kinds.length
      if (isActionable(nextRow, nextCol)) {
        focusCell(nextRow, nextCol)
        return
      }
    }
  }
  const moveToRowEdge = (row: number, fromEnd: boolean) => {
    for (let step = 0; step < kinds.length; step++) {
      const col = fromEnd ? kinds.length - 1 - step : step
      if (isActionable(row, col)) {
        focusCell(row, col)
        return
      }
    }
  }
  const onCellKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    row: number,
    col: number,
  ) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveCell(row, col, 0, -1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveCell(row, col, 0, 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveCell(row, col, -1, 0)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveCell(row, col, 1, 0)
    } else if (event.key === 'Home') {
      event.preventDefault()
      moveToRowEdge(row, false)
    } else if (event.key === 'End') {
      event.preventDefault()
      moveToRowEdge(row, true)
    }
  }
  const slotMeaning = (dayIndex: number, kindName: string, slot?: DaySlot): string => {
    if (!slot) return `${kindName}: not part of this day`
    const state = slot.state === 'filled'
      ? slot.filledStop?.title ?? 'planned'
      : slot.state === 'auto'
        ? 'added by the app'
        : slot.state === 'empty'
          ? 'still open'
          : 'not part of this day'
    return `Day ${dayIndex + 1} ${kindName}: ${state}`
  }
  // The day in view. A trip day is today only when the start date and the local
  // date put today inside the trip, so the Today row never guesses.
  const today = useToday()
  const todayIndex = trip.startDate
    ? Math.round((today.getTime() - new Date(`${trip.startDate}T00:00`).getTime()) / 86400000)
    : -1
  const dayStatesLabel = (dayIndex: number, slots: DaySlot[]): string =>
    `Day ${dayIndex + 1}. ${kinds.map(kind => {
      const slot = slotFor(slots, kind.key)
      if (!slot) return `${kind.name}: not part of this day`
      if (slot.state === 'filled') return `${kind.name}: ${slot.filledStop?.title ?? 'planned'}`
      if (slot.state === 'auto') return `${kind.name}: added by the app`
      if (slot.state === 'empty') return `${kind.name}: still open`
      return `${kind.name}: not part of this day`
    }).join('. ')}.`

  return (
    <Surface as="section" className="ovw-block ovw-matrix" enterIndex={6} aria-labelledby="ovw-matrix-title">
      <div className="ovw-head">
        <h2 className="ovw-title" id="ovw-matrix-title">What each day holds</h2>
        <span className="ovw-head-meta">
          Meals, fuel, a stretch and a bed
          {thinnest
            ? <> · thinnest: <b className="ovw-thin">Day {thinnest.index + 1}, {thinnest.filled} of {thinnest.total}</b></>
            : ''}
        </span>
      </div>
      {!hasMatrixPlan ? (
        <StateBlock
          kind="empty"
          size="compact"
          title="Nothing planned yet"
          body="Add a stop and each day shows its meals, fuel, stretch breaks and night."
        />
      ) : freshness === 'stale' ? (
        <>
          <p className="muted small ovw-matrix-stale">
            Stale: your settings changed since the Map tab&apos;s scan, so these numbers would describe the old
            plan. Nothing is shown rather than something wrong.
          </p>
          {onRefreshMatrix && (
            <button type="button" className="link-btn teal ovw-matrix-refresh" onClick={onRefreshMatrix}>
              Refresh on the Map tab →
            </button>
          )}
        </>
      ) : (
        <>
          <div className="mx-wrap">
            <div className="mx-scroll">
              <div className="mx" role="grid" aria-label="Planned parts per day">
                <div className="mx-row is-head" role="row">
                  <span className="mx-th mx-daycol" role="columnheader">Day · route</span>
                  {kinds.map(kind => (
                    <span key={kind.key} className="mx-th" role="columnheader" aria-label={kind.name}>
                      {kind.header}
                    </span>
                  ))}
                  <span className="mx-th mx-th-total" role="columnheader">Filled</span>
                </div>
                {rows.map(({ day, slots }, rowIndex) => {
                  const filled = slots.filter(slot => slot.state === 'filled').length
                  return (
                    <div key={day.index} className={`mx-row${day.index === todayIndex ? ' is-today' : ''}`} role="row">
                      <span className="mx-day mx-daycol" role="rowheader">
                        {(() => {
                          const label = dayPlaceLabel(trip, day.index)
                          const artId = artIdFor(region, `${trip.id}:${day.index}`)
                          const inner = (
                            <>
                              <span className="mx-thumb" aria-hidden="true">
                                <RegionArt
                                  id={artId}
                                  ratio="4:3"
                                  sizes="44px"
                                  fallback={<TripArt region={region} />}
                                  scrim={false}
                                />
                                <span className="mx-thumb-n">{day.index + 1}</span>
                              </span>
                              <span className="mx-place">{overviewPinText(label, 26)}</span>
                              {day.index === todayIndex && <span className="mx-today">Today</span>}
                            </>
                          )
                          return onSelectDay ? (
                            <button type="button" className="mx-daybtn" onClick={() => onSelectDay(day.index)}>
                              {inner}
                            </button>
                          ) : (
                            <span className="mx-daybtn is-static">{inner}</span>
                          )
                        })()}
                      </span>
                      {kinds.map((kind, colIndex) => {
                        const slot = slotFor(slots, kind.key)
                        const state = slot?.state ?? 'none'
                        const meaning = slotMeaning(day.index, kind.name, slot)
                        const actionable = !!slot && state !== 'none' && !!onSelectCell
                        const active = resolvedActive?.row === rowIndex && resolvedActive.col === colIndex
                        const content = (
                          <span className="mx-chip" data-state={state}>
                            {state === 'filled'
                              ? <Check size={16} aria-hidden />
                              : state === 'auto'
                                ? <span className="mx-app" aria-hidden>App</span>
                                : state === 'empty'
                                  ? <span className="mx-bang" aria-hidden>!</span>
                                  : <span className="mx-dash" aria-hidden>–</span>}
                          </span>
                        )
                        return (
                          <span
                            key={kind.key}
                            className="mx-cell"
                            role="gridcell"
                            data-state={state}
                            aria-label={meaning}
                          >
                            {actionable ? (
                              <button
                                ref={element => { cellRefs.current[rowIndex * kinds.length + colIndex] = element }}
                                type="button"
                                className="mx-btn"
                                tabIndex={active ? 0 : -1}
                                aria-label={meaning}
                                onFocus={() => setActiveCell({ row: rowIndex, col: colIndex })}
                                onKeyDown={event => onCellKeyDown(event, rowIndex, colIndex)}
                                onClick={() => onSelectCell(day.index, overviewSlotTarget(slot))}
                              >
                                {content}
                              </button>
                            ) : content}
                          </span>
                        )
                      })}
                      <span
                        className={`mx-total${thinnest?.index === day.index ? ' is-thin' : ''}`}
                        role="gridcell"
                        aria-label={`${filled} of ${slots.length} parts filled`}
                      >
                        <em>{filled}/{slots.length}</em>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="mx-compact" aria-label="Planned parts per day">
            <div className="mx-chead" aria-hidden="true">
              <span>Day</span>
              {kinds.map(kind => <span key={kind.key}>{kind.short}</span>)}
              <span>Filled</span>
            </div>
            {rows.map(({ day, slots }) => {
              const filled = slots.filter(slot => slot.state === 'filled').length
              const body = (
                <>
                  <span className="mx-cday">
                    <span className="mx-thumb is-small" aria-hidden="true">
                      <RegionArt
                        id={artIdFor(region, `${trip.id}:${day.index}`)}
                        ratio="4:3"
                        sizes="32px"
                        fallback={<TripArt region={region} />}
                        scrim={false}
                      />
                      <span className="mx-thumb-n">{day.index + 1}</span>
                    </span>
                    <span className="mx-place">{overviewPinText(dayPlaceLabel(trip, day.index), 40)}</span>
                  </span>
                  {kinds.map(kind => {
                    const slot = slotFor(slots, kind.key)
                    const state = slot?.state ?? 'none'
                    return (
                      <span
                        key={kind.key}
                        className="mx-g"
                        data-state={state}
                        aria-hidden="true"
                      >
                        {state === 'filled'
                          ? <Check size={14} />
                          : state === 'auto'
                            ? <span className="mx-app">App</span>
                            : state === 'empty'
                              ? <span className="mx-bang">!</span>
                              : <span className="mx-dash">–</span>}
                      </span>
                    )
                  })}
                  <span className="mx-ctot">{filled}/{slots.length}</span>
                </>
              )
              return onSelectDay ? (
                <button
                  key={day.index}
                  type="button"
                  className="mx-crow"
                  aria-label={dayStatesLabel(day.index, slots)}
                  onClick={() => onSelectDay(day.index)}
                >
                  {body}
                </button>
              ) : (
                <div key={day.index} className="mx-crow">{body}</div>
              )
            })}
          </div>
          <div className="ovw-matrix-legend">
            <span className="mx-key">
              <span><i className="k-f" aria-hidden="true" />Planned</span>
              <span><i className="k-a" aria-hidden="true" />A break the app added</span>
              <span><i className="k-e" aria-hidden="true" />Missing</span>
              <span><i className="k-n" aria-hidden="true" />Not needed</span>
            </span>
            <span className="mx-tap">Tap a cell to open that day</span>
          </div>
          {freshness === 'unknown' && (
            <p className="muted small ovw-matrix-unverified">
              Unverified: the Map tab hasn&apos;t published a scan this session, so this may predate your latest settings.
            </p>
          )}
        </>
      )}
      {hasMatrixPlan && !hasCorridor && (
        <p className="muted small ovw-matrix-partial">
          Not counted yet: the app has not measured this route, so the fuel and stretch breaks
          are missing here. Open the Map tab once and they join this list.
        </p>
      )}
    </Surface>
  )
}

function labelCommitType(t: string): string {
  const map: Record<string, string> = { 'hotel-checkin': 'Check-in', 'train-departure': 'Train', 'flight-departure': 'Flight', event: 'Event', other: 'Other' }
  return map[t] ?? t
}
