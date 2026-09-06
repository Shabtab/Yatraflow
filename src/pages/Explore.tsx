// ============ Explore public itineraries — discover, trust and fork (CTI §6.10) ============
import { useMemo, useState } from 'react'
import {
  Calendar, Compass, Eye, GitFork, Heart, MapPin, Search, Sparkles, Star, Wallet, X,
} from 'lucide-react'
import { usePublished, useUsers, useTrips, useSessionUserId } from '../store/store'
import type { User } from '../data/types'
import { computeHealth, formatInr } from '../lib/engine'
import { useSavedPubs } from '../lib/savedPubs'
import { forkPublication } from '../lib/forkPub'
import { Avatar, Chip, EmptyState, toast } from '../components/ui'
import { PubCard } from '../components/PubCard'

type SortKey = 'popular' | 'newest' | 'budget-asc' | 'budget-desc' | 'duration'
const STYLES = ['relaxed', 'balanced', 'packed', 'adventure', 'luxury', 'budget', 'family', 'spiritual', 'food-focused', 'creator'] as const

export function ExplorePage({ onNavigate }: { onNavigate: (r: string) => void }) {
  // Slice subscriptions: Explore re-renders when the published catalog,
  // profiles, trips or the session change — not on every store commit.
  const published = usePublished()
  const users = useUsers()
  const trips = useTrips()
  const me = useSessionUserId()
  const { saved, isSaved, toggleSaved } = useSavedPubs()
  // F-22: filters + sort live in the hash query (#/explore?q=goa&sort=budget-asc)
  // so they survive a refresh and can be shared; sortKey finally gets a control.
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const s0 = params.get('sort')
  const [sortKey, setSortKey] = useState<SortKey>(s0 === 'budget-asc' || s0 === 'budget-desc' || s0 === 'duration' || s0 === 'newest' ? s0 : 'popular')
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
    let list = [...published]
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter(p =>
        p.title.toLowerCase().includes(needle) ||
        p.routeSummary.join(' ').toLowerCase().includes(needle) ||
        (userOf(users, p.creatorId)?.profile.name.toLowerCase().includes(needle) ?? false),
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
  }, [published, users, q, style, maxBudget, duration, sortKey, savedOnly, saved])

  function sortList(list: typeof published) {
    switch (sortKey) {
      case 'newest': return list.sort((a, b) => b.publishedAt - a.publishedAt)
      case 'budget-asc': return list.sort((a, b) => a.estimatedBudgetPerPersonInr - b.estimatedBudgetPerPersonInr)
      case 'budget-desc': return list.sort((a, b) => b.estimatedBudgetPerPersonInr - a.estimatedBudgetPerPersonInr)
      case 'duration': return list.sort((a, b) => b.durationDays - a.durationDays)
      default: return list.sort((a, b) => popularity(b) - popularity(a))
    }
  }

  // Featured: the community's most-forked/viewed plan, independent of filters —
  // it leads the page with its credibility explained (§6.10).
  const featured = useMemo(() => [...published].sort((a, b) => popularity(b) - popularity(a))[0], [published])
  // Read the underlying trip from the trips slice (subscribed) so the featured
  // health score stays live without subscribing to the whole cache.
  const featuredTrip = featured ? trips.find(t => t.id === featured.tripId) : undefined
  const featuredHealth = featuredTrip ? computeHealth(featuredTrip).score : undefined

  const styleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of published) counts.set(p.travelStyle, (counts.get(p.travelStyle) ?? 0) + 1)
    return counts
  }, [published])

  function forkTrip(slug: string) {
    const pub = published.find(p => p.id === slug)
    if (!pub) { toast('That itinerary is no longer available.', 'err'); return }
    forkPublication(pub, me, onNavigate)
  }

  function toggleHeart(id: string) {
    const nowSaved = toggleSaved(id)
    toast(nowSaved ? 'Saved to this browser.' : 'Removed from saved itineraries.')
  }

  const stylesWithCounts = STYLES.filter(s => (styleCounts.get(s) ?? 0) > 0)
  const filtersActive = Boolean(q.trim()) || style !== 'all' || maxBudget !== '' || duration !== 'all' || savedOnly

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
          <button className={`chip clickable-chip ${style === 'all' ? 'on-teal' : ''}`}
            aria-pressed={style === 'all'}
            onClick={() => { setStyle('all'); syncUrl({ style: 'all' }) }}>All styles</button>
          {stylesWithCounts.map(s => (
            <button key={s} className={`chip clickable-chip ${style === s ? 'on-teal' : ''}`}
              aria-pressed={style === s}
              onClick={() => { setStyle(style === s ? 'all' : s); syncUrl({ style: style === s ? 'all' : s }) }}>
              {cap(s)} <span className="chip-count">{styleCounts.get(s)}</span>
            </button>
          ))}
          <button className={`chip clickable-chip ${savedOnly ? 'chip-saffron' : ''}`} aria-pressed={savedOnly}
            onClick={() => setSavedOnly(v => !v)}><Heart size={12} aria-hidden fill={savedOnly ? 'currentColor' : 'none'} style={{ verticalAlign: '-2px', marginRight: 4 }} />Saved {saved.length > 0 && <span className="chip-count">{saved.length}</span>}</button>
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
              <option value="newest">Newest first</option>
              <option value="budget-asc">Budget: low → high</option>
              <option value="budget-desc">Budget: high → low</option>
              <option value="duration">Longest first</option>
            </select>
            {filtersActive && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setStyle('all'); setMaxBudget(''); setDuration('all'); setSavedOnly(false); syncUrl({ q: '', style: 'all', max: '', dur: 'all' }) }}><X size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Clear filters</button>
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
              <span className="editorial-kicker featured-kicker"><Star size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />FEATURED ITINERARY</span>
              <h2><a className="featured-title-link" href={`#/pub/${featured.id}`}>{featured.title}</a></h2>
              <p className="featured-tagline">{featured.tagline}</p>
              <p className="featured-credibility">
                Why featured: <GitFork size={12} aria-hidden style={{ verticalAlign: '-2px', margin: '0 2px' }} /> {featured.copies} fork{featured.copies === 1 ? '' : 's'} · <Eye size={12} aria-hidden style={{ verticalAlign: '-2px', margin: '0 2px' }} /> {featured.views} views
                {featuredHealth !== undefined && <> · trip health {featuredHealth}/100</>} — by {userOf(users, featured.creatorId)?.profile.name ?? 'a YatraFlow traveller'}{userOf(users, featured.creatorId)?.profile.isCreator && <Sparkles size={11} aria-hidden style={{ verticalAlign: '-1px', marginLeft: 2 }} />}.
              </p>
              <div className="featured-meta">
                <span><Calendar size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{featured.durationDays} days</span>
                <span><Wallet size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />~{formatInr(featured.estimatedBudgetPerPersonInr)}/person</span>
                <span><MapPin size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{featured.routeSummary.length} places · {featured.routeSummary[0]} → {featured.routeSummary[featured.routeSummary.length - 1]}</span>
              </div>
              <div className="featured-actions">
                <button className="btn fork-btn" onClick={() => forkTrip(featured.id)}><GitFork size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Fork this trip</button>
                <button className="btn save-btn" onClick={() => toggleHeart(featured.id)} aria-pressed={isSaved(featured.id)}>
                  <Heart size={13} aria-hidden fill={isSaved(featured.id) ? 'currentColor' : 'none'} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  {isSaved(featured.id) ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {pubs.length === 0 ? (
          filtersActive ? (
            <EmptyState icon={<Search size={38} aria-hidden />} title="Nothing matches those filters"
              body="Try widening the budget or clearing a filter." />
          ) : (
            /* Fresh catalog with no active filters: "nothing matches" would be a
               dead end (and a lie — nothing was filtered). Point forward instead. */
            <EmptyState icon={<Compass size={38} aria-hidden />}
              title={me ? 'No itineraries published yet' : 'The community catalog is just getting started'}
              body={me
                ? 'Publish one of your trips from its Share tab and it will appear here.'
                : 'Sign in to fork community itineraries into your own trips — or load the demo from My trips to look around first.'}
              action={!me ? (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={() => onNavigate('/auth?mode=signup')}>Sign up free</button>
                  <button className="btn btn-outline" onClick={() => onNavigate('/auth')}>Log in</button>
                </div>
              ) : undefined}
            />
          )
        ) : (
          <div className="explore-grid">
            {pubs.map(p => (
              <PubCard key={p.id} pub={p} creator={userOf(users, p.creatorId)} saved={isSaved(p.id)}
                onFork={() => forkTrip(p.id)} onToggleSave={() => toggleHeart(p.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
function userOf(users: User[], id: string): User | undefined {
  return users.find(u => u.id === id)
}