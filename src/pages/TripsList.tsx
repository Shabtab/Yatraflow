// ============ My trips ============
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Compass, Plus, Rocket, ShoppingBag, Trash2, X } from 'lucide-react'
import { InlineIcon } from '../components/icons'
import { useTrips, useTrashedTrips, useUsers, useSessionUserId, useSliceReads, useTrashLoaded, useTrashFailed, tripsForUser, trashTrip, restoreTrashedTrip, restoreTrashedTripById, permanentlyDeleteTrip, fetchTrashedTrips, rereadTrips, addDemoTrips } from '../store/store'
import { computeTotals, formatInrShort } from '../lib/engine'
import { cap } from '../lib/labels'
import { EmptyState, toast, undoToast, ConfirmDialog } from '../components/ui'
import { Select } from '../components/Select'
import { loadDraft, draftIsWorthKeeping, draftAgeLabel } from '../lib/createDraft'
import { readinessFromDraft } from '../lib/createReadiness'
import { createFunnelOn } from '../lib/featureFlags'
import { ImportTripButton } from '../components/ImportTripButton'
import { sliceState, emptyCopyFor, readState } from '../lib/readState'
import type { Trip } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import { heroHeadline, heroNote, heroPostcards, heroStats, otherTripsEmptyKind, pickUpNext, whenBucket, type WhenKey } from '../lib/tripsPage'
import { gridShape, startOfLocalDay } from '../lib/tripsCard'
import { TripArtSprite } from '../components/trips/TripArt'
import { TripsHero } from '../components/trips/TripsHero'
import { FilterChip } from '../components/filters/FilterChip'
import { SearchField } from '../components/filters/SearchField'
import { UpNextCard } from '../components/trips/UpNextCard'
import { TripCard } from '../components/trips/TripCard'
import { ViewSwitch, type TripsLayout } from '../components/trips/ViewSwitch'

