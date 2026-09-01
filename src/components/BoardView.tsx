// ============ Board — spatial group coordination (Calm Travel Intelligence §6.4) ============
// A supplementary planning mode: the route stays visible on a pinned map while
// day columns float above it for kanban-style cross-day rearrangement. Every
// change routes through the same applyChange → impact-preview flow as the
// Timeline, so nothing persists without its consequence visible first.
import React, { useMemo, useState } from 'react'
import type { Trip, ItineraryStop } from '../data/types'
import { computeTotals, computeHealth, collectWarnings, minutesToHM, formatInr } from '../lib/engine'
import type { ScheduleWarning } from '../lib/engine'
import type { ImpactResult } from '../lib/impact'
import { useTimeFormat, formatHM } from '../lib/timefmt'
import { stopKindOf, STOP_KIND_LABELS } from '../lib/stopKind'
import { useDb } from '../store/store'
import { useReorder } from './ui'
import { TripMap } from './TripMap'

export function BoardView({ trip, editable, applyChange, health, totals, onOpenOverview, onOpenTimeline }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
  health: ReturnType<typeof computeHealth>
  totals: ReturnType<typeof computeTotals>
  onOpenOverview: () => void
  onOpenTimeline: () => void
}) {
  const db = useDb()
  const days = useMemo(() => [...trip.days].sort((a, b) => a.index - b.index), [trip])
  // Column focus → the map shows just that day's route ('all' = whole trip).
  const [focusedDay, setFocusedDay] = useState<number | 'all'>('all')

  // warnings grouped by day — same parse used by the Timeline (§6.3 in-day state)
  const dayWarnings = useMemo(() => {
    const map: Record<number, ScheduleWarning[]> = {}
    for (const w of collectWarnings(trip)) {
      const m = /^Day (\d+):/.exec(w.title)
      if (m) { const di = Number(m[1]) - 1; (map[di] ??= []).push(w) }
    }
    return map
  }, [trip])
  const warnDayCount = Object.keys(dayWarnings).length

  const openDecisions = db.decisions.filter(d => d.tripId === trip.id && d.status === 'open').length
  const optionalExpenses = trip.expenses.filter(e => e.optional).length

  /** Same cross-day move helper as the Timeline — every Board mutation previews. */
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

  function fitToTrip() { setFocusedDay('all') }
  return (
    <div>
      {/* ---- slim board header (above the map board, normal flow) ---- */}
      <div className="row-between board-head">
        <div>
          <h2>Trip Board</h2>
          <p className="muted small">Arrange flexible stops across days while keeping the real route in view.</p>
        </div>
        {editable && (
          <button className="btn btn-primary btn-sm" onClick={onOpenTimeline}>＋ Add a stop</button>
        )}
      </div>

      <div className="board">
        {/* pinned route map — the existing component, no second map system (§8 guardrail) */}
        <div className="board-map">
          <TripMap trip={trip} focusDay={focusedDay} />
        </div>

        {/* floating info card (normal-flow top bar above the columns; the map still
            paints behind everything, so nothing can cover a column) */}
        <div className="board-topbar">
          <div className="glass board-info">
            <b>Plan by day, see the route</b>
            <span className="small muted" style={{ display: 'block', marginTop: 3 }}>
              Drag a stop to another day — its impact previews before saving. Click a column to focus its route.
            </span>
            <button type="button" className="board-fit" onClick={fitToTrip}>🎯 Fit route</button>
          </div>

          {/* Trip Pulse — health, decisions, budget (doc §6.4) */}
          <div className="glass board-pulse">
            <span className="pulse-label">Trip pulse</span>
            <div className="board-pulse-row">
              <b className={`health-num-big ${health.score >= 70 ? 'ok' : health.score >= 40 ? 'mid' : 'bad'}`}>
                {health.score}
              </b>
              <span className={`board-pulse-band ${health.score >= 70 ? 'ok' : health.score >= 40 ? 'mid' : 'bad'}`}>
                {health.band}{warnDayCount > 0 ? ' — needs attention' : ''}
              </span>
            </div>
            <div className="health-bar" aria-hidden="true">
              <i className={health.score >= 70 ? 'ok' : health.score >= 40 ? 'mid' : 'bad'} style={{ width: `${Math.max(4, health.score)}%` }} />
            </div>
            <div className="board-pulse-lines">
              {warnDayCount > 0 && <span>⚠ {warnDayCount} route day{warnDayCount === 1 ? '' : 's'} overloaded</span>}
              {openDecisions > 0 && <span>{openDecisions} open decision{openDecisions === 1 ? '' : 's'}</span>}
              <span>{formatInr(totals.totalCostInr)} est. budget{optionalExpenses > 0 ? ` · ${optionalExpenses} optional item${optionalExpenses === 1 ? '' : 's'}` : ''}</span>
            </div>
            <button type="button" className="board-pulse-link" onClick={onOpenOverview}>Open health advice →</button>
          </div>
        </div>

        {/* floating day columns — near-opaque so cards stay readable (§3.1) */}
        <div className="board-cols" role="list" aria-label="Trip days">
          {days.map(day => (
            <BoardColumn key={day.id} day={day} editable={editable}
              warnings={dayWarnings[day.index] ?? []}
              focused={focusedDay === day.index}
              onToggleFocus={(focus) => setFocusedDay(focus ? day.index : focusedDay === day.index ? 'all' : day.index)}
              onMoveStopIn={handleMoveStopInto} />
          ))}
        </div>
      </div>
    </div>
  )
}
function BoardColumn({ day, editable, warnings, focused, onToggleFocus, onMoveStopIn }: {
  day: Trip['days'][number]
  editable: boolean
  warnings: ScheduleWarning[]
  focused: boolean
  onToggleFocus: (focus: boolean) => void
  onMoveStopIn: (stopId: string, fromDay: number, toDay: number, position: number) => void
}) {
  const timeFormat = useTimeFormat()
  const ordered = useMemo(
    () => [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay),
    [day],
  )
  const { dndHandlers, dayDropHandlers, dragging, over, foreignOver } = useReorder(
    ordered,
    () => { /* within-day reorder of a board column is deferred to Timeline — the
               board's job is cross-day move; same-row placement still works via
               the gap zones, so keep onMove a no-op for same-day drags. */ },
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
  const sev = warnings.some(w => w.severity === 'high') ? 'high'
    : warnings.some(w => w.severity === 'medium') ? 'medium' : undefined
  const topWarn = warnings[0]
  const totalStops = day.stops.filter(s => s.status !== 'rejected').length

  return (
    <div className={`board-col${focused ? ' board-col--focused' : ''}`} role="listitem">
      <button type="button" className="board-col-head" onClick={() => onToggleFocus(!focused)}
        aria-pressed={focused} title={focused ? `Show the whole route again` : `Focus the map on Day ${day.index + 1}`}>
        <span className="day-badge"><small>DAY</small><b>{day.index + 1}</b></span>
        <span className="board-col-title">
          <b>{day.title || `Day ${day.index + 1}`}</b>
          <span className="small muted">{totalStops} stop{totalStops === 1 ? '' : 's'}{focused ? ' · focused' : ''}</span>
        </span>
        {topWarn && <span className={`day-warn-pill ${sev === 'high' ? 'sev-high' : ''}`}>⚠ {topWarn.title.replace(/^Day \d+: /, '')}{warnings.length > 1 ? ` +${warnings.length - 1}` : ''}</span>}
      </button>

      <div className="board-col-stops">
        {ordered.map((s, i) => {
          const kind = stopKindOf(s)
          return (
            <div key={s.id}
              className={`board-stop stop-card kind-${kind} status-${s.status} ${dragging === i ? 'dragging' : ''} ${over === i && dragging !== null && dragging !== i ? 'drag-over' : ''} ${foreignOver === i && dragging === null ? 'foreign-over' : ''}`}
              {...(editable ? dndHandlers(i) : {})}>
              <div className={`stop-num cat-${s.category}`}>{i + 1}</div>
              <div className="stop-main">
                <div className="stop-toprow">
                  <span className="stop-title">{s.title}</span>
                  <span className={`stop-kind-tag kind-${kind}`}>{STOP_KIND_LABELS[kind]}</span>
                </div>
                <div className="stop-meta">
                  {s.locationName && <span>📍 {s.locationName}</span>}
                  <span>⏱ {minutesToHM(s.visitMinutes)}</span>
                  {s.departTime && s.arrivalTime && (
                    <span>{formatHM(s.departTime, timeFormat)}–{formatHM(s.arrivalTime, timeFormat)}</span>
                  )}
                  {s.entryFeeInrPerPerson > 0 && <span>₹{s.entryFeeInrPerPerson}/person</span>}
                </div>
              </div>
            </div>
          )
        })}
        <div className={`board-col-zone${foreignOver === ordered.length && dragging === null && editable ? ' foreign-over' : ''}`}
          {...(editable ? dayDropHandlers(ordered.length) : {})}
          role="note">
          {editable ? (
            <>
              <b>＋ Add or drop a stop</b>
              <span className="small">Impact preview before saving</span>
            </>
          ) : (
            <span className="small">Day {day.index + 1}</span>
          )}
        </div>
      </div>
    </div>
  )
}