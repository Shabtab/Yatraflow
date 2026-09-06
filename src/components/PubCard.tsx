// ============ Published-itinerary card — shared by Explore and creator pages ============
// One card for every place the catalog renders, so a fork/save/creator change
// lands everywhere at once. Fork + save behavior arrive as callbacks; the
// creator line links to the creator's public page (#/creator/:id).
import { Calendar, Camera, GitFork, Heart, MapPin, Sparkles, TvMinimalPlay, Wallet } from 'lucide-react'
import type { PublishedItinerary, User } from '../data/types'
import { formatInr } from '../lib/engine'
import { Avatar, Chip } from './ui'
import { CoverThumb } from './CoverThumb'

export function PubCard({ pub, creator, saved, onFork, onToggleSave }: {
  pub: PublishedItinerary
  creator?: User
  saved: boolean
  onFork: () => void
  onToggleSave: () => void
}) {
  return (
    <div className="card itin-card">
      <button className="save-heart" aria-pressed={saved} aria-label={saved ? 'Remove from saved' : 'Save itinerary'}
        onClick={onToggleSave}><Heart size={13} aria-hidden fill={saved ? 'currentColor' : 'none'} /></button>
      <a className="trip-card-hit" href={`#/pub/${pub.id}`}>
        <CoverThumb
          trip={{ name: pub.title, destinations: pub.routeSummary }}
          explicitUrl={pub.coverImageUrl}
          emoji="🧭"
          routeLabel={`${pub.routeSummary[0]} → ${pub.routeSummary[pub.routeSummary.length - 1]}`}
        />
        <div className="itin-body">
          <div className="row-between" style={{ marginTop: 0 }}>
            <Chip tone="teal">{cap(pub.travelStyle)}</Chip>
            <span className="small muted"><GitFork size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{pub.copies}</span>
          </div>
          <h2 className="card-title">{pub.title}</h2>
          <p className="small muted" style={{ margin: 0 }}>{pub.tagline}</p>
          <div className="stop-meta" style={{ marginTop: 2 }}>
            <span><Calendar size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{pub.durationDays} days</span>
            <span><Wallet size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />~{formatInr(pub.estimatedBudgetPerPersonInr)}/person</span>
            <span><MapPin size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />{pub.routeSummary.length} places</span>
          </div>
        </div>
      </a>
      <div className="row-between itin-meta">
        <a className="creator-line" href={`#/creator/${pub.creatorId}`} aria-label={`View ${creator?.profile.name ?? 'creator'}'s page`}>
          <Avatar user={creator} />{creator?.profile.name ?? 'Creator'}{creator?.profile.isCreator && <span title="Verified creator" style={{ display: 'inline-flex', verticalAlign: '-2px', marginLeft: 2 }}><Sparkles size={12} aria-hidden /></span>}
        </a>
        <button className="btn btn-primary btn-sm" onClick={onFork}>Fork this trip</button>
      </div>
      {creator?.profile.isCreator && (creator.profile.creatorBio || creator.profile.socialLinks?.youtube || creator.profile.socialLinks?.instagram) && (
        <div className="row-between" style={{ gap: 8, marginTop: 6 }}>
          <span className="small muted" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{creator.profile.creatorBio}</span>
          <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
            {creator.profile.socialLinks?.youtube && (
              <a href={creator.profile.socialLinks.youtube} target="_blank" rel="noreferrer noopener" aria-label={`${creator.profile.name} on YouTube`} className="muted"><TvMinimalPlay size={14} aria-hidden /></a>
            )}
            {creator.profile.socialLinks?.instagram && (
              <a href={creator.profile.socialLinks.instagram} target="_blank" rel="noreferrer noopener" aria-label={`${creator.profile.name} on Instagram`} className="muted"><Camera size={14} aria-hidden /></a>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
