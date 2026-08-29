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
  computeHealth, computeTotals, simulateDay, originOf, getAssumptions, legKey,
  minutesToHM, hmToMinutes, formatInr, countHotelNights, predecessorOf, nextAfter,
  collectWarnings, FUEL_PRICE_INR_PER_L, isFuelEconomyMode, parseFuelEconomyKmL, isImplausibleFuelEconomy,
  parseFuelPricePerL, isRoundTrip, computeCategoryBias,
} from '../lib/engine'
import type { LegEstimate, ScheduleWarning } from '../lib/engine'
import { routePath } from '../lib/routing'
import { computeImpact, type ImpactResult } from '../lib/impact'
import { Avatar, Chip, Modal, ConfirmDialog, Field, StatTile, HealthRing, EmptyState, toast, undoToast, useReorder, CopyButton } from '../components/ui'
import { ImpactPreviewPanel } from '../components/ImpactPreview'
// MapLibre is heavy (~1MB) — load it only when the Map tab is actually opened.
const TripMap = React.lazy(() => import('../components/TripMap').then(m => ({ default: m.TripMap })))
import { StopEditor, type StopFormValues } from '../components/StopEditor'
import { AiDrawer } from '../components/AiDrawer'
import { LocationInput } from '../components/LocationInput'
import { searchNearbyPois, searchNearbyPoisMulti, corridorAnchors, detourKm, googleEnabled, type NearbyOpts } from '../lib/geocode'
import type { PlaceHit } from '../lib/geocode'
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

