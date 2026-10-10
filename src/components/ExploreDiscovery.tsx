// ============ Explore discovery blocks (MR10) ============
// The three public-discovery surfaces the mockup's hub page
// proposed: featured creators, trending itineraries, and the
// share-your-stories call to action. Every claim each block makes
// is derived from the public catalog (lib/discovery.ts), and each
// block returns null until its own evidence exists — a section
// heading over an empty rail would advertise a community that is
// not there.
import { Calendar, Check, Eye, GitFork, MapPin, PenLine, Sparkles, TrendingUp, Wallet } from 'lucide-react'
import type { PublishedItinerary, User } from '../data/types'
import { formatInr } from '../lib/engine'
import { appLink } from '../lib/appLink'
import type { CreatorRank } from '../lib/discovery'
import { Avatar } from './ui'
import { InlineIcon, MetaIcon } from './icons'
import { CoverThumb } from './CoverThumb'

/** The creator rail's own cap — the mockup drew four. */
const CREATOR_RAIL_CAP = 4

/** A count with the right noun: `plural(6, 'itinerary', 'itineraries')`.
 *  This exists because appending an `s` shipped "6 itinerarys" on the
 *  share card — the noun changes shape, so both spellings are passed in. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** One creator in the discovery rail. The whole card is one link
 *  to the creator's public page, so no second link can nest
 *  inside it. */
function CreatorCard({ rank, index }: { rank: CreatorRank; index: number }) {
  const { user, pubCount, forks } = rank
  const bio = user.profile.creatorBio?.trim() || user.profile.homeCity?.trim()
  return (
    <a className="creator-card trip-enter"
      style={{ animationDelay: `calc(var(--stagger-step) * ${Math.min(index, CREATOR_RAIL_CAP)})` }}
      {...appLink(`/creator/${user.id}`)}
      aria-label={`View ${user.profile.name}'s creator page`}>
      <Avatar user={user} size="lg" />
      <span className="creator-name">
        {user.profile.name}
        <InlineIcon icon={Sparkles} size={12} gap={0} vAlign="-1px" />
      </span>
      {bio && <span className="creator-bio">{bio}</span>}
      <span className="creator-evidence num">
        {plural(pubCount, 'itinerary', 'itineraries')}
        {forks > 0 && <> · <InlineIcon icon={GitFork} size={12} gap={2} />{forks} forks</>}
      </span>
    </a>
  )
}

/** Featured creators: the creators whose live catalogs carry the
 *  most evidence, as a scroll rail. Null until the catalog holds
 *  at least one creator with a live publication. */
export function FeaturedCreators({ creators }: { creators: CreatorRank[] }) {
  if (creators.length === 0) return null
  return (
    <section className="discovery-block" aria-labelledby="featured-creators-heading">
      <header className="discovery-head">
        <h2 id="featured-creators-heading" className="discovery-title">
          <InlineIcon icon={Sparkles} size={15} gap={6} />Featured creators
        </h2>
        <p className="discovery-sub">The travellers behind the most-copied plans here.</p>
      </header>
      <div className="creator-rail">
        {creators.map((rank, i) => <CreatorCard key={rank.user.id} rank={rank} index={i} />)}
      </div>
    </section>
  )
}

/** Trending itineraries: the catalog's most-evidenced plans, minus
 *  the one the featured card already leads with. Each row is a
 *  deep link to the public plan, with the creator's own page as
 *  the row's second link. Null until the evidence bar is met. */
export function TrendingShelf({ pubs, users }: { pubs: PublishedItinerary[]; users: User[] }) {
  if (pubs.length === 0) return null
  return (
    <section className="discovery-block" aria-labelledby="trending-heading">
      <header className="discovery-head">
        <h2 id="trending-heading" className="discovery-title">
          <InlineIcon icon={TrendingUp} size={15} gap={6} />Trending itineraries
        </h2>
        <p className="discovery-sub">The plans the community is copying and reading.</p>
      </header>
      <ul className="trending-list">
        {pubs.map((p, i) => {
          const creator = users.find(u => u.id === p.creatorId)
          return (
            <li key={p.id} className="trend-row trip-enter"
              style={{ animationDelay: `calc(var(--stagger-step) * ${Math.min(i, CREATOR_RAIL_CAP)})` }}>
              <a className="trend-hit" {...appLink(`/pub/${p.id}`)}>
                <span className="trend-rank num" aria-hidden="true">{i + 1}</span>
                <CoverThumb
                  trip={{ name: p.title, destinations: p.routeSummary }}
                  explicitUrl={p.coverImageUrl}
                  emoji="🧭"
                  routeLabel={`${p.routeSummary[0]} → ${p.routeSummary[p.routeSummary.length - 1]}`}
                />
                <span className="trend-body">
                  <h3 className="trend-title">{p.title}</h3>
                  <span className="trend-tagline">{p.tagline}</span>
                  <span className="trend-meta">
                    <span><MetaIcon icon={Calendar} tone="time" />{p.durationDays} days</span>
                    <span><MetaIcon icon={Wallet} tone="money" />~{formatInr(p.estimatedBudgetPerPersonInr)}/person</span>
                    <span><MetaIcon icon={MapPin} tone="place" />{p.routeSummary.length} places</span>
                  </span>
                </span>
              </a>
              <div className="trend-foot">
                <a className="creator-line" {...appLink(`/creator/${p.creatorId}`)}
                  aria-label={`View ${creator?.profile.name ?? 'creator'}'s page`}>
                  <Avatar user={creator} />{creator?.profile.name ?? 'Creator'}
                </a>
                <span className="trend-evidence num">
                  <InlineIcon icon={GitFork} size={12} gap={2} />{p.copies}
                  <span className="trend-evidence-sep" aria-hidden="true">·</span>
                  <InlineIcon icon={Eye} size={12} gap={2} />{plural(p.views, 'view', 'views')}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The share-stories call to action. The counts are derived from
 *  the same slice the discovery blocks read, so the card can
 *  never claim a larger community than the page shows. */
export function ShareStoriesCta({ pubCount, creatorCount, signedIn, onNavigate }: {
  pubCount: number
  creatorCount: number
  signedIn: boolean
  onNavigate: (r: string) => void
}) {
  return (
    <section className="share-cta" aria-labelledby="share-stories-heading">
      <span className="editorial-kicker share-cta-kicker">
        <InlineIcon icon={PenLine} size={12} gap={3} />Join the community
      </span>
      <h2 id="share-stories-heading" className="share-cta-title">Share your travel stories</h2>
      <p className="share-cta-sub">
        Turn your travel experiences into helpful itineraries — inspire other
        travellers and get recognised in the YatraFlow community.
      </p>
      <p className="share-cta-counts num">
        {plural(pubCount, 'itinerary', 'itineraries')} from {plural(creatorCount, 'creator', 'creators')} live here
      </p>
      <ul className="share-cta-ticks">
        <li><InlineIcon icon={Check} size={13} gap={6} />Create and publish itineraries</li>
        <li><InlineIcon icon={Check} size={13} gap={6} />Reach travellers planning trips like yours</li>
        <li><InlineIcon icon={Check} size={13} gap={6} />Get featured and build your profile</li>
      </ul>
      <div className="share-cta-actions">
        <button type="button" className="btn btn-primary"
          onClick={() => onNavigate(signedIn ? '/trips' : '/auth?mode=signup')}>
          {signedIn ? 'Publish a trip' : 'Become a creator'}
        </button>
        {signedIn && <span className="share-cta-hint">Publish one of your trips from its Share tab.</span>}
      </div>
    </section>
  )
}
