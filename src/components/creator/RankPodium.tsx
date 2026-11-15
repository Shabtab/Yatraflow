import type { CreatorRankRow } from '../../lib/creatorRank'
import type { CachedUser, PublishedItinerary } from '../../data/types'
import { Avatar } from '../ui'
import { ExploreCover } from '../explore/ExploreCover'
import { appLink } from '../../lib/appLink'

export function RankPodium({ rows, users, leadRouteFor }: {
  rows: CreatorRankRow[]
  users: CachedUser[]
  leadRouteFor?: (id: string) => PublishedItinerary | undefined
}) {
  // Second, first, third: the winner stands in the middle.
  const top = rows.slice(0, 3)
  const podiumRows = top.length > 1 ? [top[1], top[0], ...top.slice(2)] : top
  return (
    <div className="cr-rk-podium__grid">
      {podiumRows.map(row => {
        const user = users.find(candidate => candidate.id === row.id)
        const lead = leadRouteFor?.(row.id)
        return (
          <article key={row.id} className="cr-card cr-rk-podium__card" data-place={row.rank}>
            {lead && <div className="cr-rk-podium__cover"><ExploreCover pub={lead} /></div>}
            <div className="cr-rk-podium__body">
              <span className="cr-rk-podium__place">{ordinal(row.rank)}</span>
              <div className="cr-rk-podium__identity">
                <Avatar user={user} size="lg" />
                <h3 className="cr-rk-podium__name">{row.name}</h3>
              </div>
              <dl className="cr-rk-podium__facts">
                <div><dt>Forks</dt><dd>{row.forks}</dd></div>
                <div><dt>Live routes</dt><dd>{row.plans}</dd></div>
                <div><dt>Views</dt><dd>{row.views}</dd></div>
              </dl>
              <a className="btn btn-secondary btn-sm" {...appLink(`/creator/${row.id}` as `/${string}`)}>View page</a>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function ordinal(rank: number): string {
  if (rank === 1) return '1st'
  if (rank === 2) return '2nd'
  if (rank === 3) return '3rd'
  return `${rank}th`
}
