// ============ Trip workspace — Timeline DaySection (extracted from TimelineTab.tsx,
// restructure Phase 3) — the day header/summary row, the animated body, the stop
// rows and the empty-day suggestions. The 19-prop signature is the shared contract
// between the shell and this module; treat it as load-bearing (see the memo notes).
// ============ Trip workspace — Timeline tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes DaySection, DayWeatherChip, TravelPanel, HaltPlanRow,
// MoveStopModal and ClampedText — the whole timeline hot path.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { savedDayId, savedStopId } from '../../../lib/uiPrefs'
import { confirmedVisitMinutes } from '../../../lib/hoursContext'
import {
  ArrowRight, Armchair, BedDouble, Car, ChevronDown, ChevronUp, CircleCheck, CircleHelp, CloudRain, CloudSun,
  Copy, Droplets, ExternalLink, Flag, Fuel, Landmark, Lock, MapPin, Mountain,
  MoveHorizontal, MoreHorizontal, Moon, PenLine, Pencil, Pin, PlaneTakeoff, Plus, Route as RouteIcon, Trash2, TriangleAlert, Utensils,
} from 'lucide-react'
import type { ChangeEvent } from 'react'
import type { Trip, ItineraryStop, ItineraryDay } from '../../../data/types'
import {
  minutesToHM, hmToMinutes, formatInr,
  computeCategoryBias, optimizeDayOrder, roadScaleRatio, measuredLegCount, optimiseKmLabel, scheduleRowsById,
} from '../../../lib/engine'
import type { ScheduledLeg } from '../../../lib/engine'
import { distanceStatLabel, roadStateOf, type RoadState } from '../../../lib/roadStatLabel'
import type { RoadStatus } from '../../../lib/tripRoad'
import { hasUserPlannedStop, sameDaySectionProps, type DayCardFacts, type DayTotals } from '../../../lib/dayCards'
import type { LegEstimate, ScheduleWarning, OptimizeDayResult } from '../../../lib/engine'
import { stayDaySummary } from '../../../lib/daySummary'
import { insertionSlotBetween } from '../../../lib/stopOrder'
import { insertionWhere } from '../../../lib/labels'
import { isDriveDay } from '../../../lib/ridePlan'
import { fixedRowsFor, fixedStopIdsOf, waitingMinutesFor, worstFixedTone } from '../../../lib/fixedTimes'
import { openExternal } from '../../../lib/native'
import { useTimeFormat, formatHM, formatHMRange } from '../../../lib/timefmt'
import { motionTiming, prefersReducedMotion } from '../../../lib/motion'
import { stopPresentation, type StopKind } from '../../../lib/stopKind'
import { statusLabel } from '../../../lib/labels'
import { Chip, Modal, toast, useReorder } from '../../../components/ui'
import { StateBlock } from '../../../components/page/StateBlock'
import { Select } from '../../../components/Select'
import { COVER_TYPES, coverFileError, uploadCover } from '../../../lib/coverUpload'
import { CoverMedia } from '../../../components/CoverMedia'
import { coverAttemptsFor } from '../../../lib/coverAttempts'
import { coverPlanFor, type CoverPlan } from '../../../lib/regionArt'
import { regionFor } from '../../../lib/tripsPage'
import { sizedCoverUrl } from '../../../lib/tripThumb'
import { currentUser } from '../../../store/store'

/**
 * The day's cover plan: the traveller's own upload when there is one, else the
 * generated scene for where the day goes.
 *
 * The day gets its own `regionArt` plan rather than a live Wikipedia lookup.
 * A lookup was the obvious idea and it failed in practice: 9 of 10 real stop
 * names ("Panaji market", "Colva beach", "Candolim beach") resolve to nothing,
 * and the one that did resolve — "South Goa" — returned a district locator MAP,
 * which the card drew as a 132px band of cartography. The generated scenes are
 * local, always available, and the same artwork the trip's own cover uses, so a
 * day card and its trip header never disagree about what a place looks like.
 */
function useDayCover(day: ItineraryDay, trip: Pick<Trip, 'id' | 'coverEmoji' | 'destinations' | 'startLocation'> | undefined): CoverPlan {
  return useMemo(() => {
    const places = day.stops.filter(s => !s.auto).map(s => s.title.trim()).filter(Boolean)
    const regionEvidence: string[] = [...(trip?.destinations ?? [])]
    if (trip?.startLocation) regionEvidence.push(trip.startLocation)
    return coverPlanFor({
      // Sized on the way in, like every other cover surface, so a day cover
      // stored before sizing existed is still requested at the full width.
      userCover: day.coverImageUrl ? sizedCoverUrl(day.coverImageUrl) : '',
      fallbackEmoji: trip?.coverEmoji,
      // The region matcher reads the trip's destinations AND its start place. The
      // table is deliberately narrow — "Palolem" alone is not "Goa" — but a start
      // place names the state ("Panaji, Goa"), which resolves a trip whose
      // destinations are only towns. Trip-level evidence also keeps a day card
      // and its trip header on the same region's artwork.
      region: regionFor({ destinations: regionEvidence }),
      // The day's index picks the scene, so consecutive days step through the
      // region's family instead of repeating one image. A hash of the day's text
      // looked nicer but collided: "Panaji market" and "Colva beach" hashed to
      // the same Goa scene, and two neighbouring days drew the same picture.
      seed: trip?.id ?? 'day',
      sceneIndex: day.index,
      placeCount: Math.max(1, places.length),
      destinations: places.length ? places : day.title ? [day.title] : [],
    })
  }, [day.coverImageUrl, day.index, day.title, day.stops, trip])
}
/**
 * The stop's kind, drawn as the artboard's duotone tile icon. Each kind gets a
 * distinct glyph so the tile reads by shape as well as by tint — colour alone
 * would fail for a colour-blind reader and in a greyscale print.
 */
function StopKindIcon({ kind }: { kind: StopKind }) {
  switch (kind) {
    case 'food': return <Utensils size={22} aria-hidden />
    case 'stay': return <BedDouble size={22} aria-hidden />
    case 'fuel': return <Fuel size={22} aria-hidden />
    case 'rest': return <Armchair size={22} aria-hidden />
    case 'viewpoint': return <Mountain size={22} aria-hidden />
    case 'drive': return <Car size={22} aria-hidden />
    default: return <Landmark size={22} aria-hidden />
  }
}

/**
 * A collapsed day's thumbnail: the artboard's 84x60 crop at the start of the
 * row. It reads the same cover plan as the open day's band, so folding and
 * unfolding a day shows one picture rather than two different places.
 */
function DayThumb({ day, trip }: {
  day: ItineraryDay
  trip: Pick<Trip, 'id' | 'coverEmoji' | 'destinations' | 'startLocation'> | undefined
}) {
  const plan = useDayCover(day, trip)
  if (!coverAttemptsFor(plan).length) return null
  return (
    <span className="day-thumb" aria-hidden="true">
      <CoverMedia
        plan={plan}
        ratio="84:60"
        sizes="84px"
        className="day-thumb-img"
        emojiClassName="day-thumb-img day-thumb-emoji"
        alt=""
      />
    </span>
  )
}

/**
 * The day's cover strip: a photo for THIS day, a 34px "Change day cover"
 * control over it, and the white-to-transparent gradient that lets the header
 * float over the photo. The artboard draws it 132px tall, and the header below
 * pulls up 34px into it, which is why the cover is a sibling of the header
 * rather than its background.
 */
