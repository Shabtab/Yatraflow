// ============ Explore - trending shelf ============
// The catalog's most-evidenced plans, between the featured card and the grid.
// The ranking and the evidence bar live in lib/explorePage.ts
// (trendingShelfPicks) and lib/discovery.ts; this component only draws the
// picks it is given. It draws nothing when the list is empty.
//
// Each pick is the one publication card (ExploreCard) the grid draws, in the
// same three-column grid, so a plan reads the same in the shelf and below it.
// The save heart, the cover art and the Fork button come with that card.
import { useId } from 'react'
import type { PublishedItinerary, CachedUser } from '../../data/types'
import { ExploreCard } from './ExploreCard'

export function TrendingShelf({ pubs, users, isSaved, needsLogin, onFork, onToggleSave }: {
  pubs: PublishedItinerary[]
  users: CachedUser[]
  isSaved: (id: string) => boolean
  /** Signed out, Fork goes to the login page, so the button says so. */
  needsLogin: boolean
  onFork: (id: string) => void
  onToggleSave: (id: string) => void
}) {
  const titleId = useId()
  if (pubs.length === 0) return null
  return (
    <section className="ex-trend" aria-labelledby={titleId}>
      <div className="ex-trend-head">
        <h2 className="ex-trend-title" id={titleId}>Trending now</h2>
        <p className="ex-trend-sub">The plans the community is copying and reading.</p>
      </div>
      <div className="ex-grid ex-trend-cards">
        {pubs.map((pub, index) => (
          <ExploreCard key={pub.id} pub={pub} creator={users.find(user => user.id === pub.creatorId)}
            saved={isSaved(pub.id)} needsLogin={needsLogin} enterIndex={index} eager
            onFork={() => {
              onFork(pub.id)
            }}
            onToggleSave={() => {
              onToggleSave(pub.id)
            }}
          />
        ))}
      </div>
    </section>
  )
}
