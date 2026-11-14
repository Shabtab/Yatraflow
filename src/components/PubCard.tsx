// ============ Published-itinerary card for the creator page ============
// This file no longer draws a card of its own. It composes the one shared
// publication card (`components/explore/ExploreCard.tsx`) and supplies what a
// creator page adds:
//   - the creator row: bio plus channel links, from the profile's own fields,
//   - the explicit fork label ("Fork this trip") the creator page has always used,
//   - the cover sizes for the `.explore-grid` column, which is wider than the
//     Explore grid's,
//   - an optional entrance slot for a grid that staggers its rows.
// Every control still arrives as a callback, so fork, save and the creator link
// keep the behaviour of their page. Nothing here claims a statistic, a follower
// count, a payout or a date: the row prints only what the profile holds.
import type { CSSProperties } from 'react'
import { Camera, TvMinimalPlay } from 'lucide-react'
import type { PublishedItinerary, CachedUser } from '../data/types'
import { staggerDelay } from '../lib/motion'
import { openExternal } from '../lib/native'
import { ExploreCard } from './explore/ExploreCard'
import { PUB_GRID_SIZES } from './explore/ExploreCover'

export function PubCard({ pub, creator, saved, onFork, onToggleSave, enterIndex, needsLogin }: {
  pub: PublishedItinerary
  creator?: CachedUser
  saved: boolean
  onFork: () => void
  onToggleSave: () => void
  /** Grid position for a staggered entrance. Omit it for no entrance at all. */
  enterIndex?: number
  /** Signed out: Fork navigates to /auth rather than forking in place, so the
   *  button has to say so — a click that silently becomes a login redirect
   *  reads as a broken button. */
  needsLogin?: boolean
}) {
  const creatorName = creator?.profile.name ?? 'Creator'
  const bio = creator?.profile.creatorBio
  const youtube = creator?.profile.socialLinks?.youtube
  const instagram = creator?.profile.socialLinks?.instagram
  const hasCreatorRow = Boolean(creator?.profile.isCreator && (bio || youtube || instagram))
  const creatorRow = hasCreatorRow ? (
    <div className="row-between itin-foot ex-card-creator">
      {/* Always present, so the channel links stay on the right whether or not
          the creator wrote a bio. */}
      <span className="ex-card-bio">{bio ?? ''}</span>
      <span className="ex-card-channels">
        {youtube && (
          <a href={youtube} target="_blank" rel="noreferrer noopener" aria-label={`${creatorName} on YouTube`} className="icon-link"
            onClick={e => { e.preventDefault(); openExternal(youtube) }}><TvMinimalPlay size={14} aria-hidden /></a>
        )}
        {instagram && (
          <a href={instagram} target="_blank" rel="noreferrer noopener" aria-label={`${creatorName} on Instagram`} className="icon-link"
            onClick={e => { e.preventDefault(); openExternal(instagram) }}><Camera size={14} aria-hidden /></a>
        )}
      </span>
    </div>
  ) : undefined

  const card = (
    <ExploreCard
      pub={pub}
      creator={creator}
      saved={saved}
      needsLogin={needsLogin}
      sizes={PUB_GRID_SIZES}
      forkLabel={needsLogin ? 'Log in to fork' : 'Fork this trip'}
      footer={creatorRow}
      onFork={onFork}
      onToggleSave={onToggleSave}
    />
  )
  if (enterIndex == null) return card
  // The slot owns the entrance when a caller asks for one, so the card itself
  // never plays the same arrival twice.
  const enterDelay: CSSProperties = { animationDelay: staggerDelay(enterIndex) }
  return <div className="ex-enter" style={enterDelay}>{card}</div>
}
