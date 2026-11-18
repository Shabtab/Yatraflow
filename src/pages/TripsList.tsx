// ============ My trips ============
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Compass, Plus, Rocket, ShoppingBag, Trash2, X } from 'lucide-react'
import { InlineIcon } from '../components/icons'
import { useTrips, useTrashedTrips, useUsers, useSessionUserId, useSliceReads, useTrashLoaded, useTrashFailed, tripsForUser, trashTrip, restoreTrashedTrip, restoreTrashedTripById, permanentlyDeleteTrip, fetchTrashedTrips, rereadTrips, addDemoTrips, duplicateTripPersisted } from '../store/store'
import { collectWarnings, computeTotals, formatInrShort, scoreWarnings } from '../lib/engine'
import { cap } from '../lib/labels'
import { toast, undoToast, ConfirmDialog } from '../components/ui'
import { loadDraft, saveDraft, clearDraft, draftIsWorthKeeping, draftAgeLabel, type StoredDraft } from '../lib/createDraft'
import { readinessFromDraft } from '../lib/createReadiness'
import { createFunnelOn } from '../lib/featureFlags'
import { ImportTripButton } from '../components/ImportTripButton'
import { sliceState, emptyCopyFor, readState, rowsView } from '../lib/readState'
import type { Trip } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import { compareSoonest, countsLine, greetingCounts, greetingDateLabel, greetingHeadline, otherTripsEmptyKind, pickUpNext, splitByMemory, travelSoFar, whenBucket } from '../lib/tripsPage'
import { dayStrip, isReadyToGo, openChecks } from '../lib/tripDayStrip'
import { layoutFromPref, startOfLocalDay, TRIPS_LAYOUT_PREF } from '../lib/tripsCard'
import { loadPref, savePref } from '../lib/uiPrefs'
import { usePresenceList, presenceAttrs } from '../lib/usePresenceList'
import { TripArtSprite } from '../components/trips/TripArt'
import { MyTripsGreeting } from '../components/trips/MyTripsGreeting'
import { DraftBanner } from '../components/trips/DraftBanner'
import { MemoriesSection } from '../components/trips/MemoriesSection'
import { FilterChip } from '../components/filters/FilterChip'
import { SearchField } from '../components/filters/SearchField'
import { UpNextCard } from '../components/trips/UpNextCard'
import { SavedShelfSection } from '../components/trips/SavedShelfSection'
import { TripCard } from '../components/trips/TripCard'
import { LIST_SIZES } from '../components/trips/TripCover'
import { ViewSwitch, type TripsLayout } from '../components/trips/ViewSwitch'
import { SectionHead } from '../components/page/SectionHead'
import { StateBlock } from '../components/page/StateBlock'
import { Mascot } from '../components/mascot/Mascot'

type SortKey = 'recent' | 'soonest' | 'name' | 'budget-asc' | 'budget-desc' | 'length-desc'

/** The per-person figure is an unmeasured estimate until the workspace measures
 *  the real road, so it keeps the "~" marker. The cards receive this as text. */
function BudgetText({ totals }: { totals: ReturnType<typeof computeTotals> }) {
  return <>~{formatInrShort(totals.costPerPersonInr)}/person</>
}

