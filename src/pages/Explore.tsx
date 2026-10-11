// ============ Explore public itineraries — discover, trust and fork (CTI §6.10) ============
import { useEffect, useMemo, useState } from 'react'
import { currentQuery, onRouteChange, replaceRoute } from '../lib/router'
import { Compass, Heart, Lock, Search, TriangleAlert } from 'lucide-react'
import { usePublished, useUsers, useTrips, useSessionUserId, useDb, rereadPublicSlices } from '../store/store'
import type { User } from '../data/types'
import { computeHealth } from '../lib/engine'
import { useSavedPubs } from '../lib/savedPubs'
import { sliceState, emptyCopyFor } from '../lib/readState'
import { forkPublication } from '../lib/forkPub'
import { cap } from '../lib/labels'
import { scrollBehavior } from '../lib/motion'
import { toast } from '../components/ui'
import { TripArtSprite } from '../components/trips/TripArt'
import { ExploreHero } from '../components/explore/ExploreHero'
import { ExploreFilterBar, type StyleOption } from '../components/explore/ExploreFilterBar'
import { ExploreCard } from '../components/explore/ExploreCard'
import { FeaturedCard } from '../components/explore/FeaturedCard'
import { ExploreStateBlock } from '../components/explore/ExploreStateBlock'
import { PlacesPanel } from '../components/explore/PlacesPanel'
import { CreatorsPanel } from '../components/explore/CreatorsPanel'
import { SharePanel } from '../components/explore/SharePanel'
import { livePubs } from '../lib/livePubs'
import { matchesQuery, pickFeatured, placeTiles, creatorList, savedEmptyKind, type SavedEmptyKind } from '../lib/explorePage'

type SortKey = 'popular' | 'newest' | 'budget-asc' | 'budget-desc' | 'duration'
const STYLES = ['relaxed', 'balanced', 'packed', 'adventure', 'luxury', 'budget', 'family', 'spiritual', 'food-focused', 'creator'] as const
/** P4: the grid renders one page at a time; "Load more" grows the window. */
const PAGE_SIZE = 12

// #350 — the gallery's pool lives in lib/livePubs.ts so every public catalog
// surface shares one predicate copy. Re-exported for the test suite, which
// pins the filter at its definition.
export { livePubs }


/** Filter + sort state encoded in the route's query (F-22). Read at mount and
 *  on every real navigation. Filter edits write the query with `replaceRoute`,
 *  which notifies no route change, so this never fights the user's typing —
 *  it only runs when something actually navigates. */
