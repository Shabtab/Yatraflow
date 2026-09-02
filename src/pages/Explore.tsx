// ============ Explore public itineraries — discover, trust and fork (CTI §6.10) ============
import { useMemo, useState } from 'react'
import { useDb, currentUser, tripById, duplicateTrip, registerPubCopy } from '../store/store'
import { computeHealth, formatInr } from '../lib/engine'
import { useSavedPubs } from '../lib/savedPubs'
import { Avatar, Chip, EmptyState, toast } from '../components/ui'
import { CoverThumb } from '../components/CoverThumb'

type SortKey = 'popular' | 'budget-asc' | 'budget-desc' | 'duration'
const STYLES = ['relaxed', 'balanced', 'packed', 'adventure', 'luxury', 'budget', 'family', 'spiritual', 'food-focused', 'creator'] as const

export function ExplorePage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const { saved, isSaved, toggleSaved } = useSavedPubs()
  // F-22: filters + sort live in the hash query (#/explore?q=goa&sort=budget-asc)
  // so they survive a refresh and can be shared; sortKey finally gets a control.
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const s0 = params.get('sort')
  const [sortKey, setSortKey] = useState<SortKey>(s0 === 'budget-asc' || s0 === 'budget-desc' || s0 === 'duration' ? s0 : 'popular')
  const [q, setQ] = useState(params.get('q') ?? '')
  const [style, setStyle] = useState(params.get('style') ?? 'all')
  const [maxBudget, setMaxBudget] = useState<number | ''>(params.get('max') ? Number(params.get('max')) : '')
  const d0 = params.get('dur')
  const [duration, setDuration] = useState<'all' | 'short' | 'medium' | 'long'>(d0 === 'short' || d0 === 'medium' || d0 === 'long' ? d0 : 'all')
  // ♡ Saved — device-local favourites (localStorage), not part of the schema
  const [savedOnly, setSavedOnly] = useState(false)

  /** Write the current filters back into the hash query (F-22). replaceState —
      filter fiddling shouldn't spam history or retrigger App's scroll-reset. */
  function syncUrl(next: Partial<Record<'q' | 'style' | 'max' | 'dur' | 'sort', string>>) {
    const p = new URLSearchParams({ q, style, max: String(maxBudget), dur: duration, sort: sortKey, ...next })
    for (const [k, v] of [...p]) if (!v || v === 'all' || v === '0' || (k === 'sort' && v === 'popular')) p.delete(k)
    const qs = p.toString()
    history.replaceState(null, '', `#/explore${qs ? '?' + qs : ''}`)
  }

  const popularity = (p: { views: number; copies: number }) => p.views + p.copies * 5

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
    if (savedOnly) list = list.filter(p => saved.includes(p.id))
    return sortList(list)
  }, [db.published, db.users, q, style, maxBudget, duration, sortKey, savedOnly, saved])

  function sortList(list: typeof db.published) {
    switch (sortKey) {
      case 'budget-asc': return list.sort((a, b) => a.estimatedBudgetPerPersonInr - b.estimatedBudgetPerPersonInr)
      case 'budget-desc': return list.sort((a, b) => b.estimatedBudgetPerPersonInr - a.estimatedBudgetPerPersonInr)
      case 'duration': return list.sort((a, b) => b.durationDays - a.durationDays)
      default: return list.sort((a, b) => popularity(b) - popularity(a))
    }
  }

  // Featured: the community's most-forked/viewed plan, independent of filters —
  // it leads the page with its credibility explained (§6.10).
  const featured = useMemo(() => [...db.published].sort((a, b) => popularity(b) - popularity(a))[0], [db.published])
  const featuredTrip = featured ? tripById(featured.tripId) : undefined
  const featuredHealth = featuredTrip ? computeHealth(featuredTrip).score : undefined

  const styleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of db.published) counts.set(p.travelStyle, (counts.get(p.travelStyle) ?? 0) + 1)
    return counts
  }, [db.published])

  function forkTrip(slug: string) {
    const pub = db.published.find(p => p.id === slug)
    const src = pub ? tripById(pub.tripId) : undefined
    if (!pub || !src) { toast('That itinerary is no longer available.', 'err'); return }
    if (!me) { toast('Log in first to fork this trip into your plans.'); onNavigate('/auth'); return }
    duplicateTrip(src, me.id)
    registerPubCopy(slug)
    toast(`“${pub.title}” forked to My trips ✈️`)
    onNavigate('/trips')
  }

  function toggleHeart(id: string) {
    const nowSaved = toggleSaved(id)
    toast(nowSaved ? '♥ Saved to this browser.' : 'Removed from saved itineraries.')
  }

  const stylesWithCounts = STYLES.filter(s => (styleCounts.get(s) ?? 0) > 0)

  return (
    <div>
      {/* ---- Dark-teal editorial hero with route-aware search (§6.10) ---- */}
      <section className="explore-hero">
        <div className="container explore-hero-inner">
          <span className="editorial-kicker explore-hero-kicker">DISCOVER · TRUST · FORK</span>
          <h1>Explore itineraries</h1>
          <p className="explore-hero-sub">
            Real multi-day plans from travellers who actually went — real road time, real pacing, honest costs.
          </p>
          <input className="input explore-hero-search" placeholder="Search a route, place or creator — try “Alleppey”…"
            aria-label="Search destination or creator" value={q} onChange={e => { setQ(e.target.value); syncUrl({ q: e.target.value }) }} />
        </div>
      </section>

      <div className="container" style={{ paddingTop: 20 }}>
        {/* ---- Travel-style chips (§6.10) — replaces the style dropdown ---- */}
        <div className="explore-chips" role="group" aria-label="Travel style">
          <button className={`chip clickable-chip ${style === 'all' ? 'chip-teal' : ''}`}
            onClick={() => { setStyle('all'); syncUrl({ style: 'all' }) }}>All styles</button>
          {stylesWithCounts.map(s => (
            <button key={s} className={`chip clickable-chip ${style === s ? 'chip-teal' : ''}`}
              onClick={() => { setStyle(style === s ? 'all' : s); syncUrl({ style: style === s ? 'all' : s }) }}>
              {cap(s)} <span className="chip-count">{styleCounts.get(s)}</span>
            </button>
          ))}
          <button className={`chip clickable-chip ${savedOnly ? 'chip-saffron' : ''}`} aria-pressed={savedOnly}
            onClick={() => setSavedOnly(v => !v)}>♥ Saved {saved.length > 0 && <span className="chip-count">{saved.length}</span>}</button>
        </div>

        {/* ---- Compact filter bar: budget / duration / sort ---- */}
        <div className="card glass-soft" style={{ marginBottom: 20 }}>
          <div className="explore-filters">
            <select className="select" value={duration} onChange={e => { setDuration(e.target.value as never); syncUrl({ dur: e.target.value }) }} aria-label="Duration">
              <option value="all">Any length</option>
              <option value="short">≤3 days</option>
              <option value="medium">4–6 days</option>
              <option value="long">7+ days</option>
            </select>
            <select className="select" value={maxBudget} onChange={e => { setMaxBudget(e.target.value === '' ? '' : Number(e.target.value)); syncUrl({ max: e.target.value }) }} aria-label="Max budget">
              <option value="">Any budget</option>
              <option value={10000}>Under ₹10k</option>
              <option value={20000}>Under ₹20k</option>
              <option value={35000}>Under ₹35k</option>
              <option value={60000}>Under ₹60k</option>
            </select>
            <select className="select" value={sortKey} onChange={e => { setSortKey(e.target.value as SortKey); syncUrl({ sort: e.target.value }) }} aria-label="Sort by">
              <option value="popular">Most popular</option>
              <option value="budget-asc">Budget: low → high</option>
              <option value="budget-desc">Budget: high → low</option>
              <option value="duration">Longest first</option>
            </select>
            {(q || style !== 'all' || maxBudget !== '' || duration !== 'all' || savedOnly) && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setStyle('all'); setMaxBudget(''); setDuration('all'); setSavedOnly(false); syncUrl({ q: '', style: 'all', max: '', dur: 'all' }) }}>✕ Clear filters</button>
            )}
          </div>
        </div>

        {/* Screen-reader-only result count — filter changes reflow the grid
            silently otherwise (UI audit F-04) */}
        <p className="sr-only" role="status">{pubs.length} {pubs.length === 1 ? 'itinerary matches' : 'itineraries match'}</p>

        {/* ---- Featured itinerary: credibility explained (§6.10) ---- */}
        {featured && (
          <div className="featured-card" key={featured.id}>
            <div className="featured-body">
              <span className="editorial-kicker featured-kicker">⭐ FEATURED ITINERARY</span>
              <h2><a className="featured-title-link" href={`#/pub/${featured.id}`}>{featured.title}</a></h2>
              <p className="featured-tagline">{featured.tagline}</p>
              <p className="featured-credibility">
                Why featured: 🍴 {featured.copies} fork{featured.copies === 1 ? '' : 's'} · 👁 {featured.views} views
                {featuredHealth !== undefined && <> · trip health {featuredHealth}/100</>} — by {userOf(db.users, featured.creatorId)?.profile.name ?? 'a YatraFlow traveller'}{userOf(db.users, featured.creatorId)?.profile.isCreator ? ' ✨' : ''}.
              </p>
              <div className="featured-meta">
                <span>🗓 {featured.durationDays} days</span>
                <span>💰 ~{formatInr(featured.estimatedBudgetPerPersonInr)}/person</span>
                <span>📍 {featured.routeSummary.length} places · {featured.routeSummary[0]} → {featured.routeSummary[featured.routeSummary.length - 1]}</span>
              </div>
              <div className="featured-actions">
                <button className="btn fork-btn" onClick={() => forkTrip(featured.id)}>Fork this trip →</button>
                <button className="btn save-btn" onClick={() => toggleHeart(featured.id)} aria-pressed={isSaved(featured.id)}>
                  {isSaved(featured.id) ? '♥ Saved' : '♡ Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {pubs.length === 0 ? (
          <EmptyState icon="🔍" title="Nothing matches those filters"
            body="Try widening the budget or clearing a filter." />
        ) : (
          <div className="explore-grid">
            {pubs.map(p => {
              const creator = userOf(db.users, p.creatorId)
              return (
                <div key={p.id} className="card itin-card">
                  <button className="save-heart" aria-pressed={isSaved(p.id)} aria-label={isSaved(p.id) ? 'Remove from saved' : 'Save itinerary'}
                    onClick={() => toggleHeart(p.id)}>{isSaved(p.id) ? '♥' : '♡'}</button>
                  <a className="trip-card-hit" href={`#/pub/${p.id}`}>
                    <CoverThumb
                      trip={{ name: p.title, destinations: p.routeSummary }}
                      explicitUrl={p.coverImageUrl}
                      emoji="🧭"
                      routeLabel={`${p.routeSummary[0]} → ${p.routeSummary[p.routeSummary.length - 1]}`}
                    />
                    <div className="itin-body">
                      <div className="row-between" style={{ marginTop: 0 }}>
                        <Chip tone="teal">{cap(p.travelStyle)}</Chip>
                        <span className="small muted">🍴 {p.copies}</span>
                      </div>
                      <h3>{p.title}</h3>
                      <p className="small muted" style={{ margin: 0 }}>{p.tagline}</p>
                      <div className="stop-meta" style={{ marginTop: 2 }}>
                        <span>🗓 {p.durationDays} days</span>
                        <span>💰 ~{formatInr(p.estimatedBudgetPerPersonInr)}/person</span>
                        <span>📍 {p.routeSummary.length} places</span>
                      </div>
                    </div>
                  </a>
                  <div className="row-between itin-meta">
                    <span className="creator-line"><Avatar user={creator} />{creator?.profile.name ?? 'Creator'}{creator?.profile.isCreator && <span title="Verified creator">✨</span>}</span>
                    <button className="btn btn-primary btn-sm" onClick={() => forkTrip(p.id)}>Fork this trip</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
function userOf(users: { id: string; profile: { name: string; isCreator: boolean } }[], id: string) {
  return users.find(u => u.id === id)
}
