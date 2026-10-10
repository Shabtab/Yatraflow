// ============ Explore - trending shelf ============
// The catalog's most-evidenced plans as a short row of compact cards, between
// the featured card and the grid. The ranking and the evidence bar live in
// lib/explorePage.ts (trendingShelfPicks) and lib/discovery.ts; this component
// only draws the picks it is given. It draws nothing when the list is empty.
// The whole card is one link to the plan; the creator's byline is the second
// link, raised above the card's stretched link.
import { useId, type CSSProperties } from 'react'
import { Eye } from 'lucide-react'
import type { PublishedItinerary, User } from '../../data/types'
import { appLink } from '../../lib/appLink'
import { Avatar } from '../ui'
import { ExploreCover } from './ExploreCover'
import { ExploreFacts } from './ExploreFacts'

/** Views in words: "1 view", "26 views". The noun changes shape, so both are passed. */
function viewCount(n: number): string {
  return `${n} ${n === 1 ? 'view' : 'views'}`
}

export function TrendingShelf({ pubs, users }: { pubs: PublishedItinerary[]; users: User[] }) {
  const titleId = useId()
  if (pubs.length === 0) return null
  return (
    <section className="ex-trend" aria-labelledby={titleId}>
      <div className="ex-trend-head">
        <h2 className="ex-trend-title" id={titleId}>Trending now</h2>
        <p className="ex-trend-sub">The plans the community is copying and reading.</p>
      </div>
      <ol className="ex-trend-list">
        {pubs.map((pub, index) => {
          const creator = users.find(user => user.id === pub.creatorId)
          const creatorName = creator?.profile.name ?? 'Creator'
          const enterDelay: CSSProperties = { animationDelay: `calc(var(--stagger-step) * ${Math.min(index, 4)})` }
          return (
            <li key={pub.id} className="ex-trend-item ex-enter" style={enterDelay}>
              <article className="ex-trend-card" data-id={pub.id}>
                <div className="ex-trend-cover">
                  <ExploreCover pub={pub} />
                  <span className="ex-trend-rank" aria-hidden="true">{index + 1}</span>
                </div>
                <div className="ex-trend-body">
                  <h3 className="ex-trend-name">
                    <a className="ex-trend-link" {...appLink(`/pub/${pub.id}`)}>{pub.title}</a>
                  </h3>
                  <p className="ex-trend-views">
                    <Eye size={13} aria-hidden />{viewCount(pub.views)}
                  </p>
                  <ExploreFacts pub={pub} />
                  <a className="ex-byline" {...appLink(`/creator/${pub.creatorId}`)} aria-label={`View ${creatorName}'s page`}>
                    <Avatar user={creator} />
                    <span>{creatorName}</span>
                  </a>
                </div>
              </article>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
