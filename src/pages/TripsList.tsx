// ============ My trips ============
import { useEffect, useMemo, useState } from 'react'
import { Clock, Compass, Plus, Rocket, ShoppingBag, Trash2, Wallet } from 'lucide-react'
import { InlineIcon, MetaIcon } from '../components/icons'
import { useTrips, useTrashedTrips, useUsers, useSessionUserId, useSliceReads, useTrashLoaded, useTrashFailed, tripsForUser, trashTrip, restoreTrashedTrip, restoreTrashedTripById, permanentlyDeleteTrip, fetchTrashedTrips, rereadTrips, addDemoTrips } from '../store/store'
import { computeTotals, formatInrShort } from '../lib/engine'
import { cap } from '../lib/labels'
import { Avatar, Chip, EmptyState, toast, undoToast, ConfirmDialog } from '../components/ui'
import { Select } from '../components/Select'
import { loadDraft, draftIsWorthKeeping, draftAgeLabel } from '../lib/createDraft'
import { readinessFromDraft } from '../lib/createReadiness'
import { createFunnelOn } from '../lib/featureFlags'
import { CoverThumb } from '../components/CoverThumb'
import { ImportTripButton } from '../components/ImportTripButton'
import { sliceState, emptyCopyFor, readState } from '../lib/readState'
import type { Trip, User } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import { appLink } from '../lib/appLink'

type SortKey = 'recent' | 'name' | 'budget-asc' | 'budget-desc' | 'length-desc'
type WhenKey = 'all' | 'upcoming' | 'past' | 'draft'

/** Date-bucket helper: "upcoming" starts today or later, "past" ended before
 *  today, "draft" has no meaningful date set. Uses endDate (not startDate) so
 *  a trip in progress counts as upcoming. */
