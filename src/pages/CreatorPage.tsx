// ============ Public creator page — #/creator/:id ============
// The shareable destination for the creator chips on Explore cards and the
// public itinerary pages: bio + links + every itinerary this creator has
// published. Works logged-out (profiles and publications are public app-wide).
import { useMemo } from 'react'
import { Camera, Compass, Eye, GitFork, Link2, MapPin, Sparkles, TvMinimalPlay } from 'lucide-react'
import { useDb, useSessionUserId, usePublished, userById } from '../store/store'
import { forkPublication } from '../lib/forkPub'
import { openExternal } from '../lib/native'
import { useSavedPubs } from '../lib/savedPubs'
import { Avatar, CopyButton, EmptyState } from '../components/ui'
import { PubCard } from '../components/PubCard'

export function CreatorPage({ creatorId, onNavigate }: { creatorId: string; onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = useSessionUserId()
  const published = usePublished()
  const { isSaved, toggleSaved } = useSavedPubs()

  const creator = userById(creatorId)
  const pubs = useMemo(
    () => published.filter(p => p.creatorId === creatorId).sort((a, b) => b.publishedAt - a.publishedAt),
    [published, creatorId],
  )
  const totalViews = pubs.reduce((s, p) => s + p.views, 0)
  const totalForks = pubs.reduce((s, p) => s + p.copies, 0)

  if (!creator) {
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
  const shareLink = `${location.origin}${location.pathname}#/creator/${creatorId}`

  return (
    <div>
      {/* ---- Creator hero: identity, trust, share ---- */}
      <section className="creator-hero">
        <div className="container creator-hero-inner">
          <Avatar user={creator} size="lg" />
          <div className="creator-hero-id">
            <h1>
              {creator.profile.name}
              {creator.profile.isCreator && <span className="creator-badge" title="Verified creator"><Sparkles size={13} aria-hidden /> Creator</span>}
            </h1>
            <p className="creator-hero-meta">
              {[creator.profile.homeCity, ...creator.profile.languages.map(l => l.toUpperCase())].filter(Boolean).join(' · ') || 'Traveller'}
            </p>
            {creator.profile.creatorBio && <p className="creator-hero-bio">{creator.profile.creatorBio}</p>}
          </div>
          <div className="creator-hero-actions">
            {links.map(({ key, href, label, Icon }) => (
              <a key={key} className="btn btn-outline btn-sm" href={href} target="_blank" rel="noreferrer noopener" aria-label={label} onClick={e => { e.preventDefault(); openExternal(href) }}>
                <Icon size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />{key === 'youtube' ? 'YouTube' : 'Instagram'}
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
            <div className="stat-tile"><div className="stat-label">Total views</div><div className="stat-value"><Eye size={15} aria-hidden style={{ verticalAlign: '-1px', marginRight: 5 }} />{totalViews}</div></div>
            <div className="stat-tile"><div className="stat-label">Total forks</div><div className="stat-value"><GitFork size={15} aria-hidden style={{ verticalAlign: '-1px', marginRight: 5 }} />{totalForks}</div></div>
          </div>
        )}

        {pubs.length === 0 ? (
          !creator.profile.isCreator ? (
            <EmptyState icon={<Compass size={38} aria-hidden />} title="No creator page here yet"
              body={`${creator.profile.name} hasn't enabled creator mode or published an itinerary.`}
              action={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Browse Explore</button>} />
          ) : (
            <EmptyState icon={<MapPin size={38} aria-hidden />} title="No itineraries published yet"
              body="When they publish a trip to Explore, it will appear here." />
          )
        ) : (
          <div className="explore-grid">
            {pubs.map(p => (
              <PubCard key={p.id} pub={p} creator={creator} saved={isSaved(p.id)}
                onFork={() => forkPublication(p, me, onNavigate)}
                onToggleSave={() => toggleSaved(p.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
