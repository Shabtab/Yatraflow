// ============ Explore public itineraries — discover, trust and fork (CTI §6.10) ============
import { useEffect, useMemo, useState } from 'react'
import {
  Calendar, Compass, Eye, GitFork, Heart, MapPin, Search, Sparkles, Star, Wallet, X,
} from 'lucide-react'
import { InlineIcon, MetaIcon } from '../components/icons'
import { usePublished, useUsers, useTrips, useSessionUserId, useDb, rereadPublicSlices } from '../store/store'
import type { PublishedItinerary, User } from '../data/types'
import { computeHealth, formatInr } from '../lib/engine'
import { useSavedPubs } from '../lib/savedPubs'
import { sliceState, emptyCopyFor } from '../lib/readState'
import { forkPublication } from '../lib/forkPub'
import { cap } from '../lib/labels'
import { Avatar, Chip, EmptyState, toast } from '../components/ui'
import { Select } from '../components/Select'
import { PubCard } from '../components/PubCard'

type SortKey = 'popular' | 'newest' | 'budget-asc' | 'budget-desc' | 'duration'
const STYLES = ['relaxed', 'balanced', 'packed', 'adventure', 'luxury', 'budget', 'family', 'spiritual', 'food-focused', 'creator'] as const
/** P4: the grid renders one page at a time; "Load more" grows the window. */
const PAGE_SIZE = 12
/** A publication is only worth featuring when it carries real evidence. With a
 *  young catalog the honest answer is often "nothing yet" — leading with
 *  "Why featured: 0 forks · 13 views" advertises emptiness rather than
 *  credibility (§6.10). */
const FEATURED_MIN_VIEWS = 25

/** The gallery's pool: only publications that are still LIVE on Explore (#350).
 *
 *  A soft-unpublished row deliberately keeps existing — its buyers keep the
 *  plan they paid for and the creator's ledger keeps its sales history — but it
 *  has come down, so it leaves every Explore surface with it: the grid, the
 *  featured card (which reads the catalog directly and would otherwise keep
 *  leading the page with a plan nobody can open) and the style counts beside
 *  the filters.
 *
 *  Exported because the test suite runs in node env and cannot render a page:
 *  `tests/soft-unpublish.test.ts` calls this rather than re-implementing the
 *  predicate and asserting its own copy. */
export function livePubs(pubs: PublishedItinerary[]): PublishedItinerary[] {
  return pubs.filter(p => !p.unpublishedAt)
}

/** Filter + sort state encoded in the hash query (F-22). Read at mount and on
 *  every real navigation. Filter edits write the query with `replaceState`,
 *  which fires no `hashchange`, so this never fights the user's typing — it
 *  only runs when something actually navigates. */
function filtersFromHash() {
  const p = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const d = p.get('dur')
  const s = p.get('sort')
  return {
    q: p.get('q') ?? '',
    style: p.get('style') ?? 'all',
    maxBudget: (p.get('max') ? Number(p.get('max')) : '') as number | '',
    duration: (d === 'short' || d === 'medium' || d === 'long' ? d : 'all') as 'all' | 'short' | 'medium' | 'long',
    sortKey: (s === 'budget-asc' || s === 'budget-desc' || s === 'duration' || s === 'newest' ? s : 'popular') as SortKey,
  }
}

