// ============ Trip workspace ============
// Tabs: Overview / Timeline / Map / Suggestions / Budget / Decisions / Share
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Trip, ItineraryStop, Expense, LatLngPoint } from '../data/types'
import { TRANSPORT_MODES, TRAVEL_STYLES } from '../data/types'
import {
  useDb, tripById, userById, currentUser, roleOf, canEdit,
  setStopStatus, addExpense, deleteExpense, restoreExpense, addSuggestion,
  voteSuggestion, addCommentToSuggestion,
  acceptSuggestionIntoTimeline, declineSuggestion, addDecision, voteOnDecision, resolveDecision,
  activityFor, setMemberRole, removeMember, restoreMember, updateTrip, publishItinerary,
} from '../store/store'
import {
  computeHealth, computeTotals, simulateDay, originOf, getAssumptions, legKey, coLocates,
  minutesToHM, hmToMinutes, formatInr, countHotelNights, predecessorOf, nextAfter,
  collectWarnings, FUEL_PRICE_INR_PER_L, isFuelEconomyMode, parseFuelEconomyKmL, isImplausibleFuelEconomy,
  parseFuelPricePerL, isRoundTrip, computeCategoryBias, addMinutesToClock, buildJourney,
} from '../lib/engine'
import type { LegEstimate, ScheduleWarning, Journey } from '../lib/engine'
import { routePath } from '../lib/routing'
import { computeImpact, type ImpactResult } from '../lib/impact'
import { loadDayCollapsed, saveDayCollapsed } from '../lib/uiPrefs'
import { useTimeFormat, formatHM, formatHMRange } from '../lib/timefmt'
import { scrollBehavior } from '../lib/motion'
import { Avatar, Chip, Modal, ConfirmDialog, Field, StatTile, HealthRing, EmptyState, toast, undoToast, useReorder, CopyButton } from '../components/ui'
import { ImpactPreviewPanel } from '../components/ImpactPreview'
import { useSuggestionCache } from '../hooks/useSuggestionCache'
// MapLibre is heavy (~1MB) — load it only when the Map tab is actually opened.
const TripMap = React.lazy(() => import('../components/TripMap').then(m => ({ default: m.TripMap })))
import { StopEditor, type StopFormValues } from '../components/StopEditor'
import { AiDrawer } from '../components/AiDrawer'
import { LocationInput } from '../components/LocationInput'
import { searchNearbyPois, searchNearbyPoisMulti, searchCitiesAlong, corridorAnchors, detourKm, googleEnabled, planJourneyHalts, type NearbyOpts } from '../lib/geocode'
import type { PlaceHit, SegmentHit } from '../lib/geocode'
import { anchorHash, kmFromStartForHit, type HaltPurpose } from '../lib/providers/hits'
import { segmentsFromPlan, assignSegmentHits, annotateSegmentHits, type HaltPlanItem } from '../lib/ridePlan'
import { pointAtKm } from '../lib/geo'
import { fetchDailyWeather, forecastAvailable, wmoInfo } from '../lib/weather'
import type { DayWeather } from '../lib/weather'
import { encodeTripSnapshot, decodeTripSnapshot, snapshotUrl, downloadTripJson } from '../lib/snapshot'
import { duplicateTrip } from '../store/store'

type TabKey = 'overview' | 'timeline' | 'map' | 'suggestions' | 'budget' | 'decisions' | 'share'

const TABS: [TabKey, string][] = [
  ['overview', 'Overview'],
  ['timeline', 'Timeline'],
  ['map', 'Map'],
  ['suggestions', 'Suggestions'],
  ['budget', 'Budget'],
  ['decisions', 'Decisions'],
  ['share', 'Share'],
]

/** URL tab segment → TabKey (F-21): junk falls back to Overview. */
function sanitizeTab(s: string | undefined): TabKey {
  return TABS.some(([k]) => k === s) ? (s as TabKey) : 'overview'
}

export function TripWorkspace({ tripId, initialTab, onNavigate }: { tripId: string; initialTab?: string; onNavigate: (route: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const trip = tripById(tripId)
  const [tab, setTabState] = useState<TabKey>(() => sanitizeTab(initialTab))
  /** F-21: the active tab rides the URL as #/trip/<id>/<tab> (no segment =
      Overview). replaceState, not location.hash, so switching tabs writes no
      extra history entry and doesn't trip App's scroll-reset; browser Back
      still leaves the trip rather than cycling tabs — a tab is a view
      preference, not a navigation step. */
  function setTab(t: TabKey) {
    setTabState(t)
    const seg = location.hash.replace(/^#/, '').split('/').filter(Boolean)
    if (t === 'overview') seg.splice(2)
    else if (seg.length >= 3) seg[2] = t
    else seg.push(t)
    history.replaceState(null, '', `#/${seg.join('/')}`)
  }
  const [aiOpen, setAiOpen] = useState(false)

  const role = me && trip ? roleOf(trip, me.id) : null
  const editable = canEdit(role)

  // Real road distances/durations for the estimate totals, refreshed when the
  // route changes. Only applied for ground modes (OSRM is driving-only); the
  // deterministic haversine engine stays the fallback and powers warnings/impact.
  const legCorrections = useTripCorrections(trip)

  // Pending change: a proposed plan held until the user keeps or discards it.
  const [pending, setPending] = useState<{ proposed: Trip; result: ImpactResult } | null>(null)

  // F-16: a reload or tab close while a proposed change is pending silently
  // discards the preview the user is studying — ask before leaving. (The soft
  // in-app hash-nav guard from the audit is deliberately skipped: intercepting
  // every hashchange in App would need pending state lifted app-wide, and the
  // beforeunload layer already covers the common accident — F5 / tab close.)
  useEffect(() => {
    if (!pending) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [pending])

  // Suggestion cache: persists across tab switches, invalidated by anchor changes.
  const suggestionCache = useSuggestionCache(tripId)

  function scrollToDay(dayIndex: number) {
    const el = document.getElementById(`day-card-${dayIndex}`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight
    if (!isVisible) {
      el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
    }
  }

  if (!trip || !me) {
    return <div className="container loading-block">Trip not found. <button className="btn btn-outline btn-sm" onClick={() => onNavigate('trips')}>Back to my trips</button></div>
  }

  const effective = pending?.proposed ?? trip
  const health = computeHealth(effective)
  const totals = computeTotals(effective, legCorrections)

  function applyChange(mutator: (draft: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) {
    const proposed = structuredClone(trip!) as Trip
    mutator(proposed)
    const result = computeImpact(trip!, proposed, kind, dayIndex)
    setPending({ proposed, result })
  }

  function keepPending() {
    if (!pending || !trip) return
    updateTrip(trip.id, pending.proposed)
    setPending(null)
    toast('Change saved to your plan')
  }

  function removePending() {
    setPending(null)
    toast('Change discarded')
  }

  function moveToAnotherDay() {
    if (!pending || !trip) return
    const proposed = structuredClone(pending.proposed) as Trip
    const day = proposed.days.find(d => d.index === pending.result.dayIndex)
    if (day && day.stops.length) {
      const sortedStops = [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)
      const last = sortedStops[sortedStops.length - 1]
      const nextDay = proposed.days.find(d => d.index === day.index + 1)
      if (nextDay) {
        day.stops = day.stops.filter(s => s.id !== last.id)
        last.orderInDay = nextDay.stops.length + 1
        nextDay.stops.push(last)
        updateTrip(trip.id, proposed)
        setPending(null)
        toast(`Moved “${last.title}” to Day ${day.index + 2}`)
        return
      }
    }
    toast('No later day available to move this stop to.', 'err')
  }

  return (
    <div className="container" style={{ paddingTop: 22 }}>
      {/* ---------- Header ---------- */}
      <div className="trip-head-card">
        <div className="row-between">
          <div style={{ position: 'relative', zIndex: 1 }}>
            <button className="btn btn-sm btn-outline" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.4)' }} onClick={() => onNavigate('trips')}>← All trips</button>
            <h1 style={{ marginTop: 12 }}>{trip.coverEmoji} {trip.name}</h1>
            <p style={{ opacity: .9, marginTop: 6 }}>
              {trip.startLocation} → {trip.destinations.join(' → ')} · {fmtDateRange(trip.startDate, trip.endDate)} · {trip.travellers} travellers · {cap(trip.transportMode)} · {cap(trip.travelStyle)}
            </p>
            <div className="member-stack" style={{ marginTop: 10 }}>
              {(trip.members ?? []).map(m => <Avatar key={m.userId} user={userById(m.userId)} />)}
              <span className="small" style={{ marginLeft: 8, opacity: .85 }}>
                {(trip.members ?? []).length} member{(trip.members ?? []).length !== 1 ? 's' : ''}{role ? ` · you are ${role}` : ''}
              </span>
            </div>
          </div>
          {editable && (
            <button className="btn btn-saffron btn-sm" style={{ position: 'relative', zIndex: 1 }} onClick={() => setTab('share')}>Invite & share</button>
          )}
        </div>
      </div>

      {/* ---------- Tabs ---------- */}
      <div className="tabbar" role="tablist" style={{ marginTop: 20 }}>
        {TABS.map(([key, label]) => {
          const count = key === 'suggestions'
            ? db.suggestions.filter(s => s.tripId === trip.id && s.status === 'open').length
            : key === 'decisions'
              ? db.decisions.filter(d => d.tripId === trip.id && d.status === 'open').length
              : undefined
          return (
            <button key={key} role="tab" aria-selected={tab === key}
              className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {label}{count ? <span className="tab-count">{count}</span> : null}
            </button>
          )
        })}
      </div>

      {pending && (
        <ImpactPreviewPanel
          result={pending.result}
          onKeep={keepPending}
          onMoveDay={moveToAnotherDay}
          onRemove={removePending}
          onScrollToDay={scrollToDay}
        />
      )}

      {tab === 'overview' && <OverviewTab trip={effective} editable={editable} onOpenDecisions={() => setTab('decisions')} health={health} totals={totals} />}
      {tab === 'timeline' && <TimelineTab trip={trip} editable={editable} applyChange={applyChange} legCorrections={legCorrections} suggestionCache={suggestionCache} />}
      {tab === 'map' && (
        <React.Suspense fallback={<div className="container loading-block"><div className="spinner" />Loading map…</div>}>
          <MapTab trip={trip} editable={editable} applyChange={applyChange} suggestionCache={suggestionCache} />
        </React.Suspense>
      )}
      {tab === 'suggestions' && <SuggestionsTab trip={trip} editable={editable} me={me} />}
      {tab === 'budget' && <BudgetTab trip={trip} totals={totals} editable={editable} />}
      {tab === 'decisions' && <DecisionsTab trip={trip} me={me} editable={editable} />}
      {tab === 'share' && <ShareTab trip={trip} me={me} editable={editable} onNavigate={onNavigate} />}

      <AiDrawer trip={trip} open={aiOpen} onOpen={() => setAiOpen(true)} onClose={() => setAiOpen(false)} />
    </div>
  )
}

// ================= Overview =================

function OverviewTab({ trip, editable, onOpenDecisions, health, totals }: {
  trip: Trip
  editable: boolean
  onOpenDecisions: () => void
  health: ReturnType<typeof computeHealth>
  totals: ReturnType<typeof computeTotals>
}) {
  const db = useDb()
  const timeFormat = useTimeFormat()
  const unresolvedDecisions = db.decisions.filter(d => d.tripId === trip.id && d.status === 'open').length
  const nextCommitment = [...trip.fixedCommitments]
    .sort((a, b) => a.dayIndex - b.dayIndex || a.time.localeCompare(b.time))[0]

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <div className="row-between">
            <h3>Trip Health Score</h3>
            <Chip tone={health.band === 'Comfortable' ? 'ok' : health.band === 'Manageable' ? 'teal' : health.band === 'Tight' ? 'saffron' : 'danger'}>
              {health.band}
            </Chip>
          </div>
          <hr className="divider" />
          <div className="health-wrap">
            <HealthRing score={health.score} band={health.band} />
            <div style={{ flex: 1, minWidth: 220 }}>
              {health.warnings.length === 0 ? (
                <p className="muted small">No schedule issues detected. Buffers look healthy — enjoy the yatra! 🎉</p>
              ) : (
                <div className="warn-list">
                  {health.warnings.slice(0, 4).map(w => (
                    <div key={w.code + w.title} className={`warn-item ${w.severity === 'high' ? 'sev-high' : w.severity === 'low' ? 'sev-low' : ''}`}>
                      <span className="warn-icon">{w.severity === 'high' ? '🚨' : w.severity === 'medium' ? '⚠️' : '💡'}</span>
                      <div>
                        <div className="warn-title">{w.title}</div>
                        <div className="warn-fix">✅ Recommended: {w.fix}</div>
                      </div>
                    </div>
                  ))}
                  {health.warnings.length > 4 && <span className="small muted">+{health.warnings.length - 4} more — see Timeline.</span>}
                </div>
              )}
            </div>
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
                <span className="warn-icon">📌</span>
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

      <div>
        <div className="stat-grid" style={{ gridTemplateColumns: '1fr' }}>
          <StatTile label="Total estimated cost" value={formatInr(totals.totalCostInr)} sub={`${formatInr(totals.costPerDayInr)}/day · estimates only`} />
          <StatTile label="Cost per person" value={formatInr(totals.costPerPersonInr)} sub={`vs budget ${formatInr(trip.budgetPerPersonInr)} per head`} />
          <StatTile label="Total travel time" value={minutesToHM(totals.totalTravelMinutes)} sub={`≈${Math.round(totals.totalDistanceKm)} km across the route`} />
          <StatTile label="Stops planned" value={totals.stopCount} sub={`${countHotelNights(trip)} overnight base${countHotelNights(trip) !== 1 ? 's' : ''}`} />
        </div>
        <div className="card" style={{ marginTop: 14, textAlign: 'center' }}>
          <h3>Unresolved decisions</h3>
          <p style={{ fontSize: 34, fontWeight: 800, fontFamily: 'var(--font-display)', margin: '8px 0', color: unresolvedDecisions ? 'var(--warn)' : 'var(--ok)' }}>
            {unresolvedDecisions}
          </p>
          <button className="btn btn-outline btn-sm" onClick={onOpenDecisions}>Open Decisions tab</button>
        </div>
      </div>
    </div>
  )
}

// ================= Timeline =================

/** Compact forecast chip for a single trip day (Timeline day headers). */
function DayWeatherChip({ trip, dayIndex }: { trip: Trip; dayIndex: number }) {
  const [w, setW] = useState<DayWeather | null>(null)
  const date = isoAddDays(trip.startDate, dayIndex)
  useEffect(() => {
    if (!forecastAvailable(trip.startDate)) return
    let cancelled = false
    fetchDailyWeather(
      trip.days.flatMap(d => d.stops)[0]?.lat ?? 10.5,
      trip.days.flatMap(d => d.stops)[0]?.lng ?? 76.5,
      date, 1,
    ).then(res => { if (!cancelled) setW(res[date] ?? null) }).catch(() => {})
    return () => { cancelled = true }
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!w) return null
  const info = wmoInfo(w.code)
  return (
    <span className="weather-chip" title={`${info.label} · ${Math.round(w.tempMinC)}–${Math.round(w.tempMaxC)}°C · ${w.rainChancePct}% rain chance`}>
      {info.icon} {Math.round(w.tempMaxC)}° 💧{w.rainChancePct}%
    </span>
  )
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// ================= Timeline =================

function TimelineTab({ trip, editable, applyChange, legCorrections, suggestionCache }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
  legCorrections?: Record<string, LegEstimate>
  suggestionCache: ReturnType<typeof useSuggestionCache>
}) {
  const [editorState, setEditorState] = useState<
    { mode: 'add'; dayIndex: number } | { mode: 'edit'; stopId: string } | null
  >(null)
  const [moveModalStop, setMoveModalStop] = useState<ItineraryStop | null>(null)

  const days = [...trip.days].sort((a, b) => a.index - b.index)

  function handleSave(v: StopFormValues) {
    if (!editorState) return
    // legFromSource is display-only - never persist it onto the stop
    const { legFromSource: _drop, ...legFields } = v
    if (editorState.mode === 'add') {
      const dayIndex = editorState.dayIndex
      applyChange(draft => {
        const day = draft.days.find(d => d.index === dayIndex)!
        day.stops.push({
          ...(legFields as unknown as ItineraryStop),
          id: 'pending_' + Math.random().toString(36).slice(2),
          orderInDay: day.stops.length + 1,
        })
      }, 'add', dayIndex)
    } else {
      const stopId = editorState.stopId
      applyChange(draft => {
        for (const day of draft.days) {
          const s = day.stops.find(x => x.id === stopId)
          if (s) { Object.assign(s, legFields); break }
        }
      }, 'edit', dayIndexOfStop(trip, stopId))
    }
    setEditorState(null)
  }

  // Deletions go through the impact-preview flow, whose Keep / Remove buttons
  // already act as the confirmation + undo step for this destructive action.
  function handleDelete(stopId: string, dayIndex: number) {
    applyChange(draft => {
      for (const day of draft.days) day.stops = day.stops.filter(s => s.id !== stopId)
    }, 'remove', dayIndex)
  }

  function handleMoveWithinDay(fromIdx: number, toIdx: number, dayIndex: number) {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      const arr = [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)
      arr.forEach((s, i) => { s.orderInDay = i + 1 })
      day.stops = arr
    }, 'reorder', dayIndex)
  }

  /** Cross-day drag: lift a stop out of its day and insert it at `position` of `toDayIndex`. */
  function handleMoveStopInto(stopId: string, fromDayIndex: number, toDayIndex: number, position: number) {
    applyChange(draft => {
      let moved: ItineraryStop | undefined
      for (const d of draft.days) {
        const idx = d.stops.findIndex(s => s.id === stopId)
        if (idx >= 0) {
          [moved] = d.stops.splice(idx, 1)
          d.stops.forEach((s, j) => { s.orderInDay = j + 1 })
          break
        }
      }
      const target = draft.days.find(d => d.index === toDayIndex)
      if (moved && target) {
        const pos = Math.max(0, Math.min(position, target.stops.length))
        moved.orderInDay = pos + 1
        target.stops.splice(pos, 0, moved)
        target.stops.forEach((s, j) => { s.orderInDay = j + 1 })
      }
    }, 'move-day', toDayIndex)
  }

  // warnings grouped by day index — powers the per-day progress-bar colour
  const dayWarnings = useMemo(() => {
    const map: Record<number, ScheduleWarning[]> = {}
    for (const w of collectWarnings(trip)) {
      const m = /^Day (\d+):/.exec(w.title)
      if (m) { const di = Number(m[1]) - 1; (map[di] ??= []).push(w) }
    }
    return map
  }, [trip])

  /** Inline day rename — a lightweight label change, applied directly (no impact preview). */
  function handleRenameDay(dayIndex: number, title: string) {
    updateTrip(trip.id, { days: trip.days.map(d => d.index === dayIndex ? { ...d, title: title.trim() || undefined } : d) })
    toast('Day renamed')
  }

  /** Duplicate this day's stops onto the next day (base-camp style planning). */
  function handleCopyDay(dayIndex: number) {
    applyChange(draft => {
      const src = draft.days.find(d => d.index === dayIndex)
      const dst = draft.days.find(d => d.index === dayIndex + 1)
      if (!src || !dst) return
      const sorted = [...src.stops].sort((a, b) => a.orderInDay - b.orderInDay)
      for (const s of sorted) {
        dst.stops.push({
          ...structuredClone(s),
          id: 'pending_' + Math.random().toString(36).slice(2),
          orderInDay: dst.stops.length + 1,
        })
      }
    }, 'add', dayIndex + 1)
  }

  /** One-click add from the empty-day suggestions (route continuation / nearby POI). */
  function handleAddQuickStop(dayIndex: number, stop: Omit<ItineraryStop, 'id' | 'orderInDay'>) {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      day.stops.push({ ...stop, id: 'pending_' + Math.random().toString(36).slice(2), orderInDay: day.stops.length + 1 })
    }, 'add', dayIndex)
  }

  /** Ride start time for a day — a lightweight plan field, applied directly (like rename). */
  function handleSetDayStart(dayIndex: number, time: string) {
    updateTrip(trip.id, { days: trip.days.map(d => d.index === dayIndex ? { ...d, startTime: time || undefined } : d) })
    toast(time ? `Day ${dayIndex + 1} now starts ${time}` : 'Ride start reset to the default')
  }

  /** Insert a batch of long-ride break halts, each at a user-chosen km point, ordered by
      distance along the route so the arrival clock and map reflect true stop order. Impact
      preview applies the whole-day change. */
  function handleAddPlannedHalts(dayIndex: number, halts: { km: number; stop: Omit<ItineraryStop, 'id' | 'orderInDay'> }[]) {
    if (halts.length === 0) return
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      const j = buildJourney(draft, day) // existing stop → km lookup
      const posOf = (p: { lat: number; lng: number }) => kmFromStartForHit({ latitude: p.lat, longitude: p.lng }, j.points) ?? 0
      const merged = [
        ...day.stops.map(s => ({ km: posOf(s), s: structuredClone(s) })),
        ...halts.map(h => ({ km: h.km, s: { ...h.stop, id: 'pending_' + Math.random().toString(36).slice(2), orderInDay: 0 } })),
      ].sort((a, b) => a.km - b.km)
      day.stops = merged.map((m, i) => ({ ...m.s, orderInDay: i + 1 }))
    }, 'add', dayIndex)
  }

  function handleStatus(stop: ItineraryStop, status: ItineraryStop['status']) {
    // Status flips are lightweight group signals — applied directly.
    setStopStatus(trip.id, status, stop.id)
    toast(`“${stop.title}” marked ${status === 'needs-booking' ? 'needs booking' : status}`)
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div>
          <h2>Day-by-day timeline</h2>
          <p className="muted small">Drag stops to reorder within a day — or drop them onto another day to move them there. On touch devices: press and hold a stop, then drag it. Every change shows its impact before saving.</p>
        </div>
        {editable && (
          <button className="btn btn-primary btn-sm" onClick={() => setEditorState({ mode: 'add', dayIndex: 0 })}>+ Add stop</button>
        )}
      </div>

      {days.map(day => (
        <DaySection key={day.id} day={day} trip={trip} editable={editable} legCorrections={legCorrections} suggestionCache={suggestionCache}
          onAdd={() => setEditorState({ mode: 'add', dayIndex: day.index })}
          onEdit={(sid) => setEditorState({ mode: 'edit', stopId: sid })}
          onDelete={handleDelete}
          onMoveWithinDay={handleMoveWithinDay}
          onMoveBetweenDays={setMoveModalStop}
          onMoveStopIn={handleMoveStopInto}
          onRenameDay={handleRenameDay}
          onCopyDay={handleCopyDay}
          onAddQuickStop={handleAddQuickStop}
          onSetDayStart={handleSetDayStart}
          onAddPlannedHalts={handleAddPlannedHalts}
          warnings={dayWarnings[day.index] ?? []}
          onStatus={handleStatus}
        />
      ))}

      <StopEditor
        open={!!editorState}
        onClose={() => setEditorState(null)}
        initial={initialValues(editorState, trip)}
        resetKey={editorState ? (editorState.mode === 'edit' ? editorState.stopId : `add-${editorState.dayIndex}`) : ''}
        onSave={handleSave}
        dayLabel={editorState?.mode === 'add' ? `Day ${editorState.dayIndex + 1}` : undefined}
        legContext={legContextFor(editorState, trip)}
      />

      <MoveStopModal
        stop={moveModalStop}
        trip={trip}
        onClose={() => setMoveModalStop(null)}
        onMove={(toDay) => {
          if (!moveModalStop) return
          const stopId = moveModalStop.id
          applyChange(draft => {
            let moved: ItineraryStop | undefined
            for (const d of draft.days) {
              const idx = d.stops.findIndex(s => s.id === stopId)
              if (idx >= 0) { [moved] = d.stops.splice(idx, 1); break }
            }
            const target = draft.days.find(d => d.index === toDay)
            if (moved && target) {
              moved.orderInDay = target.stops.length + 1
              target.stops.push(moved)
            }
          }, 'move-day', moveModalStop ? currentDayOf(trip, stopId) : 0)
          setMoveModalStop(null)
        }}
      />
    </div>
  )
}

