// ============ Trip workspace ============
// Tabs: Overview / Timeline / Map / Suggestions / Budget / Decisions / Share
import React, { useMemo, useState } from 'react'
import type { Trip, ItineraryStop, Expense } from '../data/types'
import { TRANSPORT_MODES, TRAVEL_STYLES } from '../data/types'
import {
  useDb, tripById, userById, currentUser, roleOf, canEdit,
  setStopStatus, addExpense, deleteExpense, addSuggestion,
  voteSuggestion, addCommentToSuggestion,
  acceptSuggestionIntoTimeline, declineSuggestion, addDecision, voteOnDecision, resolveDecision,
  activityFor, setMemberRole, removeMember, updateTrip, publishItinerary,
} from '../store/store'
import {
  computeHealth, computeTotals, simulateDay, originOf, getAssumptions,
  minutesToHM, formatInr, countHotelNights,
} from '../lib/engine'
import { computeImpact, type ImpactResult } from '../lib/impact'
import { Avatar, Chip, Modal, Field, StatTile, HealthRing, EmptyState, toast, useReorder, CopyButton } from '../components/ui'
import { ImpactPreviewPanel } from '../components/ImpactPreview'
import { TripMap } from '../components/TripMap'
import { StopEditor, type StopFormValues } from '../components/StopEditor'
import { AiDrawer } from '../components/AiDrawer'
import { LocationInput } from '../components/LocationInput'

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

  // Pending change: a proposed plan held until the user keeps or discards it.
  const [pending, setPending] = useState<{ proposed: Trip; result: ImpactResult } | null>(null)

  if (!trip || !me) {
    return <div className="container loading-block">Trip not found. <button className="btn btn-outline btn-sm" onClick={() => onNavigate('trips')}>Back to my trips</button></div>
  }

  const effective = pending?.proposed ?? trip
  const health = computeHealth(effective)
  const totals = computeTotals(effective)

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
      {tab === 'timeline' && <TimelineTab trip={trip} editable={editable} applyChange={applyChange} />}
      {tab === 'map' && <MapTab trip={trip} />}
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

