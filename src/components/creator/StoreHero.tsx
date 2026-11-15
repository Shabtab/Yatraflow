// ============ Creator storefront — hero (cover band + identity card) ============
// Presentational only: every value arrives as a prop, and the props carry
// public shapes alone. The page owns the reads, the featured pick and the
// library; this component owns the cover band, the identity card and the
// track-record tiles. Styling lives with the page CSS owner (`cr-store-*`).
import { countNoun } from '../../lib/creatorCopy'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { Eye, GitFork, Route } from 'lucide-react'
import type { CachedUser, PublishedItinerary } from '../../data/types'
import { appLinkHref, shouldHandleAppLink } from '../../lib/appLink'
import { openExternal } from '../../lib/native'
import { ExploreCover } from '../explore/ExploreCover'
import { Avatar, Chip, CopyButton } from '../ui'
import { CrStatTile } from './CrStatTile'
import { SocialIcon } from './SocialIcon'

/** The hero band's real width. The band spans the container; below 1440 it is
 *  the viewport less the container's inline padding. */
export const STORE_COVER_SIZES = '(min-width: 1440px) 1280px, calc(100vw - 32px)'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Publishing since <Mon YYYY>" — the month and year alone. */
export function monthYear(timestamp: number): string {
  const date = new Date(timestamp)
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** "Updated <D Mon YYYY>" — the day, month and year of the stamp. */
export function dayStamp(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

interface HeroFigures {
  liveRoutes: number | null
  views: number | null
  forks: number | null
}

/** In-page jump to the library head. The href stays a real path for the
 *  address bar; the click scrolls instead of navigating, because the library
 *  is on this page whenever the link renders. */
function scrollToLibrary(event: ReactMouseEvent<HTMLAnchorElement>): void {
  if (!shouldHandleAppLink(event, event.currentTarget.target, event.currentTarget.hasAttribute('download'))) return
  event.preventDefault()
  const library = document.getElementById('creator-library')
  if (!library) return
  library.scrollIntoView()
  library.focus({ preventScroll: true })
}

export function StoreHero({ creator, cover, publishingSince, shareUrl, figures, routeCount, showBrowse, tabs, heading }: {
  /** A public row, or the account's own row when the viewer is the creator.
   *  Only `profile`'s public fields are read. */
  creator: CachedUser
  /** The route whose cover leads the band. Omitted: the token band shows. */
  cover?: PublishedItinerary
  /** Earliest live `publishedAt`, from the read model. Omitted: no chip. */
  publishingSince?: number
  shareUrl: string
  /** A null figure is not a zero: the tile shows "Unavailable". */
  figures: HeroFigures
  /** The live count behind the "Browse N routes" label. */
  routeCount: number
  showBrowse: boolean
  /** Cover tabs render only when the page has three or more sections. */
  tabs: boolean
  /** The name heading, built by the page. The page keeps the raw h1 so the
   *  page-consistency scanner counts it where the route is owned. */
  heading: ReactNode
}) {
  const name = creator.profile.name
  const channels: { key: 'youtube' | 'instagram'; href: string; label: string }[] = []
  if (creator.profile.socialLinks?.youtube) {
    channels.push({ key: 'youtube', href: creator.profile.socialLinks.youtube, label: `${name} on YouTube` })
  }
  if (creator.profile.socialLinks?.instagram) {
    channels.push({ key: 'instagram', href: creator.profile.socialLinks.instagram, label: `${name} on Instagram` })
  }
  const libraryHref = `${appLinkHref(`/creator/${creator.id}`)}#creator-library`
  return (
    <section className="cr-store-hero" aria-label={`${name} on YatraFlow`}>
      <div className="container">
        <div className={cover ? 'cr-store-cover' : 'cr-store-cover cr-store-cover--plain'}>
          {cover && <ExploreCover pub={cover} ratio="21:9" sizes={STORE_COVER_SIZES} eager />}
          {tabs && (
            <nav className="cr-store-tabs" aria-label="On this page">
              <a className="cr-store-tab" href={libraryHref} onClick={scrollToLibrary}>Routes</a>
            </nav>
          )}
        </div>
        <div className="cr-store-card">
          <div className="cr-store-cardgrid">
            <div className="cr-store-ident">
              <div className="cr-store-avatar"><Avatar user={creator} size="lg" /></div>
              <div className="cr-store-id">
                <div className="cr-store-name">
                  {heading}
                  {creator.profile.isCreator && <Chip tone="teal">Creator</Chip>}
                </div>
                {creator.profile.creatorBio && <p className="cr-store-bio">{creator.profile.creatorBio}</p>}
                {publishingSince !== undefined && (
                  <p className="cr-store-chips"><Chip>Publishing since {monthYear(publishingSince)}</Chip></p>
                )}
                <div className="cr-store-actions">
                  {showBrowse && (
                    <a className="btn btn-primary cr-store-browse" href={libraryHref} onClick={scrollToLibrary}>
                      Browse {countNoun(routeCount, 'route')}
                    </a>
                  )}
                  <CopyButton text={shareUrl} label="Share" />
                  {channels.length > 0 && <span className="cr-store-divider" aria-hidden="true" />}
                  {channels.map(({ key, href, label }) => (
                    <a key={key} className="btn btn-ghost" href={href} target="_blank" rel="noreferrer noopener"
                      aria-label={label}
                      onClick={e => { e.preventDefault(); openExternal(href) }}>
                      <SocialIcon kind={key} size={14} />{key === 'youtube' ? 'YouTube' : 'Instagram'}
                    </a>
                  ))}
                </div>
              </div>
            </div>
            <div className="cr-store-track">
              <p className="cr-store-track-label">Track record</p>
              <div className="cr-tilegrid">
                <CrStatTile icon={<Route size={18} aria-hidden />} value={figures.liveRoutes} label="Live routes" />
                <CrStatTile icon={<Eye size={18} aria-hidden />} value={figures.views} label="Route views" />
                <CrStatTile icon={<GitFork size={18} aria-hidden />} value={figures.forks} label="Forks" />
              </div>
              <p className="cr-store-note">Figures count live public routes only.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
