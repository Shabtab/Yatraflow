// ============ Trip workspace — Timeline tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes DaySection, DayWeatherChip, TravelPanel, HaltPlanRow, DaySpark,
// MoveStopModal and ClampedText — the whole timeline hot path.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, Ban, Car, ChevronDown, ChevronUp, CircleCheck, CircleHelp, Clock, CloudRain, CloudSun,
  BedDouble, Bike, Bus, CarTaxiFront, Coffee, Copy, Droplets, ExternalLink, Eye, Flag, Fuel, MapPin,
  MoveHorizontal, PenLine, Pencil, Pin, Plane, Plus, RotateCcw, Route as RouteIcon, Search, Shuffle,
  Ticket, TrainFront, Trash2, TriangleAlert, Utensils, X,
} from 'lucide-react'
import type { Trip, ItineraryStop } from '../../data/types'
import { updateTrip, setStopStatus } from '../../store/store'
import {
  computeTotals, simulateDay, originOf, getAssumptions, coLocates, minutesToHM, hmToMinutes, formatInr,
  predecessorOf, nextAfter, collectWarnings, buildJourney, addMinutesToClock, FUEL_PRICE_INR_PER_L,
  computeCategoryBias, optimizeDayOrder, dayRoadPolyline, roadScaleRatio,
} from '../../lib/engine'
import { MODE_SPEED } from '../../lib/engine'
import type { LegEstimate, ScheduleWarning, Journey } from '../../lib/engine'
import type { OptimizeDayResult } from '../../lib/engine'
import type { ImpactResult } from '../../lib/impact'
import { loadDayCollapsed, saveDayCollapsed } from '../../lib/uiPrefs'
import { openExternal } from '../../lib/native'
import { useTimeFormat, formatHM, formatHMRange } from '../../lib/timefmt'
import { scrollBehavior } from '../../lib/motion'
import { stopKindOf, STOP_KIND_LABELS } from '../../lib/stopKind'
import { statusLabel } from '../../lib/labels'
import { Chip, Modal, EmptyState, toast, useReorder } from '../../components/ui'
import { StopEditor, type StopFormValues } from '../../components/StopEditor'
import { stopInitialValues, stopLegContext, stopEditorKey, stopDayIndex, type StopEditorTarget } from '../../lib/stopForm'
import { useSuggestionCache } from '../../hooks/useSuggestionCache'
import { searchNearbyPois, searchNearbyPoisMulti, searchCitiesAlong, corridorAnchors, reasonForHit, filterPlannedNearby, asymmetricDetourMinutes, googleEnabled, googleCitiesAlong } from '../../lib/geocode'
import type { PlaceHit, SegmentHit } from '../../lib/geocode'
import { kmFromStartForHit, type HaltPurpose } from '../../lib/providers/hits'
import { segmentsFromPlan, assignSegmentHits, annotateSegmentHits, type HaltPlanItem } from '../../lib/ridePlan'
import { daySlackMin, slackPrompt, pickSlackHit, visitMinutesForCategory } from '../../lib/slackPrompts'
import { googleMapsDirectionsUrl } from '../../lib/externalMaps'
import { pointAtKm } from '../../lib/geo'
import type { LucideIcon } from 'lucide-react'
import { MetaIcon } from '../../components/icons'
import { fetchDailyWeather, forecastAvailable, isoAddDays, wmoInfo } from '../../lib/weather'
import type { DayWeather } from '../../lib/weather'
import { cap } from './shared'

// ================= Timeline =================

/** Shared empty array so the memoized DaySections' `warnings` prop keeps a
 *  stable reference for days without warnings (`?? []` would defeat the memo). */
const NO_WARNINGS: ScheduleWarning[] = []

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
      {info.icon} {Math.round(w.tempMaxC)}°<Droplets size={11} aria-hidden style={{ verticalAlign: '-1px', marginLeft: 4, marginRight: 2 }} />{w.rainChancePct}%
    </span>
  )
}

// ================= Timeline =================

