// ============ Trip workspace ============
// Shell: hero header, tab list, pending-change plumbing, applyChange, and
// routing to the tab components in pages/trip/* (M3.4 split). Tabs:
// Overview / Timeline / Map / Group input / Budget / Share. The former
// Suggestions and Decisions tabs merged into `group` (old slugs redirect).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Trip } from '../data/types'
import { useDb, tripById, currentUser, roleOf, canEdit, updateTrip, userById, fetchSharedTrip } from '../store/store'
import { PillNav } from '../components/PillNav'
import { computeHealth, computeTotals, getAssumptions, isRoadMeasuredMode } from '../lib/engine'
import type { LegEstimate } from '../lib/engine'
import { buildRoadChain, measureRoadChain, correctionsFromLegs, type RoadStatus, type TripRoadView } from '../lib/tripRoad'
import { computeImpact, type ImpactResult } from '../lib/impact'
import { scrollBehavior } from '../lib/motion'
import { Avatar, toast } from '../components/ui'
import { useTripPresence } from '../hooks/useTripPresence'
import { presenceView } from '../lib/presence'
import { ImpactPreviewPanel } from '../components/ImpactPreview'
import { useSuggestionCache } from '../hooks/useSuggestionCache'
import { useTablist } from '../hooks/useTablist'
// Board also embeds TripMap (so it pulls the same lazy map chunk) — load the whole
// view lazily so the Board tab never adds app-start cost either. TripMap itself
// is lazily imported inside MapTab.
const BoardView = React.lazy(() => import('../components/BoardView').then(m => ({ default: m.BoardView })))
import { AiDrawer } from '../components/AiDrawer'
import { AI_COMPANION_ENABLED } from '../lib/featureFlags'
import { useDestinationCover } from '../hooks/useDestinationCover'
import { pickTripQueryCandidates } from '../lib/tripThumb'
import { OverviewTab } from './trip/OverviewTab'
import { TimelineTab } from './trip/TimelineTab'
import { MapTabSkeleton } from './trip/MapTabSkeleton'
// #332 R4: the Map TAB is lazy, not just the renderer inside it. MapTab statically
// imports the whole suggestion stack (geocode, engine, daySlots, tripDna,
// storyArcs, slackPrompts…), so a static import here put all of it in the
// workspace chunk whether or not the tab was ever opened. The skeleton stays a
// static, dependency-free module so the Suspense fallback cannot suspend itself.
const MapTab = React.lazy(() => import('./trip/MapTab').then(m => ({ default: m.MapTab })))
import { GroupInputTab } from './trip/GroupInputTab'
import { BudgetTab } from './trip/BudgetTab'
import { ShareTab } from './trip/ShareTab'
import { TripSettingsForm } from './trip/TripSettingsForm'
import { cap } from './trip/shared'
import { roadChainSig } from '../lib/tripRoad'
import { keepIsStale, stagedChange } from '../lib/previewChain'

/** A staged change: the proposed shape, its impact against the committed trip,
 *  and an optional follow-up its caller runs when the change is kept. */
type PendingChange = { proposed: Trip; result: ImpactResult; onKept?: () => void }

type TabKey = 'overview' | 'timeline' | 'board' | 'map' | 'group' | 'budget' | 'share' | 'settings'

const TABS: [TabKey, string][] = [
  ['overview', 'Overview'],
  ['board', 'Board'],
  ['map', 'Map'],
  ['timeline', 'Timeline'],
  ['group', 'Group input'],
  ['budget', 'Budget'],
  ['share', 'Share'],
  ['settings', 'Settings'],
]
const TAB_IDS = TABS.map(([k]) => k)

/** Legacy tab slugs that now redirect to the merged Group input tab. */
const LEGACY_TAB_SLUGS = ['suggestions', 'decisions']

/** Runtime type guard over the TABS table — no `as TabKey` cast anywhere. */
function isTabKey(s: string | undefined): s is TabKey {
  return typeof s === 'string' && TABS.some(([k]) => k === s)
}