export function ExplorePage({ onNavigate }: { onNavigate: (r: string) => void }) {
  // Slice subscriptions: Explore re-renders when the published catalog,
  // profiles, trips or the session change — not on every store commit.
  const published = usePublished()
  const users = useUsers()
  const trips = useTrips()
  const me = useSessionUserId()
  // #364: the catalog's own read state, so "the community has published nothing"
  // is never printed over a read that failed. See the empty branch below.
  const { sliceReads } = useDb()
  const pubsRead = sliceState(sliceReads, 'suggested itineraries')
  const retryCatalog = () => { void rereadPublicSlices() }
  const { saved, isSaved, toggleSaved } = useSavedPubs()
  // F-22: filters + sort live in the hash query (#/explore?q=goa&sort=budget-asc)
  // so they survive a refresh and can be shared; sortKey finally gets a control.
  const f0 = filtersFromHash()
  const [sortKey, setSortKey] = useState<SortKey>(f0.sortKey)
  const [q, setQ] = useState(f0.q)
  const [style, setStyle] = useState(f0.style)
  const [maxBudget, setMaxBudget] = useState<number | ''>(f0.maxBudget)
  const [duration, setDuration] = useState<'all' | 'short' | 'medium' | 'long'>(f0.duration)
  // A navigation that drops the query — clicking "Explore" while filtered, or
  // Back — lands on a clean URL, but `navigate` only sets `location.hash` and
  // this page is already mounted, so the filters would survive and the view
  // would disagree with the address bar and with whatever that URL is shared
  // to. Re-seed on a real hash change; `syncUrl`'s replaceState fires none, so
  // typing is untouched.
  useEffect(() => {
    const onHash = () => {
      const f = filtersFromHash()
      setQ(f.q); setStyle(f.style); setMaxBudget(f.maxBudget); setDuration(f.duration); setSortKey(f.sortKey)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // ♡ Saved — device-local favourites (localStorage), not part of the schema
  // (#395). Deliberately NOT synced into the URL, unlike every other filter on
  // this page: the hash is shareable, so a `savedOnly` in it would hand the next
  // person an address that reads "showing only what I have saved" — an empty
  // catalog on their device — when what they were sent was a catalogue. The
  // other filters describe the ITINERARIES (which anyone can see); this one
  // describes the READER, and that is the line the URL must not cross.
  const [savedOnly, setSavedOnly] = useState(false)
  // P4 pagination: show the first page; "Load more" widens the window. Reset
  // to the first page whenever the result set's shape changes (filter/sort
  // edits), but NOT when `published` updates live (realtime insert) — a new
  // row appearing shouldn't yank the user back to the top.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [q, style, maxBudget, duration, savedOnly, sortKey])

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
    let list = [...livePubs(published)]
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

  // Featured: the most-forked/viewed plan, independent of filters — it leads the
  // page with its credibility explained (§6.10), and only when that credibility
  // can be stated without printing a zero.
  const featured = useMemo(() => {
    const pool = livePubs(published).filter(p => p.copies >= 1 || p.views >= FEATURED_MIN_VIEWS)
    // Deterministic order: a tie on the evidence score must not depend on the
    // order rows arrived in (two live publications scored exactly 13).
    return [...pool].sort((a, b) => b.copies - a.copies || b.views - a.views || b.publishedAt - a.publishedAt)[0]
  }, [published])
  // Read the underlying trip from the trips slice (subscribed) so the featured
  // health score stays live without subscribing to the whole cache.
  const featuredTrip = featured ? trips.find(t => t.id === featured.tripId) : undefined
  const featuredHealth = featuredTrip ? computeHealth(featuredTrip).score : undefined

  // The grid must not re-offer the plan the featured card already leads with —
  // on a three-item shelf the duplicate was a third of the page. Only ever a
  // no-op when the featured pick is a card from OUTSIDE the active filters,
  // which is the normal case once any filter is on.
  const gridPubs = useMemo(
    () => (featured ? pubs.filter(p => p.id !== featured.id) : pubs),
    [pubs, featured],
  )
  // "outside your filters" is a claim, so only make it when it is true: with a
  // filter on, the featured pick is often the matching card itself (it was
  // labelled "outside your filters" while being the only adventure result).
  const featuredOutsideFilters = !!featured && !pubs.some(p => p.id === featured.id)

  const styleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of livePubs(published)) counts.set(p.travelStyle, (counts.get(p.travelStyle) ?? 0) + 1)
    return counts
  }, [published])

  function forkTrip(slug: string) {
    const pub = published.find(p => p.id === slug)
    if (!pub) { toast('That itinerary is no longer available.', 'err'); return }
    void forkPublication(pub, me, onNavigate, undefined, 'explore')
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
          <span className="editorial-kicker explore-hero-kicker">Discover · Trust · Fork</span>
          <h1>Explore itineraries</h1>
          <p className="explore-hero-sub">
            Real multi-day plans — real road time, real pacing, honest costs. Copy one and make it yours.
          </p>
          <div className="explore-hero-searchrow">
            <input className="input explore-hero-search" placeholder="Search a route, place or creator — try “Alleppey”…"
              aria-label="Search destination or creator" value={q} onChange={e => { setQ(e.target.value); syncUrl({ q: e.target.value }) }} />
            {q.trim() !== '' && (
              <button type="button" className="explore-hero-clear" aria-label="Clear search"
                onClick={() => { setQ(''); syncUrl({ q: '' }) }}><X size={14} aria-hidden /></button>
            )}
          </div>
        </div>
      </section>

      <div className="container" style={{ paddingTop: 22 }}>
        {/* "Fork" is the product's own word for copying a plan into your trips and
            the cards never explain it, so it is said once, here, before anyone
            meets the button that carries the name. */}
        <p className="small muted" style={{ margin: '0 0 12px', maxWidth: '72ch' }}>
          Fork any itinerary to copy it into your own trips — then change whatever you like.
          {/* Signed out, that button navigates to /auth — say so before the click,
              not in a toast that the redirect swallows. */}
          {!me && <> You’ll need a free account to fork trips.</>}
        </p>

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
            onClick={() => setSavedOnly(v => !v)}><InlineIcon icon={Heart} size={12} gap={4} fill={savedOnly ? 'currentColor' : 'none'} />Saved {saved.length > 0 && <span className="chip-count">{saved.length}</span>}</button>
        </div>

        {/* ---- Compact filter bar: budget / duration / sort ---- */}
        <div className="card glass-soft explore-filterbar" style={{ marginBottom: 22 }}>
          <div className="explore-filters">
            <Select value={duration} onChange={v => { setDuration(v as never); syncUrl({ dur: v }) }} aria-label="Duration"
              options={[
                { value: 'all', label: 'Any length' },
                { value: 'short', label: '≤3 days' },
                { value: 'medium', label: '4–6 days' },
                { value: 'long', label: '7+ days' },
              ]} />
            <Select value={maxBudget === '' ? '' : String(maxBudget)} onChange={v => { setMaxBudget(v === '' ? '' : Number(v)); syncUrl({ max: v }) }} aria-label="Max budget"
              options={[
                { value: '', label: 'Any budget' },
                { value: '10000', label: 'Under ₹10k' },
                { value: '20000', label: 'Under ₹20k' },
                { value: '35000', label: 'Under ₹35k' },
                { value: '60000', label: 'Under ₹60k' },
              ]} />
            <Select value={sortKey} onChange={v => { setSortKey(v as SortKey); syncUrl({ sort: v }) }} aria-label="Sort by"
              options={[
                { value: 'popular', label: 'Most popular' },
                { value: 'newest', label: 'Newest first' },
                { value: 'budget-asc', label: 'Budget: low → high' },
                { value: 'budget-desc', label: 'Budget: high → low' },
                { value: 'duration', label: 'Longest first' },
              ]} />
            {filtersActive && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setStyle('all'); setMaxBudget(''); setDuration('all'); setSavedOnly(false); syncUrl({ q: '', style: 'all', max: '', dur: 'all' }) }}><InlineIcon icon={X} size={13} gap={4} />Clear filters</button>
            )}
          </div>
        </div>

        {/* Screen-reader-only result count — filter changes reflow the grid
            silently otherwise (UI audit F-04).
            #395 — and it is a claim about the CATALOG, so it may only be made
            once the catalog was READ: "0 itineraries match" over a failed read
            is the same conflation as the empty copy below, in one line, and it
            is the one a screen-reader user would hear with no visible cue to
            contradict it. It announces the read's own state instead. */}
        <p className="sr-only" role="status">
          {pubsRead === 'ready'
            ? `${pubs.length} ${pubs.length === 1 ? 'itinerary matches' : 'itineraries match'}`
            : pubsRead === 'reading' ? 'Loading the catalog' : 'The catalog could not be loaded'}
        </p>

        {/* ---- Featured itinerary: credibility explained (§6.10) ----
            #395 — gated on the READ, not only on a featured plan existing. A
            failed re-read KEEPS the rows it already had (a dropped connection
            must not discard a catalog the reader was already looking at), so
            `featured` can be truthy while the grid below is saying it could not
            load the catalog — one card contradicting the sentence right under
            it. The read's state owns the whole surface until Retry settles it. */}
        {pubsRead === 'ready' && featured && (
          <div className="featured-card" key={featured.id}>
            <div className="featured-body">
              <span className="editorial-kicker featured-kicker"><InlineIcon icon={Star} size={12} gap={3} />Featured itinerary{featuredOutsideFilters && <> · outside your filters</>}</span>
              <h2><a className="featured-title-link" href={`#/pub/${featured.id}`}>{featured.title}</a></h2>
              <p className="featured-tagline">{featured.tagline}</p>
              <p className="featured-credibility">
                Why featured: {featured.copies >= 1
                  ? <><InlineIcon icon={GitFork} size={12} gap={2} style={{ marginLeft: 2 }} /> {featured.copies} fork{featured.copies === 1 ? '' : 's'} — the most-forked plan here</>
                  : <><InlineIcon icon={Eye} size={12} gap={2} style={{ marginLeft: 2 }} /> {featured.views} views</>}
                {featuredHealth !== undefined && <> · trip health {featuredHealth}/100</>} — by {userOf(users, featured.creatorId)?.profile.name ?? 'a YatraFlow traveller'}{userOf(users, featured.creatorId)?.profile.isCreator && <InlineIcon icon={Sparkles} size={12} gap={0} vAlign="-1px" style={{ marginLeft: 2 }} />}.
              </p>
              <div className="featured-meta">
                <span><MetaIcon icon={ Calendar } tone="time" />{featured.durationDays} days</span>
                <span><MetaIcon icon={ Wallet } tone="money" />~{formatInr(featured.estimatedBudgetPerPersonInr)}/person</span>
                <span><MetaIcon icon={ MapPin } tone="place" />{featured.routeSummary.length} places · {featured.routeSummary[0]} → {featured.routeSummary[featured.routeSummary.length - 1]}</span>
              </div>
              <div className="featured-actions">
                <button className="btn fork-btn" onClick={() => forkTrip(featured.id)}><InlineIcon icon={GitFork} size={14} gap={4} />{me ? 'Fork this trip' : 'Log in to fork'}</button>
                <button className="btn save-btn" onClick={() => toggleHeart(featured.id)} aria-pressed={isSaved(featured.id)}>
                  <InlineIcon icon={Heart} size={13} gap={4} fill={isSaved(featured.id) ? 'currentColor' : 'none'} />
                  {isSaved(featured.id) ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {pubsRead !== 'ready' ? (
          /* #364: a failed catalog read used to render "just getting started" —
             copy that tells a visitor the community is empty when the truth is
             that we could not read it. The failed branch is checked FIRST, and
             the retry re-issues the read rather than re-rendering nothing. */
          pubsRead === 'reading' ? (
            <div className="loading-block"><div className="spinner" />Loading the catalog…</div>
          ) : (
            <EmptyState icon={<Compass size={38} aria-hidden />} title={emptyCopyFor(pubsRead, 'catalog', retryCatalog).title}
              body={emptyCopyFor(pubsRead, 'catalog', retryCatalog).body}
              action={<button className="btn btn-primary" onClick={retryCatalog}>Try again</button>} />
          )
        ) : pubs.length === 0 ? (
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
          <>
            {/* Only when something is left after the featured pick — otherwise
                the featured card was the whole result and an empty grid would
                just add a gap under it. */}
            {gridPubs.length > 0 && (
              <div className="explore-grid">
                {gridPubs.slice(0, visibleCount).map((p, i) => (
                  <PubCard key={p.id} pub={p} creator={userOf(users, p.creatorId)} saved={isSaved(p.id)}
                    onFork={() => forkTrip(p.id)} onToggleSave={() => toggleHeart(p.id)} enterIndex={i}
                    needsLogin={!me} />
                ))}
              </div>
            )}
            {gridPubs.length > visibleCount && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 22px' }}>
                <button className="btn btn-outline" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                  aria-label={`Load more itineraries — ${gridPubs.length - visibleCount} remaining`}>
                  Load more · {gridPubs.length - visibleCount} more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function userOf(users: User[], id: string): User | undefined {
  return users.find(u => u.id === id)
}