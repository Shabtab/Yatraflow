// ============ Trip workspace — Timeline DaySection (extracted from TimelineTab.tsx,
// restructure Phase 3) — the day header/summary row, the animated body, the stop
// rows and the empty-day suggestions. The 19-prop signature is the shared contract
// between the shell and this module; treat it as load-bearing (see the memo notes).
// ============ Trip workspace — Timeline tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes DaySection, DayWeatherChip, TravelPanel, HaltPlanRow, DaySpark,
// MoveStopModal and ClampedText — the whole timeline hot path.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, Ban, Car, ChevronDown, ChevronUp, CircleCheck, CircleHelp, Clock, CloudRain, CloudSun,
  Copy, Droplets, ExternalLink, Flag, MapPin,
  MoveHorizontal, PenLine, Pencil, Pin, Plus, Route as RouteIcon,   Ticket, Trash2, TriangleAlert, 
} from 'lucide-react'
import type { Trip, ItineraryStop } from '../../../data/types'
import {
  minutesToHM, hmToMinutes, formatInr,
  computeCategoryBias, optimizeDayOrder, roadScaleRatio, measuredLegCount, optimiseKmLabel, scheduleRowsById,
} from '../../../lib/engine'
import { sameDaySectionProps, type DayCardFacts, type DayTotals } from '../../../lib/dayCards'
import type { LegEstimate, ScheduleWarning, OptimizeDayResult } from '../../../lib/engine'
import { routeChain, stayDaySummary, dwellSegments, visibleStops } from '../../../lib/daySummary'
import { insertionSlotBetween } from '../../../lib/stopOrder'
import { insertionWhere } from '../../../lib/labels'
import { isDriveDay } from '../../../lib/ridePlan'
import { openExternal } from '../../../lib/native'
import { useTimeFormat, formatHM, formatHMRange } from '../../../lib/timefmt'
import { motionTiming, prefersReducedMotion } from '../../../lib/motion'
import { stopKindOf, STOP_KIND_LABELS } from '../../../lib/stopKind'
import { statusLabel } from '../../../lib/labels'
import { Chip, EmptyState, Modal, toast, useReorder } from '../../../components/ui'
import { Select } from '../../../components/Select'

/** Stop options for a commitment link: live stops only, plus the unlink row. */
function linkStopOptions(stops: ItineraryStop[]): { value: string; label: string }[] {
  return [{ value: '', label: 'No linked stop' }, ...stops.filter(s => s.status !== 'rejected').map(s => ({ value: String(s.id), label: s.title }))]
}
import { glideOffsetPx, insertionIndexFor, rowLayoutBoxes, cancelRowSettle, cancelListSettles, settleRow } from '../../../lib/touchDnd'
import { useSuggestionCache } from '../../../hooks/useSuggestionCache'
import { searchNearbyPois } from '../../../lib/geocode'
import type { PlaceHit } from '../../../lib/geocode'
import { nearbyHitKey } from '../../../lib/providers/hits'
import { InlineIcon, MetaIcon } from '../../../components/icons'
import { fetchDailyWeather, forecastAvailable, isoAddDays, weatherAnchor, wmoInfo } from '../../../lib/weather'
import type { DayWeather } from '../../../lib/weather'
import { TravelPanel } from './TravelPanel'
import { DaySpark } from './DaySpark'

/** Compact forecast chip for a single trip day (Timeline day headers). */
function DayWeatherChip({ day, startDate }: { day: Trip['days'][number]; startDate: string }) {
  const [w, setW] = useState<DayWeather | null>(null)
  const date = isoAddDays(startDate, day.index)
  // #340: the chip asks about THIS day's own anchor, and the effect depends on
  // the resolved coordinates instead of suppressing exhaustive-deps — a moved
  // stop or a new city re-fetches, and a day with no anchor has no chip at all
  // rather than another city's weather.
  const anchor = useMemo(() => weatherAnchor(day), [day])
  const lat = anchor?.lat
  const lng = anchor?.lng
  useEffect(() => {
    // Gate on THIS day's date, not the trip's start: a 15-day window that opens
    // on day 1 still leaves day 12 beyond the forecast, and Open-Meteo answers
    // that with a 400 rather than a forecast (#340). No chip is the honest
    // answer — the same rule as "no anchor, no chip".
    if (lat == null || lng == null || !forecastAvailable(date)) { setW(null); return }
    let cancelled = false
    fetchDailyWeather(lat, lng, date, 1)
      .then(res => { if (!cancelled) setW(res[date] ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [lat, lng, date])
  if (!w) return null
  const info = wmoInfo(w.code)
  return (
    <span className="weather-chip" title={`${info.label} · ${Math.round(w.tempMinC)}–${Math.round(w.tempMaxC)}°C · ${w.rainChancePct}% rain chance`}>
      {info.icon} {Math.round(w.tempMaxC)}°<InlineIcon icon={Droplets} size={11} gap={2} vAlign="-1px" style={{ marginLeft: 4 }} />{w.rainChancePct}%
    </span>
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

/** Collapsed-row dwell chart (docs/TIMELINE-PLAN.md Phase 1): one bar per
 *  visible stop, amber on the stop that eats the most of the day. Pure data
 *  from dwellSegments; hides itself when the chart would say nothing. */
function DwellBars({ day }: { day: Trip['days'][number] }) {
  const segs = dwellSegments(day)
  if (!segs) return null
  return (
    <span className="dwell-bars" aria-hidden="true">
      {segs.map(s => (
        <i
          key={s.stop.id}
          className={s.busiest ? 'dwell-bar busiest' : 'dwell-bar'}
          style={{ flexGrow: s.weight }}
          title={`${s.stop.title} · ${minutesToHM(s.minutes)} at the stop`}
        />
      ))}
    </span>
  )
}

/** Extra frames after the CSS transition ends before the body is unmounted. */
const COLLAPSE_UNMOUNT_SLACK_MS = 40

/** Smooth open/close for a day body: the wrapper animates grid rows 0fr→1fr
 *  (height-agnostic, no max-height guessing), mounting the body just before
 *  the expand and unmounting it just after the collapse — so a closed day
 *  still costs nothing (the collapsed-by-default premise) while the motion
 *  stays smooth. A section that mounts already-open does NOT animate (no
 *  surprise motion on page load).
 *
 *  The two rAFs before the class flip are load-bearing, not defensive: React
 *  flushes a discrete-event effect before the browser paints, so mounting and
 *  opening in the SAME commit leaves the 0fr row unrendered — the transition
 *  then has no "from" value and the day snaps open. The unmount delay reads its
 *  duration from --motion-slower, so retiming the animation in CSS can never
 *  leave a half-collapsed body mounted — and an unmount that would strand the
 *  keyboard user's focus hands it back through `fallbackFocus` instead. */
function SmoothCollapse({ open, children, fallbackFocus }: { open: boolean; children: React.ReactNode; fallbackFocus?: React.RefObject<HTMLButtonElement | null> }) {
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)
  const clipRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) {
      setMounted(true)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setExpanded(true)) })
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
    }
    setExpanded(false)
    // This clip is on its way out, so hand focus back to the day's disclosure
    // control the moment the close starts — NOT when the clip unmounts. Its
    // inner wrapper flips to `visibility: hidden` one animation earlier, and a
    // browser blurs a hidden element immediately: focus is already back on
    // <body> by then, and a keyboard user's next Tab restarts at the top of the
    // document. Reachable on both clips: opening a day from its route line
    // removes that line, and collapsing removes the body under the cursor.
    if (clipRef.current?.contains(document.activeElement)) fallbackFocus?.current?.focus()
    const t = window.setTimeout(() => { setMounted(false) }, motionTiming('--motion-slower').duration + COLLAPSE_UNMOUNT_SLACK_MS)
    return () => window.clearTimeout(t)
  }, [open, fallbackFocus])
  if (!mounted) return null
  return (
    <div ref={clipRef} className={`day-body-clip${expanded ? ' open' : ''}`} aria-hidden={!expanded}>
      <div className="day-body-clip-inner">{children}</div>
    </div>
  )
}

