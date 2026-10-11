// ============ Explore — featured itinerary ============
// The whole cover on the left, the text on the right, and the route trail and
// facts under the cover. On a phone the three blocks stack: cover, text, route.
// Its credibility line says why the plan leads, and only with real evidence.
import type { ReactNode } from 'react'
import { Eye, GitFork, Heart, Sparkles, Star } from 'lucide-react'
import type { PublishedItinerary, User } from '../../data/types'
import { appLink } from '../../lib/appLink'
import { cap } from '../../lib/labels'
import { Avatar } from '../ui'
import { ExploreCover } from './ExploreCover'
import { ExploreFacts } from './ExploreFacts'
import { RouteTrail } from './RouteTrail'

export function FeaturedCard({ pub, creator, kicker, healthScore, saved, needsLogin, onFork, onToggleSave }: {
  pub: PublishedItinerary
  creator?: User
  /** The kicker line. The page builds it, because it states the filter case. */
  kicker: ReactNode
  /** Trip health out of 100, when the plan's trip is in this browser. */
  healthScore?: number
  saved: boolean
  needsLogin: boolean
  onFork: () => void
  onToggleSave: () => void
}) {
  const creatorName = creator?.profile.name ?? 'a YatraFlow traveller'
  return (
    <article className="ex-feature ex-enter" data-id={pub.id}>
      <div className="ex-feature-cover">
        <ExploreCover pub={pub} />
        <span className="ex-style-tag">{cap(pub.travelStyle)}</span>
      </div>
      <div className="ex-feature-body">
        <p className="ex-kicker"><Star size={12} aria-hidden />{kicker}</p>
        <h3 className="ex-feature-title"><a className="ex-feature-link" {...appLink(`/pub/${pub.id}`)}>{pub.title}</a></h3>
        <p className="ex-feature-tagline">{pub.tagline}</p>
        <p className="ex-credibility">
          Why featured: {pub.copies >= 1
            ? <><GitFork size={12} aria-hidden className="ex-inline-icon" /> {pub.copies} fork{pub.copies === 1 ? '' : 's'} — the most-forked plan here</>
            : <><Eye size={12} aria-hidden className="ex-inline-icon" /> {pub.views} views</>}
          {healthScore !== undefined && <> · trip health {healthScore}/100</>} — by {creatorName}
          {creator?.profile.isCreator && <> <Sparkles size={12} aria-hidden className="ex-inline-icon" /></>}.
        </p>
        <div className="ex-feature-foot">
          {creator ? (
            <a className="ex-byline" {...appLink(`/creator/${pub.creatorId}`)} aria-label={`View ${creatorName}’s page`}>
              <Avatar user={creator} />
              <span>{creatorName}</span>
            </a>
          ) : <span />}
          <div className="ex-feature-actions">
            <button type="button" className="btn btn-primary ex-fork" onClick={onFork}>
              <GitFork size={14} aria-hidden />{needsLogin ? 'Log in to fork' : 'Fork this trip'}
            </button>
            <button type="button" className="btn btn-secondary" aria-pressed={saved}
              aria-label={`Save ${pub.title}`} onClick={onToggleSave}>
              <Heart size={14} aria-hidden fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      <div className="ex-feature-route">
        <RouteTrail routeSummary={pub.routeSummary} />
        <ExploreFacts pub={pub} />
      </div>
    </article>
  )
}