// ============ Clamp long stop descriptions behind a "Show more" toggle (#3) ============
// Renders text clamped to 2 lines; shows a toggle only when the text actually
// overflows. Detection uses a hidden always-clamped twin, so the toggle stays
// present even while the visible block is expanded (measurement never flips).
function ClampedText({ children, className }: { children: React.ReactNode; className?: string }) {
  const measurerRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const el = measurerRef.current
    if (!el) return
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    check()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(check)
      ro.observe(el)
      return () => ro.disconnect()
    }
  }, [children])

  return (
    <div className="clamp-wrap">
      {/* invisible always-clamped twin: keeps overflow detection independent of expansion */}
      <div ref={measurerRef} aria-hidden="true" className="clamp-measure">{children}</div>
      <div className={`${className ?? ''} ${expanded ? '' : 'clamp-lines'}`}>{children}</div>
      {overflows && (
        <button type="button" className="clamp-toggle" onClick={() => setExpanded(x => !x)} aria-expanded={expanded}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function DaySection({ day, trip, editable, onAdd, onEdit, onDelete, onMoveWithinDay, onMoveBetweenDays, onMoveStopIn, onRenameDay, onCopyDay, onAddQuickStop, onSetDayStart, onAddPlannedHalts, warnings, onStatus, legCorrections, suggestionCache }: {
  day: Trip['days'][number]
  trip: Trip
  editable: boolean
  legCorrections?: Record<string, LegEstimate>
  suggestionCache: ReturnType<typeof useSuggestionCache>
  onAdd: () => void
  onEdit: (stopId: string) => void
  onDelete: (stopId: string, dayIndex: number) => void
  onMoveWithinDay: (from: number, to: number, dayIndex: number) => void
  onMoveBetweenDays: (stop: ItineraryStop) => void
  /** cross-day drag landed on this day: insert the stop at `position` */
  onMoveStopIn: (stopId: string, fromDayIndex: number, toDayIndex: number, position: number) => void
  onRenameDay: (dayIndex: number, title: string) => void
  onCopyDay: (dayIndex: number) => void
  onAddQuickStop: (dayIndex: number, stop: Omit<ItineraryStop, 'id' | 'orderInDay'>) => void
  /** set the day's ride/drive start time (long-ride planner) */
  onSetDayStart: (dayIndex: number, time: string) => void
  /** insert planned break halts, each at a user-chosen km point, ordered by distance */
  onAddPlannedHalts: (dayIndex: number, halts: { km: number; stop: Omit<ItineraryStop, 'id' | 'orderInDay'> }[]) => void
  warnings: ScheduleWarning[]
  onStatus: (stop: ItineraryStop, status: ItineraryStop['status']) => void
}) {
  const sim = simulateDay(day, trip, originOf(trip, day.index), day.index, legCorrections)
  // One unified journey per day — start → halts/visits → destination with an
  // arrival clock — regardless of distance. This is the single travel system.
  const journey = useMemo(() => buildJourney(trip, day, legCorrections), [trip, day, legCorrections])
  const visitCount = journey.points.filter(p => p.kind === 'visit').length
  // A stay day: the journey never leaves its base — no chain, no synthesized
  // destination. Intermediate days of a round trip parked at the destination.
  // The travelling card belongs to the departure day, the return day, real
  // transfers, and any day where the user adds travel manually.
  const isStayDay = journey.points.length <= 1 && journey.distanceKm < 0.5
  const A = getAssumptions(trip)
  const ordered = [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)
  const { dndHandlers, dayDropHandlers, dragging, over, foreignOver, moveUp, moveDown } = useReorder(
    ordered,
    (f, t) => onMoveWithinDay(f, t, day.index),
    {
      dragPayload: (s) => JSON.stringify({ stopId: s.id, fromDay: day.index }),
      onForeignDrop: (payload, toIdx) => {
        try {
          const p = JSON.parse(payload) as { stopId?: string; fromDay?: number }
          if (p.stopId && typeof p.fromDay === 'number' && p.fromDay !== day.index) {
            onMoveStopIn(p.stopId, p.fromDay, day.index, toIdx)
          }
        } catch { /* malformed payload — ignore */ }
      },
    },
  )
  const commitmentsToday = trip.fixedCommitments.filter(fc => fc.dayIndex === day.index)

  // --- Phase 3/4: collapse, rename, day progress, empty-day suggestions ---
  // Collapse state persists across reloads per trip+day (localStorage, not trip
  // data — it's a view preference, not part of the plan). Unknown days default
  // to expanded.
  const [collapsed, setCollapsed] = useState(() => loadDayCollapsed(trip.id, day.index))
  const timeFormat = useTimeFormat()
  function toggleCollapsed() {
    setCollapsed(c => {
      saveDayCollapsed(trip.id, day.index, !c)
      return !c
    })
  }
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(day.title ?? '')
  const [nearby, setNearby] = useState<PlaceHit[]>([])
  const nextAnchor = useMemo(() => nextAfter(trip, day.index), [trip]) // eslint-disable-line react-hooks/exhaustive-deps
  // "Continue to X" only makes sense while X is still ahead of you. The day
  // wakes up where the previous day's JOURNEY ended — when that IS the next
  // anchor (you arrived at the trip's destination on day 1, so every later
  // unplanned day is parked there), the chip would offer a drive to where
  // you already stand. Suppress it; nearby-idea chips are unaffected.
  const alreadyAtNext = useMemo(
    () => !!nextAnchor && coLocates(originOf(trip, day.index), nextAnchor.point),
    [trip, nextAnchor], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // anchor suggestions on where you'd arrive from; only for unplanned days
  useEffect(() => {
    if (!editable || ordered.length > 0) { setNearby([]); return }
    let cancelled = false
    const anchor = predecessorOf(trip, day.index)?.point ?? trip.startLocationCoords
    if (!anchor) return
    searchNearbyPois(anchor.lat, anchor.lng, 10000, 6, {
      includeFuel: trip.transportMode === 'car' || trip.transportMode === 'motorcycle',
      homeCenter: trip.startLocationCoords ?? null,
      categoryBias: computeCategoryBias(trip),
    })
      .then(hits => { if (!cancelled) setNearby(hits.slice(0, 3)) })
      .catch(() => { /* suggestions are best-effort */ })
    return () => { cancelled = true }
  }, [editable, ordered.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // day progress: how much of the realistic window (start–20:00) the plan consumes
  const dayStartHM = day.startTime ?? A.dayStart
  const startMin = hmToMinutes(dayStartHM)
  const windowMin = Math.max(1, hmToMinutes(A.dayEnd) - startMin)
  const used = Math.max(0, Math.min(1, (hmToMinutes(sim.endsAt) - startMin) / windowMin))
  const sev = warnings.some(w => w.severity === 'high') ? 'high' : warnings.some(w => w.severity === 'medium') ? 'medium' : 'ok'

  return (
    <div className="day-section" id={`day-card-${day.index}`}>
      <div className="day-header">
        {/* Stable name + state attribute (UI audit F-09); the collapsible body
            is a fragment of siblings, so there's no single aria-controls id. */}
        <button className="day-collapse" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-label={`Day ${day.index + 1} stops`}>
          {collapsed ? '▸' : '▾'}
        </button>
        <div className="day-badge"><small>DAY</small><b>{day.index + 1}</b></div>
        <div style={{ flex: 1, minWidth: 160 }}>
          {editingTitle ? (
            <input
              autoFocus
              className="input"
              value={titleDraft}
              style={{ maxWidth: 300, marginBottom: 4 }}
              placeholder={`Day ${day.index + 1}`}
              aria-label={`Rename Day ${day.index + 1}`}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={() => { setEditingTitle(false); if (titleDraft.trim() !== (day.title ?? '')) onRenameDay(day.index, titleDraft) }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') { setTitleDraft(day.title ?? ''); setEditingTitle(false) }
              }}
            />
          ) : (
            <h3
              onClick={editable ? () => { setTitleDraft(day.title ?? ''); setEditingTitle(true) } : undefined}
              style={{ cursor: editable ? 'pointer' : 'default' }}
              title={editable ? 'Click to rename this day' : undefined}
            >
              {day.title ?? `Day ${day.index + 1}`}
            </h3>
          )}
          <div className="small muted">
            {isStayDay ? (
              <>
                Based in {journey.startTitle}
                {visitCount > 0 && ` · ${visitCount} visit${visitCount !== 1 ? 's' : ''}`}
              </>
            ) : (
              <>
                {journey.startTitle} → {journey.endTitle}
                {' · '}~{Math.round(journey.distanceKm)} km · drive ~{minutesToHM(journey.driveMinutes)}
                {journey.halts.length > 0 && ` · ${journey.halts.length} halt${journey.halts.length !== 1 ? 's' : ''}`}
                {visitCount > 0 && ` · ${visitCount} visit${visitCount !== 1 ? 's' : ''}`}
                {' · '}start {formatHM(journey.startTime, timeFormat)} → ends ~{formatHM(sim.endsAt, timeFormat)}
              </>
            )}
          </div>
          <div className={`day-progress ${collapsed ? 'compact' : ''}`} title={`${Math.round(used * 100)}% of the ${formatHM(dayStartHM, timeFormat)}–${formatHM(A.dayEnd, timeFormat)} window`}>
            <div className={`day-progress-fill sev-${sev}`} style={{ width: `${Math.round(used * 100)}%` }} />
          </div>
          {!collapsed && <DayWeatherChip trip={trip} dayIndex={day.index} />}
        </div>
        {ordered.filter(s => s.status !== 'rejected').length >= 2 && <DaySpark stops={ordered.filter(s => s.status !== 'rejected')} />}
        {editable && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className="btn btn-outline btn-sm"
              disabled={ordered.length === 0 || day.index + 1 >= trip.days.length}
              onClick={() => onCopyDay(day.index)}
              title={ordered.length ? `Copy these stops to Day ${day.index + 2}` : 'Nothing to copy yet'}
            >⧉ Copy</button>
            <button className="btn btn-outline btn-sm" onClick={onAdd}>+ Add here</button>
          </div>
        )}
      </div>

      {!collapsed && <>
      {commitmentsToday.map(fc => (
        <div key={fc.id} className="warn-item sev-low" style={{ marginBottom: 8 }}>
          <span className="warn-icon">📌</span>
          <div>
            <div className="warn-title">{fc.title}</div>
            <div className="warn-fix">Fixed at {formatHM(fc.time, timeFormat)}{fc.notes ? ` — ${fc.notes}` : ''}</div>
          </div>
        </div>
      ))}

      <TravelPanel trip={trip} day={day} editable={editable} journey={journey} suggestionCache={suggestionCache}
        onSetDayStart={onSetDayStart} onAddPlannedHalts={onAddPlannedHalts} />

      {ordered.length === 0 && (<>
        <EmptyState icon="🌤️" title="Nothing planned yet" body="Add your first stop for this day — or drag one here from another day."
          action={editable ? <button className="btn btn-primary btn-sm" onClick={onAdd}>+ Add stop</button> : undefined} />
        {editable && ((nextAnchor && !alreadyAtNext) || nearby.length > 0) && (
          <div className="day-suggest">
            {nextAnchor && !alreadyAtNext && (
              <button className="chip-btn" onClick={() => onAddQuickStop(day.index, nextWaypointStop(nextAnchor))} title="Add this as a route waypoint">
                ➡ Continue to {nextAnchor.name.replace(/ \((start|end)\)$/, '')}
              </button>
            )}
            {nearby.map(h => (
              <button key={h.name} className="chip-btn" onClick={() => onAddQuickStop(day.index, poiQuickStop(h))} title="Add this nearby idea">
                ＋ {h.name}
              </button>
            ))}
          </div>
        )}
      </>)}

      <div className="tl">
        {ordered.map((s, i) => {
          // Auto anchors (trip start/end, route-continuation waypoints) are pure
          // route endpoints, not activities. The rich travel summary (mode,
          // distance, fuel, departure→ETA, halts) lives in TravelPanel above;
          // here we just anchor the timeline leg with a clean marker.
          const isAnchor = s.auto === true
          if (isAnchor) {
            const cleanName = (s.locationName || s.title).replace(/ \((start|end)\)$/, '')
            // The day's final anchor (when the journey ends at a stored stop,
            // not a synthesized one) reads as the destination with its arrival.
            const isFinal = i !== 0 && journey.points[journey.points.length - 1].stop.id === s.id
            // Stay day: the journey never leaves this place — a plain base
            // marker, not a travelling card (that belongs to the departure
            // day, the return day, and manually planned travel days).
            if (isStayDay) {
              return (
                <div key={s.id} className="tl-row tl-anchor" {...(editable ? dndHandlers(i) : {})}>
                  <div className="tl-gutter" aria-hidden="true" />
                  <div className="travel-endpoint">
                    <span className="travel-anchor-ico">📍</span>
                    <span>Based in {cleanName}</span>
                  </div>
                </div>
              )
            }
            return (
              <div key={s.id} className="tl-row tl-anchor" {...(editable ? dndHandlers(i) : {})}>
                <div className="tl-gutter" aria-hidden="true">
                  <span className="tl-time">{isFinal ? (sim.arrivalTimes[i] ? formatHM(sim.arrivalTimes[i], timeFormat) : '--:--') : (sim.departures[i] ? formatHM(sim.departures[i], timeFormat) : '--:--')}</span>
                </div>
                <div className="travel-endpoint">
                  <span className="travel-anchor-ico">{i === 0 ? '🏁' : isFinal ? '🏁' : '📍'}</span>
                  <span>
                    {i === 0 ? `Start — ${cleanName}` : isFinal ? `Destination — ${cleanName}` : cleanName}
                  </span>
                  {isFinal && <span className="small muted" style={{ marginLeft: 6 }}>arrives ~{sim.arrivalTimes[i] ? formatHM(sim.arrivalTimes[i], timeFormat) : '--:--'}</span>}
                </div>
              </div>
            )
          }
          return (
            <React.Fragment key={s.id}>
              <div
                className="tl-row"
                {...(editable ? dndHandlers(i) : {})}
              >
                <div className="tl-gutter" aria-hidden="true">
                  <span className="tl-time tl-arr">{sim.arrivalTimes[i] ?? '--:--'}</span>
                  <span className="tl-line" />
                  <span className="tl-time tl-dep">{sim.departures[i] ?? '--:--'}</span>
                </div>
                <div
                  className={`stop-card status-${s.status} ${dragging === i ? 'dragging' : ''} ${over === i && dragging !== null && dragging !== i ? 'drag-over' : ''} ${foreignOver === i && dragging === null ? 'foreign-over' : ''}`}
                >
                <div className={`stop-num cat-${s.category}`}>{i + 1}</div>
              <div className="stop-main">
                <div className="stop-toprow">
                  <span className="stop-title">{s.title}</span>
                  <Chip tone={statusTone(s.status)}>{labelStatusText(s.status)}</Chip>
                  <Chip tone="info">{labelCatText(s.category)}</Chip>
                  {s.priority === 'must-do' && <Chip tone="danger">Must do</Chip>}
                  {s.priority === 'optional' && <Chip tone="saffron">Optional</Chip>}
                  {s.weatherSensitive && <Chip tone="info">🌧️ weather-sensitive</Chip>}
                </div>
                <div className="stop-meta">
                  <span>📍 {s.locationName}</span>
                  <span>⏱ {minutesToHM(s.visitMinutes)}</span>
                  {s.openTime && <span>🕒 {formatHMRange(s.openTime, s.closeTime, timeFormat)}</span>}
                  <span>🎫 ₹{s.entryFeeInrPerPerson}/person</span>
                  <span>🚗 ₹{s.transportCostInrTotal} transport</span>
                  {s.departTime && s.arrivalTime && (
                    <span>🕰 dep {formatHM(s.departTime, timeFormat)} · arr {formatHM(s.arrivalTime, timeFormat)}{s.legDistanceKm ? ` · ${s.legDistanceKm.toFixed(0)} km` : ''}</span>
                  )}
                </div>
                {s.description && <ClampedText className="stop-desc">{s.description}</ClampedText>}
                {s.notes && <ClampedText className="stop-desc muted">📝 {s.notes}</ClampedText>}
                {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="small">Source ↗</a>}
              </div>
              {editable && (
                <div className="stop-actions">
                  <div className="move-btns">
                    <button className="move-btn" disabled={i === 0} onClick={() => moveUp(i)} aria-label={`Move ${s.title} up`}>▲</button>
                    <button className="move-btn" disabled={i === ordered.length - 1} onClick={() => moveDown(i)} aria-label={`Move ${s.title} down`}>▼</button>
                  </div>
                  <button className="icon-btn" onClick={() => onEdit(s.id)} aria-label={`Edit ${s.title}`}>✏️</button>
                  {s.status !== 'confirmed'
                    ? <button className="icon-btn" title="Mark confirmed" aria-label={`Mark ${s.title} confirmed`} onClick={() => onStatus(s, 'confirmed')}>✔️</button>
                    : <button className="icon-btn" title="Mark maybe" aria-label={`Mark ${s.title} maybe`} onClick={() => onStatus(s, 'maybe')}>❓</button>}
                  <button className="icon-btn" title="Move to another day" aria-label={`Move ${s.title} to another day`} onClick={() => onMoveBetweenDays(s)}>↔️</button>
                  <button className="icon-btn" onClick={() => onDelete(s.id, day.index)} aria-label={`Delete ${s.title}`}>🗑️</button>
                </div>
              )}
              </div>
            </div>

            {i < ordered.length - 1 && !(ordered[i + 1].auto === true) && (() => {
                const leg = sim.legs[i]
                if (!leg) return null
                return (
                  <div className="tl-legrow" {...(editable ? dayDropHandlers(i + 1) : {})}>
                    <div className="tl-gutter tl-gutter-leg"><span className="tl-line tl-line-leg" /></div>
                    <div className={`travel-leg ${foreignOver === i + 1 && dragging === null ? 'foreign-over' : ''}`}>
                      🚗 ~{leg.distanceKm.toFixed(0)} km · ~{Math.round(leg.durationMinutes)} min from {leg.fromTitle.replace(/ \((start|end)\)$/, '')} · est ₹{Math.round(leg.distanceKm * (A.inrPerKm ?? 8))} ({A.mode})
                    </div>
                  </div>
                )
              })()}
            </React.Fragment>
          )
        })}
        {/* The engine-closed journey: a destination the day doesn't hold as a
            stored stop gets its own endpoint row with the arrival clock. */}
        {(() => {
          const last = journey.points[journey.points.length - 1]
          if (!(last.synthesized && last.kind === 'destination')) return null
          return (
            <>
              {last.legIn && last.legIn.distanceKm >= 0.5 && (
                <div className="tl-legrow">
                  <div className="tl-gutter tl-gutter-leg"><span className="tl-line tl-line-leg" /></div>
                  <div className="travel-leg">
                    🚗 ~{last.legIn.distanceKm.toFixed(0)} km · ~{Math.round(last.legIn.durationMinutes)} min from {last.legIn.fromTitle} · est ₹{Math.round(last.legIn.distanceKm * (A.inrPerKm ?? 8))} ({A.mode})
                  </div>
                </div>
              )}
              <div className="tl-row tl-anchor">
                <div className="tl-gutter" aria-hidden="true">
                  <span className="tl-time tl-arr">{last.arrive ? formatHM(last.arrive, timeFormat) : '--:--'}</span>
                </div>
                <div className="travel-endpoint">
                  <span className="travel-anchor-ico">🏁</span>
                  <span>{journey.direction === 'return' ? `Home — ${last.title}` : `Destination — ${last.title}`}</span>
                  <span className="small muted" style={{ marginLeft: 6 }}>arrives ~{last.arrive ? formatHM(last.arrive, timeFormat) : '--:--'}</span>
                </div>
              </div>
            </>
          )
        })()}
        {ordered.length > 0 && (
          <div className="tl-end" {...(editable ? dayDropHandlers(ordered.length) : {})}>
            {foreignOver === ordered.length && dragging === null && <div className="tl-drop-line">Drop to add here</div>}
          </div>
        )}
      </div>
      </>}
    </div>
  )
}

/** One-click "continue the route" waypoint for an empty day. */
function nextWaypointStop(a: { name: string; point: { lat: number; lng: number } }): Omit<ItineraryStop, 'id' | 'orderInDay'> {
  const name = a.name.replace(/ \((start|end)\)$/, '')
  return {
    title: name, category: 'travel', locationName: name,
    lat: a.point.lat, lng: a.point.lng,
    description: '', notes: 'Route continuation',
    visitMinutes: 0, openTime: '', closeTime: '',
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', sourceUrl: '', status: 'confirmed', auto: true,
  }
}

/** One-click nearby-POI stop for an empty day. */
function poiQuickStop(h: PlaceHit): Omit<ItineraryStop, 'id' | 'orderInDay'> {
  return {
    title: h.name, category: (h.category as ItineraryStop['category']) ?? 'sightseeing', locationName: h.description ?? h.name,
    lat: h.latitude, lng: h.longitude,
    description: h.description ?? '', notes: 'Nearby idea',
    visitMinutes: h.category === 'food' ? 45 : h.category === 'hotel' ? 0 : 60, openTime: '', closeTime: '',
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', sourceUrl: '', status: 'suggested',
  }
}

function modeLabelMode(m: string): string {
  const map: Record<string, string> = {
    car: '🚗 Car', motorcycle: '🏍️ Motorcycle', taxi: '🚕 Taxi', bus: '🚌 Bus',
    train: '🚆 Train', flight: '✈️ Flight', mixed: '🔀 Mixed',
  }
  return map[m] ?? cap(m)
}

/**
 * The one travel panel — every day, any distance, any mode. Shows the day's
 * journey (mode, distance, drive time, fuel), the departure → arrival clocks,
 * planned halts, and lets you add halts manually or from real spots along the
 * route corridor. Replaces the old split where long rides got a completely
 * different "LongRidePanel" with its own ride-style options.
 */
function TravelPanel({ trip, day, editable, journey, onSetDayStart, onAddPlannedHalts, suggestionCache }: {
  trip: Trip
  day: Trip['days'][number]
  editable: boolean
  journey: Journey
  onSetDayStart: (dayIndex: number, time: string) => void
  onAddPlannedHalts: (dayIndex: number, halts: { km: number; stop: Omit<ItineraryStop, 'id' | 'orderInDay'> }[]) => void
  suggestionCache: ReturnType<typeof useSuggestionCache>
}) {
  const A = getAssumptions(trip)
  const timeFormat = useTimeFormat()
  const { cache: sugCache, setHaltCache } = suggestionCache

  // ---- Halt planner ----
  // The plan is user-authored: WHERE along the ride (km) and HOW LONG (minutes),
  // per halt, plus what kind of stop it is. `hit` is the best real place found
  // near that km (empty until 🔎 is pressed); `pin` picks the real spot over a
  // generic break stop pinned at the route km.
  const [plan, setPlan] = useState<HaltPlanDraft[]>([])
  const [draftKm, setDraftKm] = useState(100)
  const [draftMin, setDraftMin] = useState(20)
  const [draftPurpose, setDraftPurpose] = useState<HaltPurpose>('meal')
  const [resolving, setResolving] = useState(false)
  const [searched, setSearched] = useState(false)

  // Hydrate the persisted plan + resolved spots so tab switches don't lose work.
  // Only rehydrates while the plan is empty, so in-flight edits are never
  // clobbered by this component's own cache write coming back around.
  useEffect(() => {
    const cached = sugCache.halts[day.index]
    setPlan(prev => {
      if (prev.length > 0) return prev
      if (!cached) return []
      return (cached.plan ?? []).map((p, i) => ({
        id: `pl-${day.index}-${i}-${p.km}-${p.minutes}`,
        km: p.km, minutes: p.minutes, purpose: p.purpose,
        hit: cached.segments[i]?.hit ?? null,
        // Opt-in: a planned halt sits on the route unless the user explicitly
        // chooses the real place found near it.
        pin: false,
      }))
    })
    if (cached) setSearched(true)
  }, [day, sugCache])

  // No real drive — no travelling card at all. Stay days (parked at the base
  // with no chain) and local days (visits around one place) render nothing
  // here: with no ride on the road there is no drive to clock and no halt to
  // add. The full panel appears the moment the day actually drives — e.g. the
  // user adds a stop in another town via the day's "+ Add stop" or drags one
  // in — which revives the departure clocks, halts and corridor suggestions.
  const hasDrive = journey.distanceKm >= 0.5 || journey.driveMinutes > 0
  if (!hasDrive) return null

  const startMin = hmToMinutes(journey.startTime)
  const isReturn = journey.direction === 'return'
  const fuelPrice = A.fuelPricePerL ?? FUEL_PRICE_INR_PER_L
  const fuelCost = journey.fuelLitres != null ? journey.fuelLitres * fuelPrice : journey.transportCostInr

  // Live schedule preview for the planned (not yet added) halts: each one adds
  // its duration plus the engine's per-stop buffer to the day's end clock.
  const planMinutes = plan.reduce((a, p) => a + p.minutes, 0)
  const planBuffer = plan.length * A.bufferMinutesPerStop
  const arrivalPreview = formatHM(
    addMinutesToClock(startMin, journey.driveMinutes + journey.dwellMinutes + planMinutes + planBuffer),
    timeFormat,
  )

  /** Persist the plan (and its best spots) so it survives tab switches. */
  function commitPlan(next: HaltPlanDraft[]) {
    setPlan(next)
    const sorted = [...next].sort((a, b) => a.km - b.km)
    const segments = segmentsFromPlan(sorted, journey.distanceKm || 0, journey.driveMinutes)
    const hits: SegmentHit[] = segments.map((seg, i) => ({ segment: seg, hit: sorted[i]?.hit ?? null, score: 0 }))
    setHaltCache(day.index, hits, sorted.map(s => ({ km: s.km, minutes: s.minutes, purpose: s.purpose })))
  }

  function addPlanHalt() {
    const total = journey.distanceKm || 0
    const km = Math.round(Math.max(1, Math.min(draftKm || 0, total > 0 ? total : draftKm)))
    const minutes = Math.max(5, Math.min(draftMin || 20, 480))
    if (!Number.isFinite(km) || km <= 0) { toast('Enter a km point along this ride first.', 'err'); return }
    commitPlan([...plan, { id: `pl-${Date.now()}-${plan.length}`, km, minutes, purpose: draftPurpose, hit: null, pin: false }])
    setSearched(false)
  }

  function removePlanHalt(id: string) {
    commitPlan(plan.filter(p => p.id !== id))
  }

  function togglePin(id: string) {
    commitPlan(plan.map(p => (p.id === id ? { ...p, pin: !p.pin } : p)))
  }

  /**
   * Find a real spot near each planned km point (restaurant / fuel / hotel,
   * matched to the halt's purpose) along the day's corridor. Runs only on this
   * explicit action — never on derived-state churn.
   */
  async function resolveSpots() {
    if (plan.length === 0) return
    setResolving(true)
    try {
      const routePts = journey.points.map(p => ({ lat: p.lat, lng: p.lng }))
      const anchors = corridorAnchors(routePts, trip.startLocationCoords, 35000, 8)
      const purposes = [...new Set(plan.map(p => p.purpose))]
      const [hits, cities] = await Promise.all([
        searchNearbyPoisMulti(anchors, 35000, 16, {
          purposes,
          includeFuel: trip.transportMode === 'car' || trip.transportMode === 'motorcycle',
          homeCenter: trip.startLocationCoords ?? null,
        }).catch(() => [] as PlaceHit[]),
        searchCitiesAlong(anchors, 35000, 8).catch(() => [] as PlaceHit[]),
      ])
      const seen = new Set<string>()
      const candidates: PlaceHit[] = []
      for (const h of [...cities, ...hits]) {
        if (!h.name) continue
        const key = h.name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push(h)
      }
      const sorted = [...plan].sort((a, b) => a.km - b.km)
      const segments = segmentsFromPlan(sorted, journey.distanceKm || 0, journey.driveMinutes)
      const assigned = annotateSegmentHits(
        assignSegmentHits(candidates, segments, anchors, { homeCenter: trip.startLocationCoords ?? null }),
        candidates,
      )
      const hitById = new Map<string, PlaceHit | null>()
      sorted.forEach((item, i) => hitById.set(item.id, assigned[i]?.hit ?? null))
      commitPlan(plan.map(item => ({ ...item, hit: hitById.get(item.id) ?? null })))
    } catch {
      toast('Could not find spots for your halts.', 'err')
    } finally {
      setResolving(false)
      setSearched(true)
    }
  }

  /** Turn the planned halts into real day stops (pinned spot, else generic at the route km). */
  function addHaltsToDay() {
    if (plan.length === 0) return
    const genericTitle = (purpose: HaltPurpose) =>
      purpose === 'meal' ? 'Meal break' : purpose === 'fuel' ? 'Fuel stop' : purpose === 'overnight' ? 'Overnight stay' : 'Break — tea & stretch'
    const halts = plan.map(item => {
      const useSpot = item.pin && item.hit
      const pt = useSpot
        ? { lat: item.hit!.latitude, lng: item.hit!.longitude }
        : (pointAtKm(journey.points, item.km) ?? journey.points[0])
      const cat: ItineraryStop['category'] =
        item.purpose === 'meal' ? 'food' : item.purpose === 'fuel' ? 'transport-hub' : item.purpose === 'overnight' ? 'hotel' : 'rest'
      return {
        km: item.km,
        stop: {
          title: useSpot ? item.hit!.name : genericTitle(item.purpose),
          category: cat,
          locationName: useSpot ? (item.hit!.description || item.hit!.name) : 'Ride break en route',
          lat: pt.lat, lng: pt.lng,
          description: useSpot ? item.hit!.description ?? '' : '',
          notes: `Halt at ~${Math.round(item.km)} km (+${item.minutes} min)${useSpot ? ` · ${item.hit!.name}` : ''}`,
          visitMinutes: item.minutes, openTime: '', closeTime: '',
          entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
          priority: 'nice-to-have', sourceUrl: '', status: 'confirmed',
        } as Omit<ItineraryStop, 'id' | 'orderInDay'>,
      }
    })
    onAddPlannedHalts(day.index, halts)
  }

  const title = isReturn
    ? `Return drive · back to ${journey.endTitle}`
    : `Travelling · ${journey.startTitle} → ${journey.endTitle}`

  return (
    <div className="travel-panel">
      <div className="travel-panel-head">
        <div className="travel-panel-title">🛣️ {title}</div>
        <div className="small muted">
          {modeLabelMode(trip.transportMode)} · {journey.distanceKm.toFixed(0)} km · {minutesToHM(journey.driveMinutes)} wheel time
          {journey.halts.length > 0 && ` · ${journey.halts.length} halt${journey.halts.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      <div className="travel-panel-stats">
        <div className="tps-stat"><div className="tps-label">Mode</div><b>{modeLabelMode(trip.transportMode)}</b></div>
        <div className="tps-stat"><div className="tps-label">Distance</div><b>{journey.distanceKm.toFixed(0)} km</b></div>
        <div className="tps-stat"><div className="tps-label">Drive time</div><b>{minutesToHM(journey.driveMinutes)}</b></div>
        <div className="tps-stat">
          <div className="tps-label">{journey.fuelLitres != null ? 'Fuel needed' : 'Est. transport'}</div>
          <b>{journey.fuelLitres != null ? `${journey.fuelLitres.toFixed(1)} L` : formatInr(Math.round(fuelCost))}</b>
        </div>
      </div>

      {journey.fuelLitres != null && (
        <div className="travel-panel-fuel">
          ≈ {journey.fuelLitres.toFixed(1)} L × ₹{fuelPrice}/L = <b>{formatInr(Math.round(fuelCost))}</b>
          {' '}<span className="small muted">{A.fuelPriceIsUserSet ? '(your pump price)' : '(indicative national rate)'}</span>
        </div>
      )}

      <div className="travel-panel-eta">
        {editable ? (
          <label className="tps-dep">
            <span className="tps-label">Departure</span>
            <input type="time" value={journey.startTime} onChange={e => onSetDayStart(day.index, e.target.value)} />
            <span className="time-preview">= {formatHM(journey.startTime, timeFormat)}</span>
          </label>
        ) : (
          <span className="tps-label">Departure {formatHM(journey.startTime, timeFormat)}</span>
        )}
        <span className="tps-arrow">→</span>
        <div className="tps-eta">
          <div className="tps-label">{isReturn ? 'Home by' : 'Arrival'}</div>
          <b>{formatHM(journey.arrivalTime, timeFormat)}</b>
        </div>
        {journey.dwellMinutes > 0 && <div className="small muted">includes {minutesToHM(journey.dwellMinutes)} of stops</div>}
      </div>

      {journey.driveMinutes >= 420 && journey.halts.length === 0 && (
        <div className="warn-item sev-medium" style={{ marginTop: 10 }}>
          <span className="warn-icon">⚠️</span>
          <div>
            <div className="warn-title">~{minutesToHM(journey.driveMinutes)} behind the wheel with no halt</div>
            <div className="warn-fix">Riding more than ~6–7 h in one go is a fatigue risk — add a halt below or split the drive across two days.</div>
          </div>
        </div>
      )}

      {journey.halts.length > 0 && (
        <div className="travel-panel-halts">
          {journey.halts.map(h => (
            <span key={h.id} className="tp-halt-chip">{h.title} · {minutesToHM(h.visitMinutes || 0)}</span>
          ))}
        </div>
      )}

      {editable && (
        <div className="travel-panel-add halt-planner" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div className="small muted">🛑 Halt planner — you pick where along the ride and for how long. Halts sit on the route itself; tick a found spot to detour there instead.</div>
          <div className="halt-planner-inputs">
            <label className="hp-field">
              <span className="tps-label">after</span>
              <input
                type="number" min={1} step={10} value={draftKm}
                onChange={e => setDraftKm(Math.max(1, Number(e.target.value) || 0))}
                aria-label="Halt after how many km" style={{ width: 78 }}
              />
              <span className="tps-label">km</span>
            </label>
            <label className="hp-field">
              <span className="tps-label">for</span>
              <input
                type="number" min={5} max={480} step={5} value={draftMin}
                onChange={e => setDraftMin(Math.max(5, Math.min(480, Number(e.target.value) || 20)))}
                aria-label="Halt duration in minutes" style={{ width: 64 }}
              />
              <span className="tps-label">min</span>
            </label>
            <select className="input" value={draftPurpose} onChange={e => setDraftPurpose(e.target.value as HaltPurpose)} aria-label="Halt type">
              <option value="meal">🍽 Meal</option>
              <option value="stretch">☕ Stretch / rest</option>
              <option value="fuel">⛽ Fuel</option>
              <option value="overnight">🏨 Overnight</option>
            </select>
            <button className="btn btn-outline btn-sm" onClick={addPlanHalt}>+ Add halt</button>
          </div>

          {plan.length > 0 && (
            <>
              <div className="halt-plan-list">
                {plan.map(item => (
                  <HaltPlanRow key={item.id} item={item}
                    onRemove={() => removePlanHalt(item.id)}
                    onTogglePin={() => togglePin(item.id)} />
                ))}
              </div>
              <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="small muted">
                  {plan.length} halt{plan.length !== 1 ? 's' : ''} · +{minutesToHM(planMinutes)} → arrival ≈ <b>{arrivalPreview}</b>
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={resolveSpots} disabled={resolving}>
                    {resolving ? 'Searching the route…' : plan.some(p => p.hit) ? '↻ Re-find real spots' : '🔎 Find real spots'}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={addHaltsToDay}>➕ Add {plan.length} to the day</button>
                </div>
              </div>
              {searched && !plan.some(p => p.hit) && (
                <span className="small muted">
                  No good spots found near your km points — the halts will be added as generic breaks on the route itself.
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** One user-planned halt in the halt planner: km point + duration + purpose,
 *  plus the best real spot found near that km and whether to pin to it. */
interface HaltPlanDraft extends HaltPlanItem {
  id: string
  hit: PlaceHit | null
  pin: boolean
}

const HALT_PURPOSE_TAG: Record<HaltPurpose, string> = {
  meal: '🍽 Meal', stretch: '☕ Break', fuel: '⛽ Fuel', overnight: '🏨 Overnight', rest: '☕ Break', sight: '👀 Stop',
}

/** One planned halt: where along the ride, how long, and the real spot found near it (pinnable). */
function HaltPlanRow({ item, onRemove, onTogglePin }: {
  item: HaltPlanDraft
  onRemove: () => void
  onTogglePin: () => void
}) {
  const h = item.hit
  const usingSpot = item.pin && h
  return (
    <div className="ride-spot halt-plan-row">
      <div className="ride-spot-main">
        <div className="ride-spot-title">
          <span className={`ride-purpose ride-purpose-${item.purpose}`}>{HALT_PURPOSE_TAG[item.purpose]}</span>
          <b>{usingSpot ? h!.name : 'On the route'}</b>
        </div>
        <span className="muted small">
          after ~{Math.round(item.km)} km · {item.minutes} min halt
          {usingSpot && h!.offRouteKm != null ? ` · ~${Math.round(h!.offRouteKm)} km off route` : ''}
        </span>
        {h && (
          <label className="hp-pin muted small">
            <input type="checkbox" checked={item.pin} onChange={onTogglePin} aria-label={`Detour to ${h.name} instead of halting on the route`} />
            <span>detour to {h.name}{h.nearestCity ? ` (near ${h.nearestCity})` : ''} instead of the route point</span>
          </label>
        )}
      </div>
      <div className="ride-spot-actions">
        <button className="btn btn-ghost btn-sm" onClick={onRemove} title="Remove this planned halt"
          aria-label={`Remove the halt planned at ${Math.round(item.km)} km`}>✕</button>
      </div>
    </div>
  )
}

/** Tiny inline SVG of the day's route shape — no map mount, pure geometry. */
function DaySpark({ stops }: { stops: ItineraryStop[] }) {
  // A day with no stops has no shape — bail out before Math.min() on an empty
  // spread turns into ±Infinity and the polyline renders `NaN` coordinates.
  if (stops.length === 0) return null
  const lats = stops.map(s => s.lat)
  const lngs = stops.map(s => s.lng)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const spanLat = Math.max(1e-4, maxLat - minLat)
  const spanLng = Math.max(1e-4, maxLng - minLng)
  const px = (s: ItineraryStop) => 6 + ((s.lng - minLng) / spanLng) * 68
  const py = (s: ItineraryStop) => 38 - ((s.lat - minLat) / spanLat) * 32
  return (
    <svg className="day-spark" viewBox="0 0 80 44" width={80} height={44} aria-hidden="true">
      <polyline
        points={stops.map(s => `${px(s)},${py(s)}`).join(' ')}
        fill="none" stroke="var(--teal)" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round"
      />
      {stops.map((s, i) => (
        <circle key={i} cx={px(s)} cy={py(s)}
          r={i === 0 ? 3.4 : i === stops.length - 1 ? 3 : 2.3}
          fill={i === 0 ? 'var(--saffron)' : 'var(--teal-deep)'} />
      ))}
    </svg>
  )
}

function MoveStopModal({ stop, trip, onClose, onMove }: {
  stop: ItineraryStop | null
  trip: Trip
  onClose: () => void
  onMove: (dayIndex: number) => void
}) {
  return (
    <Modal open={!!stop} onClose={onClose} title={`Move “${stop?.title ?? ''}”`}>
      <p className="muted small" style={{ marginBottom: 14 }}>Pick the day this stop should live on. The impact preview will recalculate.</p>
      <div className="chip-row">
        {trip.days.filter(d => d.stops.every(s => s.id !== stop?.id)).map(d => (
          <Chip key={d.index} tone="info" onClick={() => onMove(d.index)}>
            Day {d.index + 1}{d.title ? ` — ${d.title}` : ''}
          </Chip>
        ))}
      </div>
    </Modal>
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
    return <div className="card"><h3>🌦️ Weather</h3><hr className="divider" /><p className="muted small">Loading forecast…</p></div>
  }
  if (state !== 'ready') return null

  const entries = Object.values(byDate)
  const wetDays = entries.filter(w => w.rainChancePct >= 60).length
  return (
    <div className="card">
      <div className="row-between">
        <h3>🌦️ Weather along the route</h3>
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
              <div className="weather-icon">{info.icon}</div>
              <div className="weather-temp">{Math.round(w.tempMinC)}°–{Math.round(w.tempMaxC)}°</div>
              <div className="small muted">💧{w.rainChancePct}%</div>
            </div>
          )
        })}
      </div>
      {wetDays > 0 && (
        <p className="hint-text" style={{ marginTop: 8 }}>
          ⚠️ High rain chance on {wetDays} day{wetDays > 1 ? 's' : ''} — consider indoor alternatives for weather-sensitive stops (beaches, viewpoints, treks).
        </p>
      )}
    </div>
  )
}

// ================= Map tab =================

/** Wikipedia thumbnail URLs are hotlink-friendly but huge; ask for a small one. */
function smallThumb(url: string): string {
  return url.replace(/\/(\d+)px-/, '/120px-')
}

/** Detour-scope presets for nearby suggestions (km off the route). */
const SCOPE_KM_STEPS = [10, 20, 30, 50, 80, 100]
const SCOPE_STORAGE_KEY = 'yf_nearby_scope_km'

/** Sensible visit durations per suggestion category (tourist pacing). */
function poiVisitMinutes(cat?: string): number {
  switch (cat) {
    case 'food': return 45
    case 'hotel': return 0        // overnight stay — consumes no daylight
    case 'transport-hub': return 20 // petrol-pump pit stop
    case 'museum': case 'temple': case 'nature': case 'beach': return 90
    default: return 60
  }
}

function MapTab({ trip, editable, applyChange, suggestionCache }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
  suggestionCache: ReturnType<typeof useSuggestionCache>
}) {
  const [pois, setPois] = useState<SegmentHit[]>([])
  const timeFormat = useTimeFormat()
  const [loadingPois, setLoadingPois] = useState(false)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  // bump to force a corridor re-search — the only refetch path besides a
  // detour-scope change or a first-ever load (empty cache)
  const [refreshTick, setRefreshTick] = useState(0)
  // detour-scope control — how far off the route suggestions may sit
  const [scopeIdx, setScopeIdx] = useState(() => {
    const saved = Number(localStorage.getItem(SCOPE_STORAGE_KEY))
    const i = SCOPE_KM_STEPS.indexOf(saved)
    return i >= 0 ? i : 1 // default 20 km
  })
  const scopeKm = SCOPE_KM_STEPS[scopeIdx]
  function changeScope(i: number) {
    setScopeIdx(i)
    localStorage.setItem(SCOPE_STORAGE_KEY, String(SCOPE_KM_STEPS[i]))
  }
  // pending "add from map / nearby" — pick a day, then confirm
  const [poiDraft, setPoiDraft] = useState<{ hit: PlaceHit } | null>(null)
  const [pickDay, setPickDay] = useState<number>(0)

  const existingNames = useMemo(() => {
    const names = new Set<string>()
    for (const d of trip.days) for (const s of d.stops) names.add(s.title.toLowerCase())
    return names
  }, [trip])

  // whole-trip wheel distance & time (journey sums) — the plan budget for the
  // fatigue math; OSRM's road total wins when it's available (more accurate).
  const wholeTrip = useMemo(() => {
    let km = 0
    let min = 0
    for (const d of trip.days) {
      const j = buildJourney(trip, d)
      km += j.distanceKm
      min += j.driveMinutes
    }
    return { km, min }
  }, [trip])

  /** Which day's cumulative drive covers a given along-route km (for pick-a-day defaults). */
  function dayForKm(km: number | undefined): number {
    if (km == null) return trip.days[0]?.index ?? 0
    let covered = 0
    for (const d of trip.days) {
      covered += buildJourney(trip, d).distanceKm
      if (km <= covered) return d.index
    }
    return trip.days[trip.days.length - 1]?.index ?? 0
  }

  // search the WHOLE route corridor (start → stops → destination); the home
  // zone around the starting point is excluded inside the engine
  const anchors = useMemo(() => {
    const pts = trip.days
      .flatMap(d => d.stops)
      .filter(s => s.status !== 'rejected')
      .map(s => ({ lat: s.lat, lng: s.lng }))
    return corridorAnchors(pts, trip.startLocationCoords ?? null, scopeKm * 1000)
  }, [trip, scopeKm])

  // OSRM road geometry of the whole route — feeds Google Search-Along-Route
  // (the report's killer feature); the free stack ignores it. TripMap draws
  // the same legs independently, so this is one extra free OSRM call per route.
  const [routeGeometry, setRouteGeometry] = useState<[number, number][] | null>(null)
  const [routeTotalKm, setRouteTotalKm] = useState<number | null>(null)
  // OSRM's road total (when resolved) is the most accurate journey budget for
  // the fatigue math; until then use the journey-summed estimate.
  const planKm = routeTotalKm && routeTotalKm >= 90 ? routeTotalKm : wholeTrip.km
  useEffect(() => {
    let cancelled = false
    const pts = [
      ...(trip.startLocationCoords ? [trip.startLocationCoords] : []),
      ...trip.days.flatMap(d => d.stops).filter(s => s.status !== 'rejected').map(s => ({ lat: s.lat, lng: s.lng })),
    ]
    if (pts.length < 2) { setRouteGeometry(null); setRouteTotalKm(null); return }
    routePath(pts, getAssumptions(trip))
      .then(legs => {
        if (cancelled) return
        setRouteGeometry(legs.flatMap(l => l.geometry))
        // Google's routingSummaries legs are origin→place and place→destination,
        // so the real detour per hit is (leg0 + leg1) − this total.
        setRouteTotalKm(legs.reduce((sum, l) => sum + l.distanceKm, 0))
      })
      .catch(() => { if (!cancelled) { setRouteGeometry(null); setRouteTotalKm(null) } })
    return () => { cancelled = true }
  }, [trip])

  const nearbyOpts: NearbyOpts = useMemo(() => ({
    includeFuel: trip.transportMode === 'car' || trip.transportMode === 'motorcycle',
    homeCenter: trip.startLocationCoords ?? null,
    // fill what the itinerary lacks, demote what it already covers
    categoryBias: computeCategoryBias(trip),
    // Google mode: bias the search along the real road polyline; free mode ignores it
    routeCoords: routeGeometry,
    routeTotalKm,
  }), [trip, routeGeometry, routeTotalKm])

  useEffect(() => {
    if (anchors.length === 0) return
    const cached = suggestionCache.cache.map
    // Persisted results always win: returning to this tab, editing the trip, or
    // OSRM resolving after mount must NOT silently re-run the expensive corridor
    // search. Only ↻ Refresh, a detour-scope change, or an empty cache does.
    if (cached && cached.scopeKm === scopeKm) {
      setPois(cached.segments)
      return
    }
    let cancelled = false
    setLoadingPois(true)
    const hash = anchorHash(anchors)
    planJourneyHalts(anchors, planKm, wholeTrip.min, { ...nearbyOpts, multiDay: trip.days.length > 1 }, scopeKm * 1000)
      .then(plan => {
        if (!cancelled) {
          setPois(plan)
          suggestionCache.setMapCache(plan, hash, scopeKm)
        }
      })
      .catch(() => { /* suggestions are best-effort */ })
      .finally(() => { if (!cancelled) setLoadingPois(false) })
    return () => { cancelled = true }
  }, [anchors, nearbyOpts, scopeKm, planKm, wholeTrip.min, trip.days.length, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  function addPoiToDay(hit: PlaceHit, dayIndex: number) {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      day.stops.push({
        id: 'pending_' + Math.random().toString(36).slice(2),
        title: hit.name,
        category: (hit.category as ItineraryStop['category']) ?? 'sightseeing',
        locationName: hit.description ?? hit.name,
        lat: hit.latitude,
        lng: hit.longitude,
        description: hit.description ?? '',
        notes: hit.haltPurpose ? 'Added from the ride plan' : 'Added from nearby suggestions',
        visitMinutes: poiVisitMinutes(hit.category),
        // reported hours arrive on Google suggestion hits; free hits stay blank
        openTime: hit.openTime ?? '', closeTime: hit.closeTime ?? '',
        entryFeeInrPerPerson: 0,
        transportCostInrTotal: 0,
        priority: 'nice-to-have',
        sourceUrl: '',
        status: 'suggested',
        orderInDay: day.stops.length + 1,
      } as unknown as ItineraryStop)
    }, 'add', dayIndex)
    setAddedIds(prev => new Set(prev).add(hit.id as string))
    toast(`“${hit.name}” added to Day ${dayIndex + 1}`)
  }

  function openAddModal(hit: PlaceHit) {
    setPickDay(dayForKm(hit.cumKm))
    setPoiDraft({ hit })
  }

  const dayOptions = trip.days.map(d => ({ index: d.index }))

  return (
    <div>
      <TripMap trip={trip} nearbyPois={pois.flatMap(p => p.hit ? [p.hit] : [])} onAddNearby={editable ? (hit) => openAddModal(hit) : undefined} />
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row-between">
          <h3 style={{ margin: 0 }}>💡 Nearby ideas</h3>
          <div className="row-between" style={{ gap: 10 }}>
            <span className="small muted">{loadingPois ? 'searching…' : `${pois.filter(p => p.hit).length} suggested stops — spaced for fatigue & anchored on cities`}</span>
            <button
              className="btn btn-outline btn-sm suggestion-refresh-btn"
              title="Refresh suggestions"
              onClick={() => { suggestionCache.clearMap(); setRefreshTick(t => t + 1) }}
              disabled={loadingPois}
            >
              ↻ Refresh
            </button>
          </div>
        </div>
        <p className="hint-text" style={{ margin: '4px 0 6px' }}>
          Live data from {googleEnabled() ? 'Google Places' : 'OpenStreetMap, Wikipedia & Mappls'}: lunch ~ every 300 km, stretch & fuel breaks in between, and for long trips an overnight stop in a key city at the end of each day’s drive. Never around your starting point.
        </p>
        <div className="row-between" style={{ gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 230 }}>
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>Detour scope</span>
            <input
              type="range"
              min={0}
              max={SCOPE_KM_STEPS.length - 1}
              step={1}
              value={scopeIdx}
              onChange={e => changeScope(Number(e.target.value))}
              style={{ flex: 1 }}
              aria-label="How far from the route to search suggestions"
            />
            <b style={{ whiteSpace: 'nowrap', minWidth: 46, textAlign: 'right' }}>{scopeKm} km</b>
          </label>
        </div>
        {!loadingPois && pois.length === 0 && (
          <p className="muted small">Not enough driving distance yet for a fatigue plan — add a longer route (90+ km) in the Timeline and segmented stop suggestions will appear here.</p>
        )}
        <div className="poi-plan-list">
          {pois.map(sh => {
            const hit = sh.hit
            if (!hit) {
              return (
                <div key={`gap-${sh.segment.index}`} className="poi-plan-row poi-plan-gap">
                  <span className={`ride-purpose ride-purpose-${sh.segment.purpose} ride-purpose-muted`}>{sh.segment.label}</span>
                  <span className="muted small">no good match around ~{sh.segment.targetKm.toFixed(0)} km — add a stop on the Timeline and it will pin itself here.</span>
                </div>
              )
            }
            const added = addedIds.has(hit.id as string) || existingNames.has(hit.name.toLowerCase())
            const offRoute = detourKm(hit, anchors)
            return (
              <div key={hit.id} className="poi-plan-row">
                <div className="ride-spot-title">
                  <span className={`ride-purpose ride-purpose-${sh.segment.purpose}`}>{sh.segment.label}</span>
                  {hit.thumb && <img className="poi-thumb" src={smallThumb(hit.thumb)} alt="" loading="lazy" />}
                  <b>{hit.name}</b>
                </div>
                <div className="poi-desc small muted">
                  ~{hit.cumKm ?? sh.segment.targetKm.toFixed(0)} km into the trip · ≈{sh.segment.kmFromPrev.toFixed(0)} km / {minutesToHM(sh.segment.minutesFromPrev)} since the last stop
                  {hit.nearestCity ? ` · near ${hit.nearestCity}` : ''}
                  {' · '}{offRoute == null ? 'on route' : `~${Math.round(offRoute * 10) / 10} km off route`}
                </div>
                {hit.description && <div className="poi-desc small muted">{hit.description}</div>}
                {(hit.openTime || hit.closeTime) && (
                  <div className="poi-desc small muted">🕘 {formatHMRange(hit.openTime, hit.closeTime, timeFormat)} (reported)</div>
                )}
                <div>
                  {editable && (
                    added
                      ? <span className="chip chip-teal">✓ Added</span>
                      : <button className="btn btn-primary btn-sm" onClick={() => openAddModal(hit)}>+ Add</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* pick-a-day modal for adding a suggested POI — explicit confirm */}
      <Modal open={!!poiDraft} onClose={() => setPoiDraft(null)} title={`Add “${poiDraft?.hit.name ?? ''}”`}>
        {poiDraft && (
          <div>
            {poiDraft.hit.description && <p className="small muted" style={{ marginTop: 0 }}>{poiDraft.hit.description}</p>}
            <Field label="Add to which day?">
              <select
                className="select"
                value={pickDay}
                onChange={e => setPickDay(Number(e.target.value))}
              >
                {dayOptions.map(d => <option key={d.index} value={d.index}>Day {d.index + 1}</option>)}
              </select>
            </Field>
            <p className="hint-text">You can fine-tune duration, fees and timings in the Timeline afterwards.</p>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-outline" onClick={() => setPoiDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { addPoiToDay(poiDraft.hit, pickDay); setPoiDraft(null) }}>
                Add to timeline
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ================= Suggestions tab =================

function SuggestionsTab({ trip, editable, me }: {
  trip: Trip
  editable: boolean
  me: NonNullable<ReturnType<typeof currentUser>>
}) {
  const db = useDb()
  const suggestions = db.suggestions.filter(s => s.tripId === trip.id).sort((a, b) => b.createdAt - a.createdAt)
  const memberCount = (trip.members ?? []).length
  const [form, setForm] = useState({ title: '', locationName: '', description: '', visitMinutes: 60, entryFee: 0, transportCost: 200 })
  const [sugCoords, setSugCoords] = useState<{ lat?: number; lng?: number }>({})

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { toast('Give your suggestion a name.', 'err'); return }
    addSuggestionLocal()
  }

  function addSuggestionLocal() {
    addSuggestion(trip.id, {
      dayIndex: 0, proposedBy: me.id, title: form.title.trim(),
      category: 'sightseeing', locationName: form.locationName || 'To be decided',
      lat: sugCoords.lat ?? 10.0889, lng: sugCoords.lng ?? 77.0595, description: form.description,
      visitMinutes: form.visitMinutes, estimatedEntryFeeInr: form.entryFee,
      estimatedTransportInr: form.transportCost,
    })
    setForm(f => ({ ...f, title: '', description: '' }))
    toast('Suggestion shared with the group!')
  }

  return (
    <div className="two-col">
      <div>
        {suggestions.length === 0 && (
          <EmptyState icon="💡" title="No suggestions yet" body="Group members can propose stops; everyone votes and comments." />
        )}
        {suggestions.map(sg => {
          const ups = sg.votes.filter(v => v.value === 1).length
          const downs = sg.votes.length - ups
          const myVote = sg.votes.find(v => v.userId === me.id)?.value
          const consensusPct = memberCount ? Math.round((ups / memberCount) * 100) : 0
          const author = userById(sg.proposedBy)
          return (
            <div key={sg.id} className="card" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14, marginBottom: 14 }}>
              <div className="vote-col">
                <button className={`vote-btn ${myVote === 1 ? 'on' : ''}`} onClick={() => voteSuggestion(trip.id, sg.id, me.id, 1)} aria-label="Upvote">▲</button>
                <span className="vote-count">{ups - downs}</span>
                <button className={`vote-btn ${myVote === -1 ? 'on' : ''}`} onClick={() => voteSuggestion(trip.id, sg.id, me.id, -1)} aria-label="Downvote">▼</button>
              </div>
              <div>
                <div className="row-between">
                  <h3>{sg.title}</h3>
                  <Chip tone={sg.status === 'accepted' ? 'ok' : sg.status === 'declined' ? 'danger' : 'teal'}>{sg.status}</Chip>
                </div>
                <div className="creator-line" style={{ margin: '5px 0' }}>
                  <Avatar user={author} /> {author?.profile.name ?? 'Traveller'} suggested for Day {sg.dayIndex + 1}
                </div>
                {sg.description && <p className="small muted">{sg.description}</p>}
                <div className="stop-meta" style={{ marginTop: 7 }}>
                  <span>📍 {sg.locationName}</span>
                  <span>⏱ {minutesToHM(sg.visitMinutes)}</span>
                  <span>🎫 ₹{sg.estimatedEntryFeeInr}/person</span>
                  <span>🚗 ₹{sg.estimatedTransportInr} transport</span>
                </div>
                <div style={{ marginTop: 9 }}>
                  <div className="small muted" style={{ marginBottom: 3 }}>Consensus: {consensusPct}% of members upvoted</div>
                  <div className="consensus-bar">
                    <div style={{ width: `${consensusPct}%`, background: consensusPct >= 60 ? 'var(--ok)' : consensusPct >= 35 ? 'var(--saffron)' : 'var(--line)' }} />
                  </div>
                </div>

                {editable && sg.status === 'open' && (
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 11 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => { acceptSuggestionIntoTimeline(trip.id, sg.id); toast('Added to timeline') }}>Add to timeline</button>
                    <button className="btn btn-danger btn-sm" onClick={() => { declineSuggestion(trip.id, sg.id); toast('Suggestion declined') }}>Decline</button>
                  </div>
                )}

                {sg.comments.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {sg.comments.map(c => (
                      <div key={c.id} className="comment">
                        <Avatar user={userById(c.authorId)} />
                        <div className="comment-body">
                          <span className="comment-author">{userById(c.authorId)?.profile.name}</span>
                          <span className="comment-time">{timeAgo(c.createdAt)}</span>
                          <div>{c.text}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <CommentForm onSubmit={(text) => addCommentToSuggestion(trip.id, sg.id, me.id, text)} />
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <form className="card" onSubmit={submit}>
          <h3>Propose a stop</h3>
          <p className="hint-text" style={{ margin: '6px 0 12px' }}>Others can vote and comment; editors can accept it into the timeline.</p>
          <Field label="Idea"><input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Pothamedu viewpoint" /></Field>
          <Field label="Area"><LocationInput value={form.locationName} onChange={v => setForm(f => ({ ...f, locationName: v }))} onPick={p => setSugCoords({ lat: p.latitude, lng: p.longitude })} placeholder="Search, e.g. Munnar" /></Field>
          <div className="form-row">
            <Field label="Visit minutes"><input type="number" className="input" min={15} step={5} value={form.visitMinutes} onChange={e => setForm(f => ({ ...f, visitMinutes: Number(e.target.value) }))} /></Field>
            <Field label="Entry fee ₹/person"><input type="number" className="input" min={0} value={form.entryFee} onChange={e => setForm(f => ({ ...f, entryFee: Number(e.target.value) }))} /></Field>
          </div>
          <Field label="Why it’s worth it"><textarea className="textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>
          <button className="btn btn-primary" style={{ width: '100%' }}>Share suggestion</button>
        </form>
      </div>
    </div>
  )
}

function CommentForm({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <form style={{ display: 'flex', gap: 7, marginTop: 10 }} onSubmit={e => { e.preventDefault(); if (text.trim()) { onSubmit(text.trim()); setText('') } }}>
      <input className="input" placeholder="Add a comment…" aria-label="Add a comment" value={text} onChange={e => setText(e.target.value)} />
      <button className="btn btn-sm btn-outline">Post</button>
    </form>
  )
}

// ================= Budget tab =================

const CAT_COLORS: Record<string, string> = {
  transport: '#149A90', accommodation: '#0B2545', food: '#F59E2D',
  activities: '#45566E', 'entry-fees': '#2E8B57', 'tolls-parking': '#8291A6',
  'local-travel': '#B47207', 'emergency-buffer': '#C93B3B',
}

function BudgetTab({ trip, totals, editable }: { trip: Trip; totals: ReturnType<typeof computeTotals>; editable: boolean }) {
  const [form, setForm] = useState({ label: '', amount: 0, category: 'food', perPerson: false, optional: false, attachStop: '' })
  const budgetTotal = trip.budgetPerPersonInr * trip.travellers
  const pctUsed = Math.min(150, Math.round((totals.totalCostInr / Math.max(1, budgetTotal)) * 100))
  const cats = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1])
  const maxCatVal = cats.length ? cats[0][1] : 1
  const A = getAssumptions(trip)

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <h3>Where the money goes</h3>
          <p className="hint-text" style={{ margin: '4px 0 14px' }}>
            {A.kmPerLiter
              ? <>All figures are estimates in INR. Transport is fuel-based: route distance{isRoundTrip(trip) ? ' (incl. return drive)' : ''} ≈{Math.round(totals.totalDistanceKm)} km ÷ {A.kmPerLiter} km/L ≈ <b>{Math.round(totals.totalDistanceKm / A.kmPerLiter)} L</b> of fuel × ₹{A.fuelPricePerL}/L ({A.fuelPriceIsUserSet ? 'your local pump price' : 'indicative petrol price — actual consumption varies'}).</>
              : <>All figures are estimates in INR. Transport is derived from route distance × ₹{A.inrPerKm}/km for {trip.transportMode}.</>}
          </p>
          <div className="budget-bars">
            {cats.map(([c, v]) => (
              <div key={c} className="budget-bar-row">
                <span>{labelCat(c)}</span>
                <div className="budget-bar-track">
                  <div className="budget-bar-fill" style={{ width: `${(v / maxCatVal) * 100}%`, background: CAT_COLORS[c] ?? '#45566E' }} />
                </div>
                <b>{formatInr(v)}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Essential vs optional</h3>
          <hr className="divider" />
          <div className="budget-bars">
            <div className="budget-bar-row">
              <span>Essential</span>
              <div className="budget-bar-track"><div className="budget-bar-fill" style={{ width: `${(totals.essentialInr / Math.max(1, totals.totalCostInr)) * 100}%`, background: '#149A90' }} /></div>
              <b>{formatInr(totals.essentialInr)}</b>
            </div>
            <div className="budget-bar-row">
              <span>Optional</span>
              <div className="budget-bar-track"><div className="budget-bar-fill" style={{ width: `${(totals.optionalInr / Math.max(1, totals.totalCostInr)) * 100}%`, background: '#F59E2D' }} /></div>
              <b>{formatInr(totals.optionalInr)}</b>
            </div>
          </div>
          <p className="hint-text" style={{ marginTop: 10 }}>Optional includes buffers & shopping that you can trim to save.</p>
        </div>

        <div className="card">
          <h3>Expense lines</h3>
          <hr className="divider" />
          {trip.expenses.length === 0 ? <p className="muted small">No expense lines yet.</p> : (
            <table className="compare-table">
              <thead><tr><th>Item</th><th>Category</th><th className="num">Amount</th><th /></tr></thead>
              <tbody>
                {trip.expenses.map(e => (
                  <tr key={e.id}>
                    <td>{e.label}{e.perPerson && <span className="chip chip-info" style={{ marginLeft: 6 }}>per person</span>}{e.optional && <span className="chip chip-saffron" style={{ marginLeft: 6 }}>optional</span>}</td>
                    <td><Chip tone="info">{labelCat(e.category)}</Chip></td>
                    <td className="num">{formatInr(e.amountInr * (e.perPerson ? trip.travellers : 1))}</td>
                    <td>{editable && (
                      <button className="icon-btn" aria-label="Delete expense" onClick={() => {
                        const idx = trip.expenses.findIndex(x => x.id === e.id)
                        deleteExpense(trip.id, e.id)
                        undoToast(`Removed “${e.label}”`, () => {
                          restoreExpense(trip.id, e, idx)
                          toast(`Restored “${e.label}”`)
                        })
                      }}>🗑️</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {editable && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 14 }}>+ Add expense line</summary>
              <div style={{ marginTop: 12 }}>
                <Field label="Label"><input className="input" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Kayaking session" /></Field>
                <div className="form-row">
                  <Field label="Amount (₹)"><input type="number" min={0} className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))} /></Field>
                  <Field label="Category">
                    <select className="select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                      {['transport', 'accommodation', 'food', 'activities', 'entry-fees', 'tolls-parking', 'local-travel', 'emergency-buffer'].map(c => <option key={c} value={c}>{labelCat(c)}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="chip-row" style={{ margin: '4px 0 12px' }}>
                  <Chip onClick={() => setForm(f => ({ ...f, perPerson: !f.perPerson }))} active={form.perPerson}>Per person</Chip>
                  <Chip onClick={() => setForm(f => ({ ...f, optional: !f.optional }))} active={form.optional}>Optional</Chip>
                </div>
                <Field label="Attach to stop (optional)">
                  <select className="select" value={form.attachStop} onChange={e => setForm(f => ({ ...f, attachStop: e.target.value }))}>
                    <option value="">— none —</option>
                    {trip.days.flatMap(d => d.stops.map(s => <option key={s.id} value={s.id}>{`Day ${d.index + 1}: ${s.title}`}</option>))}
                  </select>
                </Field>
                <button className="btn btn-primary btn-sm" onClick={() => {
                  if (!form.label.trim() || !form.amount) { toast('Enter a label and an amount.', 'err'); return }
                  addExpense(trip.id, {
                    label: form.label.trim(),
                    category: form.category as Expense['category'],
                    amountInr: form.amount,
                    perPerson: form.perPerson,
                    optional: form.optional,
                    stopId: form.attachStop || undefined,
                  })
                  setForm({ label: '', amount: 0, category: 'food', perPerson: false, optional: false, attachStop: '' })
                  toast('Expense added')
                }}>Save expense</button>
              </div>
            </details>
          )}
        </div>
      </div>

      <div>
        <div className="stat-grid" style={{ gridTemplateColumns: '1fr' }}>
          <StatTile label="Total estimated" value={formatInr(totals.totalCostInr)} />
          <StatTile label="Per person" value={formatInr(totals.costPerPersonInr)} sub={`Budget: ${formatInr(trip.budgetPerPersonInr)}/head`} />
          <StatTile label="Per day" value={formatInr(totals.costPerDayInr)} />
          <div className="stat-tile">
            <div className="stat-label">Budget usage</div>
            <div className="stat-value">{pctUsed}%</div>
            <div className="budget-bar-track" style={{ marginTop: 8 }}>
              <div className="budget-bar-fill" style={{ width: `${Math.min(100, pctUsed)}%`, background: pctUsed > 100 ? 'var(--danger)' : pctUsed > 85 ? 'var(--saffron)' : 'var(--teal)' }} />
            </div>
            {pctUsed > 100 && <div className="stat-sub" style={{ color: 'var(--danger)' }}>Over group budget — trim optional lines.</div>}
          </div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <h3>Plan snapshot</h3>
          <p className="hint-text" style={{ margin: '6px 0 10px' }}>The numbers behind this estimate right now.</p>
          <table className="compare-table">
            <thead><tr><th>Metric</th><th className="num">Value</th></tr></thead>
            <tbody>
              <tr><td>Total cost</td><td className="num">{formatInr(totals.totalCostInr)}</td></tr>
              <tr><td>Essential cost</td><td className="num">{formatInr(totals.essentialInr)}</td></tr>
              <tr><td>Optional cost</td><td className="num">{formatInr(totals.optionalInr)}</td></tr>
              <tr><td>Total travel time</td><td className="num">{minutesToHM(totals.totalTravelMinutes)}</td></tr>
              <tr><td>Active stops</td><td className="num">{totals.stopCount}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ================= Decisions tab =================

function DecisionsTab({ trip, me, editable }: { trip: Trip; me: { id: string }; editable: boolean }) {
  const db = useDb()
  const decisions = db.decisions.filter(d => d.tripId === trip.id).sort((a, b) => b.createdAt - a.createdAt)
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState('')

  function create(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) { toast('Write the question first.', 'err'); return }
    const list = opts.split('\n').map(o => o.trim()).filter(Boolean)
    if (list.length < 2) { toast('Give at least two options (one per line).', 'err'); return }
    addDecision(trip.id, {
      question: q.trim(),
      options: list.map(l => ({ id: `opt_${Math.random().toString(36).slice(2, 8)}`, label: l })),
    })
    setQ(''); setOpts('')
    toast('Decision posted for the group')
  }

  return (
    <div className="two-col">
      <div>
        {decisions.length === 0 && (
          <EmptyState icon="⚖️" title="No decisions tracked"
            body='Raise questions like "houseboat menu — veg or mixed?" so nothing gets lost in a chaotic group chat.' />
        )}
        {decisions.map(d => {
          const tally = d.options.map(o => Object.values(d.votesByUserId).filter(v => v === o.id).length)
          return (
            <div key={d.id} className="card" style={{ marginBottom: 14 }}>
              <div className="row-between">
                <h3>{d.question}</h3>
                <Chip tone={d.status === 'open' ? 'saffron' : 'ok'}>{d.status}</Chip>
              </div>
              {d.context && <p className="small muted" style={{ margin: '5px 0 10px' }}>{d.context}</p>}
              <div style={{ margin: '8px 0' }}>
                {d.options.map((o, i) => {
                  const votes = tally[i]
                  const mine = d.votesByUserId[me.id] === o.id
                  return (
                    <div key={o.id} className="decision-option-row">
                      <button className={`vote-btn ${mine ? 'on' : ''}`} disabled={d.status === 'resolved'}
                        onClick={() => voteOnDecision(d.id, o.id)} aria-label={`Vote for ${o.label}`}>▲</button>
                      <span style={{ flex: 1 }}>{o.label}{o.costImpactInr ? <span className="muted small"> · {o.costImpactInr > 0 ? '+' : ''}{formatInr(o.costImpactInr)}</span> : null}</span>
                      {votes > 0 && <span className="chip chip-info">{votes} vote{votes !== 1 ? 's' : ''}</span>}
                      {d.status === 'resolved' && d.resolvedOptionId === o.id && <Chip tone="ok">Chosen</Chip>}
                    </div>
                  )
                })}
              </div>
              {editable && d.status === 'open' && (
                <div className="resolve-btns">
                  {d.options.map(o => (
                    <button key={o.id} className="btn btn-outline btn-sm" onClick={() => { resolveDecision(d.id, o.id); toast('Decision resolved') }}>
                      Resolve: {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <div className="card">
          <h3>Activity feed</h3>
          <hr className="divider" />
          {activityFor(trip.id).slice(0, 20).map(a => (
            <div key={a.id} className="feed-item">
              <Avatar user={userById(a.actorId)} />
              <span><b>{userById(a.actorId)?.profile.name}</b> {a.verb}{a.target ? ` · ${a.target}` : ''}</span>
              <span className="feed-time">{timeAgo(a.at)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <form className="card" onSubmit={create}>
          <h3>Raise a decision</h3>
          <p className="hint-text" style={{ margin: '6px 0 12px' }}>Turn endless group-chat debates into one clear vote.</p>
          <Field label="Question"><input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Beach shack lunch or café?" /></Field>
          <Field label="Options (one per line)" hint="At least two"><textarea className="textarea" value={opts} onChange={e => setOpts(e.target.value)} placeholder={'Option A\nOption B'} /></Field>
          <button className="btn btn-primary" style={{ width: '100%' }}>Post decision</button>
        </form>
      </div>
    </div>
  )
}

// ================= Snapshot (export / import / URL share) =================

function SnapshotCard({ trip, me, onNavigate }: {
  trip: Trip
  me: { id: string }
  onNavigate: (r: string) => void
}) {
  const [link, setLink] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function makeLink() {
    const payload = await encodeTripSnapshot(trip)
    const url = snapshotUrl(trip, payload)
    setLink(url)
    navigator.clipboard?.writeText(url).catch(() => {})
    toast('Snapshot link copied — anyone can open it, no account needed')
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const imported = JSON.parse(await file.text()) as Trip
      if (!imported || !Array.isArray(imported.days)) throw new Error('bad shape')
      duplicateTrip(imported, me!.id)
      toast(`Imported “${imported.name}” into your trips`)
      onNavigate('/trips')
    } catch {
      toast('That file is not a valid YatraFlow trip export', 'err')
    }
    e.target.value = ''
  }

  return (
    <div className="card">
      <h3>Export & snapshot sharing</h3>
      <p className="hint-text" style={{ margin: '6px 0 12px' }}>
        Take the whole plan anywhere — no server stores it. Snapshot links embed the trip in the URL itself.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-outline btn-sm" onClick={() => downloadTripJson(trip)}>⬇️ Download JSON</button>
        <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>⬆️ Import JSON</button>
        <button className="btn btn-teal btn-sm" onClick={makeLink}>🔗 Create snapshot link</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
      </div>
      {link && (
        <div className="share-link-box" style={{ marginTop: 10 }}>
          <code style={{ wordBreak: 'break-all' }}>{link}</code>
          <CopyButton text={link} label="Copy" />
        </div>
      )}
    </div>
  )
}

// ================= Share tab =================

function ShareTab({ trip, me, editable, onNavigate }: {
  trip: Trip
  me: { id: string; email: string }
  editable: boolean
  onNavigate: (route: string) => void
}) {
  const db = useDb()
  const inviteLink = `${location.origin}${location.pathname}#/invite/${trip.id}`
  const pub = db.published.find(p => p.tripId === trip.id)
  const pubLink = pub ? `${location.origin}${location.pathname}#/pub/${pub.id}` : ''
  const isOwner = (trip.members ?? []).some(m => m.userId === me.id && m.role === 'owner')
  const [pendingRemove, setPendingRemove] = useState<NonNullable<Trip['members']>[number] | null>(null)

  function confirmRemoveMember() {
    if (!pendingRemove) return
    removeMember(trip.id, pendingRemove.userId)
    undoToast(`${userById(pendingRemove.userId)?.profile.name ?? 'Member'} removed`, () => {
      restoreMember(trip.id, pendingRemove)
      toast('Member restored')
    })
  }

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <h3>Invite collaborators</h3>
          <p className="hint-text" style={{ margin: '6px 0 12px' }}>Anyone with this link joins as an editor after logging in.</p>
          <div className="share-link-box"><code>{inviteLink}</code><CopyButton text={inviteLink} /></div>
          <hr className="divider" />
          <h3>Members & roles</h3>
          <div style={{ marginTop: 10 }}>
            {(trip.members ?? []).map(m => {
              const u = userById(m.userId)
              return (
                <div key={m.userId} className="feed-item" style={{ alignItems: 'center' }}>
                  <Avatar user={u} size="lg" />
                  <div style={{ flex: 1 }}>
                    <b>{u?.profile.name ?? 'Traveller'}</b> <span className="muted small">{u?.email}</span>
                    <div className="small muted">Joined {timeAgo(m.joinedAt)}</div>
                  </div>
                  {isOwner && m.role !== 'owner' ? (
                    <select className="role-select" value={m.role} onChange={e => setMemberRole(trip.id, m.userId, e.target.value as never)}
                      aria-label={`Role for ${u?.profile.name}`}>
                      {['editor', 'commenter', 'viewer'].map(r => <option key={r}>{r}</option>)}
                    </select>
                  ) : (
                    <Chip tone={m.role === 'owner' ? 'teal' : 'info'}>{m.role}</Chip>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <h3>Publish as public itinerary</h3>
          <p className="hint-text" style={{ margin: '6px 0 12px' }}>
            Creators can list this trip on Explore. Day 1 is the free preview; later days sit behind a premium placeholder (no real payments in this MVP).
          </p>
          {!pub ? (
            <button className="btn btn-saffron" disabled={!isOwner}
              onClick={() => {
                publishItinerary({
                  tripId: trip.id, creatorId: me.id, title: trip.name,
                  tagline: `${trip.days.length}-day ${trip.travelStyle} trip through ${trip.destinations.join(', ')}.`,
                  routeSummary: [trip.startLocation, ...trip.destinations],
                  durationDays: trip.days.length,
                  estimatedBudgetPerPersonInr: trip.budgetPerPersonInr,
                  travelStyle: trip.travelStyle,
                  travelTips: ['Start ghat-section drives early.', 'Carry cash in hill towns.'],
                  warningsAndAssumptions: ['All costs are estimates based on typical prices — verify locally before booking.'],
                  freeDayIndexes: [0], premiumPriceInr: 199,
                  subscriberCta: 'Full checklist + stay contacts.',
                })
                toast('Published to Explore 🎉')
              }}>Publish to Explore</button>
          ) : (
            <div className="row-between">
              <span className="small muted">Live on Explore · {pub.views} views · {pub.copies} copies</span>
              <button className="btn btn-outline btn-sm" onClick={() => onNavigate(`pub:${pub.id}`)}>View public page</button>
            </div>
          )}
          {!isOwner && <p className="hint-text" style={{ marginTop: 8 }}>Only the trip owner can publish.</p>}
          {pubLink && <div className="share-link-box" style={{ marginTop: 10 }}><code>{pubLink}</code><CopyButton text={pubLink} label="Copy" /></div>}
        </div>

        <SnapshotCard trip={trip} me={me} onNavigate={onNavigate} />
      </div>

      <div>
        <div className="card">
          <h3>Trip settings</h3>
          <hr className="divider" />
          <TripSettingsForm trip={trip} editable={editable} />
        </div>
        {isOwner && (trip.members ?? []).length > 1 && (
          <div className="card">
            <h3>Danger zone</h3>
            <p className="hint-text" style={{ margin: '6px 0' }}>Removing someone revokes their access immediately.</p>
            {(trip.members ?? []).filter(m => m.role !== 'owner').map(m => (
              <div key={m.userId} className="row-between" style={{ padding: '5px 0' }}>
                <span className="small">{userById(m.userId)?.profile.name}</span>
                <button className="btn btn-danger btn-sm" onClick={() => setPendingRemove(m)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingRemove}
        title={`Remove ${userById(pendingRemove?.userId)?.profile.name ?? 'this member'}?`}
        body="They lose access to this trip immediately. You can undo this from the toast for a few seconds."
        confirmLabel="Remove member"
        danger
        onConfirm={confirmRemoveMember}
        onClose={() => setPendingRemove(null)}
      />
    </div>
  )
}

function TripSettingsForm({ trip, editable }: { trip: Trip; editable: boolean }) {
  const [f, setF] = useState({
    name: trip.name, startLocation: trip.startLocation,
    destinations: [...trip.destinations],
    travellers: trip.travellers, budget: trip.budgetPerPersonInr,
    transportMode: trip.transportMode, travelStyle: trip.travelStyle,
    fuelEconomy: trip.fuelEconomyKmL?.toString() ?? '',
    fuelPrice: trip.fuelPricePerL?.toString() ?? '',
    roundTrip: trip.roundTrip ?? true,
    vehicleType: trip.vehicleProfile?.vehicleType ?? 'car',
    fuelType: trip.vehicleProfile?.fuelType ?? 'petrol',
    capacity: trip.vehicleProfile?.capacity?.toString() ?? '',
    vehicleEconomy: trip.vehicleProfile?.economy?.toString() ?? '',
  })
  const [startCoords, setStartCoords] = useState<LatLngPoint | null>(trip.startLocationCoords ?? null)
  const [destCoords, setDestCoords] = useState<(LatLngPoint | null)[]>(trip.destinationCoords ?? [])
  const [destInput, setDestInput] = useState('')

  function addDest(name: string, coords: LatLngPoint | null) {
    const clean = name.trim()
    if (!clean) return
    if (f.destinations.some(d => d.toLowerCase() === clean.toLowerCase())) {
      toast('Already on the route.', 'err'); return
    }
    setF(x => ({ ...x, destinations: [...x.destinations, clean] }))
    setDestCoords(list => [...list, coords])
    setDestInput('')
  }

  return (
    <div>
      <Field label="Trip name"><input className="input" disabled={!editable} value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></Field>
      <div className="form-row">
        <Field label="Starting location">
          <LocationInput
            value={f.startLocation}
            onChange={v => setF(x => ({ ...x, startLocation: v }))}
            onPick={p => setStartCoords({ lat: p.latitude, lng: p.longitude })}
            placeholder="Search a city…"
          />
        </Field>
      </div>
      <Field label={`Destinations (${f.destinations.length})`} hint="Search to add — arrows reorder the route">
        <LocationInput
          value={destInput}
          onChange={setDestInput}
          onPick={p => addDest(p.name + (p.admin1 ? `, ${p.admin1}` : ''), { lat: p.latitude, lng: p.longitude })}
          placeholder={f.destinations.length ? 'Add another destination…' : 'Add your first destination…'}
        />
        {f.destinations.length > 0 && (
          <div className="dest-chips">
            {f.destinations.map((d, i) => (
              <span key={`${d}-${i}`} className="dest-chip">
                <span className="dest-order">{i + 1}</span>{d}
                <button type="button" aria-label={`Move ${d} earlier`} disabled={!editable || i === 0}
                  onClick={() => setF(x => {
                    const list = [...x.destinations]; if (i === 0) return x
                    ;[list[i - 1], list[i]] = [list[i], list[i - 1]]
                    const dc = [...destCoords]; [dc[i - 1], dc[i]] = [dc[i], dc[i - 1]]; setDestCoords(dc)
                    return { ...x, destinations: list }
                  })} style={{ opacity: i === 0 ? .25 : undefined }}>↑</button>
                <button type="button" aria-label={`Move ${d} later`} disabled={!editable || i === f.destinations.length - 1}
                  onClick={() => setF(x => {
                    const list = [...x.destinations]; if (i >= list.length - 1) return x
                    ;[list[i + 1], list[i]] = [list[i], list[i + 1]]
                    const dc = [...destCoords]; [dc[i + 1], dc[i]] = [dc[i], dc[i + 1]]; setDestCoords(dc)
                    return { ...x, destinations: list }
                  })} style={{ opacity: i === f.destinations.length - 1 ? .25 : undefined }}>↓</button>
                {editable && (
                  <button type="button" aria-label={`Remove ${d}`}
                    onClick={() => {
                      setF(x => ({ ...x, destinations: x.destinations.filter((_, j) => j !== i) }))
                      setDestCoords(list => list.filter((_, j) => j !== i))
                    }}>✕</button>
                )}
              </span>
            ))}
          </div>
        )}
      </Field>
      <div className="form-row">
        <Field label="Travellers"><input type="number" min={1} className="input" disabled={!editable} value={f.travellers} onChange={e => setF(x => ({ ...x, travellers: Number(e.target.value) }))} /></Field>
        <Field label="Budget/person (₹)"><input type="number" min={0} className="input" disabled={!editable} value={f.budget} onChange={e => setF(x => ({ ...x, budget: Number(e.target.value) }))} /></Field>
      </div>
      <div className="form-row">
        <Field label="Transport mode">
          <select className="select" disabled={!editable} value={f.transportMode} onChange={e => setF(x => ({ ...x, transportMode: e.target.value as never }))}>
            {TRANSPORT_MODES.map(m => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Travel style">
          <select className="select" disabled={!editable} value={f.travelStyle} onChange={e => setF(x => ({ ...x, travelStyle: e.target.value as never }))}>
            {TRAVEL_STYLES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      {isFuelEconomyMode(f.transportMode) && (
        <div className="form-row">
          <Field label="Fuel economy (km per litre)" hint="Optional — transport cost becomes route distance ÷ economy × price per litre instead of the default ₹/km rate.">
            <input type="number" min={2} max={80} step={0.1} className="input" disabled={!editable} value={f.fuelEconomy}
              onChange={e => setF(x => ({ ...x, fuelEconomy: e.target.value }))} placeholder="e.g. 18" />
            {isImplausibleFuelEconomy(f.transportMode, parseFuelEconomyKmL(f.fuelEconomy)) && (
              <p className="hint-text" style={{ marginTop: 5, color: '#b45309' }}>
                ⚠️ Unusual for a {f.transportMode} — most do far better. Double-check the value (km per litre).
              </p>
            )}
          </Field>
          <Field label="Fuel price (₹ per litre)" hint={`Optional — defaults to ₹${FUEL_PRICE_INR_PER_L}/L (indicative national average). Enter your local pump price for a sharper estimate.`}>
            <input type="number" min={50} max={250} step={0.1} className="input" disabled={!editable} value={f.fuelPrice}
              onChange={e => setF(x => ({ ...x, fuelPrice: e.target.value }))} placeholder="e.g. 105.5" />
          </Field>
        </div>
      )}
      {isFuelEconomyMode(f.transportMode) && (
        <div className="chip-row" style={{ margin: '4px 0 12px' }}>
          <Chip active={f.roundTrip} onClick={editable ? () => setF(x => ({ ...x, roundTrip: !x.roundTrip })) : undefined}>
            Round trip — return to start
          </Chip>
        </div>
      )}
      {isFuelEconomyMode(f.transportMode) && (
        <div className="vehicle-profile-form" style={{ margin: '4px 0 16px' }}>
          <div className="form-row">
            <Field label="Vehicle type">
              <select className="select" disabled={!editable} value={f.vehicleType} onChange={e => setF(x => ({ ...x, vehicleType: e.target.value as never }))}>
                <option value="car">Car</option>
                <option value="motorcycle">Motorcycle</option>
                <option value="ev">Electric (EV)</option>
              </select>
            </Field>
            <Field label="Fuel / energy">
              <select className="select" disabled={!editable} value={f.fuelType} onChange={e => setF(x => ({ ...x, fuelType: e.target.value as never }))}>
                <option value="petrol">Petrol</option>
                <option value="diesel">Diesel</option>
                <option value="electric">Electric</option>
                <option value="cng">CNG</option>
              </select>
            </Field>
          </div>
          <div className="form-row">
            <Field label={f.fuelType === 'electric' ? 'Battery (kWh)' : 'Tank capacity (L)'} hint={f.fuelType === 'electric' ? 'e.g. 50' : 'e.g. 45'}>
              <input type="number" min={1} max={300} step={0.5} className="input" disabled={!editable} value={f.capacity}
                onChange={e => setF(x => ({ ...x, capacity: e.target.value }))} placeholder={f.fuelType === 'electric' ? '50' : '45'} />
            </Field>
            <Field label={f.fuelType === 'electric' ? 'Efficiency (km / kWh)' : 'Economy (km / L)'} hint={f.fuelType === 'electric' ? 'e.g. 6' : 'e.g. 15'}>
              <input type="number" min={1} max={200} step={0.1} className="input" disabled={!editable} value={f.vehicleEconomy}
                onChange={e => setF(x => ({ ...x, vehicleEconomy: e.target.value }))} placeholder={f.fuelType === 'electric' ? '6' : '15'} />
            </Field>
          </div>
        </div>
      )}
      {editable && (
        <button className="btn btn-primary btn-sm" onClick={() => {
          updateTrip(trip.id, {
            name: f.name, startLocation: f.startLocation,
            startLocationCoords: startCoords ?? undefined,
            destinations: f.destinations.map(s => s.trim()).filter(Boolean),
            destinationCoords: destCoords,
            travellers: Math.max(1, f.travellers),
            budgetPerPersonInr: Math.max(0, f.budget),
            transportMode: f.transportMode, travelStyle: f.travelStyle,
            fuelEconomyKmL: isFuelEconomyMode(f.transportMode) ? parseFuelEconomyKmL(f.fuelEconomy) : undefined,
            fuelPricePerL: isFuelEconomyMode(f.transportMode) ? parseFuelPricePerL(f.fuelPrice) : undefined,
            roundTrip: isFuelEconomyMode(f.transportMode) ? f.roundTrip : undefined,
            vehicleProfile: isFuelEconomyMode(f.transportMode) ? {
              vehicleType: f.vehicleType as 'car' | 'motorcycle' | 'ev',
              fuelType: f.fuelType as 'petrol' | 'diesel' | 'electric' | 'cng',
              capacity: Number(f.capacity) || 45,
              economy: Number(f.vehicleEconomy) || 15,
            } : undefined,
          })
          toast('Trip settings updated')
        }}>Save settings</button>
      )}
    </div>
  )
}

// ================= Real-road distance refinement =================

/** Road modes where OSRM's driving distances make sense as estimates. */
const ROAD_MODES = ['car', 'motorcycle', 'taxi', 'bus', 'mixed']

/**
 * Fetches real road distances/durations (OSRM) for the trip's legs and returns
 * a map keyed by `legKey(a, b)` that the engine consumes to replace its
 * haversine estimates. Falls back to the deterministic values when the service
 * is unreachable or the mode isn't ground-based.
 */
function useTripCorrections(trip: Trip | null | undefined): Record<string, LegEstimate> | undefined {
  const [corrections, setCorrections] = useState<Record<string, LegEstimate> | undefined>(undefined)

  const chain = useMemo(() => {
    if (!trip) return []
    const pts: { lat: number; lng: number }[] = []
    if (trip.startLocationCoords) pts.push({ lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng })
    ;[...trip.days]
      .sort((a, b) => a.index - b.index)
      .forEach(d => [...d.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
        .forEach(s => pts.push({ lat: s.lat, lng: s.lng })))
    // Round trip: also refine the turnaround → start leg with road distances.
    if (isRoundTrip(trip) && trip.startLocationCoords) {
      pts.push({ lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng })
    }
    const dc = trip.destinationCoords ?? []
    const lastDest = dc.length ? dc[dc.length - 1] : undefined
    if (lastDest && !(pts.length && pts[pts.length - 1].lat === lastDest.lat && pts[pts.length - 1].lng === lastDest.lng)) {
      pts.push({ lat: lastDest.lat, lng: lastDest.lng })
    }
    return pts
  }, [trip])

  const mode = trip?.transportMode

  useEffect(() => {
    if (!trip) return
    setCorrections(undefined)
    if (!mode || !ROAD_MODES.includes(mode) || chain.length < 2) { setCorrections({}); return }
    let cancelled = false
    ;(async () => {
      try {
        const legs = await routePath(chain, getAssumptions(trip))
        if (cancelled) return
        const map: Record<string, LegEstimate> = {}
        for (let i = 0; i < legs.length; i++) {
          const est = { distanceKm: legs[i].distanceKm, durationMinutes: legs[i].durationMinutes }
          map[legKey(chain[i], chain[i + 1])] = est
          // Store the mirrored leg too: the return drive runs the same road in
          // the opposite direction (e.g. Siliguri → home through a halt), and a
          // reversed road number beats a haversine fallback.
          const rk = legKey(chain[i + 1], chain[i])
          if (!map[rk]) map[rk] = est
        }
        setCorrections(map)
      } catch {
        if (!cancelled) setCorrections({})
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip, mode, chain])

  return corrections
}

// ================= helpers =================

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
function fmtDateRange(a: string, b: string): string {
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${new Date(a).toLocaleDateString('en-IN', opt)} – ${new Date(b).toLocaleDateString('en-IN', { ...opt, year: 'numeric' })}`
}
function labelCommitType(t: string): string {
  const map: Record<string, string> = { 'hotel-checkin': 'Check-in', 'train-departure': 'Train', 'flight-departure': 'Flight', event: 'Event', other: 'Other' }
  return map[t] ?? t
}
function statusTone(s: string): 'teal' | 'saffron' | 'danger' | 'ok' | 'info' {
  return s === 'confirmed' ? 'teal' : s === 'needs-booking' ? 'saffron' : s === 'rejected' ? 'danger' : 'info'
}
function labelStatusText(s: string): string {
  return s === 'needs-booking' ? 'Needs booking' : s[0].toUpperCase() + s.slice(1)
}
function labelCatText(c: string): string { return labelCat(c) }
function labelCat(c: string): string { return c.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) }
function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
function dayIndexOfStop(trip: Trip, stopId: string): number {
  for (const d of trip.days) if (d.stops.some(s => s.id === stopId)) return d.index
  return 0
}
function currentDayOf(trip: Trip, stopId: string): number {
  return dayIndexOfStop(trip, stopId)
}
function initialValues(state: { mode: 'add'; dayIndex: number } | { mode: 'edit'; stopId: string } | null, trip: Trip): Partial<StopFormValues> | undefined {
  if (!state) return undefined
  if (state.mode === 'edit') {
    for (const d of trip.days) {
      const s = d.stops.find(x => x.id === state.stopId)
      if (s) {
        return {
          ...s,
          description: s.description ?? '',
          notes: s.notes ?? '',
          openTime: s.openTime ?? '',
          closeTime: s.closeTime ?? '',
          departTime: s.departTime ?? '',
          arrivalTime: s.arrivalTime ?? '',
          legDistanceKm: s.legDistanceKm ?? 0,
          legTravelMinutes: s.legTravelMinutes ?? 0,
        }
      }
    }
  }
  return undefined
}

/** Leg context for the add-stop flow: where you're coming from and where you're headed next. */
function legContextFor(state: { mode: 'add'; dayIndex: number } | { mode: 'edit'; stopId: string } | null, trip: Trip) {
  if (!state || state.mode !== 'add') return undefined
  const pred = predecessorOf(trip, state.dayIndex)
  if (!pred) return undefined
  const nxt = nextAfter(trip, state.dayIndex)
  // Don't advertise "headed next to X" when you're already standing in X.
  const next = nxt && !coLocates(pred.point, nxt.point) ? nxt : undefined
  return {
    fromName: pred.name,
    fromPoint: pred.point,
    nextName: next?.name,
    dayStart: getAssumptions(trip).dayStart,
    transportMode: trip.transportMode,
    fuelEconomyKmL: trip.fuelEconomyKmL,
    fuelPricePerL: trip.fuelPricePerL,
  }
}