function DayCover({ day, trip, editable, onSetCover, folded = false, nodeRef }: {
  day: ItineraryDay
  trip: Pick<Trip, 'id' | 'coverEmoji' | 'destinations' | 'startLocation'> | undefined
  editable: boolean
  onSetCover: (dayIndex: number, url: string | undefined) => void
  /** Folded shut: the strip's closing state, held for the length of the day's
   *  open/close gesture so the photo never pops out on the first frame. */
  folded?: boolean
  nodeRef?: React.Ref<HTMLDivElement>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const plan = useDayCover(day, trip)

  const onPick = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const bad = coverFileError(file)
    if (bad) { toast(bad); return }
    const me = currentUser()
    if (!me) { toast('Sign in to add a day cover'); return }
    setBusy(true)
    const { url: stored, error } = await uploadCover(me.id, file)
    setBusy(false)
    if (error || !stored) { toast(error ?? 'Could not upload that image'); return }
    onSetCover(day.index, stored)
    toast('Day cover updated')
  }, [day.index, onSetCover])

  // A generated scene is always available, so the strip always draws — which is
  // what the artboard shows: every day has a photo. Only the emoji terminal
  // state (every image gone) leaves the header on the bare card.
  if (!coverAttemptsFor(plan).length) return null

  return (
    <div ref={nodeRef} className={`day-cover${folded ? ' is-folded' : ''}`}>
      <CoverMedia
        plan={plan}
        ratio="16:5"
        sizes="(max-width: 900px) 100vw, 780px"
        className="day-cover-img"
        emojiClassName="day-cover-img day-cover-emoji"
        alt=""
      />
      <span aria-hidden="true" className="day-cover-veil" />
      {editable && (
        <>
          <input
            ref={fileRef} type="file" accept={COVER_TYPES.join(',')} className="sr-only"
            aria-label={`Choose a cover for Day ${day.index + 1}`}
            onChange={onPick}
          />
          <div className="day-cover-tools">
            <button
              type="button" className="day-cover-btn" disabled={busy}
              onClick={() => fileRef.current?.click()}
              title="Replace this day’s cover"
            >
              {busy ? 'Uploading…' : 'Change day cover'}
            </button>
            <button
              type="button" className="day-cover-clear" onClick={() => onSetCover(day.index, undefined)}
              aria-label={`Remove the cover for Day ${day.index + 1}`} title="Remove day cover"
            >
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Stop options for a commitment link: live stops only, plus the unlink row. */
/** One leg row's summary. An air sector reads as a flight — a plane glyph, the
 *  block time and the fare — and never as "~N km · ~N min · est ₹/km", which is
 *  what a flight row used to say when the whole day ran at one blended speed. */
function LegSummary({ leg, inrPerKm, mode }: { leg: ScheduledLeg; inrPerKm: number; mode: string }) {
  const from = leg.fromTitle.replace(/ \((start|end)\)$/, '')
  if (leg.kind === 'air') {
    const fare = leg.costInr != null ? ` · ${formatInr(Math.round(leg.costInr))} total` : ''
    return (
      <>
        <MetaIcon icon={PlaneTakeoff} tone="money" />{leg.toTitle} · fly {minutesToHM(leg.durationMinutes)} from {from}
        {leg.distanceKm >= 0.5 ? ` · ${Math.round(leg.distanceKm)} km` : ''}{fare}
      </>
    )
  }
  return (
    <>
      <MetaIcon icon={Car} tone="money" />
      <span className="travel-leg-line">~{leg.distanceKm.toFixed(0)} km · {minutesToHM(leg.durationMinutes)}</span>
      <span className="travel-leg-extra">from {from} · est ₹{Math.round(leg.distanceKm * (leg.inrPerKm ?? inrPerKm))} ({leg.inrPerKm != null ? 'car' : mode})</span>
    </>
  )
}

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
import { useWeatherRefreshTick } from '../../../hooks/useWeatherRefresh'
import { TravelPanel } from './TravelPanel'
import type { TimelineAddAvailability } from './timelineAddAvailability'
import type { JourneyDay, JourneyStatus } from '../journey/journeyDays'
import type { JourneyRow } from '../../../lib/journeyProjection'

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
  // Re-pull on the refresh cadence and whenever the tab regains focus, so the
  // chip never shows a forecast that is hours stale.
  const tick = useWeatherRefreshTick()
  useEffect(() => {
    // Gate on THIS day's date, not the trip's start: a 15-day window that opens
    // on day 1 still leaves day 12 beyond the forecast, and Open-Meteo answers
    // that with a 400 rather than a forecast (#340). No chip is the honest
    // answer — the same rule as "no anchor, no chip".
    if (lat == null || lng == null || !forecastAvailable(date)) { setW(null); return }
    let cancelled = false
    fetchDailyWeather(lat, lng, date, 1, { force: tick > 0 })
      .then(res => { if (!cancelled) setW(res[date] ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [lat, lng, date, tick])
  if (!w) return null
  const info = wmoInfo(w.code)
  return (
    <span className="weather-chip" title={`${info.label} · ${Math.round(w.tempMinC)}–${Math.round(w.tempMaxC)}°C · ${w.rainChancePct}% rain chance`}>
      {info.icon} {Math.round(w.tempMaxC)}°<InlineIcon icon={Droplets} size={11} gap={2} vAlign="-1px" className="tl-rain-gap" />{w.rainChancePct}%
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

/** Extra frames after the CSS transition ends before the body is unmounted. */
const COLLAPSE_UNMOUNT_SLACK_MS = 40

/** Smooth open/close for a day body: the wrapper animates grid rows 0fr→1fr
 *  (height-agnostic, no max-height guessing), mounting the body just before
 *  the expand and unmounting it just after the collapse — so a closed day
 *  still costs nothing (the collapsed-by-default premise) while the motion
 *  stays smooth. A clip that would strand the keyboard user's focus hands it
 *  back through `fallbackFocus` instead.
 *
 *  Pass `fold` to move on a clock a sibling shares (the day cover rides the
 *  body's); without it the clip keeps its own. */
function SmoothCollapse({ open, children, fallbackFocus, fold }: {
  open: boolean
  children: React.ReactNode
  fallbackFocus?: React.RefObject<HTMLButtonElement | null>
  fold?: FoldState
}) {
  return fold
    ? <FoldClip open={open} fold={fold} fallbackFocus={fallbackFocus}>{children}</FoldClip>
    : <OwnFoldClip open={open} fallbackFocus={fallbackFocus}>{children}</OwnFoldClip>
}

function OwnFoldClip({ open, children, fallbackFocus }: {
  open: boolean
  children: React.ReactNode
  fallbackFocus?: React.RefObject<HTMLButtonElement | null>
}) {
  const fold = useFold(open)
  return <FoldClip open={open} fold={fold} fallbackFocus={fallbackFocus}>{children}</FoldClip>
}

function FoldClip({ open, fold, children, fallbackFocus }: {
  open: boolean
  fold: FoldState
  children: React.ReactNode
  fallbackFocus?: React.RefObject<HTMLButtonElement | null>
}) {
  const { mounted, expanded } = fold
  const clipRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) return
    // This clip is on its way out, so hand focus back to the day's disclosure
    // control the moment the close starts — NOT when the clip unmounts. Its
    // inner wrapper flips to `visibility: hidden` one animation earlier, and a
    // browser blurs a hidden element immediately: focus is already back on
    // <body> by then, and a keyboard user's next Tab restarts at the top of the
    // document. Reachable on both clips: opening a day from its route line
    // removes that line, and collapsing removes the body under the cursor.
    if (clipRef.current?.contains(document.activeElement)) fallbackFocus?.current?.focus()
  }, [open, fallbackFocus])
  if (!mounted) return null
  return (
    <div ref={clipRef} className={`day-body-clip${expanded ? ' open' : ''}`} aria-hidden={!expanded}>
      <div className="day-body-clip-inner">{children}</div>
    </div>
  )
}

type FoldState = { mounted: boolean; expanded: boolean }

/** One open/close gesture, shared by every part of a day that folds: `mounted`
 *  keeps a closing element in the document until its transition ends, and
 *  `expanded` is the open state. A section that mounts already-open never
 *  animates (the persisted open day renders open immediately).
 *
 *  The layout-effect read is load-bearing, not defensive. React flushes a
 *  discrete event's effect before the browser paints, so mounting the element
 *  and opening it in the same commit left the transition with no "from" value:
 *  measured on the first day, the card went 195px → 1090px inside 130ms with no
 *  height animation at all while the chevron took 600ms — the "snap then settle"
 *  the motion doc names as a defect. The fix commits the closed state, reads
 *  layout, and only then flips the class, which pins the "from" value. The unmount
 *  delay reads its duration from --motion-slower, so retiming the animation in
 *  CSS can never leave a half-collapsed body mounted. A reopen during the close
 *  clears that timer and re-flips `expanded`, so the transition simply reverses
 *  from wherever it had got to. */
function useFold(open: boolean): FoldState {
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)
  // Follow `open` while rendering (React's "adjust state on a prop change"
  // pattern) so the closed commit never waits on an effect: a reopen mounts, a
  // close drops `expanded` in the same pass that the prop arrives.
  const [seenOpen, setSeenOpen] = useState(open)
  if (open !== seenOpen) {
    setSeenOpen(open)
    if (open) setMounted(true)
    else setExpanded(false)
  }
  useEffect(() => {
    if (open) return
    const t = window.setTimeout(() => { setMounted(false) }, motionTiming('--motion-slower').duration + COLLAPSE_UNMOUNT_SLACK_MS)
    return () => window.clearTimeout(t)
  }, [open])
  useLayoutEffect(() => {
    if (!open || !mounted || expanded) return
    // Commits the closed value before the class flips, so the transition has a
    // start to travel from.
    void document.documentElement.offsetHeight
    setExpanded(true)
  }, [open, mounted, expanded])
  return { mounted, expanded }
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
export const DaySection = React.memo(function DaySection({ day, trip, dayCover, facts, savedIds, onToggleSaved, editable, open, reviewMode, inView, onToggleOpen, onInsertHere, onAdd, onEdit, onDelete, onMoveWithinDay, onReorderDay, onMoveBetweenDays, onMoveStopIn, onRenameDay, onSetCover, onCopyDay, onAddQuickStop, onSetDayStart, onAddPlannedHalts, onLinkCommitment, warnings, onStatus, legCorrections, roadStatus, suggestionCache, dayTotals, journeyDay, journeyStatus, onAddProjectedRow, projectedAddBusy, previewOpen, projectedAddError, onRetryProjectedRow, projectedRetryAvailable, projectedTerminal, projectedUnresolved, projectedRetryBlockedReason, projectedAvailability }: {
  day: Trip['days'][number]
  /** MR8: this trip's saved ids, and the one toggle every heart on the page uses. */
  savedIds: string[]
  onToggleSaved: (id: string) => void
  /** fresh ONLY for the open day — everything else comes from `facts` */
  trip?: Trip
  /** The cover's own slice of the trip. Present on every card, open or closed,
   *  because a closed card is denied the whole `trip` for render cost and its
   *  cover would otherwise lose its region evidence. */
  dayCover?: Pick<Trip, 'id' | 'coverEmoji' | 'destinations' | 'startLocation'>
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
  /** The workspace's road-chain status: what the distance stat's wording must
   *  say (#671). Undefined from a caller that does not plumb it reads as an
   *  unmeasured day — the helper can only ever see a real correction with it. */
  roadStatus?: RoadStatus
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
  /** set or clear this day's own cover photo (undefined clears it) */
  onSetCover: (dayIndex: number, url: string | undefined) => void
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
  /** S3: the shared day model. Optional until S4 declares the panel props. */
  journeyDay?: JourneyDay
  journeyStatus?: JourneyStatus
  /** S4 repair: forward the real #841 writer hop to the panel. */
  onAddProjectedRow?: (row: JourneyRow, dayIndex: number) => void
  projectedAddBusy?: boolean
  previewOpen?: boolean
  projectedAddError?: string | null
  onRetryProjectedRow?: () => void
  projectedRetryAvailable?: boolean
  projectedTerminal?: string | null
  projectedUnresolved?: boolean
  projectedRetryBlockedReason?: string | null
  /** S4: typed covered-Add reason from the measured road grade. */
  projectedAvailability?: TimelineAddAvailability
}) {
  // One unified journey per day — start → halts/visits → destination with an
  // arrival clock — regardless of distance. This is the single travel system.
  const sim = facts.sim
  const journey = facts.journey
  const hasAirLeg = journey.points.some(p => p.legIn?.kind === 'air')
  // The body keeps rendering through the collapse animation (SmoothCollapse
  // unmounts it a beat after the class flip), while `trip` only arrives for the
  // OPEN day. Hold the last one we were given so a fading body never loses its
  // travel panel mid-animation — and a never-opened card never gets one at all.
  const lastTrip = useRef(trip)
  if (trip) lastTrip.current = trip
  // MR8: one lookup for this day's heart. The stop hearts read the same list.
  const daySaved = savedIds.includes(savedDayId(day.index))
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
  const commitmentsToday = facts.commitments
  // PW-08: one read model for the day's fixed commitments. Every clock comes
  // from the same simulateDay rows the rail prints, so a stop pill, the fixed
  // times panel and the engine's conflict warning cannot disagree. A hotel
  // check-in stays an anchor (the engine skips it for conflicts); it still
  // shows its clock. A missing link stays unlinked — never another stop's time.
  const fixedRows = useMemo(() => fixedRowsFor(sim, commitmentsToday), [commitmentsToday, sim])
  // The optimiser may not rewire a stop that carries a fixed clock. Passing
  // these ids is what turns the engine's guard on; a day with none keeps the
  // existing anti-crisscross behaviour unchanged.
  const fixedStopIds = useMemo(
    () => fixedStopIdsOf(fixedRows),
    [fixedRows],
  )
  const fixedByStop = useMemo(() => {
    const byStop = new Map<string, typeof fixedRows>()
    for (const row of fixedRows) {
      if (row.fc.stopId == null) continue
      const key = String(row.fc.stopId)
      const list = byStop.get(key)
      if (list) list.push(row)
      else byStop.set(key, [row])
    }
    return byStop
  }, [fixedRows])
  const fixedClashes = fixedRows.filter(r => r.tone === 'clash').length
  const fixedInvalid = fixedRows.filter(r => r.tone === 'invalid').length
  const fixedTight = fixedRows.some(r => r.tone === 'tight')
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
  const optKey = `${day.index}|${hasNextDay ? 1 : 0}|${optOrigin.lat.toFixed(5)},${optOrigin.lng.toFixed(5)}|fixed:${fixedStopIds.join(',')}|${ordered.map(s => `${s.id}:${s.lat.toFixed(5)},${s.lng.toFixed(5)}:${s.orderInDay}:${s.status}:${s.auto ? 1 : 0}:${s.category}`).join('|')}`
  const optResult = useMemo(
    () => optimizeDayOrder(optOrigin, ordered, { hasNextDay, fixedStopIds }),
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
  /** #671: which truth the distance stat shows — a measured road number or a
   *  straight-line estimate. Pending, failed and never-measured all print the
   *  estimate wording; only a day with a measured leg claims the road. */
  const roadState: RoadState = useMemo(
    () => roadStateOf(roadStatus, journey, legCorrections),
    [roadStatus, journey, legCorrections],
  )
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

  // --- Collapsed-by-default accordion (docs/TIMELINE-PLAN.md Phase 1) ---
  // Collapse state lives in TimelineTab (one open day per trip, persisted via
  // uiPrefs.loadOpenDay). This component is controlled: `open` in, `onToggleOpen`
  // out — the old local collapsed useState + per-day localStorage map is retired.
  const collapsed = !open
  // The cover and the body are one gesture: both read this fold, so the photo
  // keeps its place in the layout until the body has finished closing instead
  // of vanishing on the first frame (measured: cover height was -1 by 69ms
  // while the card still had 900px left to travel).
  const fold = useFold(open)
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
  // #842 F17: a day whose only rows are automatic anchors (trip start/end,
  // route waypoints) is still an unplanned day — it gets discovery chips.
  const hasPlannedStop = hasUserPlannedStop(ordered)
  // The bias is a real search input, so the effect keys on its VALUE: a
  // day-title rename changes `trip` but not the bias, and the paid search
  // must not re-fire (#842 F17, audit case 2).
  const nearbyBias = useMemo(() => (trip ? computeCategoryBias(trip) : {}), [trip])
  const nearbyBiasKey = JSON.stringify(nearbyBias)
  // #842 F17: a failed chips search says so — the old swallowed catch made a
  // provider failure read exactly like "nothing nearby".
  const [nearbyFailed, setNearbyFailed] = useState(false)
  useEffect(() => {
    const anchor = facts.prevPoint ?? facts.homeCenter
    if (!editable || !open || !trip || hasPlannedStop || (reviewMode && !inView) || !anchor) {
      setNearby([]); setNearbyFailed(false); return
    }
    let cancelled = false
    searchNearbyPois(anchor.lat, anchor.lng, 10000, 6, {
      includeFuel: facts.assumptions.mode === 'car' || facts.assumptions.mode === 'motorcycle',
      homeCenter: facts.homeCenter,
      categoryBias: nearbyBias,
    })
      .then(hits => { if (!cancelled) { setNearbyFailed(false); setNearby(hits.slice(0, 3)) } })
      .catch(() => { if (!cancelled) setNearbyFailed(true) })
    return () => { cancelled = true }
    // #213 Phase 3 + #347: depend on the values the effect actually reads — the
    // resolved anchor and home center from `facts`, the mode that gates fuel,
    // and the open flag that decides whether a body exists to show them in.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nearbyBiasKey pins the bias value; the trip object must not re-fire the search
  }, [editable, open, nearbyBiasKey, hasPlannedStop, reviewMode, inView,
      facts.prevPoint?.lat, facts.prevPoint?.lng, facts.homeCenter?.lat, facts.homeCenter?.lng, facts.assumptions.mode])

  const dayStartHM = day.startTime ?? A.dayStart
  const sev = warnings.some(w => w.severity === 'high') ? 'high' : warnings.some(w => w.severity === 'medium') ? 'medium' : 'ok'
  // Header stats as segments, in the artboard's order: what the day holds, how
  // far, how long driving, then the window — the same reading order as the
  // mockup's "2 stops · ~140 km · 3h 50m driving · 07:00 → 20:30".
  const statSegments: React.ReactNode[] = isStayDay
    ? [
        `Based in ${journey.startTitle}`,
        ...(visitCount > 0 ? [`${visitCount} visit${visitCount !== 1 ? 's' : ''}`] : []),
        `${formatHM(journey.startTime, timeFormat)} → ${formatHM(sim.endsAt, timeFormat)}`,
      ]
    : [
        ...(visitCount > 0 ? [`${visitCount} stop${visitCount !== 1 ? 's' : ''}`] : []),
        // #671: the distance stat still names whose number it is.
        distanceStatLabel(journey, roadState),
        `${hasAirLeg ? 'travel' : 'drive'} ${minutesToHM(journey.driveMinutes)}`,
        // The mockup writes the window as a bare clock pair; "start"/"ends ~"
        // were words the two times already carry.
        `${formatHM(journey.startTime, timeFormat)} → ${formatHM(sim.endsAt, timeFormat)}`,
      ]

  // PW-07: the day's own date, derived from the trip start. Manual weekday and
  // month names keep the label stable across locales; the timeline is English.
  const dayDate = (() => {
    const raw = facts.startDate
    if (!raw) return null
    const base = new Date(`${raw}T00:00:00`)
    if (Number.isNaN(base.getTime())) return null
    base.setDate(base.getDate() + day.index)
    const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return { wd: WD[base.getDay()], d: base.getDate(), mon: MO[base.getMonth()] }
  })()
  // The mockup's time budget, from real minutes. Halts are split out of the
  // dwell total because the journey already classifies each point: a food or
  // rest stop is a `halt`, everything else is a `visit`.
  const budgetWindow = Math.max(1, hmToMinutes(A.dayEnd) - hmToMinutes(dayStartHM))
  const budgetDrive = Math.max(0, Math.min(budgetWindow, sim.totalTravelMinutes))
  const budgetDwell = Math.max(0, Math.min(budgetWindow - budgetDrive, sim.dwellMinutes))
  const budgetHalts = Math.min(budgetDwell, journey.points
    .filter(p => p.kind === 'halt')
    .reduce((sum, p) => sum + Math.max(0, p.dwellMinutes), 0))
  const budgetStops = Math.max(0, budgetDwell - budgetHalts)
  // Waiting is the spare time a fixed commitment leaves you standing around
  // for: the same `spareMin` the rail already prints as "At the jetty with 55
  // min to spare". It is real computed data, not a fifth invented bucket — it
  // was buried inside Free before this. Only the surplus counts, and overlapping
  // spares collapse to one cursor, so two commitments cannot double-count.
  const budgetWait = Math.min(
    Math.max(0, budgetWindow - budgetDrive - budgetDwell),
    waitingMinutesFor(fixedRows),
  )
  const budgetFree = Math.max(0, budgetWindow - budgetDrive - budgetDwell - budgetWait)
  // Only real segments get a column; a zero-minute drive must not leave a gap.
  const budgetSegments = [
    { cls: 'db-drive', minutes: budgetDrive },
    { cls: 'db-halt', minutes: budgetHalts },
    { cls: 'db-dwell', minutes: budgetStops },
    { cls: 'db-wait', minutes: budgetWait },
    { cls: 'db-free', minutes: budgetFree },
  ].filter(s => s.minutes > 0)
  // The day's money, split so the lines add up to the total: travel and day
  // costs are separate buckets, and the remainder is entry fees plus stay.
  const dayTotal = dayTotals != null && dayTotals.dayIndex === day.index ? dayTotals : null
  const dayRemainder = dayTotal
    ? Math.max(0, dayTotal.totalInr - dayTotal.transportInr - dayTotal.expensesInr)
    : 0

  return (
    <div className={`day-section${collapsed ? ' day-closed' : ''}${collapsed && isStayDay ? ' day-stay-collapsed' : ''}${dragging !== null ? ' drag-live' : ''}${reviewMode ? ' day-review' : ''}`} id={`day-card-${day.index}`}>
      {/* The artboard splits the cover in two. An OPEN day draws the 132px
          gradient band, and the header pulls up into it so the date badge
          overlaps the photo. A COLLAPSED day draws only an 84x60 thumbnail at
          the start of its row — the full band on a folded card turned four
          days into four banners and buried the list. The cover is a SIBLING of
          the header, not its background: a background image could not be
          overlapped by its own child. */}
      {fold.mounted && (
        <DayCover day={day} trip={trip ?? dayCover} editable={editable} onSetCover={onSetCover} folded={!fold.expanded} />
      )}
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
        <div className="day-badge-lead">
          {collapsed && <DayThumb day={day} trip={trip ?? dayCover} />}
          <div className={`day-badge${dayDate ? ' day-badge-date' : ''}`}>
            {dayDate ? (
              <>
                <span className="day-badge-wd">{dayDate.wd}</span>
                <b>{dayDate.d}</b>
                <span className="day-badge-mon">{dayDate.mon}</span>
              </>
            ) : (
              <><small>Day</small><b>{day.index + 1}</b></>
            )}
          </div>
        </div>
        <div className="tl-stop-flex">
          <div className="day-title-row">
            {dayDate && <span className="day-number">Day {day.index + 1}</span>}
            {editingTitle ? (
              <input
                autoFocus
                className="input tl-day-note"
                value={titleDraft}
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
              /* The artboard keeps the title as plain text and renames from a
                 pencil beside it. A title that was itself the trigger turned one
                 tap on the day name into a focused input, which pushed the heart
                 and the day-type chip onto a second row — the header visibly
                 reflowed while the pointer was still on the title. */
              <h3 className="day-title-text">{day.title ?? `Day ${day.index + 1}`}</h3>
            )}
            {editable && !editingTitle && (
              <button type="button" className="day-rename-btn"
                onClick={() => { setTitleDraft(day.title ?? ''); setEditingTitle(true) }}
                aria-label={`Rename Day ${day.index + 1}`}
                title="Rename this day">
                <Pencil size={15} aria-hidden />
              </button>
            )}
            {/* MR8: save the day. A heart beside the title rather than on the
                pencil, so saving does not open the rename field. */}
            <button
              className={`tl-save-heart${daySaved ? ' on' : ''}`}
              aria-pressed={daySaved}
              aria-label={`${daySaved ? 'Remove' : 'Save'} Day ${day.index + 1}`}
              title={daySaved ? 'Remove from saved' : 'Save this day'}
              onClick={() => onToggleSaved(savedDayId(day.index))}
            >
              <Heart size={14} aria-hidden fill={daySaved ? 'currentColor' : 'none'} />
            </button>
            {/* Day Planner day type (P1-D): derived from the journey, never
                labelled by hand — wheel time makes it a drive, none makes it a
                stay, a short hop plus local time is mixed. */}
            <span className={`day-kind ${dayType.toLowerCase()}`}>
              {hasAirLeg ? 'Flight day' : dayType === 'STAY' ? 'Stay day' : dayType === 'DRIVE' ? 'Drive day' : 'Drive + local'}
            </span>
            {fixedRows.length > 0 && (
              <span
                className={`day-fixed-badge${fixedClashes > 0 ? ' risk' : fixedTight || fixedInvalid > 0 ? ' tight' : ''}`}
                title={fixedRows.map(r => `${r.fc.title} at ${formatHM(r.fc.time, timeFormat)}`).join('\n')}
              >
                <InlineIcon icon={Lock} size={11} gap={4} />
                {fixedRows.length} fixed time{fixedRows.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {/* Collapsed extra line. The artboard gives a collapsed day exactly
              two lines: the title, then one stats line. A third line naming the
              stops was the loudest clutter in the header — the same names are
              the first thing the body shows when the day opens, and the stats
              line already carries the count. A stay day keeps its quiet
              "no driving" line, which says something the stats cannot. */}
          {isStayDay && (
            <SmoothCollapse open={collapsed} fallbackFocus={collapseRef}>
              <button type="button" className="day-route" onClick={onCollapseClick} aria-expanded={!collapsed}>
                <span className="day-route-text">{stayDaySummary(visitCount)}</span>
              </button>
            </SmoothCollapse>
          )}
          <div className="small muted num">
            {statSegments.map((seg, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="stat-sep" aria-hidden="true">·</span>}
                {seg}
              </React.Fragment>
            ))}
          </div>
          {/* The day-progress bar is gone. It drew one unlabeled fill against
              the day's window, and the five-segment time budget inside the
              collapse now states the same window split into what actually
              happened (driving, halts, stops, waiting, free) with a key that
              names each part. Two bars for one reading is the redundancy the
              artboard avoids, and the header one also grew the header by 18px
              in a single frame when a day opened. */}
          {/* #421: the weather chip is a provider call per day, so it waits
              until the day is near the viewport. It also lives inside the
              collapse rather than here: it arrives asynchronously and grew the
              header by 18px in one frame when it landed (measured 66 → 84.3px),
              which is a height change no duration can smooth. The artboard's
              header carries no weather either — the date, the title, the
              badges, one stats line and the chevron. */}
        </div>
        {/* Per-day cost + time-at-stops: intelligence the engine already
            computes (computeTotals().byDay + simulateDay dwell), surfaced where
            the plan is edited. Hidden while collapsed so a folded day's header
            stays calm. */}
        {/* The day's money and its time-at-stops already sit in the DAY BRIEF
            beside this header, as two of its four figures. Repeating them here
            was the header's loudest redundancy: the same ₹ and the same hours,
            twice, 400px apart. The brief owns those numbers now; the header
            keeps what the brief does NOT say — the route, the road, the stops
            and the window — plus the state that needs acting on. */}
        {sev !== 'ok' && (
          <span className={`day-warn-pill sev-${sev}`} title={warnings.map(w => w.title).join('\n')}>
            <InlineIcon icon={TriangleAlert} size={12} gap={3} />{warnings[0].title.replace(/^Day \d+:\s*/, '')}{warnings.length > 1 ? ` · +${warnings.length - 1} more` : ''}
          </span>
        )}
        {/* The day spark was a small zigzag drawn beside every header with 2+
            stops. The artboard has nothing there, and the shape carried no
            reading a traveller could act on — it was decoration in the busiest
            part of the card. The stops it drew already have their own rail. */}
        {/* A collapsed day draws two lines and nothing else. Small in-header
            graphics (the spark, the dwell bars) each carried a tooltip and no
            visible label, so at a glance they read as smudges beside the title
            rather than as information. Whatever they encoded — time at each
            stop — the open day states in words on its own rail. */}
        {/* The artboard's collapsed card carries ONE control, the chevron: the
            title, its badges and the stats line, then nothing. Copy and "Add
            here" sat on every folded day and turned four calm cards into eight
            buttons. They live inside the collapse now (below), so the folded
            card is calm AND the buttons ride the open/close instead of growing
            the header in a single frame. */}
      </div>

      {/* The time budget and the day's own tools belong to the OPEN day, and
          they live INSIDE the collapse so they ride it. Gated on `!collapsed`
          from the header instead, they appeared in one frame and grew the card
          by ~50px before the 560ms body had moved a pixel — measured 51.5px in
          the first frame, which is the "snap then settle" the motion doc names
          as a defect. Inside the clip they are simply part of the surface that
          is expanding. */}
      <SmoothCollapse open={!collapsed} fallbackFocus={collapseRef} fold={fold}>
      {editable && (
        <div className="tl-day-tools">
          {optResult.changed && !isStayDay && (
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setOptPreview(optResult)}
              title={`Reorder this day's stops to cut crisscrossing. Saves ${kmLabel(optResult.beforeKm - optResult.afterKm)} of travel${roadLegs === 0 ? ' (straight-line estimate: the road has not been measured yet)' : ''}`}
            ><InlineIcon icon={RouteIcon} size={13} gap={4} />Optimise{optResult.beforeKm - optResult.afterKm > 0 ? ` (−${roadLegs === 0 ? '~' : ''}${Math.round((optResult.beforeKm - optResult.afterKm) * roadRatio)} km)` : ''}</button>
          )}
          {/* #341: a day the optimiser refuses for a reason the user can act
              on says so, instead of hiding the button as if nothing existed.
              The tooltip needs the wrapper span — a disabled button fires no
              pointer events, so its own title would never show. */}
          {!optResult.changed && (optResult.blocked === 'mid-anchor' || optResult.blocked === 'fixed-time') && !isStayDay && (
            <span
              title={optResult.blocked === 'fixed-time'
                ? 'A stop carries a fixed time, so the optimiser will not move its clock. Reorder the stops by hand if the day must change.'
                : 'The order is fixed by your manually placed waypoints. The optimiser only rewires the middle of a day, and one of those sits mid-day.'}
              className="tl-fixed-inline"
            >
              <button className="btn btn-outline btn-sm" disabled aria-disabled="true">
                <InlineIcon icon={RouteIcon} size={13} gap={4} />Optimise
              </button>
            </span>
          )}
          <button
            className="btn btn-outline btn-sm is-day-dup"
            disabled={ordered.length === 0 || !facts.hasNextDay}
            onClick={() => onCopyDay(day.index)}
            title={!facts.hasNextDay ? 'No next day to copy to' : ordered.length ? `Copy these stops to Day ${day.index + 2}` : 'Nothing to copy yet'}
          ><InlineIcon icon={Copy} size={13} gap={4} />{facts.hasNextDay ? `Copy to Day ${day.index + 2}` : 'Copy'}</button>
          {/* The cover control lives on the cover strip itself ("Change day
              cover"), so the header carries no Cover button: a day without a
              photo simply has none, exactly as the artboard shows. */}
          <button className="btn btn-outline btn-sm is-day-dup" onClick={() => onAdd(day.index)}>+ Add here</button>
        </div>
      )}
      {!isStayDay && (
        <div className="day-budget">
          <div
            className="day-budget-bar"
            style={{ gridTemplateColumns: budgetSegments.map(s => `${s.minutes}fr`).join(' ') }}
            role="img"
            aria-label={`Day ${day.index + 1} time budget, ${formatHM(dayStartHM, timeFormat)} to ${formatHM(A.dayEnd, timeFormat)}: driving ${minutesToHM(budgetDrive)}, halts ${minutesToHM(budgetHalts)}, at stops ${minutesToHM(budgetStops)}${budgetWait > 0 ? `, waiting ${minutesToHM(budgetWait)}` : ''}, free ${minutesToHM(budgetFree)}`}
          >
            {budgetSegments.map(s => <span key={s.cls} className={s.cls} />)}
          </div>
          <div className="day-budget-key">
            {budgetDrive > 0 && <span><i className="db-dot db-drive" aria-hidden="true" />Driving {minutesToHM(budgetDrive)}</span>}
            {budgetHalts > 0 && <span><i className="db-dot db-halt" aria-hidden="true" />Halts {minutesToHM(budgetHalts)}</span>}
            {budgetStops > 0 && <span><i className="db-dot db-dwell" aria-hidden="true" />At stops {minutesToHM(budgetStops)}</span>}
            {budgetWait > 0 && <span><i className="db-dot db-wait" aria-hidden="true" />Waiting {minutesToHM(budgetWait)}</span>}
            <span><i className="db-dot db-free" aria-hidden="true" />Free {minutesToHM(budgetFree)}</span>
          </div>
        </div>
      )}
      {(!reviewMode || inView) && <DayWeatherChip day={day} startDate={facts.startDate} />}

      <div className="day-layout">
      <div className="day-main">
      {bodyTrip && <TravelPanel trip={bodyTrip} day={day} editable={editable} journey={journey} suggestionCache={suggestionCache} legCorrections={legCorrections}
        journeyDay={journeyDay} journeyStatus={journeyStatus}
        onAddProjectedRow={onAddProjectedRow} projectedAddBusy={projectedAddBusy} previewOpen={previewOpen}
        projectedAddError={projectedAddError} onRetryProjectedRow={onRetryProjectedRow} projectedRetryAvailable={projectedRetryAvailable} projectedTerminal={projectedTerminal} projectedUnresolved={projectedUnresolved} projectedRetryBlockedReason={projectedRetryBlockedReason} projectedAvailability={projectedAvailability}
        onSetDayStart={onSetDayStart} onAddPlannedHalts={onAddPlannedHalts} />}

      {ordered.length === 0 && (<>
        <div className="tl-state">
        <StateBlock kind="empty" size="compact" icon={<CloudSun size={38} aria-hidden />} title="Nothing planned yet"
          body="Add your first stop for this day. Or drag one here from another day."
          actions={editable ? <button className="btn btn-primary btn-sm" onClick={() => onAdd(day.index)}>+ Add stop</button> : undefined} />
        {editable && ((nextAnchor && !alreadyAtNext) || nearby.length > 0 || nearbyFailed) && (
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
            {nearbyFailed && <p className="day-suggest-note" role="status">Nearby ideas could not load.</p>}
          </div>
        )}
        </div>
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
                  <LegSummary leg={leg} inrPerKm={A.inrPerKm ?? 8} mode={A.mode} />
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
                  <div className="tl-gutter">
                    <span className="tl-rail-num tl-node-dot tl-node-dot--base" aria-hidden="true"><MapPin size={12} aria-hidden /></span>
                  </div>
                  <div className="tl-node-body">
                    <span>Based in {cleanName}</span>
                  </div>
                </div>
              )
            }
            const nodeKind = isFinal ? 'end' : i === 0 ? 'start' : 'via'
            return (
              <div key={s.id} data-stop-id={s.id} className={`tl-row tl-anchor tl-node tl-node--${nodeKind}`} style={{ transform: glideOffset(i) != null ? `translateY(${glideOffset(i)}px)` : undefined }} {...(editable ? dndHandlers(i) : {})}>
                <div className="tl-gutter">
                  <span className="tl-time"><span className="sr-only">{isFinal ? 'Arrival: ' : 'Departure: '}</span>{isFinal ? (row?.arrive ? formatHM(row.arrive, timeFormat) : '--:--') : (row?.depart ? formatHM(row.depart, timeFormat) : '--:--')}</span>
                  <span className="tl-line tl-line-node" aria-hidden="true" />
                  <span className={`tl-rail-num tl-node-dot tl-node-dot--${nodeKind}`} aria-hidden="true">{isFinal ? <Moon size={12} aria-hidden /> : i === 0 ? <Flag size={12} aria-hidden /> : <MapPin size={12} aria-hidden />}</span>
                </div>
                <div className="tl-node-body">
                  <span>
                    {i === 0 ? `Start: ${cleanName}` : isFinal ? `Destination: ${cleanName}` : cleanName}
                  </span>
                  {isFinal && <span className="small muted tl-arrive-gap">arrives ~{row?.arrive ? formatHM(row.arrive, timeFormat) : '--:--'}</span>}
                </div>
              </div>
            )
          }
          const { kind, label } = stopPresentation(s, trip?.transportMode)
          const stopSaved = savedIds.includes(savedStopId(s.id))
          /* The artboard outlines a stop that a fixed clock governs, so the card
             the day cannot move reads apart from the ones it can. */
          const stopFixed = (fixedByStop.get(String(s.id))?.length ?? 0) > 0
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
                  <span className="tl-time tl-dep"><span className="sr-only">Departure: </span><span aria-hidden="true">to </span>{row?.depart ? formatHM(row.depart, timeFormat) : '--:--'}</span>
                  <span className="tl-rail-num" aria-hidden="true">{i + 1}</span>
                </div>
                <div
                  className={`stop-card kind-${kind} status-${s.status} ${stopFixed ? 'is-fixed' : ''} ${foreignOver === i && dragging === null ? 'foreign-over' : ''}`}
                >
              <div className="stop-main">
                {/* The artboard leads a stop with a 48px duotone tile: a tinted
                    square holding the kind's own icon in a darker ink of the
                    same hue. It gives the eye the stop's type before it reads
                    the title, which is what lets the title stay plain. */}
                <span className={`stop-tile tile-${kind}`} aria-hidden="true">
                  <StopKindIcon kind={kind} />
                </span>
                <div className="stop-body">
                <div className="stop-toprow">
                  <span className="stop-title">{s.title}</span>
                  {/* MR8: save the experience. The heart is a real button, not a
                      glyph on the row, so it is reachable by keyboard and the
                      press state is announced. */}
                  <button
                    className={`tl-save-heart tl-save-heart--stop${stopSaved ? ' on' : ''}`}
                    aria-pressed={stopSaved}
                    aria-label={`${stopSaved ? 'Remove' : 'Save'} ${s.title}`}
                    title={stopSaved ? 'Remove from saved' : 'Save this stop'}
                    onClick={() => onToggleSaved(savedStopId(s.id))}
                  >
                    <Heart size={13} aria-hidden fill={stopSaved ? 'currentColor' : 'none'} />
                  </button>
                  <Chip tone={statusTone(s.status)}>{statusLabel(s.status)}</Chip>
                  {(() => {
                    const rows = fixedByStop.get(String(s.id))
                    if (!rows?.length) return null
                    const worstTone = worstFixedTone(rows) ?? 'ok'
                    const worst = rows.find(r => r.tone === worstTone) ?? rows[0]
                    return (
                      <span
                        className={`stop-fixed-pill is-${worst.tone}`}
                        title={rows.map(r => `${r.fc.title} at ${formatHM(r.fc.time, timeFormat)}`).join('\n')}
                      >
                        <InlineIcon icon={Lock} size={11} gap={3} />
                        Fixed {formatHM(worst.fc.time, timeFormat)}
                        {worst.tone === 'clash' ? ' · clash' : ''}
                        {rows.length > 1 ? ` +${rows.length - 1}` : ''}
                      </span>
                    )
                  })()}
                  <span className={`stop-kind-tag kind-${kind}`}>{label}</span>
                  {s.priority === 'must-do' && <Chip tone="danger">Must do</Chip>}
                  {s.priority === 'optional' && <Chip tone="saffron">Optional</Chip>}
                  {s.weatherSensitive && <Chip tone="info"><InlineIcon icon={CloudRain} size={11} gap={3} vAlign="-1px" />weather-sensitive</Chip>}
                </div>
                {/* One " · " line, the way Ride along reads: place, time here, fee.
                    Money fields stay finite-guarded (#343): an absent fee prints
                    nothing, and a stored 0 is a real "free entry". */}
                <div className="stop-meta">
                  {[
                    s.locationName,
                    `${minutesToHM(s.visitMinutes)} here`,
                    Number.isFinite(s.entryFeeInrPerPerson) ? (s.entryFeeInrPerPerson > 0 ? `₹${s.entryFeeInrPerPerson}/person` : 'free entry') : '',
                    Number.isFinite(s.transportCostInrTotal) && s.transportCostInrTotal > 0 ? `₹${s.transportCostInrTotal} transport` : '',
                  ].filter(Boolean).join(' · ')}
                </div>
                {s.openTime && <div className="stop-meta">Open {formatHMRange(s.openTime, s.closeTime, timeFormat)}</div>}
                {s.departTime && s.arrivalTime && (
                  <div className="stop-meta">dep {formatHM(s.departTime, timeFormat)} · arr {formatHM(s.arrivalTime, timeFormat)}{s.legDistanceKm ? ` · ${s.legDistanceKm.toFixed(0)} km` : ''}</div>
                )}
                {s.description && <ClampedText className="stop-desc">{s.description}</ClampedText>}
                {s.notes && <ClampedText className="stop-desc muted"><InlineIcon icon={PenLine} size={12} gap={3} />{s.notes}</ClampedText>}
                {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="small" onClick={e => { e.preventDefault(); openExternal(s.sourceUrl!) }}>Source <InlineIcon icon={ExternalLink} size={11} gap={0} className="tl-source-gap" /></a>}
                </div>
              </div>
              {editable && (
                <div className="stop-actions">
                  {/* The artboard gives a stop ONE control: a ⋯ menu. Seven
                      always-visible buttons per card (save, up, down, edit,
                      maybe, move-day, delete) put 21 controls on a three-stop
                      day and were the loudest clutter left in the body. The two
                      reorder arrows stay inline because they are the keyboard
                      alternative to dragging; everything else folds away. */}
                  <div className="move-btns">
                    <button className="move-btn" disabled={i === 0} onClick={() => moveUp(i)} aria-label={`Move ${s.title} up`}><ChevronUp size={12} aria-hidden /></button>
                    <button className="move-btn" disabled={i === ordered.length - 1} onClick={() => moveDown(i)} aria-label={`Move ${s.title} down`}><ChevronDown size={12} aria-hidden /></button>
                  </div>
                  <details className="stop-more">
                    <summary className="icon-btn" aria-label={`More actions for ${s.title}`} title="More actions">
                      <MoreHorizontal size={16} aria-hidden />
                    </summary>
                    <div className="stop-more-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => onEdit(s.id)}>
                        <Pencil size={14} aria-hidden />Edit
                      </button>
                      {s.status !== 'confirmed'
                        ? <button type="button" role="menuitem" onClick={() => onStatus(s, 'confirmed')}>
                            <CircleCheck size={14} aria-hidden />Mark confirmed
                          </button>
                        : <button type="button" role="menuitem" onClick={() => onStatus(s, 'maybe')}>
                            <CircleHelp size={14} aria-hidden />Mark maybe
                          </button>}
                      <button type="button" role="menuitem" onClick={() => onMoveBetweenDays(s)}>
                        <MoveHorizontal size={14} aria-hidden />Move to another day
                      </button>
                      <button type="button" role="menuitem" className="danger" onClick={() => onDelete(s.id, day.index)}>
                        <Trash2 size={14} aria-hidden />Delete
                      </button>
                    </div>
                  </details>
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
                        {leg && leg.distanceKm >= 0.5 && <LegSummary leg={leg} inrPerKm={A.inrPerKm ?? 8} mode={A.mode} />}
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
                    <LegSummary leg={last.legIn} inrPerKm={A.inrPerKm ?? 8} mode={A.mode} />
                  </div>
                </div>
              )}
              <div className="tl-row tl-anchor tl-node tl-node--end">
                <div className="tl-gutter">
                  <span className="tl-time tl-arr"><span className="sr-only">Arrival: </span>{last.arrive ? formatHM(last.arrive, timeFormat) : '--:--'}</span>
                  <span className="tl-line tl-line-node" aria-hidden="true" />
                  <span className="tl-rail-num tl-node-dot tl-node-dot--end" aria-hidden="true"><Moon size={12} aria-hidden /></span>
                </div>
                <div className="travel-endpoint">
                  <span className="travel-anchor-ico"><Flag size={13} aria-hidden /></span>
                  <span>{journey.direction === 'return' ? `Home: ${last.title}` : `Destination: ${last.title}`}</span>
                  <span className="small muted tl-arrive-gap">arrives ~{last.arrive ? formatHM(last.arrive, timeFormat) : '--:--'}</span>
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
      </div>
      <aside className="day-brief" aria-label={`Day ${day.index + 1} brief`}>
        <div className="brief-card">
          <div className="brief-kicker">Day brief</div>
          <div className="brief-grid">
            <div><b>{minutesToHM(budgetDrive)}</b><span>driving</span></div>
            <div><b>{minutesToHM(budgetDwell)}</b><span>at stops</span></div>
            <div><b>{formatHM(sim.endsAt, timeFormat)}</b><span>back at {journey.endTitle}</span></div>
            <div>
              <b>{dayTotal ? formatInr(dayTotal.totalInr) : 'Not available'}</b>
              <span>est. for the group</span>
            </div>
          </div>
          {dayTotal && (dayTotal.transportInr > 0 || dayTotal.expensesInr > 0) && (
            <dl className="brief-lines">
              <div><dt>Travel</dt><dd>{formatInr(dayTotal.transportInr)}</dd></div>
              <div><dt>Day costs</dt><dd>{formatInr(dayTotal.expensesInr)}</dd></div>
              {dayRemainder > 0 && <div><dt>Entry fees &amp; stay</dt><dd>{formatInr(dayRemainder)}</dd></div>}
            </dl>
          )}
        </div>
        {fixedRows.length > 0 && (
          <div className="brief-card fixed-times-card">
            <div className="brief-kicker fixed-times-head">
              <span>Fixed times</span>
              <span className={`fixed-times-count${fixedClashes > 0 ? ' risk' : fixedInvalid > 0 || fixedTight ? ' tight' : ''}`}>
                {fixedClashes > 0
                  ? `${fixedClashes} clash${fixedClashes === 1 ? '' : 'es'}`
                  : fixedInvalid > 0
                    ? `${fixedInvalid} invalid`
                    : fixedTight
                      ? 'Tight'
                  : `${fixedRows.length} set`}
              </span>
            </div>
            <div className="fixed-times-list">
              {fixedRows.map(row => {
                const { fc, arrival, spareMin, tone } = row
                const clock = formatHM(fc.time, timeFormat)
                const status = tone === 'unlinked'
                  ? 'No stop linked. Pick the stop this deadline belongs to.'
                  : tone === 'invalid'
                    ? 'This fixed time is not a valid clock. Edit the commitment time.'
                  : tone === 'anchor'
                    ? 'Check-in is an anchor. Arriving later is allowed.'
                    : tone === 'clash'
                      ? `Clashes: you arrive ~${arrival ? formatHM(arrival, timeFormat) : 'after the fixed time'}.`
                      : `On time, ${minutesToHM(Math.max(0, spareMin ?? 0))} spare${arrival ? ` · arrive ~${formatHM(arrival, timeFormat)}` : ''}.`
                return (
                  <div key={fc.id} className={`fixed-time-row is-${tone}`}>
                    <span className="fixed-time-mark" aria-hidden="true">
                      {tone === 'clash' || tone === 'tight' || tone === 'invalid'
                        ? <TriangleAlert size={15} />
                        : tone === 'unlinked'
                          ? <Pin size={15} />
                          : <CircleCheck size={15} />}
                    </span>
                    <div className="fixed-time-copy">
                      <b>{fc.title} · {clock}</b>
                      <span>{status}</span>
                      {fc.notes && <span className="fixed-time-note">{fc.notes}</span>}
                      {editable && fc.type !== 'hotel-checkin' && (
                        <div className="fixed-time-link">
                          <Select
                            value={fc.stopId ?? ''}
                            aria-label={`Stop the ${fc.title} deadline is checked against`}
                            onChange={val => onLinkCommitment(String(fc.id), day.index, val || null)}
                            options={linkStopOptions(ordered)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="brief-card">
            <div className="brief-kicker">Needs attention <span className="brief-count">{warnings.length}</span></div>
            {warnings.slice(0, 3).map((w, i) => (
              <div key={`${w.code}-${i}`} className={`brief-warn sev-${w.severity}`}>
                <b>{w.title.replace(/^Day \d+:\s*/, '')}</b>
                {w.fix && <p>{w.fix}</p>}
              </div>
            ))}
          </div>
        )}
        <div className="brief-card">
          <div className="brief-kicker">Day tools</div>
          <div className="brief-tools">
            <button
              type="button"
              className="brief-tool"
              disabled={ordered.length === 0 || !facts.hasNextDay}
              onClick={() => onCopyDay(day.index)}
              title={!facts.hasNextDay ? 'No next day to copy to' : ordered.length ? `Copy these stops to Day ${day.index + 2}` : 'Nothing to copy yet'}
            >{facts.hasNextDay ? `Copy these stops to Day ${day.index + 2}` : 'Copy these stops'}</button>
            <button type="button" className="brief-tool" onClick={() => onAdd(day.index)}>
              Add a stop to Day {day.index + 1}
            </button>
          </div>
        </div>
      </aside>
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
          <p className="hint-text tl-hint-gap">
            Reorders the day's stops into the shortest route from where you start the day. Grouping nearby sights,
            food and activities so you spend less time in transit. Anchors (your base, the day's destination and
            wherever the next day starts from) stay put; you can still drag anything afterwards.
          </p>
          {/* #341: with no measured leg the numbers below are straight-line
              math scaled by 1 — they must say so rather than read as road km. */}
          {roadLegs === 0 && (
            <p className="hint-text tl-hint-gap">
              These are straight-line estimates. The road for this trip has not been measured yet. Drive times
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
          <div className="tl-day-footer">
            <button className="btn btn-primary btn-sm" onClick={() => {
              // #341: re-derive from the day as it is NOW. A drag or an edit
              // that landed while this dialog was open used to be discarded
              // silently — last write wins over a snapshot nobody re-checked.
              const fresh = optimizeDayOrder(optOrigin, ordered, { hasNextDay, fixedStopIds })
              const idsOf = (r: OptimizeDayResult) => r.stops.filter(s => s.status !== 'rejected').map(s => s.id).join('|')
              if (!fresh.changed) {
                setOptPreview(null)
                toast(`Day ${day.index + 1} already matches its shortest order. Nothing to apply.`)
                return
              }
              if (idsOf(fresh) !== idsOf(optPreview)) {
                setOptPreview(fresh)
                toast('The day changed while you were reviewing. Here is the new order.', 'err')
                return
              }
              onReorderDay(day.index, optPreview.stops.map(s => s.id))
              toast(`Day ${day.index + 1} optimised. Saved ${kmLabel(optPreview.beforeKm - optPreview.afterKm)} of crisscrossing`)
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
    visitMinutes: confirmedVisitMinutes(h) ?? (h.category === 'food' ? 45 : h.category === 'hotel' ? 0 : 60), openTime: '', closeTime: '',
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', sourceUrl: '', status: 'suggested',
  }
}

function statusTone(s: string): 'teal' | 'saffron' | 'danger' | 'ok' | 'info' {
  /* "Confirmed" is the artboard's confirmed pill: --pw-ok ink on --pw-ok-100.
     The teal tone is the day's own "selected" colour and read as a state the
     user had just picked rather than a booking already made. */
  return s === 'confirmed' ? 'ok' : s === 'needs-booking' ? 'saffron' : s === 'rejected' ? 'danger' : 'info'
}