type SortKey = 'recent' | 'name' | 'budget-asc' | 'budget-desc' | 'length-desc'

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
  const [when, setWhen] = useState<WhenKey>('all')
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [layout, setLayout] = useState<TripsLayout>('grid')

  const mine = useMemo(() => tripsForUser(meId), [allTrips, meId])

  const trips = useMemo(() => {
    // The memo re-runs when the calendar day changes, not on every render.
    const filterToday = new Date(todayStart)
    const needle = q.trim().toLowerCase()
    const filtered = mine.filter(t => {
      if (style !== 'all' && t.travelStyle !== style) return false
      if (when !== 'all' && whenBucket(t, filterToday) !== when) return false
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
        case 'name': return a.name.localeCompare(b.name)
        case 'budget-asc': return budgetOf(a) - budgetOf(b)
        case 'budget-desc': return budgetOf(b) - budgetOf(a)
        case 'length-desc': return b.days.length - a.days.length
        default: return b.updatedAt - a.updatedAt
      }
    })
  }, [mine, q, style, when, sortKey, todayStart])

  // style chips carry counts of the *unfiltered-by-style* set so they stay
  // stable while toggling (same behavior as Explore's style chips).
  const styleCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tripsForUser(meId)) m.set(t.travelStyle, (m.get(t.travelStyle) ?? 0) + 1)
    return m
  }, [allTrips, meId])

  const hasFilters = q !== '' || style !== 'all' || when !== 'all' || sortKey !== 'recent'

  // Up next ignores the style, When and sort choices, so it stays pinned while
  // you change them. Only a text search hides it: a search is a question about
  // all trips, and the pinned card would answer a different one.
  const isSearching = q.trim() !== ''
  const upNext = isSearching ? null : pickUpNext(mine, today)
  const upNextIsOutsideFilters = upNext !== null && !trips.includes(upNext)
  const upNextTotals = upNext ? computeTotals(upNext) : null
  const otherTrips = upNext ? trips.filter(t => t.id !== upNext.id) : trips
  const otherEmptyKind = otherTripsEmptyKind({ matchCount: trips.length, otherCount: otherTrips.length, hasFilters })
  const shape = gridShape(otherTrips.length, layout === 'grid')
  const upNextTitleId = useId()
  const otherTitleId = useId()

  // #385: ONE reset for both "Clear filters" buttons. The toolbar ghost reset
  // all four fields while the empty-state action reset three and left
  // `sortKey`, so a sort-only empty was unfixable by its own button. The
  // toolbar's set is the superset — adopt it once, call it twice.
  function clearFilters() { setQ(''); setStyle('all'); setWhen('all'); setSortKey('recent') }

  // P4 - the unfinished trip shows up where people look for their trips. It is
  // not a trip yet, so it is not a row among them: one card, above the grid.
  const draft = useMemo(() => {
    if (!createFunnelOn('drafts')) return null
    const d = loadDraft()
    return draftIsWorthKeeping(d) ? d : null
  }, [])
  const draftReady = useMemo(() => (draft ? readinessFromDraft(draft.form, draft.dests.length) : null), [draft])

  // The hero reads all of the viewer's trips, not the filtered list, so a
  // search or a filter never changes its headline, counts or postcards.
  const tripsReady = tripsRead === 'ready'
  const heroHeadlineText = heroHeadline({ trips: mine, today, ready: tripsReady })
  const heroStatRow = heroStats({ trips: mine, today, meId, ready: tripsReady })
  const heroCards = heroPostcards({ trips: mine, today, ready: tripsReady })
  const heroNoteText = heroNote({ trips: mine, today, ready: tripsReady })
  const isTrashView = view === 'trash'
  function toggleTrash() {
    viewChangedByUser.current = true
    setView(v => v === 'trash' ? 'trips' : 'trash')
  }
  // The Trash toggle lives in the "Other trips" header. That header is drawn
  // only when the trips read is ready and the list is not the first-run empty
  // state, and never in the Trash view. In every other case the hero carries
  // the toggle, so the Trash stays reachable while trips load, after a failed
  // read, with cached trips, and with no trips at all.
  const showsOtherTripsHeader = !isTrashView && tripsRead === 'ready' && !(trips.length === 0 && !hasFilters)

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
    <div className="container trips-page">
      <TripArtSprite />
      <TripsHero
        headline={heroHeadlineText}
        lede="All your plans, in one place."
        stats={heroStatRow}
        postcards={heroCards}
        note={heroNoteText}
        primary={
          <button className="btn btn-primary ex-cta" onClick={() => onNavigate('/new')}><Plus size={18} aria-hidden />Plan a new trip</button>
        }
        secondary={
          <>
            {/* I-20: the shelf has to be reachable from where people look for
                their travel — a bought plan is not one of your trips, so it gets
                its own list rather than a row among them. */}
            <button className="btn btn-quiet" onClick={() => onNavigate('/purchases')}>
              <InlineIcon icon={ShoppingBag} size={15} gap={5} />My purchases
            </button>
            <ImportTripButton ownerId={meId} onNavigate={onNavigate} label="Import trip" className="btn btn-quiet" />
            {/* The Trash button lives in the "Other trips" header. When that
                header is not drawn, the button stays here instead. */}
            {!showsOtherTripsHeader && (
              <button ref={heroTrashToggleRef} type="button" className="btn btn-quiet" aria-pressed={isTrashView} onClick={toggleTrash}><InlineIcon icon={Trash2} size={15} gap={5} />Trash</button>
            )}
          </>
        }
      />

      {view === 'trash' && (
        <div className="card" style={{ marginBottom: 18 }}>
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
              <div className="loading-block"><div className="spinner" />{emptyCopyFor(trashRead, 'trash', retryTrash).title}</div>
            ) : (
              <EmptyState icon={<Trash2 size={38} aria-hidden />} title={emptyCopyFor(trashRead, 'trash', retryTrash).title}
                body={emptyCopyFor(trashRead, 'trash', retryTrash).body}
                action={<button className="btn btn-primary" onClick={retryTrash}>Try again</button>} />
            )
          ) : trashed.length === 0 ? (
            <EmptyState icon={<Trash2 size={38} aria-hidden />} title="Trash is empty"
              body="Trips you delete will show up here so you can restore them within 30 days." />
          ) : (
            trashed.map(t => (
              <div key={t.id} className="row-between trash-row">
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
        <div className="draft-card" role="status">
          <span className="draft-card-thumb" aria-hidden>&#128221;</span>
          <div className="draft-card-body">
            <b>{String((draft.form as Record<string, unknown>).name || 'Untitled trip')}</b>
            <span className="draft-card-meta">
              {draftReady ? `${draftReady.pct}% ready` : 'saved'}
              {draft.dests.length > 0 ? ` - ${draft.dests.length} stop${draft.dests.length === 1 ? '' : 's'}` : ''}
              {' - saved '}{draftAgeLabel(draft.savedAt)}
            </span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => onNavigate('/new')}>Finish planning</button>
        </div>
      )}

      {view !== 'trash' && (tripsRead !== 'ready' ? (
        // #383: a failed trips read used to render the genuine-empty copy with
        // no error branch. The failed branch precedes loading precedes empty,
        // and its Retry re-issues the hydrate rather than re-rendering.
        tripsRead === 'reading' ? (
          <div className="loading-block"><div className="spinner" />{emptyCopyFor(tripsRead, 'trips', retryTrips).title}</div>
        ) : (
          <EmptyState
            icon={<Compass size={38} aria-hidden />}
            title={emptyCopyFor(tripsRead, 'trips', retryTrips).title}
            body={emptyCopyFor(tripsRead, 'trips', retryTrips).body}
            action={<button className="btn btn-primary" onClick={retryTrips}>Try again</button>}
          />
        )
      ) : trips.length === 0 && !hasFilters ? (
        <EmptyState
          icon={<Compass size={38} aria-hidden />}
          title="No trips yet"
          body="Start from scratch with dates and budget, or copy a public itinerary from Explore."
          action={
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={() => onNavigate('/new')}>Plan your first trip</button>
              <button className="btn btn-secondary" onClick={addDemoTrips} title="Adds 3 sample trips — Kerala, Goa & Rajasthan — to your account"><InlineIcon icon={Rocket} size={15} gap={5} />Load demo trips</button>
              <button className="btn btn-secondary" onClick={() => onNavigate('/explore')}>Explore itineraries</button>
            </div>
          }
        />
      ) : (
        <div className="mt-catalog">
          {upNext && upNextTotals && (
            <section aria-labelledby={upNextTitleId}>
              <div className="mt-section-head">
                <h2 className="mt-section-title" id={upNextTitleId}>
                  Up next{upNextIsOutsideFilters && <span className="mt-kicker-note"> · outside your filters</span>}
                </h2>
              </div>
              <UpNextCard
                trip={upNext}
                today={today}
                budget={<BudgetText totals={upNextTotals} />}
                totalTravelMinutes={upNextTotals.totalTravelMinutes}
                users={users}
                meId={meId}
                onDelete={setPendingDelete}
              />
            </section>
          )}

          <section aria-labelledby={otherTitleId}>
            <div className="mt-section-head">
              <h2 className="mt-section-title" id={otherTitleId}>{upNext ? 'Other trips' : 'All trips'} ({otherTrips.length})</h2>
              <div className="mt-head-actions">
                <button ref={headerTrashToggleRef} type="button" className="btn btn-quiet" aria-pressed={isTrashView} onClick={toggleTrash}><InlineIcon icon={Trash2} size={15} gap={5} />Trash</button>
                <ViewSwitch layout={layout} onChange={setLayout} />
              </div>
            </div>

            {/* ---- Explore's filter bar: search, selects, then chips ---- */}
            <div className="ex-filterbar filterbar-host" role="search" aria-label="Filter your trips">
              <div className="ex-filter-row">
                <SearchField value={q} onChange={setQ} label="Search your trips"
                  placeholder="Search places or stops…" shortPlaceholder="Search trips" />
              </div>
              <div className="ex-filter-row">
                <div className="ex-select">
                  <Select value={when} onChange={v => setWhen(v as WhenKey)} aria-label="When"
                    options={[
                      { value: 'all', label: 'Any time' },
                      { value: 'upcoming', label: 'Upcoming & live' },
                      { value: 'past', label: 'Past trips' },
                      { value: 'draft', label: 'Drafts' },
                    ]} />
                </div>
                <div className="ex-select">
                  <Select value={sortKey} onChange={v => setSortKey(v as SortKey)} aria-label="Sort by"
                    options={[
                      { value: 'recent', label: 'Recently edited' },
                      { value: 'name', label: 'Name A–Z' },
                      { value: 'length-desc', label: 'Longest first' },
                      { value: 'budget-asc', label: 'Budget: low → high' },
                      { value: 'budget-desc', label: 'Budget: high → low' },
                    ]} />
                </div>
              </div>
              <div className="ex-chip-row">
                <div className="ex-chips" role="group" aria-label="Travel style">
                  <FilterChip pressed={style === 'all'} onClick={() => setStyle('all')}>All styles</FilterChip>
                  {TRAVEL_STYLES.filter(s => styleCounts.get(s)).map(s => (
                    <FilterChip key={s} pressed={style === s} count={styleCounts.get(s)}
                      onClick={() => setStyle(style === s ? 'all' : s)}>
                      {cap(s)}
                    </FilterChip>
                  ))}
                </div>
                {/* Always mounted, so the row never gains or loses an element when a
                    filter starts or stops. Idle, it is hidden but keeps its place. */}
                {/* "Clear filters" (review finding 4): the empty state's action said
                    "Clear filters" while this ghost button said "Clear" — the same
                    reset under two names, both once visible in one frame. */}
                <button type="button" className="btn btn-quiet ex-clear" style={{ visibility: hasFilters ? 'visible' : 'hidden' }} onClick={clearFilters}>
                  <X size={13} aria-hidden />Clear filters
                </button>
              </div>
            </div>

            <p className="sr-only" role="status">{trips.length} {trips.length === 1 ? 'trip matches' : 'trips match'}</p>

            {/* 'no-trips' never reaches this list: the page-level branch above
                shows the first-run copy for it, so it renders nothing here. */}
            {otherEmptyKind === 'none-other' ? (
              <EmptyState
                icon={<Compass size={38} aria-hidden />}
                title="No other trips yet"
                body="Your next trips will show up here."
              />
            ) : otherEmptyKind === 'no-match' ? (
              <EmptyState
                icon={<Compass size={38} aria-hidden />}
                title="No trips match those filters"
                body="Try a different search or clear the filters to see all your trips."
                action={<button className="btn btn-secondary" onClick={clearFilters}>Clear filters</button>}
              />
            ) : otherEmptyKind === 'none' ? (
              <div
                className={`mt-grid${layout === 'list' ? ' is-list' : ''}`}
                data-lone-two={shape.loneLastTwo ? '1' : '0'}
                data-lone-three={shape.loneLastThree ? '1' : '0'}
                style={{ '--mt-c2': shape.columnsTwo, '--mt-c3': shape.columnsThree } as CSSProperties}
              >
                {otherTrips.map((t, i) => {
                  const totals = computeTotals(t)
                  return (
                    <TripCard
                      key={t.id}
                      trip={t}
                      today={today}
                      budget={<BudgetText totals={totals} />}
                      totalTravelMinutes={totals.totalTravelMinutes}
                      users={users}
                      meId={meId}
                      enterIndex={i}
                      onDelete={setPendingDelete}
                    />
                  )
                })}
              </div>
            ) : null}
          </section>
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
        body="This is permanent: the trip, its votes, decisions and history are destroyed and cannot be recovered or undone. A trip that was ever published is never destroyed here — its publication and its buyers’ records stay with it, and the public page keeps working for everyone who unlocked it."
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