// React.memo on the timeline hot path: TimelineTab re-renders on every store
// commit (the shell's useDb feeds the tab counts), but with stable props each
// DaySection bails out unless ITS day data actually changed (M3.1 made trip
// references immutable, so `day` is stable between commits).
//
// #347: that memo used to be defeated by `trip` itself — a new object on every
// save — so one stop edit re-rendered every day and each day re-ran the engine
// math for itself. The trip-wide slice this card reads now arrives pre-resolved
// in `facts` (lib/dayCards.ts), and `trip` is handed over ONLY to the open day
// (whose travel panel searches against the whole itinerary). A closed card
// therefore cannot read the trip at all: `trip` is optional, so a `trip.x` on
// the collapsed path is a compile error rather than a stale render.
export const DaySection = React.memo(function DaySection({ day, trip, facts, editable, open, reviewMode, inView, onToggleOpen, onInsertHere, onAdd, onEdit, onDelete, onMoveWithinDay, onReorderDay, onMoveBetweenDays, onMoveStopIn, onRenameDay, onCopyDay, onAddQuickStop, onSetDayStart, onAddPlannedHalts, onLinkCommitment, warnings, onStatus, legCorrections, suggestionCache, dayTotals }: {
  day: Trip['days'][number]
  /** fresh ONLY for the open day — everything else comes from `facts` */
  trip?: Trip
  /** the trip-wide slice this card reads, resolved once per trip change */
  facts: DayCardFacts
  editable: boolean
  /** accordion state (false in review mode, where every day is open) */
  open: boolean
  /** #421 all-days review: the mode owns openness — no per-day disclosure, the
   *  header becomes the sticky label for its day */
  reviewMode: boolean
  /** #421: is this card near the viewport? The provider-backed extras (weather
   *  chip, nearby search) and the live-trip hand-off gate on it in review mode,
   *  so scrolling a ten-day plan does not fire ten fetches at once. Always true
   *  outside review, which is exactly the previous behaviour. */
  inView: boolean
  onToggleOpen: (dayIndex: number) => void
  /** #422: insert a stop between two existing ones — the leg's own control hands
   *  over the slot it was opened on (resolved from the neighbouring row ids) */
  onInsertHere: (dayIndex: number, slot: number) => void
  legCorrections?: Record<string, LegEstimate>
  suggestionCache: ReturnType<typeof useSuggestionCache>
  /** this day's slice of computeTotals().byDay — transport + expenses + entry fees */
  dayTotals?: DayTotals
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
  /** link a fixed commitment to the stop its deadline is checked against (null unlinks) */
  onLinkCommitment: (commitmentId: string, dayIndex: number, stopId: string | null) => void
  warnings: ScheduleWarning[]
  onStatus: (stop: ItineraryStop, status: ItineraryStop['status']) => void
}) {
  // One unified journey per day — start → halts/visits → destination with an
  // arrival clock — regardless of distance. This is the single travel system.
  const sim = facts.sim
  const journey = facts.journey
  // The body keeps rendering through the collapse animation (SmoothCollapse
  // unmounts it a beat after the class flip), while `trip` only arrives for the
  // OPEN day. Hold the last one we were given so a fading body never loses its
  // travel panel mid-animation — and a never-opened card never gets one at all.
  const lastTrip = useRef(trip)
  if (trip) lastTrip.current = trip
  const bodyTrip = trip ?? lastTrip.current
  const visitCount = journey.points.filter(p => p.kind === 'visit').length
  // A stay day: the journey never leaves its base — no chain, no synthesized
  // destination. Intermediate days of a round trip parked at the destination.
  // The travelling card belongs to the departure day, the return day, real
  // transfers, and any day where the user adds travel manually.
  const isStayDay = journey.points.length <= 1 && journey.distanceKm < 0.5
  // Day Planner day type (P1-D): derived from the journey, never labelled by
  // hand — a full drive day clears the planned-break floor, a short hop plus
  // local time is mixed, no wheel time at all is a stay.
  const dayType: 'DRIVE' | 'STAY' | 'MIXED' = isStayDay
    ? 'STAY'
    // Same floor as the planner (#134): 90 km OR 2 h wheel — the planner gives
    // an 80 km / 3 h ghat day a real segment, so the header must call it a drive.
    : isDriveDay(journey.distanceKm, journey.driveMinutes) ? 'DRIVE' : 'MIXED'
  const A = facts.assumptions
  const ordered = useMemo(() => [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay), [day.stops])
  // #555: this day's schedule keyed by stop id. `sim`'s arrays are aligned per
  // ACTIVE stop and its legs are INTO legs, while `ordered` also carries
  // rejected stops the simulator skips — so every clock and leg read below
  // goes through this map (printModel's accessor), never through the rendered
  // position.
  const simRows = useMemo(() => scheduleRowsById(sim), [sim])
  // ---- Optimize day order (anti-crisscross) ----
  // Preview is computed from the CURRENT day snapshot (pure engine call; the
  // helper clones its inputs, so the render-phase memo can't touch the store);
  // the apply goes through applyChange so the impact preview guards the commit.
  const [optPreview, setOptPreview] = useState<OptimizeDayResult | null>(null)
  // #341: whether a LATER day wakes up from this one's tail decides whether the
  // optimiser may touch the last stop at all. The surface owns that fact; the
  // engine takes it as an argument.
  const hasNextDay = facts.hasNextDay
  const optOrigin = facts.origin
  // The optimiser reads exactly two things — where the day starts (itself
  // derived from the earlier days' endpoints) and this day's ordered stops — so
  // the memo is keyed on that signature instead of on `trip`. The O(n²) sweep
  // used to re-run on every unrelated store commit; the signature changes only
  // when an input really did (#341).
  const optKey = `${day.index}|${hasNextDay ? 1 : 0}|${optOrigin.lat.toFixed(5)},${optOrigin.lng.toFixed(5)}|${ordered.map(s => `${s.id}:${s.lat.toFixed(5)},${s.lng.toFixed(5)}:${s.orderInDay}:${s.status}:${s.auto ? 1 : 0}:${s.category}`).join('|')}`
  const optResult = useMemo(
    () => optimizeDayOrder(optOrigin, ordered, { hasNextDay }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optKey IS the read set
    [optKey],
  )
  // The optimizer's objective is straight-line (pairwise road km between
  // arbitrary stops would need N² route calls), but the numbers it SHOWS must
  // speak the road km the travel panel displays — rescale by the day's
  // road-vs-chord ratio from the corrected legs. With NO measured leg that ratio
  // is 1, so the display was presenting chord km as road km with no qualifier;
  // the labels below say which number it is (#341).
  const roadRatio = useMemo(() => roadScaleRatio(journey.points, legCorrections), [journey, legCorrections])
  const roadLegs = useMemo(() => measuredLegCount(journey.points, legCorrections), [journey, legCorrections])
  /** A distance label that never dresses chord math as a measured road km. */
  const kmLabel = (km: number) => optimiseKmLabel(km, roadRatio, roadLegs)
  // --- Liquid drag (bencho-style, BoardView parity): the DOM order NEVER
  // changes mid-drag. The carried row is pinned to the pointer by the engine
  // (lib/touchDnd.ts) and its skin warps with the throw; rows between the
  // carried slot and the cursor target glide out of the way in real time
  // (transform transition). Drop resolves through the insertion index and the
  // arrangement settles ONCE via the FLIP pass on commit. ---
  const stopsRef = useRef<HTMLDivElement>(null)
  const [insertIdx, setInsertIdx] = useState<number | null>(null)
  const insertRef = useRef(insertIdx)
  insertRef.current = insertIdx
  /** viewport rect of the row as it was carried at release — the FLIP pass
      below springs it from there into its new slot (same-list drops AND
      foreign drops landing here both consume it) */
  const dropRect = useRef<{ id: string; x: number; y: number } | null>(null)
  const { dndHandlers, dayDropHandlers, dragging, foreignOver, moveUp, moveDown, takeCarryRect, listId } = useReorder(
    ordered,
    (fromIdx, commandToIdx, source) => {
      // Two contracts share this callback. A DRAG drop reports the hit-tested
      // index but is resolved from the live insertion slot: idx counts
      // positions in the full list (dragged slot included), so a slot past the
      // dragged index shifts down once it is removed. A COMMAND (the up/down
      // buttons) has no slot to read — it carries the destination the user
      // asked for, so it must be used as-is; reading `insertRef` here resolved
      // every arrow press to a no-op and the buttons silently did nothing.
      const toIdx = source === 'command'
        ? commandToIdx
        : (() => { const idx = insertRef.current ?? fromIdx; return idx > fromIdx ? idx - 1 : idx })()
      // consume the carry rect on EVERY self-drop: a no-op slot (released at
      // rest) must not leak the engine's rect into a later FLIP pass
      const rect = takeCarryRect()
      if (toIdx !== fromIdx) {
        // only a drag has a carry rect to spring from; a command moves nothing
        // on screen that needs FLIP continuity
        if (source === 'drag' && rect && ordered[fromIdx]) dropRect.current = { id: ordered[fromIdx].id, x: rect.x, y: rect.y }
        onMoveWithinDay(fromIdx, toIdx, day.index)
      }
      setInsertIdx(null)
    },
    {
      dragPayload: (s) => JSON.stringify({ stopId: s.id, fromDay: day.index }),
      onForeignDrop: (payload, toIdx) => {
        try {
          const p = JSON.parse(payload) as { stopId?: string; fromDay?: number }
          if (p.stopId && typeof p.fromDay === 'number' && p.fromDay !== day.index) {
            const rect = takeCarryRect()
            if (rect) dropRect.current = { id: p.stopId, x: rect.x, y: rect.y }
            onMoveStopIn(p.stopId, p.fromDay, day.index, toIdx)
          }
        } catch { /* malformed payload — ignore */ }
      },
      /** engine hover → insertion slot from STABLE layout geometry: the
          carried card's centre against each row's own midpoint (pure
          insertionIndexFor, lib/touchDnd.ts). Transform-immune — the gliding
          rows cannot chase the zones — and defined everywhere, so the 8px
          margins and whitespace keep the reading alive instead of freezing
          it. The engine re-fires while the centre moves; the ref guard
          keeps this from re-rendering until the slot actually flips. */
      onOwnHover: (_idx, _x, centreY, dragIdx) => {
        const root = stopsRef.current
        if (!root || dragIdx < 0) return
        const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-stop-id]'))
        if (rows.length === 0) return
        const next = insertionIndexFor(rowLayoutBoxes(root, rows), centreY, dragIdx)
        if (insertRef.current !== next) setInsertIdx(next)
      },
    },
  )
  useEffect(() => { if (dragging === null) setInsertIdx(null) }, [dragging])

  /** Live glide offset for row i while a drag is open: rows between the
   *  carried slot and the insertion index slide toward the carried row's
   *  origin, so the gap reopens under the cursor. The sign math lives in the
   *  pure glideOffsetPx (lib/touchDnd.ts) so tests can pin it. */
  function glideOffset(i: number): number | null {
    if (dragging === null || insertIdx === null) return null
    const row = stopsRef.current?.querySelectorAll<HTMLElement>('[data-stop-id]')[dragging]
    const h = row ? row.offsetHeight + 8 : 0
    return glideOffsetPx(dragging, insertIdx, i, h)
  }

  // FLIP slot-in (BoardView parity): when this day's arrangement changes
  // (same-day reorder, or a stop slotting in from another day), every row
  // animates from its previous position to the new one — compositor-only.
  // The row that was CARRIED springs from where the finger released it (the
  // engine's carry rect) rather than from its old slot; every other row
  // animates from its pre-drag position. Fires once per committed
  // arrangement, never during the drag itself.
  const prevRects = useRef<Map<string, { x: number; y: number }> | null>(null)
  useLayoutEffect(() => {
    const rootEl = stopsRef.current
    if (!rootEl) return
    const interrupted = new Map<string, DOMRect>()
    const now = new Map<string, { x: number; y: number }>()
    for (const el of Array.from(rootEl.querySelectorAll<HTMLElement>('[data-stop-id]'))) {
      const visual = cancelRowSettle(el)
      if (visual) interrupted.set(el.dataset.stopId!, visual)
      const r = el.getBoundingClientRect()
      now.set(el.dataset.stopId!, { x: r.left, y: r.top })
    }
    const prev = prevRects.current
    const dropped = dropRect.current
    dropRect.current = null
    if (prev && !prefersReducedMotion()) {
      for (const [id, p] of now) {
        const q = dropped && dropped.id === id ? dropped : prev.get(id)
        if (!q) continue
        const visual = interrupted.get(id)
        const dx = q.x - p.x + (visual && q !== dropped ? visual.left - p.x : 0)
        const dy = q.y - p.y + (visual && q !== dropped ? visual.top - p.y : 0)
        if (dx || dy) {
          const el = rootEl.querySelector<HTMLElement>(`[data-stop-id="${CSS.escape(id)}"]`)
          if (el && !el.classList.contains('is-carried')) settleRow(el, dx, dy, listId)
        }
      }
    }
    prevRects.current = now
  }, [ordered, listId])
  useLayoutEffect(() => () => cancelListSettles(listId), [listId])
  const commitmentsToday = facts.commitments

  // --- Collapsed-by-default accordion (docs/TIMELINE-PLAN.md Phase 1) ---
  // Collapse state lives in TimelineTab (one open day per trip, persisted via
  // uiPrefs.loadOpenDay). This component is controlled: `open` in, `onToggleOpen`
  // out — the old local collapsed useState + per-day localStorage map is retired.
  const collapsed = !open
  const timeFormat = useTimeFormat()
  // Both clips hand focus back here when they unmount under the keyboard user's
  // feet (see SmoothCollapse's fallbackFocus).
  const collapseRef = useRef<HTMLButtonElement>(null)
  const onCollapseClick = useCallback(() => onToggleOpen(day.index), [onToggleOpen, day.index])
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(day.title ?? '')
  const [nearby, setNearby] = useState<PlaceHit[]>([])
  const nextAnchor = facts.nextAnchor
  // "Continue to X" only makes sense while X is still ahead of you. The day
  // wakes up where the previous day's JOURNEY ended — when that IS the next
  // anchor (you arrived at the trip's destination on day 1, so every later
  // unplanned day is parked there), the chip would offer a drive to where
  // you already stand. Suppress it; nearby-idea chips are unaffected.
  const alreadyAtNext = facts.alreadyAtNext

  // anchor suggestions on where you'd arrive from; only for unplanned days —
  // and only while the day is OPEN, since the chips live in the body and `trip`
  // is handed to the open day alone (#347). A collapsed empty day used to search
  // the corridor for chips nobody could see.
  useEffect(() => {
    if (!editable || !open || !trip || ordered.length > 0 || (reviewMode && !inView)) { setNearby([]); return }
    let cancelled = false
    const anchor = facts.prevPoint ?? facts.homeCenter
    if (!anchor) return
    searchNearbyPois(anchor.lat, anchor.lng, 10000, 6, {
      includeFuel: facts.assumptions.mode === 'car' || facts.assumptions.mode === 'motorcycle',
      homeCenter: facts.homeCenter,
      categoryBias: computeCategoryBias(trip),
    })
      .then(hits => { if (!cancelled) setNearby(hits.slice(0, 3)) })
      .catch(() => { /* suggestions are best-effort */ })
    return () => { cancelled = true }
    // #213 Phase 3 + #347: depend on the values the effect actually reads — the
    // resolved anchor and home center from `facts`, the mode that gates fuel,
    // and the open flag that decides whether a body exists to show them in.
  }, [editable, open, trip, ordered.length, reviewMode, inView, facts.prevPoint, facts.homeCenter, facts.assumptions.mode])

  // day progress: how much of the realistic window (start–20:00) the plan consumes
  const dayStartHM = day.startTime ?? A.dayStart
  const startMin = hmToMinutes(dayStartHM)
  const windowMin = Math.max(1, hmToMinutes(A.dayEnd) - startMin)
  const used = Math.max(0, Math.min(1, (hmToMinutes(sim.endsAt) - startMin) / windowMin))
  const sev = warnings.some(w => w.severity === 'high') ? 'high' : warnings.some(w => w.severity === 'medium') ? 'medium' : 'ok'
  // Header stats as segments — rendered with a dimmed pipe separator, which
  // tracks better across a long line than a cramped mid-dot at 12px.
  const statSegments: React.ReactNode[] = isStayDay
    ? [
        `Based in ${journey.startTitle}`,
        ...(visitCount > 0 ? [`${visitCount} visit${visitCount !== 1 ? 's' : ''}`] : []),
      ]
    : [
        `${journey.startTitle} → ${journey.endTitle}`,
        `~${Math.round(journey.distanceKm)} km`,
        `drive ~${minutesToHM(journey.driveMinutes)}`,
        ...(journey.halts.length > 0 ? [`${journey.halts.length} halt${journey.halts.length !== 1 ? 's' : ''}`] : []),
        ...(visitCount > 0 ? [`${visitCount} visit${visitCount !== 1 ? 's' : ''}`] : []),
        `start ${formatHM(journey.startTime, timeFormat)} → ends ~${formatHM(sim.endsAt, timeFormat)}`,
      ]
  // The route chain is only worth a line when the day's PLANNED stops add
  // something the stats route (start → end) doesn't already say — auto
  // anchors and single-stop days would just repeat it back.
  const chainStops = visibleStops(day).filter(s => !s.auto)

  return (
    <div className={`day-section${collapsed ? ' day-closed' : ''}${collapsed && isStayDay ? ' day-stay-collapsed' : ''}${dragging !== null ? ' drag-live' : ''}${reviewMode ? ' day-review' : ''}`} id={`day-card-${day.index}`}>
      <div className={`day-header${foreignOver === ordered.length && dragging === null ? ' foreign-over' : ''}`} {...(editable ? dayDropHandlers(ordered.length) : {})}>
        {/* Stable name + state attribute (UI audit F-09); the collapsible body
            is a fragment of siblings, so there's no single aria-controls id. */}
        {/* Review mode owns openness, so there is nothing to expand or collapse
            here — the header itself becomes the sticky label for its day (#421),
            and hiding the control is the honest affordance (a disabled chevron
            would promise an interaction that has no meaning). */}
        {!reviewMode && (
        <button ref={collapseRef} className="day-collapse" onClick={onCollapseClick} aria-expanded={!collapsed} aria-label={`Day ${day.index + 1} stops`}>
          <ChevronDown size={16} aria-hidden className="day-collapse-icon" />
        </button>
        )}
        <div className="day-badge"><small>Day</small><b>{day.index + 1}</b></div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div className="day-title-row">
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
            {/* Day Planner day type (P1-D): derived from the journey, never
                labelled by hand — wheel time makes it a drive, none makes it a
                stay, a short hop plus local time is mixed. */}
            <span className={`day-kind ${dayType.toLowerCase()}`}>
              {dayType === 'STAY' ? 'Stay day' : dayType === 'DRIVE' ? 'Drive day' : 'Drive + local'}
            </span>
          </div>
          {/* Collapsed extra line: only when it adds something the stats line
              doesn't already say. Stay days get their quiet "no driving" line;
              drive days get the stop-name chain when there are ≥2 planned
              stops. It's a button that opens the day, like the mockup; names
              wrap rather than truncate (full chain rides in the tooltip).
              This line is what changes the header's height, so it rides the
              same collapse as the body, in reverse: growing in as the body
              folds away, folding away as the body grows. Popping it instead
              moved every row below the header in a single frame. */}
          <SmoothCollapse open={collapsed} fallbackFocus={collapseRef}>
            {isStayDay ? (
              <button type="button" className="day-route" onClick={onCollapseClick} aria-expanded={!collapsed}>
                <span className="day-route-text">{stayDaySummary(visitCount)}</span>
              </button>
            ) : chainStops.length >= 2 ? (
              <button type="button" className="day-route" onClick={onCollapseClick} aria-expanded={!collapsed} title={routeChain(day)}>
                {chainStops.slice(0, 5).map((s, i) => (
                  <React.Fragment key={s.id}>
                    {i > 0 && <span className="day-route-sep" aria-hidden="true">→</span>}
                    <span className="day-route-stop">{s.title}</span>
                  </React.Fragment>
                ))}
                {chainStops.length > 5 && <span className="day-route-more">+{chainStops.length - 5} more</span>}
              </button>
            ) : null}
          </SmoothCollapse>
          <div className="small muted num">
            {statSegments.map((seg, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="stat-sep" aria-hidden="true">|</span>}
                {seg}
              </React.Fragment>
            ))}
          </div>
          <div className={`day-progress ${collapsed ? 'compact' : ''}`} title={`${Math.round(used * 100)}% of the ${formatHM(dayStartHM, timeFormat)}–${formatHM(A.dayEnd, timeFormat)} window`}>
            <div className={`day-progress-fill sev-${sev}`} style={{ width: `${Math.round(used * 100)}%` }} />
          </div>
          {/* #421: in review this is a provider call per day — it waits until
              the day is actually near the viewport (outside review, unchanged). */}
          {!collapsed && (!reviewMode || inView) && <DayWeatherChip day={day} startDate={facts.startDate} />}
        </div>
        {/* Per-day cost + time-at-stops: intelligence the engine already
            computes (computeTotals().byDay + simulateDay dwell), surfaced where
            the plan is edited. Hidden while collapsed so a folded day's header
            stays calm. */}
        {/* The chip renders only for the day it BELONGS to (matched by index):
            a lookup that finds no bucket shows nothing, never another day's
            total under this header (#338 — the old positional clamp showed the
            last day's money on a day with a skipped index). */}
        {!collapsed && dayTotals != null && dayTotals.dayIndex === day.index && dayTotals.totalInr > 0 && (
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
            <InlineIcon icon={TriangleAlert} size={12} gap={3} />{warnings[0].title.replace(/^Day \d+:\s*/, '')}{warnings.length > 1 ? ` · +${warnings.length - 1} more` : ''}
          </span>
        )}
        {ordered.filter(s => s.status !== 'rejected').length >= 2 && <DaySpark stops={ordered.filter(s => s.status !== 'rejected')} />}
        {/* Collapsed-only dwell chart: one bar per stop, amber on the stop
            that eats the most of the day (mockup P1's "busiest stop"). */}
        {collapsed && <DwellBars day={day} />}
        {editable && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {optResult.changed && !isStayDay && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setOptPreview(optResult)}
                title={`Reorder this day's stops to cut crisscrossing — saves ${kmLabel(optResult.beforeKm - optResult.afterKm)} of travel${roadLegs === 0 ? ' (straight-line estimate: the road has not been measured yet)' : ''}`}
              ><InlineIcon icon={RouteIcon} size={13} gap={4} />Optimise{optResult.beforeKm - optResult.afterKm > 0 ? ` (−${roadLegs === 0 ? '~' : ''}${Math.round((optResult.beforeKm - optResult.afterKm) * roadRatio)} km)` : ''}</button>
            )}
            {/* #341: a day the optimiser refuses for a reason the user can act
                on says so, instead of hiding the button as if nothing existed.
                The tooltip needs the wrapper span — a disabled button fires no
                pointer events, so its own title would never show. */}
            {!optResult.changed && optResult.blocked === 'mid-anchor' && !isStayDay && (
              <span title="The order is fixed by your manually placed waypoints — the optimiser only rewires the middle of a day, and one of those sits mid-day." style={{ display: 'inline-flex' }}>
                <button className="btn btn-outline btn-sm" disabled aria-disabled="true">
                  <InlineIcon icon={RouteIcon} size={13} gap={4} />Optimise
                </button>
              </span>
            )}
            <button
              className="btn btn-outline btn-sm"
              disabled={ordered.length === 0 || !facts.hasNextDay}
              onClick={() => onCopyDay(day.index)}
              title={ordered.length ? `Copy these stops to Day ${day.index + 2}` : 'Nothing to copy yet'}
            ><InlineIcon icon={Copy} size={13} gap={4} />Copy</button>
            <button className="btn btn-outline btn-sm" onClick={() => onAdd(day.index)}>+ Add here</button>
          </div>
        )}
      </div>

      <SmoothCollapse open={!collapsed} fallbackFocus={collapseRef}>
      {commitmentsToday.map(fc => (
        <div key={fc.id} className="warn-item sev-low" style={{ marginBottom: 8 }}>
          <span className="warn-icon"><Pin size={13} aria-hidden /></span>
          <div>
            <div className="warn-title">{fc.title}</div>
            <div className="warn-fix">Fixed at {formatHM(fc.time, timeFormat)}{fc.notes ? ` — ${fc.notes}` : ''}</div>
            {editable && fc.type !== 'hotel-checkin' && (
              <Select value={fc.stopId ?? ''} aria-label={`Stop the ${fc.title} deadline is checked against`}
                onChange={val => onLinkCommitment(String(fc.id), day.index, val || null)}
                options={linkStopOptions(ordered)} />
            )}
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

      {bodyTrip && <TravelPanel trip={bodyTrip} day={day} editable={editable} journey={journey} suggestionCache={suggestionCache} legCorrections={legCorrections}
        onSetDayStart={onSetDayStart} onAddPlannedHalts={onAddPlannedHalts} />}

      {ordered.length === 0 && (<>
        <EmptyState icon={<CloudSun size={38} aria-hidden />} title="Nothing planned yet" body="Add your first stop for this day — or drag one here from another day."
          action={editable ? <button className="btn btn-primary btn-sm" onClick={() => onAdd(day.index)}>+ Add stop</button> : undefined} />
        {editable && ((nextAnchor && !alreadyAtNext) || nearby.length > 0) && (
          <div className="day-suggest">
            {nextAnchor && !alreadyAtNext && (
              <button className="chip-btn" onClick={() => onAddQuickStop(day.index, nextWaypointStop(nextAnchor))} title="Add this as a route waypoint">
                <InlineIcon icon={ArrowRight} size={13} gap={3} />Continue to {nextAnchor.name.replace(/ \((start|end)\)$/, '')}
              </button>
            )}
            {nearby.map(h => (
              <button key={nearbyHitKey(h)} className="chip-btn" onClick={() => onAddQuickStop(day.index, poiQuickStop(h))} title="Add this nearby idea">
                <InlineIcon icon={Plus} size={12} gap={3} />{h.name}
              </button>
            ))}
          </div>
        )}
      </>)}

      <div className={`tl${dragging !== null ? ' is-dragging' : ''}`} ref={stopsRef} data-yf-list={listId}>
        {/* #555: the day's opening drive (origin → first stop) is a real leg —
            printModel unshifts it before the first stop row, and the timeline
            shows it the same way: a leg row above the first stop. It sits
            before the list rather than between two rows, so it carries no drop
            zone or Insert control (those belong to the gaps between rows), and
            a leading auto anchor — which IS the day's start — shows none. */}
        {(() => {
          const first = ordered[0]
          const leg = first && first.auto !== true ? simRows.get(first.id)?.legIn : null
          if (!leg || leg.distanceKm < 0.5) return null
          return (
            <div className="tl-legrow">
              <div className="tl-gutter tl-gutter-leg"><span className="tl-line tl-line-leg" /></div>
              <div className="tl-leg-cell">
                <div className="travel-leg">
                  <MetaIcon icon={ Car } tone="money" />~{leg.distanceKm.toFixed(0)} km · ~{Math.round(leg.durationMinutes)} min from {leg.fromTitle.replace(/ \((start|end)\)$/, '')} · est ₹{Math.round(leg.distanceKm * (A.inrPerKm ?? 8))} ({A.mode})
                </div>
              </div>
            </div>
          )
        })()}
        {ordered.map((s, i) => {
          // Auto anchors (trip start/end, route-continuation waypoints) are pure
          // route endpoints, not activities. The rich travel summary (mode,
          // distance, fuel, departure→ETA, halts) lives in TravelPanel above;
          // here we just anchor the timeline leg with a clean marker.
          // #555: this row's own schedule facts, keyed by stop id — never by
          // the rendered index (rejected rows shift positional reads).
          const row = simRows.get(s.id)
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
                <div key={s.id} data-stop-id={s.id} className="tl-row tl-anchor" style={{ transform: glideOffset(i) != null ? `translateY(${glideOffset(i)}px)` : undefined }} {...(editable ? dndHandlers(i) : {})}>
                  <div className="tl-gutter" aria-hidden="true" />
                  <div className="travel-endpoint">
                    <span className="travel-anchor-ico"><MapPin size={13} aria-hidden /></span>
                    <span>Based in {cleanName}</span>
                  </div>
                </div>
              )
            }
            return (
              <div key={s.id} data-stop-id={s.id} className="tl-row tl-anchor" style={{ transform: glideOffset(i) != null ? `translateY(${glideOffset(i)}px)` : undefined }} {...(editable ? dndHandlers(i) : {})}>
                <div className="tl-gutter">
                  <span className="tl-time"><span className="sr-only">{isFinal ? 'Arrival: ' : 'Departure: '}</span>{isFinal ? (row?.arrive ? formatHM(row.arrive, timeFormat) : '--:--') : (row?.depart ? formatHM(row.depart, timeFormat) : '--:--')}</span>
                </div>
                <div className="travel-endpoint">
                  <span className="travel-anchor-ico">{i === 0 || isFinal ? <Flag size={13} aria-hidden /> : <MapPin size={13} aria-hidden />}</span>
                  <span>
                    {i === 0 ? `Start — ${cleanName}` : isFinal ? `Destination — ${cleanName}` : cleanName}
                  </span>
                  {isFinal && <span className="small muted" style={{ marginLeft: 6 }}>arrives ~{row?.arrive ? formatHM(row.arrive, timeFormat) : '--:--'}</span>}
                </div>
              </div>
            )
          }
          const kind = stopKindOf(s)
          return (
            <React.Fragment key={s.id}>
              <div
                className="tl-row"
                data-stop-id={s.id}
                style={{ transform: glideOffset(i) != null ? `translateY(${glideOffset(i)}px)` : undefined }}
                {...(editable ? dndHandlers(i) : {})}
              >
                <div className="tl-gutter">
                  <span className="tl-time tl-arr"><span className="sr-only">Arrival: </span>{row?.arrive ? formatHM(row.arrive, timeFormat) : '--:--'}</span>
                  <span className="tl-line" aria-hidden="true" />
                  <span className="tl-time tl-dep"><span className="sr-only">Departure: </span>{row?.depart ? formatHM(row.depart, timeFormat) : '--:--'}</span>
                </div>
                <div
                  className={`stop-card kind-${kind} status-${s.status} ${foreignOver === i && dragging === null ? 'foreign-over' : ''}`}
                >
                <div className={`stop-num cat-${s.category}`}>{i + 1}</div>
              <div className="stop-main">
                <div className="stop-toprow">
                  <span className="stop-title">{s.title}</span>
                  <Chip tone={statusTone(s.status)}>{statusLabel(s.status)}</Chip>
                  <span className={`stop-kind-tag kind-${kind}`}>{STOP_KIND_LABELS[kind]}</span>
                  {s.priority === 'must-do' && <Chip tone="danger">Must do</Chip>}
                  {s.priority === 'optional' && <Chip tone="saffron">Optional</Chip>}
                  {s.weatherSensitive && <Chip tone="info"><InlineIcon icon={CloudRain} size={11} gap={3} vAlign="-1px" />weather-sensitive</Chip>}
                </div>
                <div className="stop-meta">
                  <span><MetaIcon icon={ MapPin } tone="place" />{s.locationName}</span>
                  <span><MetaIcon icon={ Clock } tone="time" />{minutesToHM(s.visitMinutes)}</span>
                  {s.openTime && <span><MetaIcon icon={ Clock } tone="time" />{formatHMRange(s.openTime, s.closeTime, timeFormat)}</span>}
                  {/* Money fields are finite-guarded, not defaulted (#343): an
                      absent/non-finite fee renders NO segment ("₹undefined"
                      told the user a lie, and a forced ₹0 invents a free
                      ticket). A stored 0 is a real 0 and still renders. */}
                  {Number.isFinite(s.entryFeeInrPerPerson) && <span><MetaIcon icon={ Ticket } tone="ticket" />₹{s.entryFeeInrPerPerson}/person</span>}
                  {Number.isFinite(s.transportCostInrTotal) && <span><MetaIcon icon={ Car } tone="money" />₹{s.transportCostInrTotal} transport</span>}
                  {s.departTime && s.arrivalTime && (
                    <span><MetaIcon icon={ Clock } tone="time" />dep {formatHM(s.departTime, timeFormat)} · arr {formatHM(s.arrivalTime, timeFormat)}{s.legDistanceKm ? ` · ${s.legDistanceKm.toFixed(0)} km` : ''}</span>
                  )}
                </div>
                {s.description && <ClampedText className="stop-desc">{s.description}</ClampedText>}
                {s.notes && <ClampedText className="stop-desc muted"><InlineIcon icon={PenLine} size={12} gap={3} />{s.notes}</ClampedText>}
                {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="small" onClick={e => { e.preventDefault(); openExternal(s.sourceUrl!) }}>Source <InlineIcon icon={ExternalLink} size={11} gap={0} style={{ marginLeft: 2 }} /></a>}
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
                // #555: the gap under this row is the drive INTO the row BELOW
                // it — sim's legs are into-legs, resolved by stop id here, so a
                // rejected neighbour (absent from the schedule) can never shift
                // another row's leg into this gap. The row renders even without
                // a leg: it is also the drop zone / Insert slot between the two
                // rows.
                const leg = simRows.get(ordered[i + 1].id)?.legIn
                return (
                  <div className="tl-legrow" {...(editable ? dayDropHandlers(i + 1) : {})}>
                    <div className="tl-gutter tl-gutter-leg"><span className="tl-line tl-line-leg" /></div>
                    <div className="tl-leg-cell">
                      <div className={`travel-leg ${foreignOver === i + 1 && dragging === null ? 'foreign-over' : ''}`}>
                        {leg && leg.distanceKm >= 0.5 && <><MetaIcon icon={ Car } tone="money" />~{leg.distanceKm.toFixed(0)} km · ~{Math.round(leg.durationMinutes)} min from {leg.fromTitle.replace(/ \((start|end)\)$/, '')} · est ₹{Math.round(leg.distanceKm * (A.inrPerKm ?? 8))} ({A.mode})</>}
                      </div>
                      {/* #422: the insertion control belongs to the leg BETWEEN
                          two stops, and it hands over the slot it sits in —
                          resolved from the two neighbouring row ids at click
                          time, so a shifted list cannot insert two rows away.
                          Revealed on hover and on keyboard focus; always visible
                          on touch (a hover-only control is unreachable there). */}
                      {editable && (
                        <button
                          type="button"
                          className="leg-insert"
                          onClick={() => onInsertHere(day.index, insertionSlotBetween(ordered, ordered[i]?.id ?? null, ordered[i + 1]?.id ?? null))}
                          aria-label={`Insert a stop on Day ${day.index + 1} ${insertionWhere(ordered[i]?.title, ordered[i + 1]?.title)}`}
                          title="Insert a stop here"
                        ><Plus size={13} aria-hidden /><span className="leg-insert-label">Insert</span></button>
                      )}
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
                <div className="tl-gutter">
                  <span className="tl-time tl-arr"><span className="sr-only">Arrival: </span>{last.arrive ? formatHM(last.arrive, timeFormat) : '--:--'}</span>
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
          <div className="tl-end">
            {foreignOver === ordered.length && dragging === null && <div className="tl-drop-line">Drop to add here</div>}
          </div>
        )}
      </div>
      </SmoothCollapse>

      {/* Optimize-day preview: the before/after is straight-line distance math
          from the pure engine helper, rescaled to road km for display;
          committing goes through the same impact-preview gate as a manual
          drag (onReorderDay → applyChange). Lives outside the collapse so the
          header's Optimise button works from a collapsed day too. */}
      <Modal
        open={!!optPreview}
        onClose={() => setOptPreview(null)}
        title={`Optimise Day ${day.index + 1}`}
      >
        {optPreview && <>
          <p className="hint-text" style={{ margin: '0 0 12px' }}>
            Reorders the day's stops into the shortest route from where you start the day — grouping nearby sights,
            food and activities so you spend less time in transit. Anchors (your base, the day's destination and
            wherever the next day starts from) stay put; you can still drag anything afterwards.
          </p>
          {/* #341: with no measured leg the numbers below are straight-line
              math scaled by 1 — they must say so rather than read as road km. */}
          {roadLegs === 0 && (
            <p className="hint-text" style={{ margin: '0 0 12px' }}>
              These are straight-line estimates — the road for this trip has not been measured yet. Drive times
              after Keep come from the road itself.
            </p>
          )}
          <div className="opt-delta">
            <div className="opt-delta-cell">
              <div className="k">Travel distance</div>
              <div className="v">{kmLabel(optPreview.beforeKm)} → <b>{kmLabel(optPreview.afterKm)}</b></div>
              <div className="save">−{kmLabel(optPreview.beforeKm - optPreview.afterKm)}</div>
            </div>
            <div className="opt-delta-cell">
              <div className="k">Est. driving time</div>
              <div className="v">{roadLegs === 0 ? '~' : ''}{minutesToHM(Math.round(optPreview.beforeKm * roadRatio / (A.avgSpeedKmph || 40) * 60))} → <b>{roadLegs === 0 ? '~' : ''}{minutesToHM(Math.round(optPreview.afterKm * roadRatio / (A.avgSpeedKmph || 40) * 60))}</b></div>
              <div className="save">−{roadLegs === 0 ? '~' : ''}{Math.round((optPreview.beforeKm - optPreview.afterKm) * roadRatio / (A.avgSpeedKmph || 40) * 60)} min</div>
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
              // #341: re-derive from the day as it is NOW. A drag or an edit
              // that landed while this dialog was open used to be discarded
              // silently — last write wins over a snapshot nobody re-checked.
              const fresh = optimizeDayOrder(optOrigin, ordered, { hasNextDay })
              const idsOf = (r: OptimizeDayResult) => r.stops.filter(s => s.status !== 'rejected').map(s => s.id).join('|')
              if (!fresh.changed) {
                setOptPreview(null)
                toast(`Day ${day.index + 1} already matches its shortest order — nothing to apply.`)
                return
              }
              if (idsOf(fresh) !== idsOf(optPreview)) {
                setOptPreview(fresh)
                toast('The day changed while you were reviewing — here is the new order.', 'err')
                return
              }
              onReorderDay(day.index, optPreview.stops.map(s => s.id))
              toast(`Day ${day.index + 1} optimised — saved ${kmLabel(optPreview.beforeKm - optPreview.afterKm)} of crisscrossing`)
              setOptPreview(null)
            }}>Apply new order</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setOptPreview(null)}>Not now</button>
          </div>
        </>}
      </Modal>
    </div>
  )
// `day` is compared by CONTENT: the store hands every merged/echoed row fresh
// day objects with identical content, and the shallow default re-rendered every
// card on every commit for that alone (#347). Every other prop stays identity-
// compared, and the comparator is exhaustive by construction.
}, sameDaySectionProps)

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

function statusTone(s: string): 'teal' | 'saffron' | 'danger' | 'ok' | 'info' {
  return s === 'confirmed' ? 'teal' : s === 'needs-booking' ? 'saffron' : s === 'rejected' ? 'danger' : 'info'
}