/** URL tab segment → TabKey (F-21): junk falls back to Overview; the old
    `suggestions`/`decisions` slugs redirect to the merged `group` tab. */
function sanitizeTab(s: string | undefined): TabKey {
  if (s && LEGACY_TAB_SLUGS.includes(s)) return 'group'
  return isTabKey(s) ? s : 'overview'
}

export function TripWorkspace({ tripId, initialTab, onNavigate }: { tripId: string; initialTab?: string; onNavigate: (route: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const trip = tripById(tripId)
  // A cache miss is not final: hydration is membership-scoped and can come
  // back partial (a failed trips read keeps last-known data but a first-load
  // blip leaves the cache cold), and a direct link can land before hydration
  // finishes. fetchSharedTrip reads the row directly (owner / member / public)
  // and merges it into the cache — the commit re-renders this component. Only
  // a null fetch (unreadable / trashed / bad id) is "Trip not found".
  const [missedFetchFor, setMissedFetchFor] = useState<string | null>(null)
  const fetchMissed = missedFetchFor === tripId
  useEffect(() => {
    if (trip || fetchMissed) return
    let cancelled = false
    void fetchSharedTrip(tripId).then(t => {
      if (!cancelled && !t) setMissedFetchFor(tripId)
    })
    return () => { cancelled = true }
  }, [trip, fetchMissed, tripId])
  const [tab, setTabState] = useState<TabKey>(() => sanitizeTab(initialTab))
  // Normalize a legacy slug in the URL once on mount so existing
  // #/trip/<id>/suggestions|decisions links keep working but self-heal to `group`.
  useEffect(() => {
    const seg = location.hash.replace(/^#/, '').split('/').filter(Boolean)
    if (seg[0] === 'trip' && LEGACY_TAB_SLUGS.includes(seg[2] ?? '')) {
      seg[2] = 'group'
      history.replaceState(null, '', `#/${seg.join('/')}`)
    }
  }, [])
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
  // #87: the tab bar had role="tab" + aria-selected but every tab stayed in
  // the tab order and arrows did nothing — now the shared roving-tabindex
  // primitive (Tab lands on the active tab only; arrows/Home/End move it).
  const { refs: tabRefs, tabProps } = useTablist(TAB_IDS, tab, setTab)
  const [aiOpen, setAiOpen] = useState(false)

  const role = me && trip ? roleOf(trip, me.id) : null
  const editable = canEdit(role)

  // M6 B1 — who else is viewing this trip right now. Joins the presence
  // room only when a signed-in user has the trip open; anon/public views
  // stay out. Session-local state, never trip data.
  const presence = useTripPresence(trip?.id ?? null, me, me?.profile.name ?? '')
  // An empty room still says so — see presenceView().
  const presenceRow = presenceView(presence.peers, presence.connected)

  // ONE road measurement for the whole workspace (#188): the engine's leg
  // corrections and the Map tab's road view come from the same chain.
  const { corrections: legCorrections, road } = useTripRoad(trip)
  // #342: the preview must measure with the SAME road data the timeline
  // renders, but `applyChange`'s identity is a memo prop for DaySection — so
  // the corrections are read through a ref instead of entering its deps.
  const legCorrRef = useRef(legCorrections)
  legCorrRef.current = legCorrections

  // Auto (Wikipedia) destination photo for the workspace header cover badge.
  // Walk all candidates (last stop → earlier stops → start city) so a single
  // "no photo" Wikipedia page doesn't leave the cover blank.
  const tripCoverAuto = useDestinationCover(trip ? pickTripQueryCandidates(trip) : null)

  // Suggestion cache: persists across tab switches, invalidated by anchor changes.
  const suggestionCache = useSuggestionCache(tripId)

  // Pending change: a proposed plan held until the user keeps or discards it.
  const [pending, setPending] = useState<PendingChange | null>(null)
  /** The staged change mirrored in a ref: (a) a mutation scheduled in the same
   *  tick as another, or from a stale closure, still CHAINS onto it (#334), and
   *  (b) `baseRef` remembers the committed row the preview was built on, so
   *  Keep can tell when a direct write landed underneath it. */
  const pendingRef = useRef<PendingChange | null>(null)
  const baseRef = useRef<Trip | null>(null)
  const stage = useCallback((next: PendingChange | null) => {
    pendingRef.current = next
    if (!next) baseRef.current = null
    setPending(next)
  }, [])

  // Phase 3 (the living plan): a halt label on the map asks the timeline to open
  // that day. One-shot signal — TimelineTab consumes it on mount, then the
  // accordion is the user's again. The consumer clears it through the callback
  // below: an unconsumed value would re-fire on every later mount of the tab
  // (tab navigation) and leak into the NEXT trip's timeline, since this
  // workspace component is not keyed by trip id.
  const [timelineFocusDay, setTimelineFocusDay] = useState<number | null>(null)
  const clearTimelineFocusDay = useCallback(() => setTimelineFocusDay(null), [])

  // Stable identity for applyChange (useCallback over the trip reference): it
  // flows into TimelineTab → DaySection props, and an unstable identity would
  // defeat the DaySection React.memo on every workspace render.
  const applyChange = useCallback((mutator: (draft: Trip) => void, kind: ImpactResult['kind'], dayIndex: number, onKept?: () => void) => {
    if (!trip) return
    // #334: chain onto the open preview instead of forking from the committed
    // row — the fork silently discarded the first staged change. The impact is
    // still measured against the committed trip, so the sheet shows the
    // COMBINED delta, which is what Keep will actually write.
    const staged = pendingRef.current
    const proposed = stagedChange(trip, staged?.proposed ?? null, mutator)
    const result = computeImpact(trip, proposed, kind, dayIndex, legCorrRef.current)
    // The baseline is recorded only when a NEW preview starts: a chain keeps
    // the original, so a direct write that landed mid-preview still reads stale.
    if (!staged) baseRef.current = trip
    // A previous step's follow-up (the day plan's Fill Undo) survives a chain.
    stage({ proposed, result, onKept: onKept ?? staged?.onKept })
  }, [trip, stage])

  // #334 pitfall: this workspace outlives trips (it is not keyed by trip id),
  // so a pending preview must not survive a trip switch — Keep would write one
  // trip's shape into another. Cleared on switch, and said out loud.
  useEffect(() => {
    if (!pendingRef.current) return
    stage(null)
    toast('Staged change discarded — you switched trips', 'err')
  }, [trip?.id, stage])

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

  function scrollToDay(dayIndex: number) {
    const el = document.getElementById(`day-card-${dayIndex}`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight
    if (!isVisible) {
      el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
    }
  }

  if ((!trip && fetchMissed) || !me) {
    return <div className="container loading-block">Trip not found. <button className="btn btn-outline btn-sm" onClick={() => onNavigate('trips')}>Back to my trips</button></div>
  }
  if (!trip) {
    return <div className="container loading-block"><div className="spinner" />Loading trip…</div>
  }

  const effective = pending?.proposed ?? trip
  const health = computeHealth(effective)
  const totals = computeTotals(effective, legCorrections)

  function keepPending() {
    if (!pending || !trip) return
    // #334: the preview is not modal, so a direct write (a resolved decision,
    // an accepted suggestion, a realtime edit) can land while it is open.
    // Saving the proposal would overwrite that edit with no trace, so refuse
    // and let the person look — remove the preview, then redo the change.
    if (keepIsStale(baseRef.current, trip)) {
      toast('The plan changed while you were reviewing — remove this preview and redo the change.', 'err')
      return
    }
    const onKept = pending.onKept
    updateTrip(trip.id, pending.proposed)
    stage(null)
    // A caller carrying its own follow-up (the day plan's Fill, with its Undo)
    // speaks for the change; the generic confirmation would double-toast it.
    if (onKept) onKept()
    else toast('Change saved to your plan')
  }

  function removePending() {
    stage(null)
    toast('Change discarded')
  }

  /** Move the previewed day's last stop to the day after it. #334: staged
   *  THROUGH applyChange so the sheet's numbers describe what Save will write
   *  (it used to commit on the spot while the pre-move preview was on screen). */
  function moveToAnotherDay() {
    if (!pending || !trip) return
    const dayIndex = pending.result.dayIndex
    const day = pending.proposed.days.find(d => d.index === dayIndex)
    const sorted = day ? [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay) : []
    const last = sorted[sorted.length - 1]
    if (!last || !pending.proposed.days.some(d => d.index === dayIndex + 1)) {
      toast('No later day available to move this stop to.', 'err')
      return
    }
    applyChange(draft => {
      const from = draft.days.find(d => d.index === dayIndex)
      const to = draft.days.find(d => d.index === dayIndex + 1)
      if (!from || !to) return
      const ordered = [...from.stops].sort((a, b) => a.orderInDay - b.orderInDay)
      const moving = ordered[ordered.length - 1]
      if (!moving) return
      from.stops = from.stops.filter(s => s.id !== moving.id)
      moving.orderInDay = to.stops.length + 1
      to.stops.push(moving)
    }, 'move-day', dayIndex)
    toast(`Moved “${last.title}” to Day ${dayIndex + 2} — review and keep`)
  }

  return (
    <div className={`container${tab === 'board' ? ' container--board' : ''}${tab === 'map' ? ' container--map' : ''}`} style={{ paddingTop: 22 }}>
      {/* ---------- Header ---------- */}
      <div className="trip-head-card">
        <div className="row-between">
          <div style={{ position: 'relative', zIndex: 1 }}>
            <button className="trip-hero-back" onClick={() => onNavigate('trips')}>← All trips</button>
            <h1 style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              {(() => {
                const cover = trip.coverImageUrl || tripCoverAuto
                return cover
                  ? <span className="trip-cover-badge" style={{ backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-hidden="true" />
                  : <span className="trip-cover-badge trip-cover-badge--emoji" aria-hidden="true">{trip.coverEmoji}</span>
              })()}
              {trip.name}
            </h1>
            <p style={{ opacity: .9, marginTop: 6 }}>
              {trip.startLocation} → {trip.destinations.join(' → ')} · {fmtDateRange(trip.startDate, trip.endDate)} · {trip.travellers} travellers · {cap(trip.transportMode)} · {cap(trip.travelStyle)}
            </p>
            <div className="member-stack" style={{ marginTop: 10 }}>
              {(trip.members ?? []).map(m => <Avatar key={m.userId} user={userById(m.userId)} />)}
              <span className="small" style={{ marginLeft: 8, opacity: .85 }}>
                {(trip.members ?? []).length} member{(trip.members ?? []).length !== 1 ? 's' : ''}{role ? ` · you are ${role}` : ''}
              </span>
              {presenceRow.kind === 'peers' ? (
                <span className="presence-stack" aria-label={`${presenceRow.peers.length} viewing now`}>
                  {presenceRow.peers.map(p => (
                    <span key={p.sessionKey} className="presence-peer" tabIndex={0}
                      aria-label={`${p.name} is viewing this trip now`}>
                      <Avatar user={{ profile: { name: p.name } }} />
                      <span className="presence-dot" aria-hidden="true" />
                      <span className="presence-tip" role="tooltip">{p.name} · viewing now</span>
                    </span>
                  ))}
                </span>
              ) : presenceRow.kind === 'solo' ? (
                <span className="presence-stack" aria-label="Only you are viewing this trip right now">
                  <span className="small presence-solo">Just you viewing</span>
                </span>
              ) : null}
            </div>
          </div>
          {editable && (
            <button className="btn btn-saffron btn-sm" style={{ position: 'relative', zIndex: 1 }} onClick={() => setTab('share')}>Invite & share</button>
          )}
        </div>
      </div>

      {/* ---------- Tabs ---------- */}
      <PillNav className="tabbar" role="tablist" aria-label="Trip sections" activeKey={tab}>
        {TABS.map(([key, label], i) => {
          const count = key === 'group'
            ? db.suggestions.filter(s => s.tripId === trip.id && s.status === 'open').length
              + db.decisions.filter(d => d.tripId === trip.id && d.status === 'open').length
            : undefined
          return (
            <button key={key} ref={tabRefs(i)} role="tab" id={`tab-${key}`} data-pill-key={key} aria-selected={tab === key}
              aria-controls={`panel-${key}`} {...tabProps(key, i)}
              className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {label}{count ? <span className="tab-count">{count}</span> : null}
            </button>
          )
        })}
      </PillNav>

      <div className="tab-panel" key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {/* The Overview matrix reads the SAME corridor halts and the SAME road
          measurement the Map tab does — taken from the suggestion cache, so it
          costs no fetch and the two surfaces cannot disagree about a day. */}
      {tab === 'overview' && <OverviewTab trip={effective} editable={editable} onOpenDecisions={() => setTab('group')} onOpenTimeline={() => setTab('timeline')} onOpenMap={() => setTab('map')} onInvite={() => setTab('share')} health={health} totals={totals} road={road} corridorSegments={suggestionCache.cache.map?.segments} />}
      {/* key: the timeline holds per-trip view state (open-day accordion) —
          remount it when the workspace switches trips (e.g. browser back/forward). */}
      {tab === 'timeline' && <TimelineTab key={effective.id} trip={effective} editable={editable} applyChange={applyChange} previewOpen={!!pending} legCorrections={legCorrections} suggestionCache={suggestionCache} onOpenBoard={() => setTab('board')} focusDay={timelineFocusDay} onFocusConsumed={clearTimelineFocusDay} />}
      {tab === 'board' && (
        <React.Suspense fallback={<div className="container loading-block"><div className="spinner" />Loading board…</div>}>
          <BoardView trip={effective} editable={editable} applyChange={applyChange} health={health} totals={totals} legCorrections={legCorrections}
            onOpenOverview={() => setTab('overview')} onOpenTimeline={() => setTab('timeline')} />
        </React.Suspense>
      )}
      {tab === 'map' && (
        <React.Suspense fallback={<MapTabSkeleton />}>
          <MapTab trip={effective} editable={editable} applyChange={applyChange} suggestionCache={suggestionCache} crewSuggestions={db.suggestions.filter(s => s.tripId === trip.id)} decisions={db.decisions.filter(d => d.tripId === trip.id)} road={road} onOpenTimeline={() => setTab('timeline')} onOpenBoard={() => setTab('board')} onOpenDay={(dayIndex) => { setTimelineFocusDay(dayIndex); setTab('timeline') }} onOpenGroupInput={() => setTab('group')} previewOpen={!!pending} />
        </React.Suspense>
      )}
      {tab === 'group' && <GroupInputTab trip={effective} editable={editable} me={me} previewOpen={!!pending} />}
      {tab === 'budget' && <BudgetTab trip={effective} totals={totals} editable={editable} previewOpen={!!pending} />}
      {tab === 'share' && <ShareTab trip={trip} me={me} editable={editable} onNavigate={onNavigate} legCorrections={legCorrections} />}
      {/* key=trip.id: TripSettingsForm holds local draft state in useState
           seeded from the trip at mount and never re-syncs, so without the key
           a quick trip-switch keeps the previous trip's draft visible until a
           reload (#213). */}
      {tab === 'settings' && <TripSettingsForm key={trip.id} trip={trip} editable={editable} />}
      </div>

      {/* The impact sheet is position:fixed, so it paints in the same place either
          way — but it renders AFTER the tab panel so that Tab from the row just
          edited reaches Keep / Remove without first walking the whole workspace. */}
      {pending && (
        <ImpactPreviewPanel
          result={pending.result}
          onKeep={keepPending}
          onMoveDay={moveToAnotherDay}
          onRemove={removePending}
          onScrollToDay={scrollToDay}
        />
      )}

      {/* AI companion: locked for the premium milestone (M8) — the feature is
          complete but unmounted unless VITE_AI_COMPANION=on. See featureFlags. */}
      {AI_COMPANION_ENABLED && (
        <AiDrawer trip={trip} open={aiOpen} onOpen={() => setAiOpen(true)} onClose={() => setAiOpen(false)} />
      )}
    </div>
  )
}

// ================= Real-road distance refinement (ONE measurement, #188) =================

/**
 * The trip's single road measurement. Owns the one `routePath` chain (with its
 * one retry) and hands out both consumers: the engine's leg corrections (budget,
 * fatigue, warnings — every tab) and the Map tab's road view (line, totals,
 * per-day km, suggestion corridor).
 *
 * Before #188 the workspace and the Map tab each measured the same chain, which
 * doubled the load on the shared OSRM demo server and let the map draw a road
 * the detour math could not see. The chain measured here is a superset of the
 * Map tab's points, so its legs are a strict prefix — see tripRoad.ts.
 */
function useTripRoad(trip: Trip | null | undefined): {
  corrections: Record<string, LegEstimate> | undefined
  road: TripRoadView
} {
  // #213 Phase 3: chain memo depends on roadChainSig(trip), NOT on trip itself.
  // `mutateTrip` clones the trip on every save, so the old `[trip]` dep re-built
  // the chain (and re-measured the OSRM chain, via the effect below) on every
  // fuel/crew/budget/dates tweak. roadChainSig hashes ONLY the geometry fields,
  // so a non-geometry save keeps the chain (and the existing legs) stable —
  // totals don't blink to haversine, the corridor search isn't re-planned, and
  // the split/clock verdicts keep their numbers.
  const chainSig = trip ? roadChainSig(trip) : ''
  const chain = useMemo(() => (trip ? buildRoadChain(trip) : null), [chainSig])
  const [state, setState] = useState<{ status: RoadStatus; legs: TripRoadView['legs'] }>({ status: 'pending', legs: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // Nothing to measure is not a failure: no trip, or a single point.
    if (!trip || !chain || chain.points.length < 2) {
      setState({ status: 'ok', legs: [] })
      return
    }
    let cancelled = false
    // #325: two layers, two jobs. The flag guards `setState`; the controller stops
    // the network work. Without the abort the whole OSRM chain (and its parallel
    // per-leg fallbacks) ran to completion behind the flag — burning quota on a
    // trip the user had already left. And because a trip switch unmounts nothing
    // here, a late result could still land on the next trip's view.
    const controller = new AbortController()
    setState({ status: 'pending', legs: null })
    measureRoadChain(chain.points, getAssumptions(trip), { signal: controller.signal }).then(outcome => {
      if (cancelled) return
      setState(outcome.ok ? { status: 'ok', legs: outcome.legs } : { status: 'failed', legs: null })
    })
    return () => { cancelled = true; controller.abort() }
    // chain reflects chainSig; trip is read for assumptions only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainSig, chain, attempt])

  const retry = useCallback(() => setAttempt(a => a + 1), [])

  // The engine only takes road numbers for ground modes (OSRM is driving-only);
  // anything else — and a failed or still-pending measurement — leaves the
  // deterministic haversine engine in charge, exactly as before.
  const roadMode = !!trip?.transportMode && isRoadMeasuredMode(trip.transportMode)
  const corrections = useMemo(() => {
    if (!trip) return undefined
    if (!chain || !roadMode || chain.points.length < 2) return {}
    if (state.status === 'pending' || !state.legs) return undefined
    return correctionsFromLegs(chain, state.legs)
  }, [chain, roadMode, state])

  const road = useMemo<TripRoadView>(
    () => ({ chain, legs: state.legs, status: state.status, retry }),
    [chain, state, retry],
  )

  return { corrections, road }
}

function fmtDateRange(a: string, b: string): string {
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${new Date(a).toLocaleDateString('en-IN', opt)} – ${new Date(b).toLocaleDateString('en-IN', { ...opt, year: 'numeric' })}`
}
