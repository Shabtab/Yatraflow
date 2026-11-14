// ============ Publication card — the one card the catalog draws ============
// Cover, style label, price label, save heart, title, tagline, the four real
// facts, then the creator line and Fork. The title link stretches over the
// whole card, so a tap anywhere opens the plan; every other control sits above
// that link.
//
// This file is the single rendering of a published itinerary. `PubCard` composes
// it for the creator page (it adds the creator row, the longer fork label and
// the creator grid's cover sizes), and the Explore grid renders it directly.
// Neither consumer draws a second copy of the card.
//
// The price label is ExplorePriceTag: the storefront's exact figure, or Free.
import type { CSSProperties, ReactNode } from 'react'
import { GitFork, Sparkles } from 'lucide-react'
import type { PublishedItinerary, CachedUser } from '../../data/types'
import { appLink } from '../../lib/appLink'
import type { PresenceAttrs } from '../../lib/usePresenceList'
import { cap } from '../../lib/labels'
import { staggerDelay } from '../../lib/motion'
import { Avatar } from '../ui'
import { ExploreCover, EX_GRID_SIZES } from './ExploreCover'
import { ExploreFacts } from './ExploreFacts'
import { ExplorePriceTag } from './ExplorePriceTag'
import { ExploreSaveHeart } from './ExploreSaveHeart'

export function ExploreCard({
  pub, creator, saved, needsLogin, enterIndex, presence, sizes = EX_GRID_SIZES, eager, forkLabel, footer,
  onFork, onToggleSave,
}: {
  pub: PublishedItinerary
  creator?: CachedUser
  saved: boolean
  /** Signed out, Fork goes to the login page, so the button says so. */
  needsLogin?: boolean
  /** Position in its page of results. It sets the card's staggered entrance.
   *  Omit it and the card arrives with no delay and no entrance class. */
  enterIndex?: number
  /** Worn by the list that plays this card's exit (usePresenceList). */
  presence?: PresenceAttrs
  /** The cover slot's real width. The grid, the shelf and the creator page differ. */
  sizes?: string
  /** Load the cover at once. Set for the cards near the top of the page. */
  eager?: boolean
  /** The Fork button's own words. The grid is short; a creator page is explicit. */
  forkLabel?: string
  /** A last row inside the card, such as the creator's bio and channels. */
  footer?: ReactNode
  onFork: () => void
  onToggleSave: () => void
}) {
  const creatorName = creator?.profile.name ?? 'Creator'
  const title = pub.title
  // The pill says "Fork" for every visitor, as in the mockup. A signed-out click
  // leads to the login page, and the accessible name below says so.
  const label = forkLabel ?? 'Fork'
  const enterDelay: CSSProperties | undefined = enterIndex == null ? undefined : { animationDelay: staggerDelay(enterIndex) }
  return (
    <article className={`ex-card${enterIndex == null ? '' : ' ex-enter'}`} data-id={pub.id}
      style={enterDelay} {...presence}>
      <div className="ex-cover-wrap">
        <ExploreCover pub={pub} sizes={sizes} eager={eager} />
        <span className="ex-style-tag">{cap(pub.travelStyle)}</span>
        <ExplorePriceTag pub={pub} />
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
          {/* The visible label leads the accessible name, so voice control can
              still act on what the reader sees (WCAG 2.5.3). */}
          <button type="button" className="btn btn-secondary ex-fork"
            aria-label={`${label}: ${title}${needsLogin && !forkLabel ? ' (log in first)' : ''}`} onClick={onFork}>
            <GitFork size={14} aria-hidden />{label}
          </button>
        </div>
        {footer}
      </div>
    </article>
  )
}
