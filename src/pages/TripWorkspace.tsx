// ============ Trip workspace ============
// Shell: hero header, tab list, pending-change plumbing, applyChange, and
// routing to the tab components in pages/trip/* (M3.4 split). Tabs:
// Overview / Timeline / Map / Group input / Budget / Share. The former
// Suggestions and Decisions tabs merged into `group` (old slugs redirect).
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Trip } from '../data/types'
import { useDb, tripById, currentUser, roleOf, canEdit, updateTrip, userById } from '../store/store'
import { PillNav } from '../components/PillNav'
import { computeHealth, computeTotals, getAssumptions, legKey, isRoundTrip } from '../lib/engine'
import type { LegEstimate } from '../lib/engine'
import { routePath } from '../lib/routing'
import { computeImpact, type ImpactResult } from '../lib/impact'
import { scrollBehavior } from '../lib/motion'
import { Avatar, toast } from '../components/ui'
import { ImpactPreviewPanel } from '../components/ImpactPreview'
import { useSuggestionCache } from '../hooks/useSuggestionCache'
// Board also embeds TripMap (so it pulls the same lazy map chunk) — load the whole
// view lazily so the Board tab never adds app-start cost either. TripMap itself
// is lazily imported inside MapTab.
const BoardView = React.lazy(() => import('../components/BoardView').then(m => ({ default: m.BoardView })))
import { AiDrawer } from '../components/AiDrawer'
import { useDestinationCover } from '../hooks/useDestinationCover'
import { pickTripQueryCandidates } from '../lib/tripThumb'
import { OverviewTab } from './trip/OverviewTab'
import { TimelineTab } from './trip/TimelineTab'
import { MapTab } from './trip/MapTab'
import { GroupInputTab } from './trip/GroupInputTab'
import { BudgetTab } from './trip/BudgetTab'
import { ShareTab } from './trip/ShareTab'
import { cap } from './trip/shared'

type TabKey = 'overview' | 'timeline' | 'board' | 'map' | 'group' | 'budget' | 'share'

const TABS: [TabKey, string][] = [
  ['overview', 'Overview'],
  ['timeline', 'Timeline'],
  ['board', 'Board'],
  ['map', 'Map'],
  ['group', 'Group input'],
  ['budget', 'Budget'],
  ['share', 'Share'],
]

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
  const [aiOpen, setAiOpen] = useState(false)

  const role = me && trip ? roleOf(trip, me.id) : null
  const editable = canEdit(role)

  // Real road distances/durations for the estimate totals, refreshed when the
  // route changes. Only applied for ground modes (OSRM is driving-only); the
  // deterministic haversine engine stays the fallback and powers warnings/impact.
  const legCorrections = useTripCorrections(trip)

  // Auto (Wikipedia) destination photo for the workspace header cover badge.
  // Walk all candidates (last stop → earlier stops → start city) so a single
  // "no photo" Wikipedia page doesn't leave the cover blank.
  const tripCoverAuto = useDestinationCover(trip ? pickTripQueryCandidates(trip) : null)

  // Suggestion cache: persists across tab switches, invalidated by anchor changes.
  const suggestionCache = useSuggestionCache(tripId)

  // Pending change: a proposed plan held until the user keeps or discards it.
  const [pending, setPending] = useState<{ proposed: Trip; result: ImpactResult } | null>(null)

  // Stable identity for applyChange (useCallback over the trip reference): it
  // flows into TimelineTab → DaySection props, and an unstable identity would
  // defeat the DaySection React.memo on every workspace render.
  const applyChange = useCallback((mutator: (draft: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => {
    if (!trip) return
    const proposed = structuredClone(trip) as Trip
    mutator(proposed)
    const result = computeImpact(trip, proposed, kind, dayIndex)
    setPending({ proposed, result })
  }, [trip])

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

  if (!trip || !me) {
    return <div className="container loading-block">Trip not found. <button className="btn btn-outline btn-sm" onClick={() => onNavigate('trips')}>Back to my trips</button></div>
  }

  const effective = pending?.proposed ?? trip
  const health = computeHealth(effective)
  const totals = computeTotals(effective, legCorrections)

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
            </div>
          </div>
          {editable && (
            <button className="btn btn-saffron btn-sm" style={{ position: 'relative', zIndex: 1 }} onClick={() => setTab('share')}>Invite & share</button>
          )}
        </div>
      </div>

      {/* ---------- Tabs ---------- */}
      <PillNav className="tabbar" role="tablist" aria-label="Trip sections" activeKey={tab}>
        {TABS.map(([key, label]) => {
          const count = key === 'group'
            ? db.suggestions.filter(s => s.tripId === trip.id && s.status === 'open').length
              + db.decisions.filter(d => d.tripId === trip.id && d.status === 'open').length
            : undefined
          return (
            <button key={key} role="tab" id={`tab-${key}`} data-pill-key={key} aria-selected={tab === key}
              aria-controls={`panel-${key}`}
              className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              {label}{count ? <span className="tab-count">{count}</span> : null}
            </button>
          )
        })}
      </PillNav>

      {pending && (
        <ImpactPreviewPanel
          result={pending.result}
          onKeep={keepPending}
          onMoveDay={moveToAnotherDay}
          onRemove={removePending}
          onScrollToDay={scrollToDay}
        />
      )}

      <div className="tab-panel" key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === 'overview' && <OverviewTab trip={effective} editable={editable} onOpenDecisions={() => setTab('group')} onOpenTimeline={() => setTab('timeline')} onOpenMap={() => setTab('map')} onInvite={() => setTab('share')} health={health} totals={totals} />}
      {tab === 'timeline' && <TimelineTab trip={effective} editable={editable} applyChange={applyChange} legCorrections={legCorrections} suggestionCache={suggestionCache} onOpenBoard={() => setTab('board')} />}
      {tab === 'board' && (
        <React.Suspense fallback={<div className="container loading-block"><div className="spinner" />Loading board…</div>}>
          <BoardView trip={effective} editable={editable} applyChange={applyChange} health={health} totals={totals}
            onOpenOverview={() => setTab('overview')} onOpenTimeline={() => setTab('timeline')} />
        </React.Suspense>
      )}
      {tab === 'map' && (
        <React.Suspense fallback={<div className="container loading-block"><div className="spinner" />Loading map…</div>}>
          <MapTab trip={effective} editable={editable} applyChange={applyChange} suggestionCache={suggestionCache} crewSuggestions={db.suggestions.filter(s => s.tripId === trip.id)} />
        </React.Suspense>
      )}
      {tab === 'group' && <GroupInputTab trip={trip} editable={editable} me={me} />}
      {tab === 'budget' && <BudgetTab trip={trip} totals={totals} editable={editable} />}
      {tab === 'share' && <ShareTab trip={trip} me={me} editable={editable} onNavigate={onNavigate} legCorrections={legCorrections} />}
      </div>

      <AiDrawer trip={trip} open={aiOpen} onOpen={() => setAiOpen(true)} onClose={() => setAiOpen(false)} />
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

function fmtDateRange(a: string, b: string): string {
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${new Date(a).toLocaleDateString('en-IN', opt)} – ${new Date(b).toLocaleDateString('en-IN', { ...opt, year: 'numeric' })}`
}
