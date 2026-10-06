// ============ Public creator page — #/creator/:id ============
// The shareable destination for the creator chips on Explore cards and the
// public itinerary pages: bio + links + every itinerary this creator has
// published. Works logged-out (profiles and publications are public app-wide).
import { useMemo } from 'react'
import { InlineIcon } from '../components/icons'
import { Camera, Compass, Eye, GitFork, Link2, MapPin, Sparkles, TvMinimalPlay } from 'lucide-react'
import { useSessionUserId, usePublished, userById, useDb, rereadPublicSlices } from '../store/store'
import { forkPublication } from '../lib/forkPub'
import { currentCreatorShareUrl } from '../lib/shareUrl'
import { openExternal } from '../lib/native'
import { useSavedPubs } from '../lib/savedPubs'
import { Avatar, CopyButton, EmptyState } from '../components/ui'
import { PubCard } from '../components/PubCard'
import { sliceState, emptyCopyFor, figureOrUnavailable } from '../lib/readState'
import { livePubs } from '../lib/livePubs'

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
  const totalViews = pubs.reduce((s, p) => s + p.views, 0)
  const totalForks = pubs.reduce((s, p) => s + p.copies, 0)

  if (!creator) {
    // A broken read is not an absent creator. The distinction is the whole bug.
    if (profileRead !== 'ready') {
      const copy = emptyCopyFor(profileRead, 'this creator', retry)
      return (
        <div className="container">
          {profileRead === 'reading' ? (
            <div className="loading-block"><div className="spinner" />{copy.title}</div>
          ) : (
            <EmptyState icon={<Link2 size={38} aria-hidden />} title={copy.title} body={copy.body}
              action={<button className="btn btn-primary" onClick={retry}>Try again</button>} />
          )}
        </div>
      )
    }
    return (
      <div className="container">
        <EmptyState icon={<Link2 size={38} aria-hidden />} title="Creator not found"
          body="This page may have been removed, or the link is wrong."
          action={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Back to Explore</button>} />
      </div>
    )
  }

  const links: { key: 'youtube' | 'instagram'; href: string; label: string; Icon: typeof Camera }[] = []
  if (creator.profile.socialLinks?.youtube) links.push({ key: 'youtube', href: creator.profile.socialLinks.youtube, label: `${creator.profile.name} on YouTube`, Icon: TvMinimalPlay })
  if (creator.profile.socialLinks?.instagram) links.push({ key: 'instagram', href: creator.profile.socialLinks.instagram, label: `${creator.profile.name} on Instagram`, Icon: Camera })
  // #362: the copied link is the SERVER path (`/c/<id>`), which carries the
  // creator's own card to a link preview. The hash form never leaves the
  // browser, so sharing it unfurled as the app shell.
  const shareLink = currentCreatorShareUrl(creatorId)

  return (
    <div>
      {/* ---- Creator hero: identity, trust, share ---- */}
      <section className="creator-hero">
        <div className="container creator-hero-inner">
          <Avatar user={creator} size="lg" />
          <div className="creator-hero-id">
            <h1>
              {creator.profile.name}
              {creator.profile.isCreator && <span className="creator-badge" title="Creator"><Sparkles size={13} aria-hidden /> Creator</span>}
            </h1>
            <p className="creator-hero-meta">
              {[creator.profile.homeCity, ...creator.profile.languages.map(l => l.toUpperCase())].filter(Boolean).join(' · ') || 'Traveller'}
            </p>
            {creator.profile.creatorBio && <p className="creator-hero-bio">{creator.profile.creatorBio}</p>}
          </div>
          <div className="creator-hero-actions">
            {links.map(({ key, href, label, Icon }) => (
              <a key={key} className="btn btn-outline btn-sm" href={href} target="_blank" rel="noreferrer noopener" aria-label={label} onClick={e => { e.preventDefault(); openExternal(href) }}>
                <InlineIcon icon={Icon} size={14} gap={4} />{key === 'youtube' ? 'YouTube' : 'Instagram'}
              </a>
            ))}
            <CopyButton text={shareLink} label="Copy page link" />
          </div>
        </div>
      </section>

      <div className="container" style={{ paddingTop: 20 }}>
        {pubs.length > 0 && (
          <div className="creator-stats" role="group" aria-label="Creator track record">
            <div className="stat-tile"><div className="stat-label">Itineraries</div><div className="stat-value">{pubs.length}</div></div>
            <div className="stat-tile"><div className="stat-label">Total views</div><div className="stat-value">
              {figureOrUnavailable(totalViews, pubsRead) === null
                ? <span className="muted">unavailable</span>
                : <><InlineIcon icon={Eye} size={15} gap={5} vAlign="-1px" />{totalViews}</>}
            </div></div>
            <div className="stat-tile"><div className="stat-label">Total forks</div><div className="stat-value">
              {figureOrUnavailable(totalForks, pubsRead) === null
                ? <span className="muted">unavailable</span>
                : <><InlineIcon icon={GitFork} size={15} gap={5} vAlign="-1px" />{totalForks}</>}
            </div></div>
          </div>
        )}

        <h2 style={{ marginBottom: 12 }}>Publications</h2>

        {pubsRead !== 'ready' ? (
          // Loading and failed both sit here, and both are checked BEFORE the
          // empty copy — which is the ordering whose absence caused the bug.
          pubsRead === 'reading' ? (
            <div className="loading-block"><div className="spinner" />Loading publications…</div>
          ) : (
            <EmptyState icon={<MapPin size={38} aria-hidden />} title={emptyCopyFor(pubsRead, 'publications', retry).title}
              body={emptyCopyFor(pubsRead, 'publications', retry).body}
              action={<button className="btn btn-primary" onClick={retry}>Try again</button>} />
          )
        ) : pubs.length === 0 ? (
          !creator.profile.isCreator ? (
            <EmptyState icon={<Compass size={38} aria-hidden />} title="No creator page here yet"
              body={`${creator.profile.name} hasn’t enabled creator mode or published an itinerary.`}
              action={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Explore itineraries</button>} />
          ) : (
            <EmptyState icon={<MapPin size={38} aria-hidden />} title="No itineraries published yet"
              body="When they publish a trip to Explore, it will appear here." />
          )
        ) : (
          <div className="explore-grid">
            {pubs.map(p => (
              <PubCard key={p.id} pub={p} creator={creator} saved={isSaved(p.id)}
                onFork={() => { void forkPublication(p, me, onNavigate, undefined, 'creator') }} needsLogin={!me}
                onToggleSave={() => toggleSaved(p.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
