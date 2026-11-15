// ============ Public creator page — #/creator/:id ============
// The shareable destination for the creator chips on Explore cards and the
// public itinerary pages: the v2 storefront — hero, featured route, route
// library — over real fields alone. Works logged-out (profiles and publications
// are public app-wide). The presentational parts live in the Store* components;
// this page keeps every data read, every state decision and the shared card
// behaviour the guards pin.
import { countNoun } from '../lib/creatorCopy'
import { useCreatorFollows } from '../hooks/useCreatorFollows'
import { creatorFollowerCountLabel, type CreatorFollowApi } from '../lib/creatorFollows'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'
import { useSessionUserId, usePublished, userById, useDb, rereadPublicSlices } from '../store/store'
import { forkPublication } from '../lib/forkPub'
import { currentCreatorShareUrl } from '../lib/shareUrl'
import { useSavedPubs } from '../lib/savedPubs'
import { sliceState, emptyCopyFor, rowsView } from '../lib/readState'
import { livePubs } from '../lib/livePubs'
import {
  storefrontFigures, publishingSince, leadRoute, storefrontSections,
} from '../lib/creatorStorefront'
import { FeaturedCard } from '../components/explore/FeaturedCard'
import { StoreHero } from '../components/creator/StoreHero'
import { StoreRouteStamp } from '../components/creator/StoreRouteStamp'
import { creatorPick, plannedKilometres } from '../lib/creatorFacts'
import { CrStatTile } from '../components/creator/CrStatTile'
import { StoreLibrary } from '../components/creator/StoreLibrary'
import { StoreBand } from '../components/creator/StoreBand'
import { StorePosts } from '../components/creator/StorePosts'
import { useCreatorPosts } from '../hooks/useCreatorPosts'
import { creatorPostRef, creatorPostsApi, type CreatorPostsApi } from '../lib/creatorPosts'
import { StateBlock } from '../components/page/StateBlock'
import { OwnerLayer } from '../components/creator/OwnerLayer'
import {
  fetchCreatorPageViews, fetchCreatorShareSources, bumpCreatorPageView, creatorPageSource, failedOwnerRead,
  type OwnerRead, type OwnerReads,
} from '../lib/creatorOwnerReads'
import { fetchCreatorFunnel, fetchCreatorSales } from '../lib/unlock'
import { deriveActualSales } from '../lib/earnings'

function useOwnerRows<T>(identity: string, enabled: boolean, attempt: number, load: (signal: AbortSignal) => Promise<T[]>): OwnerRead<T> {
  const [settled, setSettled] = useState<{ identity: string; attempt: number; load: typeof load; read: OwnerRead<T> } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const ac = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new DOMException('The owner read timed out', 'TimeoutError')
        ac.abort(error)
        reject(error)
      }, 10_000)
    })
    void Promise.race([load(ac.signal), timeout]).then(data => {
      if (alive) setSettled({ identity, attempt, load, read: { kind: 'ready', data, at: Date.now() } })
    }).catch(() => {
      if (alive) setSettled(previous => {
        const kept = previous?.identity === identity ? previous.read : null
        const read = failedOwnerRead(kept)
        return { identity, attempt, load, read }
      })
    }).finally(() => clearTimeout(timer))
    return () => { alive = false; clearTimeout(timer); ac.abort() }
  }, [identity, enabled, attempt, load])
  if (settled?.identity !== identity) return { kind: 'reading', data: null, at: null }
  if (settled.attempt !== attempt || settled.load !== load) return { kind: 'reading', data: settled.read.data, at: settled.read.at }
  return settled.read
}