function TimelineTab({ trip, editable, applyChange }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
}) {
  const [editorState, setEditorState] = useState<
    { mode: 'add'; dayIndex: number } | { mode: 'edit'; stopId: string } | null
  >(null)
  const [moveModalStop, setMoveModalStop] = useState<ItineraryStop | null>(null)

  const days = [...trip.days].sort((a, b) => a.index - b.index)

  function handleSave(v: StopFormValues) {
    if (!editorState) return
    if (editorState.mode === 'add') {
      const dayIndex = editorState.dayIndex
      applyChange(draft => {
        const day = draft.days.find(d => d.index === dayIndex)!
        day.stops.push({
          ...(v as unknown as ItineraryStop),
          id: 'pending_' + Math.random().toString(36).slice(2),
          orderInDay: day.stops.length + 1,
        })
      }, 'add', dayIndex)
    } else {
      const stopId = editorState.stopId
      applyChange(draft => {
        for (const day of draft.days) {
          const s = day.stops.find(x => x.id === stopId)
          if (s) { Object.assign(s, v); break }
        }
      }, 'edit', dayIndexOfStop(trip, stopId))
    }
    setEditorState(null)
  }

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
          <p className="muted small">Drag stops to reorder on desktop, or use the ↑ ↓ buttons. Every change shows its impact before saving.</p>
        </div>
        {editable && (
          <button className="btn btn-primary btn-sm" onClick={() => setEditorState({ mode: 'add', dayIndex: 0 })}>+ Add stop</button>
        )}
      </div>

      {days.map(day => (
        <DaySection key={day.id} day={day} trip={trip} editable={editable}
          onAdd={() => setEditorState({ mode: 'add', dayIndex: day.index })}
          onEdit={(sid) => setEditorState({ mode: 'edit', stopId: sid })}
          onDelete={handleDelete}
          onMoveWithinDay={handleMoveWithinDay}
          onMoveBetweenDays={setMoveModalStop}
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

function DaySection({ day, trip, editable, onAdd, onEdit, onDelete, onMoveWithinDay, onMoveBetweenDays, onStatus }: {
  day: Trip['days'][number]
  trip: Trip
  editable: boolean
  onAdd: () => void
  onEdit: (stopId: string) => void
  onDelete: (stopId: string, dayIndex: number) => void
  onMoveWithinDay: (from: number, to: number, dayIndex: number) => void
  onMoveBetweenDays: (stop: ItineraryStop) => void
  onStatus: (stop: ItineraryStop, status: ItineraryStop['status']) => void
}) {
  const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
  const A = getAssumptions(trip)
  const ordered = [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)
  const { dndHandlers, dragging, over, moveUp, moveDown } = useReorder(ordered, (f, t) => onMoveWithinDay(f, t, day.index))
  const commitmentsToday = trip.fixedCommitments.filter(fc => fc.dayIndex === day.index)

  return (
    <div className="day-section">
      <div className="day-header">
        <div className="day-badge"><small>DAY</small><b>{day.index + 1}</b></div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <h3>{day.title ?? `Day ${day.index + 1}`}</h3>
          <div className="small muted">
            {sim.activeStops.length} active stop{sim.activeStops.length !== 1 ? 's' : ''} · ~{minutesToHM(sim.totalTravelMinutes)} travel · ~{Math.round(sim.totalDistanceKm)} km · ends ~{sim.endsAt}
          </div>
        </div>
        {editable && <button className="btn btn-outline btn-sm" onClick={onAdd}>+ Add here</button>}
      </div>

      {commitmentsToday.map(fc => (
        <div key={fc.id} className="warn-item sev-low" style={{ marginBottom: 8 }}>
          <span className="warn-icon">📌</span>
          <div>
            <div className="warn-title">{fc.title}</div>
            <div className="warn-fix">Fixed at {fc.time}{fc.notes ? ` — ${fc.notes}` : ''}</div>
          </div>
        </div>
      ))}

      {ordered.length === 0 && (
        <EmptyState icon="🌤️" title="Nothing planned yet" body="Add your first stop for this day."
          action={editable ? <button className="btn btn-primary btn-sm" onClick={onAdd}>+ Add stop</button> : undefined} />
      )}

      <div>
        {ordered.map((s, i) => (
          <React.Fragment key={s.id}>
            <div
              className={`stop-card status-${s.status} ${dragging === i ? 'dragging' : ''} ${over === i && dragging !== null && dragging !== i ? 'drag-over' : ''}`}
              {...(editable ? dndHandlers(i) : {})}
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
                  {sim.arrivalTimes[i] && <span>→ arrives ~{sim.arrivalTimes[i]}</span>}
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

            {i > 0 && (() => {
              const leg = sim.legs[i - 1]
              if (!leg) return null
              return (
                <div className="travel-leg">
                  🚗 ~{leg.distanceKm.toFixed(0)} km · ~{Math.round(leg.durationMinutes)} min from {leg.fromTitle} · est ₹{Math.round(leg.distanceKm * (A.inrPerKm ?? 8))} ({A.mode})
                </div>
              )
            })()}
          </React.Fragment>
        ))}
      </div>
    </div>
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

// ================= Map tab =================

function MapTab({ trip }: { trip: Trip }) {
  return <TripMap trip={trip} />
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

  return (
    <div className="two-col">
      <div>
        <div className="card">
          <h3>Where the money goes</h3>
          <p className="hint-text" style={{ margin: '4px 0 14px' }}>
            All figures are estimates in INR. Transport is derived from demo-route distance × ₹{getAssumptions(trip).inrPerKm}/km for {trip.transportMode}.
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
                    <td>{editable && <button className="icon-btn" aria-label="Delete expense" onClick={() => { deleteExpense(trip.id, e.id); toast('Expense removed') }}>🗑️</button>}</td>
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
                <button className="btn btn-danger btn-sm" onClick={() => { removeMember(trip.id, m.userId); toast('Member removed') }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TripSettingsForm({ trip, editable }: { trip: Trip; editable: boolean }) {
  const [f, setF] = useState({
    name: trip.name, startLocation: trip.startLocation,
    destinations: [...trip.destinations],
    travellers: trip.travellers, budget: trip.budgetPerPersonInr,
    transportMode: trip.transportMode, travelStyle: trip.travelStyle,
  })
  const [destInput, setDestInput] = useState('')

  function addDest(name: string) {
    const clean = name.trim()
    if (!clean) return
    if (f.destinations.some(d => d.toLowerCase() === clean.toLowerCase())) {
      toast('Already on the route.', 'err'); return
    }
    setF(x => ({ ...x, destinations: [...x.destinations, clean] }))
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
            placeholder="Search a city…"
          />
        </Field>
      </div>
      <Field label={`Destinations (${f.destinations.length})`} hint="Search to add — arrows reorder the route">
        <LocationInput
          value={destInput}
          onChange={setDestInput}
          onPick={p => addDest(p.name + (p.admin1 ? `, ${p.admin1}` : ''))}
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
                    ;[list[i - 1], list[i]] = [list[i], list[i - 1]]; return { ...x, destinations: list }
                  })} style={{ opacity: i === 0 ? .25 : undefined }}>↑</button>
                <button type="button" aria-label={`Move ${d} later`} disabled={!editable || i === f.destinations.length - 1}
                  onClick={() => setF(x => {
                    const list = [...x.destinations]; if (i >= list.length - 1) return x
                    ;[list[i + 1], list[i]] = [list[i], list[i + 1]]; return { ...x, destinations: list }
                  })} style={{ opacity: i === f.destinations.length - 1 ? .25 : undefined }}>↓</button>
                {editable && (
                  <button type="button" aria-label={`Remove ${d}`}
                    onClick={() => setF(x => ({ ...x, destinations: x.destinations.filter((_, j) => j !== i) }))}>✕</button>
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
      {editable && (
        <button className="btn btn-primary btn-sm" onClick={() => {
          updateTrip(trip.id, {
            name: f.name, startLocation: f.startLocation,
            destinations: f.destinations.map(s => s.trim()).filter(Boolean),
            travellers: Math.max(1, f.travellers),
            budgetPerPersonInr: Math.max(0, f.budget),
            transportMode: f.transportMode, travelStyle: f.travelStyle,
          })
          toast('Trip settings updated')
        }}>Save settings</button>
      )}
    </div>
  )
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
        }
      }
    }
  }
  return undefined
}
