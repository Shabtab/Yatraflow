// ============ Public creator page — #/creator/:id ============
// The shareable destination for the creator chips on Explore cards and the
// public itinerary pages: the v2 storefront — hero, featured route, route
// library — over real fields alone. Works logged-out (profiles and publications
// are public app-wide). The presentational parts live in the Store* components;
// this page keeps every data read, every state decision and the shared card
// behaviour the guards pin.
import { useMemo } from 'react'
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
import { StoreHero, dayStamp } from '../components/creator/StoreHero'
import { StoreLibrary } from '../components/creator/StoreLibrary'
import { StoreBand } from '../components/creator/StoreBand'
import { StateBlock } from '../components/page/StateBlock'

export function CreatorPage({ creatorId, onNavigate }: { creatorId: string; onNavigate: (r: string) => void }) {
  const me = useSessionUserId()
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
  const featured = useMemo(() => leadRoute(pubs, 3), [pubs])
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
  const featuredKicker = featured ? `Most forked of ${pubs.length} routes` : undefined

  return (
    <div className="page-enter cr-store-page">
      <StoreHero
        creator={creator}
        heading={<h1>{creator.profile.name}</h1>}
        cover={lead}
        publishingSince={since}
        shareUrl={shareLink}
        figures={{ liveRoutes: figures.liveRoutes, views: figures.views, forks: figures.forks }}
        routeCount={pubs.length}
        showBrowse={pubs.length > 0}
        tabs={sections?.coverTabs === true && sections.pubsView !== 'empty'}
      />

      {featured && (
        <section className="container cr-store-featured" aria-label="Featured route">
          <FeaturedCard
            pub={featured}
            creator={creator}
            kicker={featuredKicker}
            saved={isSaved(featured.id)}
            needsLogin={!me}
            onFork={() => { void forkPublication(featured, me, onNavigate, undefined, 'creator') }}
            onToggleSave={() => toggleSaved(featured.id)}
          />
        </section>
      )}

      {featured && featured.bestSeason && <p className="cr-store-season">{featured.bestSeason}</p>}
      {featured && (
        <p className="cr-store-updated">
          Updated {dayStamp(featured.refreshedAt ?? featured.publishedAt)}
        </p>
      )}

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

      {!me && <StoreBand />}
    </div>
  )
}
