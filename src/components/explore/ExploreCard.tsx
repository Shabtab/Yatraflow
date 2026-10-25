// ============ Explore — itinerary card ============
// Cover, title, tagline, four labelled facts, then the creator line and Fork.
// The title link stretches over the whole card. The save heart and the other
// controls sit above that link.
import type { CSSProperties } from 'react'
import { GitFork, Sparkles } from 'lucide-react'
import type { PublishedItinerary, CachedUser } from '../../data/types'
import { appLink } from '../../lib/appLink'
import type { PresenceAttrs } from '../../lib/usePresenceList'
import { cap } from '../../lib/labels'
import { Avatar } from '../ui'
import { ExploreCover } from './ExploreCover'
import { ExploreFacts } from './ExploreFacts'
import { ExploreSaveHeart } from './ExploreSaveHeart'

export function ExploreCard({ pub, creator, saved, needsLogin, enterIndex, presence, onFork, onToggleSave }: {
  pub: PublishedItinerary
  creator?: CachedUser
  saved: boolean
  /** Signed out, Fork goes to the login page, so the button says so. */
  needsLogin: boolean
  /** Position in its page of results. It sets the card's staggered entrance. */
  enterIndex: number
  /** Worn by the list that plays this card's exit (usePresenceList). */
  presence?: PresenceAttrs
  onFork: () => void
  onToggleSave: () => void
}) {
  const creatorName = creator?.profile.name ?? 'Creator'
  const title = pub.title
  const enterDelay: CSSProperties = { animationDelay: `calc(var(--stagger-step) * ${Math.min(enterIndex, 8)})` }
  return (
    <article className="ex-card ex-enter" data-id={pub.id} style={enterDelay} {...presence}>
      <div className="ex-cover-wrap">
        <ExploreCover pub={pub} />
        <span className="ex-style-tag">{cap(pub.travelStyle)}</span>
        <ExploreSaveHeart title={title} saved={saved} onToggle={onToggleSave} />
      </div>
      <div className="ex-card-main">
        <div className="ex-card-body">
          <h3 className="ex-card-title"><a className="ex-card-link" {...appLink(`/pub/${pub.id}`)}>{title}</a></h3>
          <p className="ex-card-desc">{pub.tagline}</p>
          <ExploreFacts pub={pub} />
        </div>
        <div className="ex-card-foot">
          <a className="ex-byline" {...appLink(`/creator/${pub.creatorId}`)} aria-label={`View ${creatorName}’s page`}>
            <Avatar user={creator} />
            <span>{creatorName}</span>
            {creator?.profile.isCreator && <Sparkles size={13} aria-hidden />}
          </a>
          <button type="button" className="btn btn-secondary ex-fork"
            aria-label={`${needsLogin ? 'Log in to fork' : 'Fork'} ${title}`} onClick={onFork}>
            <GitFork size={14} aria-hidden />{needsLogin ? 'Log in to fork' : 'Fork'}
          </button>
        </div>
      </div>
    </article>
  )
}