export function TripsListPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  // Slice subscriptions: this page only re-renders when trips, profiles or the
  // session actually change — not on every unrelated store commit.
  const allTrips = useTrips()
  const users = useUsers()
  const meId = useSessionUserId()
  const [pendingDelete, setPendingDelete] = useState<Trip | null>(null)
  // #89: "Delete forever" from the trash was the app's only unprotected
  // irreversible action — one click nuked the trip, votes, decisions, activity
  // and publication with no confirm and no undo. Now it opens a dedicated
  // confirm whose copy says plainly that this one cannot be undone.
  const [pendingPurge, setPendingPurge] = useState<Trip | null>(null)
  const [view, setView] = useState<'trips' | 'trash'>('trips')
  const trashed = useTrashedTrips()
  // #383/#387: per-slice read verdicts, so a failed read never renders the
  // genuine-empty copy. My Trips rides the hydrate's `trips` slice; the bin
  // rides its own on-demand fetch bits (it is never hydrated).
  const sliceReads = useSliceReads()
  const tripsRead = sliceState(sliceReads, 'trips')
  const retryTrips = () => { void rereadTrips() }
  const trashLoaded = useTrashLoaded()
  const trashFailed = useTrashFailed()
  const trashRead = readState({ settled: trashLoaded || trashFailed, failed: trashFailed, read: trashLoaded && !trashFailed })
  const retryTrash = () => { void fetchTrashedTrips() }
  // Entering or leaving the Trash unmounts the button that was pressed, which
  // would drop keyboard focus to <body>. These refs let the page move focus on
  // purpose: to the Trash heading on the way in, to a Trash toggle on the way out.
  const trashHeadingRef = useRef<HTMLHeadingElement>(null)
  const headerTrashToggleRef = useRef<HTMLButtonElement>(null)
  const heroTrashToggleRef = useRef<HTMLButtonElement>(null)
  const viewChangedByUser = useRef(false)
  // A restored or deleted trip leaves the Trash with a short exit. Focus that
  // sat on its button moves to the Trash heading, because the row goes inert.
  const { entries: trashEntries, exiting: trashExiting, attachList: attachTrash } = usePresenceList(trashed, t => t.id, { fallbackFocus: () => trashHeadingRef.current })

  // The Trash view is populated on demand from the owner-scoped RPC (the
  // restrictive RLS policy hides trashed trips from normal hydration).
  useEffect(() => {
    if (view === 'trash') void fetchTrashedTrips()
  }, [view])

  // #387: the bin fetched once on entry and never again — a trash or restore
  // while resident went stale, and concurrent-device trashes never appeared.
  // Re-issue the RPC on window/tab focus while resident. The fetch itself
  // gates on configured + signed-in, so this never spams an anon RPC.
  useEffect(() => {
    if (view !== 'trash') return
    const refetch = () => { void fetchTrashedTrips() }
    const onVisible = () => { if (document.visibilityState === 'visible') void fetchTrashedTrips() }
    window.addEventListener('focus', refetch)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', refetch)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [view])

  // Move focus after the new view has rendered. The first render and any change
  // that did not come from a toggle leave focus alone.
  useEffect(() => {
    if (!viewChangedByUser.current) return
    viewChangedByUser.current = false
    if (view === 'trash') trashHeadingRef.current?.focus()
    else (headerTrashToggleRef.current ?? heroTrashToggleRef.current)?.focus()
  }, [view])

  // The clock is read at the top of the render. Every date rule below works in
  // whole calendar days and takes `today` as an argument. `todayStart` is the
  // memo key for the filter: the list is filtered again when the day changes.
  // It is a separate read because the React Compiler lint rejects a memo key
  // that is derived from a Date which later calls receive.
  const today = new Date()
  const todayStart = startOfLocalDay(new Date())

  // ---- Search / filter / sort (local view state — no URL sync needed on a
  // private page, unlike Explore's shareable links) ----
  const [q, setQ] = useState('')
  const [style, setStyle] = useState<'all' | Trip['travelStyle']>('all')
  // Past trips live in Memories, so the grid has no When filter. Soonest first is the default.
  const [sortKey, setSortKey] = useState<SortKey>('soonest')
  // The Grid | List choice is the one view pref this page keeps. It is read on
  // mount and written on each change; a stored value that names no layout reads
  // as the grid, and a storage failure keeps the default.
  const [layout, setLayout] = useState<TripsLayout>(() => layoutFromPref(loadPref(TRIPS_LAYOUT_PREF, 'grid')))
  function pickLayout(next: TripsLayout) {
    setLayout(next)
    savePref(TRIPS_LAYOUT_PREF, next)
  }

  const mine = useMemo(() => tripsForUser(meId), [allTrips, meId])

  const trips = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = mine.filter(t => {
      if (style !== 'all' && t.travelStyle !== style) return false
      if (!needle) return true
      const hay = [
        t.name, t.startLocation, ...t.destinations,
        ...(t.days ?? []).flatMap(d => d.stops.map(s => s.title)),
      ].join(' ').toLowerCase()
      return hay.includes(needle)
    })
    const budgetOf = (t: Trip) => computeTotals(t).costPerPersonInr
    return filtered.sort((a, b) => {
      switch (sortKey) {
        case 'soonest': return compareSoonest(a, b)
        case 'name': return a.name.localeCompare(b.name)
        case 'budget-asc': return budgetOf(a) - budgetOf(b)
        case 'budget-desc': return budgetOf(b) - budgetOf(a)
        case 'length-desc': return b.days.length - a.days.length
        default: return b.updatedAt - a.updatedAt
      }
    })
  }, [mine, q, style, sortKey])

  // style chips carry counts of the *unfiltered-by-style* set so they stay
  // stable while toggling (same behavior as Explore's style chips).
  const styleCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tripsForUser(meId)) m.set(t.travelStyle, (m.get(t.travelStyle) ?? 0) + 1)
    return m
  }, [allTrips, meId])

  const hasFilters = q !== '' || style !== 'all' || sortKey !== 'soonest'

  // Up next ignores the style, When and sort choices, so it stays pinned while
  // you change them. Only a text search hides it: a search is a question about
  // all trips, and the pinned card would answer a different one.
  const isSearching = q.trim() !== ''
  const upNext = isSearching ? null : pickUpNext(mine, today)
  const upNextIsOutsideFilters = upNext !== null && !trips.includes(upNext)
  const upNextTotals = upNext ? computeTotals(upNext) : null
  // Trips that ended leave the grid for Memories. The filters and the search
  // still reach both groups, so "Past trips" in the When select shows them.
  const split = splitByMemory(trips, today)
  // Soonest first reads oldest-first for a past trip, so Memories flips it.
  const memoryTrips = sortKey === 'soonest' ? [...split.past].reverse() : split.past
  const otherTrips = upNext ? split.comingUp.filter(t => t.id !== upNext.id) : split.comingUp
  const otherEmptyKind = otherTripsEmptyKind({ matchCount: split.comingUp.length, otherCount: otherTrips.length, hasFilters })
  // When the filters match only past trips, Memories shows them and the grid
  // stays quiet instead of claiming there are none.
  const filtersMatchOnlyMemories = hasFilters && split.comingUp.length === 0 && memoryTrips.length > 0
  // One engine pass per trip that has not ended. The Up next strip, the status
  // line and the "Ready to go" rule all read these warnings.
  const tripChecks = useMemo(() => {
    const checks = new Map<string, ReturnType<typeof collectWarnings>>()
    const checkToday = new Date(todayStart)
    for (const t of mine) if (whenBucket(t, checkToday) !== 'past') checks.set(t.id, collectWarnings(t))
    return checks
  }, [mine, todayStart])
  const memoryCards = memoryTrips.map(t => ({ trip: t, distanceKm: computeTotals(t).totalDistanceKm }))
  const pastAll = useMemo(() => splitByMemory(mine, new Date(todayStart)).past, [mine, todayStart])
  const travel = useMemo(
    () => travelSoFar({ trips: pastAll, meId, kmOf: t => computeTotals(t as Trip).totalDistanceKm }),
    [pastAll, meId],
  )
  const [copyingId, setCopyingId] = useState<string | null>(null)
  // A trip that a filter or the Trash takes out of the list leaves with a short
  // exit. The empty copy waits until the last card has gone.
  const { entries: tripEntries, exiting: tripsExiting, attachList: attachGrid } = usePresenceList(
    otherTrips, t => t.id,
    // Focus on the last card that leaves goes to the catalog region.
    { fallbackFocus: root => root.closest<HTMLElement>('.mt-catalog') },
  )
  const upNextTitleId = useId()
  const otherTitleId = useId()
  const memoriesTitleId = useId()

  // #385: ONE reset for both "Clear filters" buttons. The toolbar ghost reset
  // all four fields while the empty-state action reset three and left
  // `sortKey`, so a sort-only empty was unfixable by its own button. The
  // toolbar's set is the superset — adopt it once, call it twice.
  function clearFilters() { setQ(''); setStyle('all'); setSortKey('soonest') }

  // P4 - the unfinished trip shows up where people look for their trips. It is
  // not a trip yet, so it is not a row among them: one card, above the grid.
  const [draft, setDraft] = useState<StoredDraft | null>(() => {
    if (!createFunnelOn('drafts')) return null
    const d = loadDraft()
    return draftIsWorthKeeping(d) ? d : null
  })
  const draftReady = useMemo(() => (draft ? readinessFromDraft(draft.form, draft.dests.length) : null), [draft])
  // The dismiss removes the saved draft, so it follows the trip delete: remove
  // at once, then offer an undo that writes the same draft back. A storage
  // failure keeps the banner and says so, because a draft that comes back on
  // reload is not dismissed.
  function dismissDraft() {
    if (!draft) return
    const kept = draft
    if (!clearDraft()) {
      toast('Couldn’t remove the draft', 'err')
      return
    }
    setDraft(null)
    undoToast('Draft removed', () => {
      saveDraft({ form: kept.form, dests: kept.dests, returnCount: kept.returnCount, crew: kept.crew, step: kept.step }, { now: new Date(kept.savedAt) })
      setDraft(kept)
      toast('Draft restored')
    })
  }

  // "Plan it again" copies a past trip into My trips and opens the copy's
  // Settings, where its dates are. The copy keeps the old dates until then. A
  // failed save says so and opens nothing.
  async function planAgain(source: Trip) {
    if (!meId || copyingId !== null) return
    setCopyingId(source.id)
    try {
      const { trip: copy, persisted } = await duplicateTripPersisted(source, meId)
      if (!persisted) {
        toast('Couldn’t save the copy. Check your connection and try again.', 'err')
        return
      }
      toast(`Copied “${source.name}”. Set new dates.`)
      onNavigate(`/trip/${copy.id}/settings`)
    } finally {
      setCopyingId(null)
    }
  }

  // The greeting counts all of the viewer's trips, not the filtered list, so a
  // search or a filter never changes them.
  // #704: a failed refresh with rows already loaded is 'kept'. The page keeps
  // showing those rows, so the greeting and the Coming up header read them as
  // ready. Only a failed or pending read with no rows is not ready.
  const tripsView = rowsView(tripsRead, mine.length)
  const tripsReady = tripsView !== 'failed' && tripsView !== 'reading'
  const me = users.find(u => u.id === meId)
  const greetingCountsText = tripsReady ? countsLine(greetingCounts({ trips: mine, today, hasCreateDraft: draft !== null })) : ''
  const isTrashView = view === 'trash'
  function toggleTrash() {
    viewChangedByUser.current = true
    setView(v => v === 'trash' ? 'trips' : 'trash')
  }
  // The Trash toggle lives in the "Coming up" header. That header is drawn
  // only when trips are ready and the list is not the first-run empty state,
  // and never in the Trash view. In every other case the greeting header carries the
  // toggle, so the Trash stays reachable while trips load, after a failed read
  // with no trips, and when there are no trips at all.
  const showsOtherTripsHeader = !isTrashView && tripsReady && !(trips.length === 0 && !hasFilters)

  function confirmDelete() {
    if (!pendingDelete) return
    const doomed = pendingDelete
    trashTrip(doomed)
    undoToast(`Moved “${doomed.name}” to trash`, () => {
      restoreTrashedTrip(doomed)
      toast(`Restored “${doomed.name}”`)
    })
  }

  return (
    <div className="container trips-page page-enter">
      <TripArtSprite />
      <MyTripsGreeting
        dateLabel={greetingDateLabel(today)}
        title={greetingHeadline(me?.profile.name, today)}
        counts={greetingCountsText}
        primary={
          <button className="btn btn-primary mt-greet-cta" onClick={() => onNavigate('/new')}><Plus size={18} aria-hidden />Plan a new trip</button>
        }
        secondary={
          <>
            {/* I-20: the shelf has to be reachable from where people look for
                their travel — a bought plan is not one of your trips, so it gets
                its own list rather than a row among them. */}
            <button className="btn btn-secondary" onClick={() => onNavigate('/purchases')}>
              <InlineIcon icon={ShoppingBag} size={15} gap={5} />My purchases
            </button>
            <ImportTripButton ownerId={meId} onNavigate={onNavigate} label="Import a plan" className="btn btn-secondary" />
            {/* The Trash button lives in the "Coming up" header. When that
                header is not drawn, the button stays here instead. */}
            {!showsOtherTripsHeader && (
              <button ref={heroTrashToggleRef} type="button" className="btn btn-quiet" aria-pressed={isTrashView} onClick={toggleTrash}><InlineIcon icon={Trash2} size={15} gap={5} />Trash</button>
            )}
          </>
        }
      />

      {view === 'trash' && (
        <div className="card" style={{ marginBottom: 18 }} ref={attachTrash}>
          <div className="row-between">
            <h3 ref={trashHeadingRef} tabIndex={-1} style={{ margin: 0 }}>Trash {trashed.length > 0 && <span className="small muted">({trashed.length})</span>}</h3>
            <button className="btn btn-secondary" onClick={toggleTrash}>Back to my trips</button>
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>Deleted trips stay for 30 days, then they’re gone for good.</p>
          <hr className="divider" />
          {trashRead !== 'ready' ? (
            // #387: a failed bin fetch used to render the genuine-empty copy.
            // The failed branch is checked first, and its Retry re-issues the
            // RPC rather than re-rendering the same empty bin.
            trashRead === 'reading' ? (
              <StateBlock kind="loading" art={<Mascot pose="loading" size={96} />} title={emptyCopyFor(trashRead, 'trash', retryTrash).title} />
            ) : (
              <StateBlock kind="failed" icon={<Trash2 size={38} aria-hidden />} title={emptyCopyFor(trashRead, 'trash', retryTrash).title}
                body={emptyCopyFor(trashRead, 'trash', retryTrash).body}
                actions={<button className="btn btn-primary" onClick={retryTrash}>Try again</button>} />
            )
          ) : trashed.length === 0 && !trashExiting ? (
            <StateBlock kind="empty" art={<Mascot pose="sleep" size={112} />} title="Trash is empty"
              body="Trips you delete will show up here so you can restore them within 30 days." />
          ) : (
            trashEntries.map(({ item: t, key, exiting }) => (
              <div key={key} className="row-between trash-row" {...presenceAttrs({ exiting })}>
                <div>
                  <b>{t.name}</b>
                  <div className="small muted">{t.startLocation} → {t.destinations[t.destinations.length - 1] ?? t.startLocation} · {t.days.length} days</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary" onClick={() => { void restoreTrashedTripById(t.id).then(ok => { if (ok) toast(`Restored “${t.name}”`) }) }}>Restore</button>
                  <button className="btn btn-danger" onClick={() => setPendingPurge(t)}>Delete forever</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {view !== 'trash' && draft && (
        <DraftBanner
          name={String((draft.form as Record<string, unknown>).name || 'Untitled trip')}
          meta={`Draft${draft.dests.length > 0 ? ` · ${draft.dests.length} stop${draft.dests.length === 1 ? '' : 's'}` : ''} · Saved ${draftAgeLabel(draft.savedAt)}`}
          readiness={draftReady}
          onContinue={() => onNavigate('/new')}
          onDismiss={dismissDraft}
        />
      )}

      {view !== 'trash' && (!tripsReady ? (
        // #383: a failed trips read used to render the genuine-empty copy with
        // no error branch. The failed branch precedes loading precedes empty,
        // and its Retry re-issues the hydrate rather than re-rendering.
        tripsRead === 'reading' ? (
          <StateBlock kind="loading" art={<Mascot pose="loading" size={96} />} title={emptyCopyFor(tripsRead, 'trips', retryTrips).title} />
        ) : (
          <StateBlock
            kind="failed"
            art={<Mascot pose="sad" size={140} />}
            title={emptyCopyFor(tripsRead, 'trips', retryTrips).title}
            body={emptyCopyFor(tripsRead, 'trips', retryTrips).body}
            actions={<button className="btn btn-primary" onClick={retryTrips}>Try again</button>}
          />
        )
      ) : trips.length === 0 && !hasFilters ? (
        <StateBlock
          kind="empty"
          art={<Mascot pose="pin" size={140} />}
          title="No trips yet"
          body="Start from scratch with dates and budget, or copy a public itinerary from Explore."
          actions={
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={() => onNavigate('/new')}>Plan your first trip</button>
              <button className="btn btn-secondary" onClick={addDemoTrips} title="Adds 3 sample trips: Kerala, Goa & Rajasthan, to your account"><InlineIcon icon={Rocket} size={15} gap={5} />Load demo trips</button>
              <button className="btn btn-secondary" onClick={() => onNavigate('/explore')}>Explore itineraries</button>
            </div>
          }
        />
      ) : (
        <div className="mt-catalog">
          {tripsView === 'kept' && (
            // #704: the refresh failed. The rows below are the ones that loaded.
            <StateBlock
              size="compact"
              kind="kept"
              titleLevel="h2"
              title="Couldn’t refresh your trips. Showing the ones that loaded."
              actions={<button className="btn btn-secondary" onClick={retryTrips}>Try again</button>}
            />
          )}
          {upNext && upNextTotals && (
            <section aria-labelledby={upNextTitleId}>
              <SectionHead id={upNextTitleId}
                title={<>Up next{upNextIsOutsideFilters && <span className="mt-kicker-note"> · outside your filters</span>}</>} />
              <UpNextCard
                trip={upNext}
                today={today}
                budget={<BudgetText totals={upNextTotals} />}
                distanceKm={upNextTotals.totalDistanceKm}
                dayCells={dayStrip(upNext, tripChecks.get(upNext.id) ?? [])}
                health={scoreWarnings(tripChecks.get(upNext.id) ?? [])}
                users={users}
                meId={meId}
                onDelete={setPendingDelete}
              />
            </section>
          )}

          <SavedShelfSection trips={mine} />

          <section aria-labelledby={otherTitleId}>
            {/* One row, as in the mockup: the heading and its count, then search, pace
                chips, the sort chip, the Grid | List switch, Clear and Trash. */}
            <div className="mt-listhead">
              <div className="mt-listhead-title">
                <h2 className="mt-section-title" id={otherTitleId}>Coming up</h2>
                <span className="mt-count">{otherTrips.length} {otherTrips.length === 1 ? 'trip' : 'trips'}</span>
              </div>
              <div className="mt-listhead-tools" role="search" aria-label="Filter your trips">
                <SearchField value={q} onChange={setQ} label="Search your trips"
                  placeholder="Search places or stops" shortPlaceholder="Search trips" pill />
                <div className="mt-chips" role="group" aria-label="Travel style">
                  <FilterChip pressed={style === 'all'} onClick={() => setStyle('all')}>All</FilterChip>
                  {TRAVEL_STYLES.filter(st => styleCounts.get(st)).map(st => (
                    <FilterChip key={st} pressed={style === st} onClick={() => setStyle(style === st ? 'all' : st)}>
                      {cap(st)}
                    </FilterChip>
                  ))}
                </div>
                <label className="mt-sort">
                  <span className="sr-only">Sort by</span>
                  <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>
                    <option value="soonest">Soonest first</option>
                    <option value="recent">Recently edited</option>
                    <option value="name">Name A–Z</option>
                    <option value="length-desc">Longest first</option>
                    <option value="budget-asc">Budget: low → high</option>
                    <option value="budget-desc">Budget: high → low</option>
                  </select>
                  <ChevronDown size={14} aria-hidden />
                </label>
                <ViewSwitch layout={layout} onChange={pickLayout} />
                {/* Shown only while a search, a chip or a sort choice is active. The
                    empty-results block keeps its own Clear filters button. */}
                {hasFilters && (
                  <button type="button" className="btn btn-quiet mt-clear" onClick={clearFilters}>
                    <X size={13} aria-hidden />Clear filters
                  </button>
                )}
                <button ref={headerTrashToggleRef} type="button" className="btn btn-quiet mt-trash" aria-pressed={isTrashView} onClick={toggleTrash}><InlineIcon icon={Trash2} size={15} gap={5} />Trash</button>
              </div>
            </div>

            <p className="sr-only" role="status">{trips.length} {trips.length === 1 ? 'trip matches' : 'trips match'}</p>

            {/* 'no-trips' never reaches this list: the page-level branch above
                shows the first-run copy for it, so it renders nothing here. */}
            {filtersMatchOnlyMemories && !tripsExiting ? null : otherEmptyKind === 'no-trips' && !tripsExiting ? (
              // Only past trips exist, so nothing is coming up. The page-level
              // branch handles the user with no trips at all.
              <StateBlock
                kind="empty"
                icon={<Compass size={38} aria-hidden />}
                title="No upcoming trips"
                actions={<button className="btn btn-secondary" onClick={() => onNavigate('/new')}>Plan a new trip</button>}
              />
            ) : otherEmptyKind === 'none-other' && !tripsExiting ? (
              <StateBlock
                kind="empty"
                icon={<Compass size={38} aria-hidden />}
                title="No other trips yet"
                body="Your next trips will show up here."
              />
            ) : otherEmptyKind === 'no-match' && !tripsExiting ? (
              <StateBlock
                kind="empty"
                icon={<Compass size={38} aria-hidden />}
                title="No trips match those filters"
                body="Try a different search or clear the filters to see all your trips."
                actions={<button className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>}
              />
            ) : otherEmptyKind === 'none' || tripsExiting ? (
              // The grid is keyed by its layout, so a Grid | List switch remounts the cards
              // and they replay the staggered entrance (cardIn) instead of snapping.
              <div key={layout} ref={attachGrid} className={`mt-grid${layout === 'list' ? ' is-list' : ''}`}>
                {tripEntries.map(({ item: t, key, exiting }, i) => {
                  const totals = computeTotals(t)
                  return (
                    <TripCard
                      key={key}
                      trip={t}
                      today={today}
                      budget={<BudgetText totals={totals} />}
                      readyToGo={isReadyToGo(t, today, tripChecks.get(t.id) ?? [])}
                      toFix={openChecks(t, tripChecks.get(t.id) ?? [])}
                      users={users}
                      meId={meId}
                      enterIndex={exiting ? 0 : i}
                      coverSizes={layout === 'list' ? LIST_SIZES : undefined}
                      presence={presenceAttrs({ exiting })}
                      onDelete={setPendingDelete}
                    />
                  )
                })}
              </div>
            ) : null}
          </section>

          <MemoriesSection
            titleId={memoriesTitleId}
            memories={memoryCards}
            today={today}
            travel={travel}
            copyingId={copyingId}
            onPlanAgain={t => { void planAgain(t) }}
          />
        </div>
      ))}

      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete “${pendingDelete?.name ?? ''}”?`}
        body="This removes the trip from your workspace. You’ll get a short window to undo from the toast. If it was published, its public page stops selling and stays readable for you and everyone who already unlocked it."
        confirmLabel="Delete trip"
        danger
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={!!pendingPurge}
        title={`Delete “${pendingPurge?.name ?? ''}” forever?`}
        body="This is permanent: the trip, its votes, decisions and history are destroyed and cannot be recovered or undone. A trip that was ever published is never destroyed here. Its publication and its buyers’ records stay with it, and the public page keeps working for everyone who unlocked it."
        confirmLabel="Delete forever"
        danger
        onConfirm={() => {
          const doomed = pendingPurge
          if (!doomed) return
          void permanentlyDeleteTrip(doomed.id).then(ok => { if (ok) toast(`“${doomed.name}” is gone for good`) })
        }}
        onClose={() => setPendingPurge(null)}
      />
    </div>
  )
}