export function CreatorPage({ creatorId, onNavigate, ownerReads, onOwnerRetry, onPageVisit = bumpCreatorPageView, followsApi, postsApi = creatorPostsApi }: {
  creatorId: string
  followsApi?: CreatorFollowApi
  postsApi?: CreatorPostsApi
  onNavigate: (r: string) => void
  ownerReads?: OwnerReads
  onOwnerRetry?: () => void
  onPageVisit?: typeof bumpCreatorPageView
}) {
  const me = useSessionUserId()
  const follows = useCreatorFollows(creatorId, me, followsApi)
  const published = usePublished()
  const { sliceReads } = useDb()
  const { isSaved, toggleSaved } = useSavedPubs()

  // #364: a failed profiles read used to land here as "Creator not found" —
  // the same friendly copy a wrong link gets. Three states, and the failure is
  // checked FIRST so it can never be mistaken for an absent creator.
  const profileRead = sliceState(sliceReads, 'profiles')
  const pubsRead = sliceState(sliceReads, 'suggested itineraries')
  // Retry re-issues the read; it does not merely re-render the same empty array.
  const retry = () => { void rereadPublicSlices() }

  const creator = userById(creatorId)
  // #800: retained crew identity and public creator availability are different
  // things. A disabled account keeps its card — name and avatar for crews it
  // already belongs to — but its public creator route must not render. The check
  // is the derived `creatorAvailable` signal, not the creator badge, so a former
  // creator with live publications stays listable once re-enabled. Without this,
  // the page rendered for any identity that merely existed.
  const creatorUnavailable = creator !== undefined && !creator.profile.creatorAvailable
  // #585 — this is the creator's PUBLIC catalog, so #350's vocabulary applies:
  // a plan that came down leaves the page. The creator's own hub keeps the row
  // on purpose (its sales history and funnel live there) — the two surfaces
  // disagree deliberately. The stat tiles below read this same filtered list,
  // so they claim only what a visitor can actually see; a buyer who kept the
  // plan reaches it through their purchases shelf, which gates nothing away.
  const pubs = useMemo(
    () => livePubs(published.filter(p => p.creatorId === creatorId)).sort((a, b) => b.publishedAt - a.publishedAt),
    [published, creatorId],
  )
  // One decision point for the figures, the "publishing since" chip, the
  // featured pick and the section layout (the P2 read model).
  const figures = useMemo(() => storefrontFigures(pubs, pubsRead), [pubs, pubsRead])
  const since = useMemo(() => publishingSince(pubs), [pubs])
  const pick = creatorPick(pubs, creatorId, creator?.profile.featuredPubId)
  const featured = pick ?? leadRoute(pubs, 3)
  const km = plannedKilometres(pubs)
  const sections = useMemo(
    // The read model takes the public shape. When the viewer IS the creator the
    // cached row is the account's own private row, so the page hands over a
    // public view of it instead of widening the model's input.
    () => creator
      ? storefrontSections({ user: { id: creator.id, kind: 'public', profile: creator.profile }, pubs, read: pubsRead })
      : undefined,
    [creator, pubs, pubsRead],
  )
  // #704 / R23: a failed refresh keeps the rows already on screen and says so.
  // Only a failed read with nothing retained hides the list.
  const pubsView = rowsView(pubsRead, pubs.length)
  const isOwner = me === creatorId
  const [previewCreator, setPreviewCreator] = useState<string | null>(null)
  const [ownerAttempt, setOwnerAttempt] = useState(0)
  const [postAttempt, setPostAttempt] = useState(0)
  // G8: a disabled or missing creator gets no post read. The database hides their posts too.
  const posts = useCreatorPosts(creator && !creatorUnavailable ? creatorId : null, postsApi, postAttempt)
  const [ownerNow, setOwnerNow] = useState(() => Date.now())
  const ownerEnabled = isOwner && Boolean(creator) && !creatorUnavailable && !ownerReads
  const ownerIdentity = `${me ?? ''}:${creatorId}`
  const allOwnerPubs = useMemo(() => published.filter(pub => pub.creatorId === creatorId), [published, creatorId])
  const loadSales = useCallback(async (signal: AbortSignal) =>
    deriveActualSales(await fetchCreatorSales({ signal }), allOwnerPubs).rows, [allOwnerPubs])
  const loadFunnel = useCallback((signal: AbortSignal) => fetchCreatorFunnel({ days: 30, signal }), [])
  const loadSources = useCallback((signal: AbortSignal) => fetchCreatorShareSources(30, { signal }), [])
  const loadVisits = useCallback((signal: AbortSignal) => fetchCreatorPageViews(30, { signal }), [])
  const sales = useOwnerRows(ownerIdentity, ownerEnabled, ownerAttempt, loadSales)
  const funnel = useOwnerRows(ownerIdentity, ownerEnabled, ownerAttempt, loadFunnel)
  const sources = useOwnerRows(ownerIdentity, ownerEnabled, ownerAttempt, loadSources)
  const visits = useOwnerRows(ownerIdentity, ownerEnabled, ownerAttempt, loadVisits)
  useEffect(() => {
    if (!creator || creatorUnavailable || profileRead !== 'ready' || isOwner) return
    void onPageVisit(creatorId, creatorPageSource(window.location.search), me, creatorPostRef(window.location.search))
  }, [creator, creatorUnavailable, profileRead, isOwner, creatorId, me, onPageVisit])

  if (!creator || creatorUnavailable) {
    // A broken read is not an absent creator. The distinction is the whole bug.
    // A disabled creator is an absent creator too, and gets the same not-found
    // copy rather than a page that names them.
    if (profileRead !== 'ready') {
      const copy = emptyCopyFor(profileRead, 'this creator', retry)
      return (
        <div className="container page-enter">
          <StateBlock kind={profileRead === 'reading' ? 'loading' : 'failed'}
            icon={<Link2 size={38} aria-hidden />}
            title={copy.title} body={copy.body}
            actions={profileRead === 'reading' ? undefined
              : <button className="btn btn-primary" onClick={retry}>Try again</button>} />
        </div>
      )
    }
    return (
      <div className="container page-enter">
        <StateBlock kind="empty" icon={<Link2 size={38} aria-hidden />} title="Creator not found"
          body="This page may have been removed, or the link is wrong."
          actions={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Back to Explore</button>} />
      </div>
    )
  }

  // #362: the copied link is the SERVER path (`/c/<id>`), which carries the
  // creator's own card to a link preview. The hash form never leaves the
  // browser, so sharing it unfurled as the app shell.
  const shareLink = currentCreatorShareUrl(creatorId)
  const lead = featured ?? pubs[0]
  const featuredKicker = pick ? `Featured by ${creator.profile.name}` : featured ? `Most forked of ${countNoun(pubs.length, 'route')}` : undefined

  return (
    <div className="page-enter cr-store-page">
      <StoreHero
        creator={creator}
        heading={<h1>{creator.profile.name}</h1>}
        cover={lead}
        publishingSince={since}
        shareUrl={shareLink}
        followerCount={<span className={follows.count.kind === 'failed' ? 'cr-tile__value--none' : undefined}>{creatorFollowerCountLabel(follows.count)}</span>}
        follow={!isOwner && creator.profile.isCreator ? <div className="cr-store-follow">
          <button type="button" className="btn btn-outline cr-store-follow-button"
            disabled={follows.busy || follows.following.kind === 'reading'}
            aria-pressed={follows.following.kind === 'ready' ? follows.following.value : undefined}
            aria-label={follows.following.kind === 'failed' ? 'Retry follow status' : undefined}
            onClick={() => { if (!me) onNavigate('/auth'); else if (follows.following.kind === 'failed') follows.refresh(); else void follows.toggle() }}>
            {follows.busy ? 'Saving…' : follows.following.kind === 'failed' ? 'Retry' : follows.following.kind === 'reading' ? 'Loading…' : follows.following.value ? 'Following' : 'Follow'}
          </button>
          {follows.following.kind === 'failed' && <span role="status">Follow status: Unavailable</span>}
          {follows.error && <span role="status">{follows.error}</span>}
        </div> : undefined}
        figures={{ liveRoutes: figures.liveRoutes, views: figures.views, forks: figures.forks }}
        routeCount={pubs.length}
        showBrowse={pubs.length > 0}
        tabs={sections?.coverTabs === true && sections.pubsView !== 'empty'}
      />

      {follows.count.kind === 'failed' && <p className="container cr-store-follow-retry" role="status">
        YatraFlow followers: Unavailable. <button type="button" className="btn btn-ghost btn-sm" onClick={follows.refresh}>Retry follower count</button>
      </p>}
      {featured && (
        <section className="container cr-store-featured" aria-label="Featured route">
          <FeaturedCard
            pub={featured}
            creator={creator}
            kicker={featuredKicker}
            reason={pick ? `Selected by ${creator.profile.name}` : undefined}
            saved={isSaved(featured.id)}
            needsLogin={!me}
            onFork={() => { void forkPublication(featured, me, onNavigate, undefined, 'creator') }}
            onToggleSave={() => toggleSaved(featured.id)}
          />
        </section>
      )}

      {featured && featured.bestSeason && <p className="cr-store-season">{featured.bestSeason}</p>}
      {featured && (
        <StoreRouteStamp pub={featured} />
      )}

      {pubsRead === 'failed' ? <p className="cr-store-facts" role="status">Route facts: Unavailable</p>
        : pubsRead === 'ready' && km !== undefined && <div className="container cr-store-facts">
            <CrStatTile value={km.toLocaleString('en-IN')} label="Km planned" note="Live routes with distance data." />
          </div>}
      {profileRead === 'failed' ? <p className="cr-store-planning" role="status">Planning notes: Unavailable</p>
        : profileRead === 'ready' && !!creator.profile.planningNotes?.length && <section className="container cr-store-planning" aria-label="Planning notes">
            <h2>How {creator.profile.name} plans</h2>
            <ul>{creator.profile.planningNotes.map((note, index) => <li key={index}>{note}</li>)}</ul>
          </section>}

      <StoreLibrary
        name={creator.profile.name}
        pubs={pubs}
        view={pubsView}
        read={pubsRead}
        retry={retry}
        creator={creator}
        savedIds={isSaved}
        needsLogin={!me}
        onFork={pub => { void forkPublication(pub, me, onNavigate, undefined, 'creator') }}
        onToggleSave={toggleSaved}
        onNavigate={onNavigate}
        emptyIsNotCreator={!creator.profile.isCreator}
      />

      <StorePosts creatorName={creator.profile.name} posts={posts} pubs={pubs} isOwner={isOwner}
        retry={() => setPostAttempt(n => n + 1)} />

      {!me && <StoreBand />}
      {isOwner && (previewCreator === ownerIdentity
        ? <div className="container cr-own-preview">
            <button className="btn btn-secondary btn-sm" onClick={() => setPreviewCreator(null)}>Back to your view</button>
          </div>
        : <OwnerLayer creator={{ id: creator.id, kind: 'public', profile: creator.profile }} pubs={pubs}
            pubsRead={pubsRead} retryPubs={retry} shareLink={shareLink} now={ownerNow}
            reads={ownerReads ?? { sales, funnel, sources, visits }}
            retry={() => {
              setOwnerNow(Date.now())
              if (onOwnerRetry) onOwnerRetry()
              else setOwnerAttempt(attempt => attempt + 1)
            }}
            onPreview={() => setPreviewCreator(ownerIdentity)} />)}
    </div>
  )
}