function filtersFromRoute() {
  const p = currentQuery()
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
  // F-22: filters + sort live in the route's query (/explore?q=goa&sort=budget-asc)
  // so they survive a refresh and can be shared; sortKey finally gets a control.
  const f0 = filtersFromRoute()
  const [sortKey, setSortKey] = useState<SortKey>(f0.sortKey)
  const [q, setQ] = useState(f0.q)
  const [style, setStyle] = useState(f0.style)
  const [maxBudget, setMaxBudget] = useState<number | ''>(f0.maxBudget)
  const [duration, setDuration] = useState<'all' | 'short' | 'medium' | 'long'>(f0.duration)
  // A navigation that drops the query — clicking "Explore" while filtered, or
  // Back — lands on a clean URL, but this page is already mounted, so the
  // filters would survive and the view would disagree with the address bar and
  // with whatever that URL is shared to. Re-seed on a real route change;
  // `syncUrl`'s replaceState notifies none, so typing is untouched.
  useEffect(() => {
    return onRouteChange(() => {
      const f = filtersFromRoute()
      setQ(f.q); setStyle(f.style); setMaxBudget(f.maxBudget); setDuration(f.duration); setSortKey(f.sortKey)
    })
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
    replaceRoute(`/explore${qs ? '?' + qs : ''}`)
  }

  const popularity = (p: { views: number; copies: number }) => p.views + p.copies * 5

  const pubs = useMemo(() => {
    let list = [...livePubs(published)]
    list = list.filter(p => matchesQuery(p, q, userOf(users, p.creatorId)?.profile.name))
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
  // can be stated without printing a zero. The rule lives in lib/explorePage.ts.
  const featured = useMemo(() => pickFeatured(published), [published])
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
  const liveCount = useMemo(() => livePubs(published).length, [published])
  const savedLiveCount = useMemo(() => livePubs(published).filter(p => saved.includes(p.id)).length, [published, saved])
  const places = useMemo(() => placeTiles(published, users), [published, users])
  const creators = useMemo(() => creatorList(published, users), [published, users])
  // The hero counts the whole catalog, not the few tiles the side panels show.
  const heroStats = useMemo(() => [
    { label: 'itineraries', value: liveCount },
    { label: 'creators', value: creatorList(published, users, Infinity).length },
    { label: 'places', value: placeTiles(published, users, Infinity).length },
    { label: 'forks', value: livePubs(published).reduce((sum, p) => sum + p.copies, 0) },
  ], [published, users, liveCount])

  /** The hero button: bring the catalog to the top and hand it focus. */
  function jumpToResults() {
    const target = document.getElementById('explore-results')
    target?.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
    target?.focus({ preventScroll: true })
  }

  function forkTrip(slug: string) {
    const pub = published.find(p => p.id === slug)
    if (!pub) { toast('That itinerary is no longer available.', 'err'); return }
    void forkPublication(pub, me, onNavigate, undefined, 'explore')
  }

  function toggleHeart(id: string) {
    const nowSaved = toggleSaved(id)
    toast(nowSaved ? 'Saved to this browser.' : 'Removed from saved itineraries.')
  }

  function clearFilters() {
    setQ(''); setStyle('all'); setMaxBudget(''); setDuration('all'); setSavedOnly(false)
    syncUrl({ q: '', style: 'all', max: '', dur: 'all' })
  }

  /** A place tile searches that place and clears every other filter, so the
   *  list starts from the whole catalog. */
  function searchPlace(name: string) {
    setQ(name); setStyle('all'); setMaxBudget(''); setDuration('all'); setSavedOnly(false)
    syncUrl({ q: name, style: 'all', max: '', dur: 'all' })
    document.getElementById('explore-results')?.scrollIntoView({ block: 'start' })
  }

  const stylesWithCounts = STYLES.filter(s => (styleCounts.get(s) ?? 0) > 0)
  const styleOptions: StyleOption[] = stylesWithCounts.map(s => ({ value: s, label: cap(s), count: styleCounts.get(s) ?? 0 }))
  const filtersActive = Boolean(q.trim()) || style !== 'all' || maxBudget !== '' || duration !== 'all' || savedOnly
  const emptyKind = savedEmptyKind({
    pubsCount: pubs.length, filtersActive, savedOnly, savedCount: savedLiveCount, signedIn: Boolean(me),
  })

  // A new key remounts the grid, so its cards run their staggered entrance again
  // each time a filter, the search or the sort changes what the grid holds.
  const gridKey = [q, style, maxBudget, duration, sortKey, savedOnly].join('|')

  return (
    <div className="container ex-page">
      <TripArtSprite />
      <ExploreHero stats={heroStats} onExplore={jumpToResults} />

      <div className="ex-layout">
        <div className="ex-main" id="explore-results" tabIndex={-1}>
          <div className="ex-head">
            <h2 className="ex-section-title" id="explore-results-title">Itineraries</h2>
            {pubsRead === 'ready' && pubs.length > 0 && <p className="ex-result-count">Showing {pubs.length} of {liveCount}</p>}
          </div>

          {/* ---- Filter bar: travel-style chips, Saved, and the three selects ---- */}
          <ExploreFilterBar
            query={q}
            onQueryChange={value => { setQ(value); syncUrl({ q: value }) }}
            styles={styleOptions}
            style={style}
            onAllStyles={() => { setStyle('all'); syncUrl({ style: 'all' }) }}
            onToggleStyle={s => { setStyle(style === s ? 'all' : s); syncUrl({ style: style === s ? 'all' : s }) }}
            savedOnly={savedOnly}
            savedCount={savedLiveCount}
            onToggleSaved={() => setSavedOnly(v => !v)}
            duration={duration}
            onDuration={v => { setDuration(v as never); syncUrl({ dur: v }) }}
            maxBudget={maxBudget === '' ? '' : String(maxBudget)}
            onBudget={v => { setMaxBudget(v === '' ? '' : Number(v)); syncUrl({ max: v }) }}
            sortKey={sortKey}
            onSort={v => { setSortKey(v as SortKey); syncUrl({ sort: v }) }}
            filtersActive={filtersActive}
            onClear={clearFilters}
          />

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

          {/* "Fork" is the product's own word for copying a plan into your trips and
              the cards never explain it, so it is said once, here, before anyone
              meets the button that carries the name. */}
          <section className="ex-howto" aria-labelledby="explore-how-fork">
            <h3 id="explore-how-fork">How forking works</h3>
            <ol>
              <li><span><b>Pick</b><span className="ex-howto-more"> a plan</span></span></li>
              <li><span><b>Fork</b><span className="ex-howto-more"> it into your trips</span></span></li>
              <li><span><b>Change</b><span className="ex-howto-more"> days, stays and stops</span></span></li>
            </ol>
            <p className="ex-fork-note">
              <Lock size={15} aria-hidden />
              <span>
                Fork any itinerary to copy it into your own trips — then change whatever you like.
                {/* Signed out, that button navigates to /auth — say so before the click,
                    not in a toast that the redirect swallows. */}
                {!me && <> You’ll need a free account to fork trips.</>}
              </span>
            </p>
          </section>

          {/* ---- Featured itinerary: credibility explained (§6.10) ----
              #395 — gated on the READ, not only on a featured plan existing. A
              failed re-read KEEPS the rows it already had (a dropped connection
              must not discard a catalog the reader was already looking at), so
              `featured` can be truthy while the grid below is saying it could not
              load the catalog — one card contradicting the sentence right under
              it. The read's state owns the whole surface until Retry settles it. */}
          {pubsRead === 'ready' && featured && (
            <FeaturedCard
              key={featured.id}
              pub={featured}
              creator={userOf(users, featured.creatorId)}
              kicker={<>Featured itinerary{featuredOutsideFilters && <> · outside your filters</>}</>}
              healthScore={featuredHealth}
              saved={isSaved(featured.id)}
              needsLogin={!me}
              onFork={() => forkTrip(featured.id)}
              onToggleSave={() => toggleHeart(featured.id)}
            />
          )}

          {pubsRead !== 'ready' ? (
            /* #364: a failed catalog read used to render "just getting started" —
               copy that tells a visitor the community is empty when the truth is
               that we could not read it. The failed branch is checked FIRST, and
               the retry re-issues the read rather than re-rendering nothing. */
            pubsRead === 'reading' ? (
              <ExploreStateBlock icon={<span className="spinner" aria-hidden="true" />} title="Loading the catalog…" />
            ) : (
              <ExploreStateBlock
                icon={<TriangleAlert size={36} aria-hidden />}
                title={emptyCopyFor(pubsRead, 'catalog', retryCatalog).title}
                body={emptyCopyFor(pubsRead, 'catalog', retryCatalog).body}
                actions={<button className="btn btn-secondary" type="button" onClick={retryCatalog}>Try again</button>}
              />
            )
          ) : pubs.length === 0 ? (
            <ExploreEmpty kind={emptyKind} onClear={clearFilters} onNavigate={onNavigate} />
          ) : (
            <>
              {/* Only when something is left after the featured pick — otherwise
                  the featured card was the whole result and an empty grid would
                  just add a gap under it. */}
              {gridPubs.length > 0 && (
                <div className="ex-grid" key={gridKey}>
                  {gridPubs.slice(0, visibleCount).map((p, index) => (
                    <ExploreCard key={p.id} pub={p} creator={userOf(users, p.creatorId)} saved={isSaved(p.id)}
                      enterIndex={index % PAGE_SIZE}
                      onFork={() => forkTrip(p.id)} onToggleSave={() => toggleHeart(p.id)} needsLogin={!me} />
                  ))}
                </div>
              )}
              {gridPubs.length > visibleCount && (
                <div className="ex-more ex-enter">
                  <button className="btn btn-secondary" type="button" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                    aria-label={`Load more itineraries — ${gridPubs.length - visibleCount} remaining`}>
                    Load more · {gridPubs.length - visibleCount} more
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="ex-aside">
          {pubsRead === 'ready' && <PlacesPanel tiles={places} onPick={searchPlace} />}
          {pubsRead === 'ready' && <CreatorsPanel rows={creators} users={users} />}
          <SharePanel />
        </div>
      </div>
    </div>
  )
}

/** The grid's empty copy. Each kind names one cause (see savedEmptyKind). */
function ExploreEmpty({ kind, onClear, onNavigate }: {
  kind: SavedEmptyKind
  onClear: () => void
  onNavigate: (r: string) => void
}) {
  const clearButton = <button className="btn btn-secondary" type="button" onClick={onClear}>Clear filters</button>
  if (kind === 'no-saved') {
    return (
      <ExploreStateBlock icon={<Heart size={36} aria-hidden />} title="You haven’t saved any itineraries yet"
        body="Tap the heart on a plan to keep it here, ready to fork." actions={clearButton} />
    )
  }
  if (kind === 'no-match') {
    return (
      <ExploreStateBlock icon={<Search size={36} aria-hidden />} title="Nothing matches those filters"
        body="Try widening the budget or clearing a filter." actions={clearButton} />
    )
  }
  if (kind === 'no-catalog-signed-in') {
    return (
      <ExploreStateBlock icon={<Compass size={36} aria-hidden />} title="No itineraries published yet"
        body="Publish one of your trips from its Share tab and it will appear here." />
    )
  }
  if (kind === 'no-catalog-signed-out') {
    return (
      <ExploreStateBlock icon={<Compass size={36} aria-hidden />} title="The community catalog is just getting started"
        body="Sign in to fork community itineraries into your own trips. Or load the demo from My trips to look around first."
        actions={(
          <>
            <button className="btn btn-primary" type="button" onClick={() => onNavigate('/auth?mode=signup')}>Sign up free</button>
            <button className="btn btn-secondary" type="button" onClick={() => onNavigate('/auth')}>Log in</button>
          </>
        )} />
    )
  }
  return null
}

function userOf(users: User[], id: string): User | undefined {
  return users.find(u => u.id === id)
}
