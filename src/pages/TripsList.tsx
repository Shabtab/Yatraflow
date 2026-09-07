// ============ My trips ============
import { useMemo, useState } from 'react'
import { Clock, Compass, Plus, Rocket, Trash2, Wallet } from 'lucide-react'
import { MetaIcon } from '../components/icons'
import { useTrips, useUsers, useSessionUserId, tripsForUser, deleteTrip, restoreTrip, addDemoTrips } from '../store/store'
import { computeTotals, formatInrShort } from '../lib/engine'
import { Avatar, Chip, EmptyState, toast, undoToast, ConfirmDialog } from '../components/ui'
import { CoverThumb } from '../components/CoverThumb'
import type { Trip, User } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'

type SortKey = 'recent' | 'name' | 'budget-asc' | 'budget-desc' | 'length-desc'
type WhenKey = 'all' | 'upcoming' | 'past' | 'draft'

/** Date-bucket helper: "upcoming" starts today or later, "past" ended before
 *  today, "draft" has no meaningful date set. Uses endDate (not startDate) so
 *  a trip in progress counts as upcoming. */
function whenBucket(t: Trip, today: Date): WhenKey {
  const end = new Date(`${t.endDate}T23:59:59`)
  const start = new Date(`${t.startDate}T00:00:00`)
  if (Number.isNaN(end.getTime()) || Number.isNaN(start.getTime())) return 'draft'
  if (end.getTime() < today.getTime()) return 'past'
  return today.getTime() <= end.getTime() && start.getTime() <= end.getTime() + 86400000 ? 'upcoming' : 'upcoming'
}

export function TripsListPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  // Slice subscriptions: this page only re-renders when trips, profiles or the
  // session actually change — not on every unrelated store commit.
  const allTrips = useTrips()
  const users = useUsers()
  const meId = useSessionUserId()
  const [pendingDelete, setPendingDelete] = useState<Trip | null>(null)

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

  function confirmDelete() {
    if (!pendingDelete) return
    const doomed = pendingDelete
    const idx = allTrips.findIndex(t => t.id === doomed.id)
    deleteTrip(doomed.id)
    undoToast(`Deleted “${doomed.name}”`, () => {
      restoreTrip(doomed, idx)
      toast(`Restored “${doomed.name}”`)
    })
  }

  return (
    <div className="container" style={{ paddingTop: 26 }}>
      <div className="row-between" style={{ marginBottom: 18 }}>
        <div>
          <h1>My trips</h1>
          <p className="muted small">Everything you’re planning or collaborating on.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" onClick={addDemoTrips} title="Adds 3 sample trips — Kerala, Goa & Rajasthan — to your account"><Rocket size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />Load demo trips</button>
          <button className="btn btn-primary" onClick={() => onNavigate('/new')}><Plus size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Plan a new trip</button>
        </div>
      </div>

      {trips.length === 0 && !hasFilters ? (
        <EmptyState
          icon={<Compass size={38} aria-hidden />}
          title="No trips yet"
          body="Start from scratch with dates and budget, or copy a public itinerary from Explore."
          action={
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => onNavigate('/new')}>Plan your first trip</button>
              <button className="btn btn-outline" onClick={addDemoTrips}><Rocket size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />Load demo trips</button>
              <button className="btn btn-outline" onClick={() => onNavigate('/explore')}>Browse Explore</button>
            </div>
          }
        />
      ) : (
        <>
          {/* ---- Search + style chips + when/sort selects (Explore's pattern) ---- */}
          <div className="trips-toolbar" style={{ marginBottom: 18 }}>
            <input className="input trips-search" placeholder="Search your trips — name, place or stop…"
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
            <select className="select" value={when} onChange={e => setWhen(e.target.value as WhenKey)} aria-label="When">
              <option value="all">Any time</option>
              <option value="upcoming">Upcoming & live</option>
              <option value="past">Past trips</option>
              <option value="draft">Drafts</option>
            </select>
            <select className="select" value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} aria-label="Sort by">
              <option value="recent">Recently edited</option>
              <option value="name">Name A–Z</option>
              <option value="length-desc">Longest first</option>
              <option value="budget-asc">Budget: low → high</option>
              <option value="budget-desc">Budget: high → low</option>
            </select>
            {hasFilters && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setStyle('all'); setWhen('all'); setSortKey('recent') }}>Clear</button>
            )}
          </div>

          <p className="sr-only" role="status">{trips.length} {trips.length === 1 ? 'trip matches' : 'trips match'}</p>

          {trips.length === 0 ? (
            <EmptyState
              icon={<Compass size={38} aria-hidden />}
              title="No trips match those filters"
              body="Try a different search or clear the filters to see all your trips."
              action={<button className="btn btn-outline" onClick={() => { setQ(''); setStyle('all'); setWhen('all') }}>Clear filters</button>}
            />
          ) : (
          <div className="explore-grid">
            {trips.map((t, i) => {
              const totals = computeTotals(t)
              const others = (t.members ?? []).filter(m => m.userId !== meId)
              return (
                <div key={t.id} className="card itin-card trip-enter" style={{ animationDelay: `${Math.min(i, 8) * 70}ms` }}>
                  <a className="trip-card-hit" href={`#/trip/${t.id}`}>
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
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete “${pendingDelete?.name ?? ''}”?`}
        body="This removes the trip from your workspace. You’ll get a short window to undo from the toast."
        confirmLabel="Delete trip"
        danger
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
function userOf(users: User[], id: string): User | undefined {
  return users.find(u => u.id === id)
}