export function TripWorkspace({ tripId, onNavigate }: { tripId: string; onNavigate: (route: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const trip = tripById(tripId)
  const [tab, setTab] = useState<TabKey>('overview')
  const [aiOpen, setAiOpen] = useState(false)

  const role = me && trip ? roleOf(trip, me.id) : null
  const editable = canEdit(role)

  // Real road distances/durations for the estimate totals, refreshed when the
  // route changes. Only applied for ground modes (OSRM is driving-only); the
  // deterministic haversine engine stays the fallback and powers warnings/impact.
  const legCorrections = useTripCorrections(trip)

  // Pending change: a proposed plan held until the user keeps or discards it.
  const [pending, setPending] = useState<{ proposed: Trip; result: ImpactResult } | null>(null)

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
        />
      )}

      {tab === 'overview' && <OverviewTab trip={effective} editable={editable} onOpenDecisions={() => setTab('decisions')} health={health} totals={totals} />}
      {tab === 'timeline' && <TimelineTab trip={trip} editable={editable} applyChange={applyChange} legCorrections={legCorrections} />}
      {tab === 'map' && (
        <React.Suspense fallback={<div className="container loading-block"><div className="spinner" />Loading map…</div>}>
          <MapTab trip={trip} editable={editable} applyChange={applyChange} />
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
                  <div className="warn-fix">Day {nextCommitment.dayIndex + 1} at {nextCommitment.time}{nextCommitment.notes ? ` — ${nextCommitment.notes}` : ''}</div>
                </div>
              </div>
              {trip.fixedCommitments.filter(fc => fc !== nextCommitment).map(fc => (
                <div key={fc.id} className="row-between small" style={{ padding: '4px 0' }}>
                  <span><b>{fc.title}</b> <span className="muted">· Day {fc.dayIndex + 1}, {fc.time}</span></span>
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

function TimelineTab({ trip, editable, applyChange, legCorrections }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
  legCorrections?: Record<string, LegEstimate>
}) {
  const [editorState, setEditorState] = useState<
    { mode: 'add'; dayIndex: number } | { mode: 'edit'; stopId: string } | null
  >(null)
  const [moveModalStop, setMoveModalStop] = useState<ItineraryStop | null>(null)

  const days = [...trip.days].sort((a, b) => a.index - b.index)

  function handleSave(v: StopFormValues) {
    if (!editorState) return
    // legFromOsrm is display-only — never persist it onto the stop
    const { legFromOsrm: _drop, ...legFields } = v
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
          <p className="muted small">Drag stops to reorder within a day — or drop them onto another day to move them there. Every change shows its impact before saving.</p>
        </div>
        {editable && (
          <button className="btn btn-primary btn-sm" onClick={() => setEditorState({ mode: 'add', dayIndex: 0 })}>+ Add stop</button>
        )}
      </div>

      {days.map(day => (
        <DaySection key={day.id} day={day} trip={trip} editable={editable} legCorrections={legCorrections}
          onAdd={() => setEditorState({ mode: 'add', dayIndex: day.index })}
          onEdit={(sid) => setEditorState({ mode: 'edit', stopId: sid })}
          onDelete={handleDelete}
          onMoveWithinDay={handleMoveWithinDay}
          onMoveBetweenDays={setMoveModalStop}
          onMoveStopIn={handleMoveStopInto}
          onRenameDay={handleRenameDay}
          onCopyDay={handleCopyDay}
          onAddQuickStop={handleAddQuickStop}
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

function DaySection({ day, trip, editable, onAdd, onEdit, onDelete, onMoveWithinDay, onMoveBetweenDays, onMoveStopIn, onRenameDay, onCopyDay, onAddQuickStop, warnings, onStatus, legCorrections }: {
  day: Trip['days'][number]
  trip: Trip
  editable: boolean
  legCorrections?: Record<string, LegEstimate>
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
  warnings: ScheduleWarning[]
  onStatus: (stop: ItineraryStop, status: ItineraryStop['status']) => void
}) {
  const sim = simulateDay(day, trip, originOf(trip, day.index), day.index, legCorrections)
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
  const [collapsed, setCollapsed] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(day.title ?? '')
  const [nearby, setNearby] = useState<PlaceHit[]>([])
  const nextAnchor = useMemo(() => nextAfter(trip, day.index), [trip]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // day progress: how much of the realistic window (08:30–20:00) the plan consumes
  const startMin = hmToMinutes(A.dayStart)
  const windowMin = Math.max(1, hmToMinutes(A.dayEnd) - startMin)
  const used = Math.max(0, Math.min(1, (hmToMinutes(sim.endsAt) - startMin) / windowMin))
  const sev = warnings.some(w => w.severity === 'high') ? 'high' : warnings.some(w => w.severity === 'medium') ? 'medium' : 'ok'

  return (
    <div className="day-section">
      <div className="day-header">
        <button className="day-collapse" onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? `Expand Day ${day.index + 1}` : `Collapse Day ${day.index + 1}`}>
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
            {sim.activeStops.length} active stop{sim.activeStops.length !== 1 ? 's' : ''} · ~{minutesToHM(sim.totalTravelMinutes)} travel · ~{Math.round(sim.totalDistanceKm)} km · ends ~{sim.endsAt}
          </div>
          <div className={`day-progress ${collapsed ? 'compact' : ''}`} title={`${Math.round(used * 100)}% of the ${A.dayStart}–${A.dayEnd} window`}>
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
            <div className="warn-fix">Fixed at {fc.time}{fc.notes ? ` — ${fc.notes}` : ''}</div>
          </div>
        </div>
      ))}

      {ordered.length === 0 && (<>
        <EmptyState icon="🌤️" title="Nothing planned yet" body="Add your first stop for this day — or drag one here from another day."
          action={editable ? <button className="btn btn-primary btn-sm" onClick={onAdd}>+ Add stop</button> : undefined} />
        {editable && (nextAnchor || nearby.length > 0) && (
          <div className="day-suggest">
            {nextAnchor && (
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
        {ordered.map((s, i) => (
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
                  {s.openTime && <span>🕒 {s.openTime}–{s.closeTime}</span>}
                  <span>🎫 ₹{s.entryFeeInrPerPerson}/person</span>
                  <span>🚗 ₹{s.transportCostInrTotal} transport</span>
                  {s.departTime && s.arrivalTime && (
                    <span>🕰 dep {s.departTime} · arr {s.arrivalTime}{s.legDistanceKm ? ` · ${s.legDistanceKm.toFixed(0)} km` : ''}</span>
                  )}
                </div>
                {s.description && <div className="stop-desc">{s.description}</div>}
                {s.notes && <div className="stop-desc muted">📝 {s.notes}</div>}
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
                    ? <button className="icon-btn" title="Mark confirmed" onClick={() => onStatus(s, 'confirmed')}>✔️</button>
                    : <button className="icon-btn" title="Mark maybe" onClick={() => onStatus(s, 'maybe')}>❓</button>}
                  <button className="icon-btn" title="Move to another day" onClick={() => onMoveBetweenDays(s)}>↔️</button>
                  <button className="icon-btn" onClick={() => onDelete(s.id, day.index)} aria-label={`Delete ${s.title}`}>🗑️</button>
                </div>
              )}
              </div>
            </div>

            {i < ordered.length - 1 && (() => {
              const leg = sim.legs[i]
              if (!leg) return null
              return (
                <div className="tl-legrow" {...(editable ? dayDropHandlers(i + 1) : {})}>
                  <div className="tl-gutter tl-gutter-leg"><span className="tl-line tl-line-leg" /></div>
                  <div className={`travel-leg ${foreignOver === i + 1 && dragging === null ? 'foreign-over' : ''}`}>
                    🚗 ~{leg.distanceKm.toFixed(0)} km · ~{Math.round(leg.durationMinutes)} min from {leg.fromTitle} · est ₹{Math.round(leg.distanceKm * (A.inrPerKm ?? 8))} ({A.mode})
                  </div>
                </div>
              )
            })()}
          </React.Fragment>
        ))}
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

/** Tiny inline SVG of the day's route shape — no map mount, pure geometry. */
function DaySpark({ stops }: { stops: ItineraryStop[] }) {
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

function MapTab({ trip, editable, applyChange }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
}) {
  const [pois, setPois] = useState<PlaceHit[]>([])
  const [loadingPois, setLoadingPois] = useState(false)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
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
    let cancelled = false
    setLoadingPois(true)
    searchNearbyPoisMulti(anchors, scopeKm * 1000, 12, nearbyOpts)
      .then(hits => { if (!cancelled) setPois(hits.slice(0, 10)) })
      .catch(() => { /* suggestions are best-effort */ })
      .finally(() => { if (!cancelled) setLoadingPois(false) })
    return () => { cancelled = true }
  }, [anchors, nearbyOpts, scopeKm]) // eslint-disable-line react-hooks/exhaustive-deps

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
        notes: 'Added from nearby suggestions',
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
    setPickDay(trip.days[0]?.index ?? 0)
    setPoiDraft({ hit })
  }

  const dayOptions = trip.days.map(d => ({ index: d.index }))

  return (
    <div>
      <TripMap trip={trip} nearbyPois={pois} onAddNearby={editable ? (hit) => openAddModal(hit) : undefined} />
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row-between">
          <h3 style={{ margin: 0 }}>💡 Nearby ideas</h3>
          <span className="small muted">{loadingPois ? 'searching…' : `${pois.length} found near your route`}</span>
        </div>
        <p className="hint-text" style={{ margin: '4px 0 6px' }}>
          Things to see, eat and stay en-route and around your destination (live data from {googleEnabled() ? 'Google Places' : 'OpenStreetMap, Wikipedia & Mappls'}) — never around your starting point. Add one straight to a day.
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
          <p className="muted small">No nearby suggestions found — add stops in the Timeline and ideas will appear here.</p>
        )}
        <div className="poi-suggest-grid">
          {pois.map(hit => {
            const added = addedIds.has(hit.id as string) || existingNames.has(hit.name.toLowerCase())
            return (
              <div key={hit.id} className="poi-suggest-card">
                {hit.thumb
                  ? <img className="poi-thumb" src={smallThumb(hit.thumb)} alt="" loading="lazy" />
                  : <div className="poi-thumb poi-thumb-empty">🏞️</div>}
                <div className="poi-info">
                  <div className="poi-name">{hit.name}</div>
                  {hit.description && <div className="poi-desc small muted">{hit.description}</div>}
                  {hit.category && (
                    <div className="poi-cat small">
                      {labelCatText(String(hit.category))}
                      {' · '}
                      ~{Math.round(detourKm(hit, anchors))} km off route
                    </div>
                  )}
                  {(hit.openTime || hit.closeTime) && (
                    <div className="poi-desc small muted">🕘 {hit.openTime}–{hit.closeTime} (reported)</div>
                  )}
                </div>
                {editable && (
                  added
                    ? <span className="chip chip-teal">✓ Added</span>
                    : <button className="btn btn-primary btn-sm" onClick={() => openAddModal(hit)}>+ Add</button>
                )}
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
          <Field label="Why it's worth it"><textarea className="textarea" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>
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
      <input className="input" placeholder="Add a comment…" value={text} onChange={e => setText(e.target.value)} />
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
          map[legKey(chain[i], chain[i + 1])] = {
            distanceKm: legs[i].distanceKm,
            durationMinutes: legs[i].durationMinutes,
          }
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
  return {
    fromName: pred.name,
    fromPoint: pred.point,
    nextName: nxt?.name,
    dayStart: getAssumptions(trip).dayStart,
    transportMode: trip.transportMode,
    fuelEconomyKmL: trip.fuelEconomyKmL,
    fuelPricePerL: trip.fuelPricePerL,
  }
}
