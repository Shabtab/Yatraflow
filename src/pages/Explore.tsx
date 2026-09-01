// ============ Explore public itineraries ============
import { useMemo, useState } from 'react'
import { useDb, currentUser, tripById, duplicateTrip, registerPubCopy } from '../store/store'
import { Avatar, Chip, EmptyState, toast } from '../components/ui'

type SortKey = 'popular' | 'budget-asc' | 'budget-desc' | 'duration'

export function ExplorePage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const [sortKey] = useState<SortKey>('popular')
  const [q, setQ] = useState('')
  const [style, setStyle] = useState('all')
  const [maxBudget, setMaxBudget] = useState<number | ''>('')
  const [duration, setDuration] = useState<'all' | 'short' | 'medium' | 'long'>('all')

  const pubs = useMemo(() => {
    let list = [...db.published]
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter(p =>
        p.title.toLowerCase().includes(needle) ||
        p.routeSummary.join(' ').toLowerCase().includes(needle) ||
        (userOf(db.users, p.creatorId)?.profile.name.toLowerCase().includes(needle) ?? false),
      )
    }
    if (style !== 'all') list = list.filter(p => p.travelStyle === style)
    if (maxBudget !== '') list = list.filter(p => p.estimatedBudgetPerPersonInr <= Number(maxBudget))
    if (duration !== 'all') {
      list = list.filter(p =>
        duration === 'short' ? p.durationDays <= 3 : duration === 'medium' ? p.durationDays >= 4 && p.durationDays <= 6 : p.durationDays >= 7,
      )
    }
    return sortList(list)
  }, [db.published, db.users, q, style, maxBudget, duration])

  function sortList(list: typeof db.published) {
    switch (sortKey) {
      case 'budget-asc': return list.sort((a, b) => a.estimatedBudgetPerPersonInr - b.estimatedBudgetPerPersonInr)
      case 'budget-desc': return list.sort((a, b) => b.estimatedBudgetPerPersonInr - a.estimatedBudgetPerPersonInr)
      case 'duration': return list.sort((a, b) => b.durationDays - a.durationDays)
      default: return list.sort((a, b) => (b.views + b.copies * 5) - (a.views + a.copies * 5))
    }
  }

  function copyTrip(slug: string) {
    const pub = db.published.find(p => p.id === slug)
    const src = pub ? tripById(pub.tripId) : undefined
    if (!pub || !src) { toast('That itinerary is no longer available.', 'err'); return }
    if (!me) { toast('Log in first to copy this trip into your plans.'); onNavigate('/auth'); return }
    duplicateTrip(src, me.id)
    registerPubCopy(slug)
    toast(`“${pub.title}” copied to My trips ✈️`)
    onNavigate('/trips')
  }

  return (
    <div className="container" style={{ paddingTop: 26 }}>
      <h1>Explore itineraries</h1>
      <p className="muted small" style={{ marginBottom: 18 }}>
        Real multi-day plans published by the community and creators. Copy one and make it yours.
      </p>

      {/* ---- Filter bar ---- */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="explore-filters">
          <input className="input" style={{ minWidth: 180, flex: 1 }} placeholder="Search destination or creator…"
            aria-label="Search destination or creator" value={q} onChange={e => setQ(e.target.value)} />
          <select className="select" value={style} onChange={e => setStyle(e.target.value)} aria-label="Travel style">
            <option value="all">Any style</option>
            {['relaxed', 'balanced', 'packed', 'adventure', 'luxury', 'budget', 'family', 'spiritual', 'food-focused', 'creator'].map(s =>
              <option key={s} value={s}>{cap(s)}</option>)}
          </select>
          <select className="select" value={duration} onChange={e => setDuration(e.target.value as never)} aria-label="Duration">
            <option value="all">Any length</option>
            <option value="short">≤3 days</option>
            <option value="medium">4–6 days</option>
            <option value="long">7+ days</option>
          </select>
          <select className="select" value={maxBudget} onChange={e => setMaxBudget(e.target.value === '' ? '' : Number(e.target.value))} aria-label="Max budget">
            <option value="">Any budget</option>
            <option value={10000}>Under ₹10k</option>
            <option value={20000}>Under ₹20k</option>
            <option value={35000}>Under ₹35k</option>
            <option value={60000}>Under ₹60k</option>
          </select>
        </div>
        {(q || style !== 'all' || maxBudget !== '' || duration !== 'all') && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setStyle('all'); setMaxBudget(''); setDuration('all') }}>✕ Clear filters</button>
        )}
      </div>

      {/* Screen-reader-only result count — filter changes reflow the grid
          silently otherwise (UI audit F-04) */}
      <p className="sr-only" role="status">{pubs.length} {pubs.length === 1 ? 'itinerary matches' : 'itineraries match'}</p>

      {pubs.length === 0 ? (
        <EmptyState icon="🔍" title="Nothing matches those filters"
          body="Try widening the budget or clearing a filter." />
      ) : (
        <div className="explore-grid">
          {pubs.map(p => {
            const creator = userOf(db.users, p.creatorId)
            return (
              <div key={p.id} className="card itin-card">
                <a className="trip-card-hit" href={`#/pub/${p.id}`}>
                  <div className="itin-cover">
                    <span className="itin-cover-route">{p.routeSummary[0]} → {p.routeSummary[p.routeSummary.length - 1]}</span>
                    <span className="itin-cover-fallback" aria-hidden="true">🧭</span>
                  </div>
                  <div className="itin-body">
                    <div className="row-between" style={{ marginTop: 0 }}>
                      <Chip tone="teal">{cap(p.travelStyle)}</Chip>
                      <span className="small muted">👁 {p.views}</span>
                    </div>
                    <h3>{p.title}</h3>
                    <p className="small muted" style={{ margin: 0 }}>{p.tagline}</p>
                    <div className="stop-meta" style={{ marginTop: 2 }}>
                      <span>🗓 {p.durationDays} days</span>
                      <span>💰 ~₹{p.estimatedBudgetPerPersonInr.toLocaleString('en-IN')}/person</span>
                      <span>📍 {p.routeSummary.length} places</span>
                    </div>
                  </div>
                </a>
                <div className="row-between itin-meta">
                  <span className="creator-line"><Avatar user={creator} />{creator?.profile.name ?? 'Creator'}{creator?.profile.isCreator && <span title="Verified creator">✨</span>}</span>
                  <button className="btn btn-primary btn-sm" onClick={() => copyTrip(p.id)}>Copy This Trip</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
function userOf(users: { id: string; profile: { name: string; isCreator: boolean } }[], id: string) {
  return users.find(u => u.id === id)
}
