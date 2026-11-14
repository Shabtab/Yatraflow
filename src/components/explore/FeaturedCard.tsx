// ============ Explore — featured itinerary ============
// The cover on the left, with its style and price labels. The text runs down the
// right: kicker, title, tagline, the route trail, the four facts, the reason it
// leads, then the creator and the actions. The creator shows once, in the byline. On a phone the cover stacks over the
// text. Its credibility line says why the plan leads, and only with real evidence.
import type { ReactNode } from 'react'
import { GitFork, Heart, Star } from 'lucide-react'
import type { PublishedItinerary, CachedUser } from '../../data/types'
import { appLink } from '../../lib/appLink'
import { cap } from '../../lib/labels'
import { Avatar } from '../ui'
import { ExploreCover, EX_FEATURE_SIZES } from './ExploreCover'
import { ExploreFacts } from './ExploreFacts'
import { ExplorePriceTag } from './ExplorePriceTag'
import { RouteTrail } from './RouteTrail'

export function FeaturedCard({ pub, creator, kicker, healthScore, saved, needsLogin, onFork, onToggleSave }: {
  pub: PublishedItinerary
  creator?: CachedUser
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
        <ExploreCover pub={pub} sizes={EX_FEATURE_SIZES} eager />
        <span className="ex-style-tag">{cap(pub.travelStyle)}</span>
        <ExplorePriceTag pub={pub} />
      </div>
      <div className="ex-feature-body">
        <p className="ex-kicker"><Star size={12} aria-hidden />{kicker}</p>
        <h3 className="ex-feature-title"><a className="ex-feature-link" {...appLink(`/pub/${pub.id}`)}>{pub.title}</a></h3>
        <p className="ex-feature-tagline">{pub.tagline}</p>
        <RouteTrail routeSummary={pub.routeSummary} />
        <ExploreFacts pub={pub} />
        <p className="ex-credibility">
          Why featured: {pub.copies >= 1
            ? `${pub.copies} fork${pub.copies === 1 ? '' : 's'}, the most of any plan here`
            : `${pub.views} view${pub.views === 1 ? '' : 's'}`}
          {healthScore !== undefined && <> · trip health {healthScore}/100</>}
        </p>
        <div className="ex-feature-foot">
          {creator ? (
            <a className="ex-byline" {...appLink(`/creator/${pub.creatorId}`)} aria-label={`View ${creatorName}’s page`}>
              <Avatar user={creator} />
              <span>{creatorName}</span>
            </a>
          ) : <span />}
          <div className="ex-feature-actions">
            <button type="button" className="btn btn-secondary ex-feature-save" aria-pressed={saved}
              aria-label={`Save ${pub.title}`} onClick={onToggleSave}>
              <Heart size={16} aria-hidden fill={saved ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className="btn btn-primary ex-fork" onClick={onFork}>
              <GitFork size={14} aria-hidden />{needsLogin ? 'Log in to fork' : 'Fork this trip'}
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