export function TimelineTab({ trip, editable, applyChange, legCorrections, suggestionCache, onOpenBoard }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
  legCorrections?: Record<string, LegEstimate>
  suggestionCache: ReturnType<typeof useSuggestionCache>
  /** M5: the doc's §6.3 "Open in Board" bridge — Board now exists. */
  onOpenBoard?: () => void
}) {
  const [editorState, setEditorState] = useState<StopEditorTarget>(null)
  const [moveModalStop, setMoveModalStop] = useState<ItineraryStop | null>(null)

  // Sorted once per trip change — a stable array of stable day references so
  // the memoized DaySections below only re-render when their own data changes.
  const days = useMemo(() => [...trip.days].sort((a, b) => a.index - b.index), [trip.days])

  // M3.3: every DaySection prop below must keep a stable identity between
  // commits that don't touch the trip, or the React.memo on DaySection never
  // bites (an unrelated store commit re-renders TimelineTab via the tab counts).
  const handleAdd = useCallback((dayIndex: number) => setEditorState({ mode: 'add', dayIndex }), [])
  const handleEdit = useCallback((stopId: string) => setEditorState({ mode: 'edit', stopId }), [])

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
      }, 'edit', stopDayIndex(trip, stopId))
    }
    setEditorState(null)
  }

  // Deletions go through the impact-preview flow, whose Keep / Remove buttons
  // already act as the confirmation + undo step for this destructive action.
  const handleDelete = useCallback((stopId: string, dayIndex: number) => {
    applyChange(draft => {
      for (const day of draft.days) day.stops = day.stops.filter(s => s.id !== stopId)
    }, 'remove', dayIndex)
  }, [applyChange])

  const handleMoveWithinDay = useCallback((fromIdx: number, toIdx: number, dayIndex: number) => {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      const arr = [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)
      arr.forEach((s, i) => { s.orderInDay = i + 1 })
      day.stops = arr
    }, 'reorder', dayIndex)
  }, [applyChange])

  /** Optimise-day commit: replace a day's stop order wholesale (ids), keeping
   *  every stop — the reorder goes through the same impact-preview gate as a
   *  manual drag. */
  const handleReorderDay = useCallback((dayIndex: number, orderedIds: string[]) => {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      const byId = new Map(day.stops.map(s => [s.id, s]))
      const reordered = orderedIds.map(id => byId.get(id)!).filter(Boolean)
      // any stop the optimizer left out (safety net) rides at the end
      const rest = day.stops.filter(s => !orderedIds.includes(s.id))
      day.stops = [...reordered, ...rest]
      day.stops.forEach((s, i) => { s.orderInDay = i + 1 })
    }, 'reorder', dayIndex)
  }, [applyChange])

  /** Cross-day drag: lift a stop out of its day and insert it at `position` of `toDayIndex`. */
  const handleMoveStopInto = useCallback((stopId: string, fromDayIndex: number, toDayIndex: number, position: number) => {
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
  }, [applyChange])

  // warnings grouped by day index — powers the per-day progress-bar colour
  const dayWarnings = useMemo(() => {
    const map: Record<number, ScheduleWarning[]> = {}
    for (const w of collectWarnings(trip)) {
      const m = /^Day (\d+):/.exec(w.title)
      if (m) { const di = Number(m[1]) - 1; (map[di] ??= []).push(w) }
    }
    return map
  }, [trip])
  const warnDayCount = Object.keys(dayWarnings).length
  // M4: sticky trip-total strip (doc §6.3) — same engine numbers as Overview.
  const totals = useMemo(() => computeTotals(trip, legCorrections), [trip, legCorrections])

  /** Day-jump rail: scroll a long timeline straight to a day card. */
  function jumpToDay(dayIndex: number) {
    const el = document.getElementById(`day-card-${dayIndex}`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight
    if (!isVisible) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }

  /** Inline day rename — a lightweight label change, applied directly (no impact preview). */
  const handleRenameDay = useCallback((dayIndex: number, title: string) => {
    updateTrip(trip.id, { days: trip.days.map(d => d.index === dayIndex ? { ...d, title: title.trim() || undefined } : d) })
    toast('Day renamed')
  }, [trip])

  /** Duplicate this day's stops onto the next day (base-camp style planning). */
  const handleCopyDay = useCallback((dayIndex: number) => {
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
  }, [applyChange])

  /** One-click add from the empty-day suggestions (route continuation / nearby POI). */
  const handleAddQuickStop = useCallback((dayIndex: number, stop: Omit<ItineraryStop, 'id' | 'orderInDay'>) => {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      day.stops.push({ ...stop, id: 'pending_' + Math.random().toString(36).slice(2), orderInDay: day.stops.length + 1 })
    }, 'add', dayIndex)
  }, [applyChange])

  /** Ride start time for a day — a lightweight plan field, applied directly (like rename). */
  const handleSetDayStart = useCallback((dayIndex: number, time: string) => {
    updateTrip(trip.id, { days: trip.days.map(d => d.index === dayIndex ? { ...d, startTime: time || undefined } : d) })
    toast(time ? `Day ${dayIndex + 1} now starts ${time}` : 'Ride start reset to the default')
  }, [trip])

  /** Insert a batch of long-ride break halts, each at a user-chosen km point, ordered by
      distance along the route so the arrival clock and map reflect true stop order. Impact
      preview applies the whole-day change. */
  const handleAddPlannedHalts = useCallback((dayIndex: number, halts: { km: number; stop: Omit<ItineraryStop, 'id' | 'orderInDay'> }[]) => {
    if (halts.length === 0) return
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      const j = buildJourney(draft, day, legCorrections) // existing stop → km lookup
      // Position stops on the day's ROAD polyline when the routing layer has
      // resolved one — the halt planner's km are road km, so ordering against
      // the straight-line chord would slot the halt at the wrong place.
      const road = dayRoadPolyline(j.points, legCorrections)
      const posOf = (p: { lat: number; lng: number }) => kmFromStartForHit({ latitude: p.lat, longitude: p.lng }, road ?? j.points) ?? 0
      const merged = [
        ...day.stops.map(s => ({ km: posOf(s), s: structuredClone(s) })),
        ...halts.map(h => ({ km: h.km, s: { ...h.stop, id: 'pending_' + Math.random().toString(36).slice(2), orderInDay: 0 } })),
      ].sort((a, b) => a.km - b.km)
      day.stops = merged.map((m, i) => ({ ...m.s, orderInDay: i + 1 }))
    }, 'add', dayIndex)
  }, [applyChange, legCorrections])

  const handleStatus = useCallback((stop: ItineraryStop, status: ItineraryStop['status']) => {
    // Status flips are lightweight group signals — applied directly.
    setStopStatus(trip.id, status, stop.id)
    toast(`“${stop.title}” marked ${status === 'needs-booking' ? 'needs booking' : status}`)
  }, [trip.id])

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div>
          <h2>Day-by-day timeline</h2>
          <p className="muted small">Drag stops to reorder within a day — or drop them onto another day to move them there. On touch devices: press and hold a stop, then drag it. Every change shows its impact before saving.</p>
        </div>
        {editable && (
          <div className="row" style={{ gap: 8 }}>
            {onOpenBoard && (
              <button className="btn btn-outline btn-sm" onClick={onOpenBoard} title="Arrange stops across days with the route in view">Open in Board →</button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => setEditorState({ mode: 'add', dayIndex: 0 })}>+ Add stop</button>
          </div>
        )}
      </div>

      <div className="tl-total-strip">
        <span className="tl-total-label">Trip total</span>
        <span>{Math.round(totals.totalDistanceKm).toLocaleString('en-IN')} km</span>
        <span className="tl-total-dot" aria-hidden="true">·</span>
        <span>{minutesToHM(totals.totalTravelMinutes)} driving</span>
        <span className="tl-total-dot" aria-hidden="true">·</span>
        <span>{formatInr(totals.totalCostInr)} estimated</span>
        {warnDayCount > 0 && (
          <span className="tl-total-warn"><TriangleAlert size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{warnDayCount} day{warnDayCount !== 1 ? 's' : ''} need{warnDayCount === 1 ? 's' : ''} attention</span>
        )}
      </div>

      {days.length >= 4 && (
        <div className="day-rail" role="navigation" aria-label="Jump to day">
          <span className="day-rail-label">Jump to day</span>
          <div className="day-rail-chips">
            {days.map(d => {
              const hasWarn = (dayWarnings[d.index] ?? []).length > 0
              return (
                <button key={d.id} type="button" className={`day-rail-chip ${hasWarn ? 'warn' : ''}`} onClick={() => jumpToDay(d.index)}>
                  Day {d.index + 1}{hasWarn && <TriangleAlert size={11} aria-hidden style={{ verticalAlign: '-1px', marginLeft: 3 }} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {days.map(day => (
        <DaySection key={day.id} day={day} trip={trip} editable={editable} legCorrections={legCorrections} suggestionCache={suggestionCache} dayTotals={totals.byDay[Math.min(day.index, totals.byDay.length - 1)]}
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onMoveWithinDay={handleMoveWithinDay}
          onReorderDay={handleReorderDay}
          onMoveBetweenDays={setMoveModalStop}
          onMoveStopIn={handleMoveStopInto}
          onRenameDay={handleRenameDay}
          onCopyDay={handleCopyDay}
          onAddQuickStop={handleAddQuickStop}
          onSetDayStart={handleSetDayStart}
          onAddPlannedHalts={handleAddPlannedHalts}
          warnings={dayWarnings[day.index] ?? NO_WARNINGS}
          onStatus={handleStatus}
        />
      ))}

      <StopEditor
        open={!!editorState}
        onClose={() => setEditorState(null)}
        initial={stopInitialValues(editorState, trip)}
        resetKey={stopEditorKey(editorState)}
        onSave={handleSave}
        dayLabel={editorState?.mode === 'add' ? `Day ${editorState.dayIndex + 1}` : undefined}
        legContext={stopLegContext(editorState, trip)}
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
          }, 'move-day', moveModalStop ? stopDayIndex(trip, stopId) : 0)
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

// React.memo on the timeline hot path: TimelineTab re-renders on every store
// commit (the shell's useDb feeds the tab counts), but with stable props each
// DaySection now bails out unless ITS day/trip data actually changed (M3.1 made
// trip references immutable, so `day`/`trip` are stable between commits).
const DaySection = React.memo(function DaySection({ day, trip, editable, onAdd, onEdit, onDelete, onMoveWithinDay, onReorderDay, onMoveBetweenDays, onMoveStopIn, onRenameDay, onCopyDay, onAddQuickStop, onSetDayStart, onAddPlannedHalts, warnings, onStatus, legCorrections, suggestionCache, dayTotals }: {
  day: Trip['days'][number]
  trip: Trip
  editable: boolean
  legCorrections?: Record<string, LegEstimate>
  suggestionCache: ReturnType<typeof useSuggestionCache>
  /** this day's slice of computeTotals().byDay — transport + expenses + entry fees */
  dayTotals?: { dayIndex: number; expensesInr: number; transportInr: number; totalInr: number; stops: number; distanceKm: number }
  onAdd: (dayIndex: number) => void
  onEdit: (stopId: string) => void
  onDelete: (stopId: string, dayIndex: number) => void
  onMoveWithinDay: (from: number, to: number, dayIndex: number) => void
  /** optimise-day commit: wholesale reorder by stop ids (impact-preview gated) */
  onReorderDay: (dayIndex: number, orderedIds: string[]) => void
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
  // ---- Optimize day order (anti-crisscross) ----
  // Preview is computed from the CURRENT day snapshot (pure engine call); the
  // apply goes through applyChange so the impact preview guards the commit.
  const [optPreview, setOptPreview] = useState<OptimizeDayResult | null>(null)
  const optResult = useMemo(
    () => optimizeDayOrder(originOf(trip, day.index), [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)),
    [trip, day],
  )
  // The optimizer's objective is straight-line (pairwise road km between
  // arbitrary stops would need N² route calls), but the numbers it SHOWS must
  // speak the road km the travel panel displays — rescale by the day's
  // road-vs-chord ratio from the corrected legs (1 = no road data yet).
  const roadRatio = useMemo(() => roadScaleRatio(journey.points, legCorrections), [journey, legCorrections])
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
        <div className="day-badge"><small>Day</small><b>{day.index + 1}</b></div>
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
          ) : editable ? (
            <button type="button" className="day-title-btn" onClick={() => { setTitleDraft(day.title ?? ''); setEditingTitle(true) }}
              title="Click to rename this day"
              aria-label={`Rename Day ${day.index + 1}`}
            >
              {day.title ?? `Day ${day.index + 1}`}
            </button>
          ) : (
            <h3>{day.title ?? `Day ${day.index + 1}`}</h3>
          )}
          <div className="small muted num">
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
        {/* Per-day cost + time-at-stops: intelligence the engine already
            computes (computeTotals().byDay + simulateDay dwell), surfaced where
            the plan is edited. Hidden while collapsed so a folded day's header
            stays calm. */}
        {!collapsed && dayTotals != null && dayTotals.totalInr > 0 && (
          <span
            className="day-cost-chip"
            title={`≈ ${formatInr(dayTotals.transportInr)} travel · ${formatInr(dayTotals.expensesInr)} day costs (incl. entry fees)`}
          >
            ≈ {formatInr(dayTotals.totalInr)}
          </span>
        )}
        {!collapsed && sim.dwellMinutes > 0 && (
          <span className="day-dwell-chip" title="Time at the stops (visits + buffers) — driving time is in the summary line">
            {minutesToHM(sim.dwellMinutes)} at stops
          </span>
        )}
        {sev !== 'ok' && (
          <span className={`day-warn-pill sev-${sev}`} title={warnings.map(w => w.title).join('\n')}>
            <TriangleAlert size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{warnings[0].title.replace(/^Day \d+:\s*/, '')}{warnings.length > 1 ? ` +${warnings.length - 1}` : ''}
          </span>
        )}
        {ordered.filter(s => s.status !== 'rejected').length >= 2 && <DaySpark stops={ordered.filter(s => s.status !== 'rejected')} />}
        {editable && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {optResult.changed && !isStayDay && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setOptPreview(optResult)}
                title={`Reorder this day's stops to cut crisscrossing — saves ~${Math.round((optResult.beforeKm - optResult.afterKm) * roadRatio)} km of travel`}
              ><RouteIcon size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Optimise{optResult.beforeKm - optResult.afterKm > 0 ? ` (−${Math.round((optResult.beforeKm - optResult.afterKm) * roadRatio)} km)` : ''}</button>
            )}
            <button
              className="btn btn-outline btn-sm"
              disabled={ordered.length === 0 || day.index + 1 >= trip.days.length}
              onClick={() => onCopyDay(day.index)}
              title={ordered.length ? `Copy these stops to Day ${day.index + 2}` : 'Nothing to copy yet'}
            ><Copy size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Copy</button>
            <button className="btn btn-outline btn-sm" onClick={() => onAdd(day.index)}>+ Add here</button>
          </div>
        )}
      </div>

      {!collapsed && <>
      {commitmentsToday.map(fc => (
        <div key={fc.id} className="warn-item sev-low" style={{ marginBottom: 8 }}>
          <span className="warn-icon"><Pin size={13} aria-hidden /></span>
          <div>
            <div className="warn-title">{fc.title}</div>
            <div className="warn-fix">Fixed at {formatHM(fc.time, timeFormat)}{fc.notes ? ` — ${fc.notes}` : ''}</div>
          </div>
        </div>
      ))}

      {/* Warning state lives inside the affected day (doc §6.3) — the "Day N:"
          prefix is redundant here, the pill + card already say which day. */}
      {warnings.map((w, i) => (
        <div key={i} className={`warn-item ${w.severity === 'high' ? 'sev-high' : w.severity === 'medium' ? '' : 'sev-low'}`} style={{ marginBottom: 8 }}>
          <span className="warn-icon">{w.severity === 'high' ? <Ban size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}</span>
          <div>
            <div className="warn-title">{w.title.replace(/^Day \d+:\s*/, '')}</div>
            {w.fix && <div className="warn-fix">{w.fix}</div>}
          </div>
        </div>
      ))}

      <TravelPanel trip={trip} day={day} editable={editable} journey={journey} suggestionCache={suggestionCache} legCorrections={legCorrections}
        onSetDayStart={onSetDayStart} onAddPlannedHalts={onAddPlannedHalts} />

      {ordered.length === 0 && (<>
        <EmptyState icon={<CloudSun size={38} aria-hidden />} title="Nothing planned yet" body="Add your first stop for this day — or drag one here from another day."
          action={editable ? <button className="btn btn-primary btn-sm" onClick={() => onAdd(day.index)}>+ Add stop</button> : undefined} />
        {editable && ((nextAnchor && !alreadyAtNext) || nearby.length > 0) && (
          <div className="day-suggest">
            {nextAnchor && !alreadyAtNext && (
              <button className="chip-btn" onClick={() => onAddQuickStop(day.index, nextWaypointStop(nextAnchor))} title="Add this as a route waypoint">
                <ArrowRight size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Continue to {nextAnchor.name.replace(/ \((start|end)\)$/, '')}
              </button>
            )}
            {nearby.map(h => (
              <button key={h.name} className="chip-btn" onClick={() => onAddQuickStop(day.index, poiQuickStop(h))} title="Add this nearby idea">
                <Plus size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{h.name}
              </button>
            ))}
          </div>
        )}
      </>)}

      <div className={`tl${dragging !== null ? ' is-dragging' : ''}`}>
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
                    <span className="travel-anchor-ico"><MapPin size={13} aria-hidden /></span>
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
                  <span className="travel-anchor-ico">{i === 0 || isFinal ? <Flag size={13} aria-hidden /> : <MapPin size={13} aria-hidden />}</span>
                  <span>
                    {i === 0 ? `Start — ${cleanName}` : isFinal ? `Destination — ${cleanName}` : cleanName}
                  </span>
                  {isFinal && <span className="small muted" style={{ marginLeft: 6 }}>arrives ~{sim.arrivalTimes[i] ? formatHM(sim.arrivalTimes[i], timeFormat) : '--:--'}</span>}
                </div>
              </div>
            )
          }
          const kind = stopKindOf(s)
          return (
            <React.Fragment key={s.id}>
              <div
                className="tl-row"
                {...(editable ? dndHandlers(i) : {})}
              >
                <div className="tl-gutter" aria-hidden="true">
                  <span className="tl-time tl-arr">{sim.arrivalTimes[i] ? formatHM(sim.arrivalTimes[i], timeFormat) : '--:--'}</span>
                  <span className="tl-line" />
                  <span className="tl-time tl-dep">{sim.departures[i] ? formatHM(sim.departures[i], timeFormat) : '--:--'}</span>
                </div>
                <div
                  className={`stop-card kind-${kind} status-${s.status} ${dragging === i ? 'dragging' : ''} ${over === i && dragging !== null && dragging !== i ? 'drag-over' : ''} ${foreignOver === i && dragging === null ? 'foreign-over' : ''}`}
                >
                <div className={`stop-num cat-${s.category}`}>{i + 1}</div>
              <div className="stop-main">
                <div className="stop-toprow">
                  <span className="stop-title">{s.title}</span>
                  <Chip tone={statusTone(s.status)}>{statusLabel(s.status)}</Chip>
                  <span className={`stop-kind-tag kind-${kind}`}>{STOP_KIND_LABELS[kind]}</span>
                  {s.priority === 'must-do' && <Chip tone="danger">Must do</Chip>}
                  {s.priority === 'optional' && <Chip tone="saffron">Optional</Chip>}
                  {s.weatherSensitive && <Chip tone="info"><CloudRain size={11} aria-hidden style={{ verticalAlign: '-1px', marginRight: 3 }} />weather-sensitive</Chip>}
                </div>
                <div className="stop-meta">
                  <span><MetaIcon icon={ MapPin } tone="place" />{s.locationName}</span>
                  <span><MetaIcon icon={ Clock } tone="time" />{minutesToHM(s.visitMinutes)}</span>
                  {s.openTime && <span><MetaIcon icon={ Clock } tone="time" />{formatHMRange(s.openTime, s.closeTime, timeFormat)}</span>}
                  <span><MetaIcon icon={ Ticket } tone="ticket" />₹{s.entryFeeInrPerPerson}/person</span>
                  <span><MetaIcon icon={ Car } tone="money" />₹{s.transportCostInrTotal} transport</span>
                  {s.departTime && s.arrivalTime && (
                    <span><MetaIcon icon={ Clock } tone="time" />dep {formatHM(s.departTime, timeFormat)} · arr {formatHM(s.arrivalTime, timeFormat)}{s.legDistanceKm ? ` · ${s.legDistanceKm.toFixed(0)} km` : ''}</span>
                  )}
                </div>
                {s.description && <ClampedText className="stop-desc">{s.description}</ClampedText>}
                {s.notes && <ClampedText className="stop-desc muted"><PenLine size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{s.notes}</ClampedText>}
                {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="small" onClick={e => { e.preventDefault(); openExternal(s.sourceUrl!) }}>Source <ExternalLink size={11} aria-hidden style={{ verticalAlign: '-2px', marginLeft: 2 }} /></a>}
              </div>
              {editable && (
                <div className="stop-actions">
                  <div className="move-btns">
                    <button className="move-btn" disabled={i === 0} onClick={() => moveUp(i)} aria-label={`Move ${s.title} up`}><ChevronUp size={12} aria-hidden /></button>
                    <button className="move-btn" disabled={i === ordered.length - 1} onClick={() => moveDown(i)} aria-label={`Move ${s.title} down`}><ChevronDown size={12} aria-hidden /></button>
                  </div>
                  <button className="icon-btn" onClick={() => onEdit(s.id)} aria-label={`Edit ${s.title}`}><Pencil size={14} aria-hidden /></button>
                  {s.status !== 'confirmed'
                    ? <button className="icon-btn" title="Mark confirmed" aria-label={`Mark ${s.title} confirmed`} onClick={() => onStatus(s, 'confirmed')}><CircleCheck size={14} aria-hidden /></button>
                    : <button className="icon-btn" title="Mark maybe" aria-label={`Mark ${s.title} maybe`} onClick={() => onStatus(s, 'maybe')}><CircleHelp size={14} aria-hidden /></button>}
                  <button className="icon-btn" title="Move to another day" aria-label={`Move ${s.title} to another day`} onClick={() => onMoveBetweenDays(s)}><MoveHorizontal size={14} aria-hidden /></button>
                  <button className="icon-btn" onClick={() => onDelete(s.id, day.index)} aria-label={`Delete ${s.title}`}><Trash2 size={14} aria-hidden /></button>
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
                      <MetaIcon icon={ Car } tone="money" />~{leg.distanceKm.toFixed(0)} km · ~{Math.round(leg.durationMinutes)} min from {leg.fromTitle.replace(/ \((start|end)\)$/, '')} · est ₹{Math.round(leg.distanceKm * (A.inrPerKm ?? 8))} ({A.mode})
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
                    <MetaIcon icon={ Car } tone="money" />~{last.legIn.distanceKm.toFixed(0)} km · ~{Math.round(last.legIn.durationMinutes)} min from {last.legIn.fromTitle} · est ₹{Math.round(last.legIn.distanceKm * (A.inrPerKm ?? 8))} ({A.mode})
                  </div>
                </div>
              )}
              <div className="tl-row tl-anchor">
                <div className="tl-gutter" aria-hidden="true">
                  <span className="tl-time tl-arr">{last.arrive ? formatHM(last.arrive, timeFormat) : '--:--'}</span>
                </div>
                <div className="travel-endpoint">
                  <span className="travel-anchor-ico"><Flag size={13} aria-hidden /></span>
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

      {/* Optimize-day preview: the before/after is straight-line distance math
          from the pure engine helper; committing goes through the same
          impact-preview gate as a manual drag (onReorderDay → applyChange). */}
      <Modal
        open={!!optPreview}
        onClose={() => setOptPreview(null)}
        title={`Optimise Day ${day.index + 1}`}
      >
        {optPreview && <>
          <p className="hint-text" style={{ margin: '0 0 12px' }}>
            Reorders the day's stops into the shortest route from where you start the day — grouping nearby sights,
            food and activities so you spend less time in transit. Anchors (your base and the day's destination)
            stay put; you can still drag anything afterwards.
          </p>
          <div className="opt-delta">
            <div className="opt-delta-cell">
              <div className="k">Travel distance</div>
              <div className="v">{Math.round(optPreview.beforeKm * roadRatio)} km → <b>{Math.round(optPreview.afterKm * roadRatio)} km</b></div>
              <div className="save">−{Math.round((optPreview.beforeKm - optPreview.afterKm) * roadRatio)} km</div>
            </div>
            <div className="opt-delta-cell">
              <div className="k">Est. driving time</div>
              <div className="v">{minutesToHM(Math.round(optPreview.beforeKm * roadRatio / (A.avgSpeedKmph || 40) * 60))} → <b>{minutesToHM(Math.round(optPreview.afterKm * roadRatio / (A.avgSpeedKmph || 40) * 60))}</b></div>
              <div className="save">−{Math.round((optPreview.beforeKm - optPreview.afterKm) * roadRatio / (A.avgSpeedKmph || 40) * 60)} min</div>
            </div>
          </div>
          <div className="opt-order-list" aria-label="New stop order">
            {optPreview.stops.filter(s => s.status !== 'rejected').map((s, i) => (
              <div key={s.id} className="opt-order-row">
                <span className="opt-order-n num">{i + 1}</span>
                <span>{s.title}{s.auto ? ' (anchor)' : ''}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" onClick={() => {
              onReorderDay(day.index, optPreview.stops.map(s => s.id))
              toast(`Day ${day.index + 1} optimised — saved ~${Math.round((optPreview.beforeKm - optPreview.afterKm) * roadRatio)} km of crisscrossing`)
              setOptPreview(null)
            }}>Apply new order</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setOptPreview(null)}>Not now</button>
          </div>
        </>}
      </Modal>
    </div>
  )
})

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
    car: 'Car', motorcycle: 'Motorcycle', taxi: 'Taxi', bus: 'Bus',
    train: 'Train', flight: 'Flight', mixed: 'Mixed',
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
function TravelPanel({ trip, day, editable, journey, onSetDayStart, onAddPlannedHalts, suggestionCache, legCorrections }: {
  trip: Trip
  day: Trip['days'][number]
  editable: boolean
  journey: Journey
  legCorrections?: Record<string, LegEstimate>
  onSetDayStart: (dayIndex: number, time: string) => void
  onAddPlannedHalts: (dayIndex: number, halts: { km: number; stop: Omit<ItineraryStop, 'id' | 'orderInDay'> }[]) => void
  suggestionCache: ReturnType<typeof useSuggestionCache>
}) {
  const A = getAssumptions(trip)
  const timeFormat = useTimeFormat()
  const { cache: sugCache, setHaltCache } = suggestionCache

  // The day's ride as one continuous ROAD polyline (assembled from the routing
  // provider's per-leg geometry). Planned halts are placed along it, so a halt
  // "after N km" lands N road-km in — on the road the map draws. Null while
  // the routing layer hasn't resolved (offline estimate) — placement then
  // falls back to the straight-line stop chain.
  const roadPolyline = useMemo(
    () => dayRoadPolyline(journey.points, legCorrections),
    [journey, legCorrections],
  )

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
  // nearby pool for slack prompts — refreshed on every spot search, picked
  // live against current slack so any itinerary change re-computes the nudge
  const [slackPool, setSlackPool] = useState<{ hit: PlaceHit; detourMin: number }[]>([])

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
      // Sample the search anchors along the ROAD polyline when routing has
      // resolved — chord anchors sit off the highway on curvy rides and bias
      // which POIs the scan finds. Home-zone exclusion still applies inside.
      const anchors = corridorAnchors(roadPolyline ?? routePts, trip.startLocationCoords, 35000, 8)
      const purposes = [...new Set(plan.map(p => p.purpose))]
      // Provider directive (2026-09-07): Google-only in Google mode — POIs and
      // the city layer both come from Google; free stack only without a key.
      const [hits, cities] = await Promise.all([
        searchNearbyPoisMulti(anchors, 35000, 16, {
          purposes,
          includeFuel: trip.transportMode === 'car' || trip.transportMode === 'motorcycle',
          homeCenter: trip.startLocationCoords ?? null,
          // Google mode: scan as one road-true Search-Along-Route request, with
          // routingSummary detours measured against the day's road km — the
          // same treatment the Map tab's corridor gets. Free mode ignores these.
          routeCoords: roadPolyline ? roadPolyline.map(p => [p.lng, p.lat] as [number, number]) : null,
          routeTotalKm: journey.distanceKm || null,
        }).catch(() => [] as PlaceHit[]),
        (googleEnabled()
          ? googleCitiesAlong(anchors, 35000, 8)
          : searchCitiesAlong(anchors, 35000, 8)
        ).catch(() => [] as PlaceHit[]),
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
      const planned = trip.days.flatMap(d => d.stops)
        .filter(s => s.status !== 'rejected' && Number.isFinite(s.lat) && Number.isFinite(s.lng))
        .map(s => ({ lat: s.lat, lng: s.lng, name: s.title }))
      const unplanned = planned.length > 0 ? filterPlannedNearby(candidates, planned) : candidates
      // refresh the slack pool: cheapest-detour unplanned hits (cap 12) —
      // detours measured asymmetrically against the road polyline when
      // available (on-the-way hits cost ~0), matching the Map tab.
      const speed = MODE_SPEED[trip.transportMode] ?? 40
      setSlackPool(
        unplanned
          .map(h => ({ hit: h, detourMin: asymmetricDetourMinutes(h, anchors, roadPolyline, speed) }))
          .filter(o => Number.isFinite(o.detourMin) && o.detourMin >= 0)
          .sort((a, b) => a.detourMin - b.detourMin)
          .slice(0, 12),
      )
      const assigned = annotateSegmentHits(
        assignSegmentHits(unplanned, segments, anchors, { homeCenter: trip.startLocationCoords ?? null, routePolyline: roadPolyline ?? (routePts.length >= 2 ? routePts : null), speedKmph: MODE_SPEED[trip.transportMode] ?? 40 }),
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
      // Unpinned halts sit ON the road at the requested road-km: interpolate
      // along the routing provider's geometry when it has resolved, so the
      // point rides the actual highway rather than the stop-to-stop chord.
      const pt = useSpot
        ? { lat: item.hit!.latitude, lng: item.hit!.longitude }
        : (pointAtKm(roadPolyline ?? journey.points, item.km) ?? journey.points[0])
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

  // Hand the day's ride to the traveller's own Google Maps for turn-by-turn
  // directions — the panel describes the ride, the app doesn't navigate it.
  // journey.points carries the synthesized legs (outbound continuation, ride
  // home), so anchor-only days get a full origin → destination URL too.
  const directionsUrl = useMemo(
    () => googleMapsDirectionsUrl(journey.points.map(p => ({ lat: p.lat, lng: p.lng }))),
    [journey],
  )

  // Slack prompt: leftover day window plus the cheapest fitting nearby pick.
  // Recomputes live, so any itinerary change refreshes the nudge.
  const slackMin = daySlackMin({
    dayEndMin: hmToMinutes(A.dayEnd), startMin,
    driveMin: journey.driveMinutes, dwellMin: journey.dwellMinutes,
    planMin: planMinutes, bufferMin: planBuffer,
  })
  const slackCands = slackPool.map(o => ({ name: o.hit.name, detourMin: o.detourMin, category: o.hit.category }))
  const slackPickHit = (() => {
    const pick = pickSlackHit(slackMin, slackCands)
    if (!pick) return null
    return slackPool.find(o => o.hit.name === pick.name)?.hit ?? null
  })()
  const slackText = slackPrompt(slackMin, journey.startTitle, slackCands)

  return (
    <div className="travel-panel">
      <div className="travel-panel-head">
        <div className="travel-panel-title"><RouteIcon size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />{title}</div>
        <div className="small muted">
          {modeLabelMode(trip.transportMode)} · {journey.distanceKm.toFixed(0)} km · {minutesToHM(journey.driveMinutes)} wheel time
          {journey.halts.length > 0 && ` · ${journey.halts.length} halt${journey.halts.length !== 1 ? 's' : ''}`}
        </div>
        {directionsUrl && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto', flex: 'none' }}
            onClick={() => openExternal(directionsUrl)}
            title="Open this ride with turn-by-turn directions in Google Maps"
          >
            <ExternalLink size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Directions
          </button>
        )}
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
          <span className="warn-icon"><TriangleAlert size={13} aria-hidden /></span>
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
          <div className="small muted"><MetaIcon icon={ MapPin } tone="place" />Halt planner — you pick where along the ride and for how long. Halts sit on the route itself; tick a found spot to detour there instead.</div>
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
              <option value="meal">Meal</option>
              <option value="stretch">Stretch / rest</option>
              <option value="fuel">Fuel</option>
              <option value="overnight">Overnight</option>
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
                    {resolving ? 'Searching the route…'
                      : plan.some(p => p.hit) ? <><RotateCcw size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Re-find real spots</>
                      : <><Search size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Find real spots</>}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={addHaltsToDay}><Plus size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Add {plan.length} to the day</button>
                </div>
              </div>
              {searched && !plan.some(p => p.hit) && (
                <span className="small muted">
                  No good spots found near your km points — the halts will be added as generic breaks on the route itself.
                </span>
              )}
            </>
          )}
          {editable && slackText && slackPickHit && (
            <div className="poi-desc small" style={{ marginTop: 6 }}>
              ☀ {slackText}
              {' '}
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  const h = slackPickHit
                  const km = kmFromStartForHit({ latitude: h.latitude, longitude: h.longitude }, roadPolyline ?? journey.points) ?? 0
                  onAddPlannedHalts(day.index, [{
                    km,
                    stop: {
                      title: h.name,
                      category: (h.category as ItineraryStop['category']) ?? 'sightseeing',
                      locationName: h.description || h.name,
                      lat: h.latitude, lng: h.longitude,
                      description: h.description ?? '',
                      notes: "Slack pick — fits the day's leftover time",
                      visitMinutes: visitMinutesForCategory(h.category),
                      openTime: '', closeTime: '',
                      entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
                      priority: 'nice-to-have', sourceUrl: '', status: 'suggested',
                    },
                  }])
                  setSlackPool(prev => prev.filter(o => o.hit.name !== h.name))
                  toast(`“${h.name}” added to Day ${day.index + 1} as a suggestion`)
                }}
              >+ Add</button>
            </div>
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

const HALT_PURPOSE_META: Record<HaltPurpose, { label: string; Icon: LucideIcon }> = {
  meal: { label: 'Meal', Icon: Utensils },
  stretch: { label: 'Break', Icon: Coffee },
  fuel: { label: 'Fuel', Icon: Fuel },
  overnight: { label: 'Overnight', Icon: BedDouble },
  rest: { label: 'Break', Icon: Coffee },
  sight: { label: 'Stop', Icon: Eye },
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
          <span className={`ride-purpose ride-purpose-${item.purpose}`}>{(() => { const m = HALT_PURPOSE_META[item.purpose]; return <><m.Icon size={11} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{m.label}</> })()}</span>
          <b>{usingSpot ? h!.name : 'On the route'}</b>
        </div>
        <span className="muted small">
          after ~{Math.round(item.km)} km · {item.minutes} min halt
          {usingSpot && h!.offRouteKm != null ? ` · ~${Math.round(h!.offRouteKm)} km off route` : ''}
        </span>
        {usingSpot && h && reasonForHit(h) && (
          <span className="muted small">Why: {reasonForHit(h)}</span>
        )}
        {h && (
          <label className="hp-pin muted small">
            <input type="checkbox" checked={item.pin} onChange={onTogglePin} aria-label={`Detour to ${h.name} instead of halting on the route`} />
            <span>detour to {h.name}{h.nearestCity ? ` (near ${h.nearestCity})` : ''} instead of the route point</span>
          </label>
        )}
      </div>
      <div className="ride-spot-actions">
        <button className="btn btn-ghost btn-sm" onClick={onRemove} title="Remove this planned halt"
          aria-label={`Remove the halt planned at ${Math.round(item.km)} km`}><X size={13} aria-hidden /></button>
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

function statusTone(s: string): 'teal' | 'saffron' | 'danger' | 'ok' | 'info' {
  return s === 'confirmed' ? 'teal' : s === 'needs-booking' ? 'saffron' : s === 'rejected' ? 'danger' : 'info'
}