function whenBucket(t: Trip, today: Date): WhenKey {
  const end = new Date(`${t.endDate}T23:59:59`)
  const start = new Date(`${t.startDate}T00:00:00`)
  if (Number.isNaN(end.getTime()) || Number.isNaN(start.getTime())) return 'draft'
  // a valid start ≤ end means the plan is dated — past or upcoming by end date
  return end.getTime() < today.getTime() ? 'past' : 'upcoming'
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

  // ---- Search / filter / sort (local view state — no URL sync needed on a
  // private page, unlike Explore's shareable links) ----
  const [q, setQ] = useState('')
  const [style, setStyle] = useState<'all' | Trip['travelStyle']>('all')
  const [when, setWhen] = useState<WhenKey>('all')
  const [sortKey, setSortKey] = useState<SortKey>('recent')

  const trips = useMemo(() => {
    const mine = tripsForUser(meId)
    const today = new Date()
    const needle = q.trim().toLowerCase()
    const filtered = mine.filter(t => {
      if (style !== 'all' && t.travelStyle !== style) return false
      if (when !== 'all' && whenBucket(t, today) !== when) return false
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
  }, [allTrips, meId, q, style, when, sortKey])

  // style chips carry counts of the *unfiltered-by-style* set so they stay
  // stable while toggling (same behavior as Explore's style chips).
  const styleCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of tripsForUser(meId)) m.set(t.travelStyle, (m.get(t.travelStyle) ?? 0) + 1)
    return m
  }, [allTrips, meId])

  const hasFilters = q !== '' || style !== 'all' || when !== 'all' || sortKey !== 'recent'

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
      <div className="row-between trips-head">
        <div className="trips-head-title">
          <h1>My trips</h1>
          <p className="muted small">Everything you’re planning or collaborating on.</p>
        </div>
        <div className="trips-head-actions">
          {/* I-20: the shelf has to be reachable from where people look for
              their travel — a bought plan is not one of your trips, so it gets
              its own list rather than a row among them. */}
          <button className="btn btn-outline" onClick={() => onNavigate('/purchases')}>
            <InlineIcon icon={ShoppingBag} size={15} gap={5} />My purchases
          </button>
          <button className={`btn btn-outline${view === 'trash' ? ' on-teal' : ''}`} aria-pressed={view === 'trash'} onClick={() => setView(v => v === 'trash' ? 'trips' : 'trash')}><InlineIcon icon={Trash2} size={15} gap={5} />Trash</button>
          <ImportTripButton ownerId={meId} onNavigate={onNavigate} />
          <button className="btn btn-outline" onClick={addDemoTrips} aria-label="Load demo trips" title="Adds 3 sample trips — Kerala, Goa & Rajasthan — to your account" disabled={tripsRead === 'failed'}><InlineIcon icon={Rocket} size={15} gap={5} /><span>Load demo trips</span></button>
          <button className="btn btn-primary" onClick={() => onNavigate('/new')}><InlineIcon icon={Plus} size={15} gap={4} />Plan a new trip</button>
        </div>
      </div>

      {view === 'trash' && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Trash {trashed.length > 0 && <span className="small muted">({trashed.length})</span>}</h3>
            <span className="small muted">Deleted trips stay for 30 days, then they’re gone for good.</span>
          </div>
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
                  <button className="btn btn-outline" onClick={() => { void restoreTrashedTripById(t.id).then(ok => { if (ok) toast(`Restored “${t.name}”`) }) }}>Restore</button>
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
              <button className="btn btn-outline" onClick={() => onNavigate('/new')}>Plan your first trip</button>
              <button className="btn btn-outline" onClick={addDemoTrips}><InlineIcon icon={Rocket} size={15} gap={5} />Load demo trips</button>
              <button className="btn btn-outline" onClick={() => onNavigate('/explore')}>Explore itineraries</button>
            </div>
          }
        />
      ) : (
        <>
          {/* ---- Search + style chips + when/sort selects (Explore's pattern) ---- */}
          <div className="trips-toolbar" style={{ marginBottom: 18 }}>
            <input className="input trips-search" placeholder="Search places or stops…"
              aria-label="Search your trips" value={q} onChange={e => setQ(e.target.value)} />
            <div className="explore-chips" role="group" aria-label="Travel style">
              <button className={`chip clickable-chip ${style === 'all' ? 'on-teal' : ''}`}
                aria-pressed={style === 'all'} onClick={() => setStyle('all')}>All styles</button>
              {TRAVEL_STYLES.filter(s => styleCounts.get(s)).map(s => (
                <button key={s} className={`chip clickable-chip ${style === s ? 'on-teal' : ''}`}
                  aria-pressed={style === s} onClick={() => setStyle(style === s ? 'all' : s)}>
                  {cap(s)} <span className="chip-count">{styleCounts.get(s)}</span>
                </button>
              ))}
            </div>
            <Select value={when} onChange={v => setWhen(v as WhenKey)} aria-label="When"
              options={[
                { value: 'all', label: 'Any time' },
                { value: 'upcoming', label: 'Upcoming & live' },
                { value: 'past', label: 'Past trips' },
                { value: 'draft', label: 'Drafts' },
              ]} />
            <Select value={sortKey} onChange={v => setSortKey(v as SortKey)} aria-label="Sort by"
              options={[
                { value: 'recent', label: 'Recently edited' },
                { value: 'name', label: 'Name A–Z' },
                { value: 'length-desc', label: 'Longest first' },
                { value: 'budget-asc', label: 'Budget: low → high' },
                { value: 'budget-desc', label: 'Budget: high → low' },
              ]} />
            {/* always mounted so the row doesn't shift when it appears mid-typing */}
            {/* "Clear filters" (review finding 4): the empty state's action said
                "Clear filters" while this ghost button said "Clear" — the same
                reset under two names, both once visible in one frame. */}
            <button className="btn btn-ghost btn-sm" style={{ visibility: hasFilters ? 'visible' : 'hidden' }} onClick={clearFilters}>Clear filters</button>
          </div>

          <p className="sr-only" role="status">{trips.length} {trips.length === 1 ? 'trip matches' : 'trips match'}</p>

          {trips.length === 0 ? (
            <EmptyState
              icon={<Compass size={38} aria-hidden />}
              title="No trips match those filters"
              body="Try a different search or clear the filters to see all your trips."
              action={<button className="btn btn-outline" onClick={clearFilters}>Clear filters</button>}
            />
          ) : (
          <div className="explore-grid">
            {trips.map((t, i) => {
              const totals = computeTotals(t)
              const others = (t.members ?? []).filter(m => m.userId !== meId)
              return (
                <div key={t.id} className="card itin-card trip-enter" style={{ animationDelay: `calc(var(--stagger-step) * ${Math.min(i, 8)})` }}>
                  <a className="trip-card-hit" {...appLink(`/trip/${t.id}`)}>
                    <CoverThumb
                      variant="short"
                      trip={t}
                      explicitUrl={t.coverImageUrl}
                      emoji={t.coverEmoji}
                    />
                    <div className="itin-body">
                      <h2 className="card-title">{t.name}</h2>
                      <div className="small muted">
                        {t.startLocation} → {t.destinations[t.destinations.length - 1] ?? t.startLocation} · {t.days.length} days
                      </div>
                      <div className="stop-meta num">
                        <span><MetaIcon icon={ Wallet } tone="money" />~{formatInrShort(totals.costPerPersonInr)}/person</span>
                        <span><MetaIcon icon={ Clock } tone="time" />{Math.round(totals.totalTravelMinutes / 60)}h travel</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Chip tone="teal">{cap(t.travelStyle)}</Chip>
                        {(t.members ?? []).length > 1 && <Chip tone="info">{(t.members ?? []).length} planners</Chip>}
                      </div>
                    </div>
                  </a>
                  <div className="row-between itin-meta">
                    <div className="member-stack">
                      {others.slice(0, 3).map(m => <Avatar key={m.userId} user={userOf(users, m.userId)} />)}
                      {others.length > 3 && <span className="small muted num">+{others.length - 3}</span>}
                      {!others.length && <span className="small muted">Just you so far</span>}
                    </div>
                    <button className="icon-btn" aria-label={`Delete ${t.name}`} onClick={() => setPendingDelete(t)}><Trash2 size={14} aria-hidden /></button>
                  </div>
                </div>
              )
            })}
          </div>
          )}
        </>
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

function userOf(users: User[], id: string): User | undefined {
  return users.find(u => u.id === id)
}
