import type { ReactNode } from 'react'
import { appLink } from '../../lib/appLink'
import { CrDelta } from './CrDelta'

type AppRoute = `/${string}`

/** Rank tile (cr-rank). With href it is a link: appLink keeps in-app
 *  navigation inside the running document. A null rank shows "Unavailable". */
export function CrRankTile({
  scope,
  rank,
  total,
  delta,
  href,
}: {
  scope: ReactNode
  rank: number | null
  total: number
  delta?: number
  href?: AppRoute
}) {
  const body = (
    <>
      <div className="cr-rank__scope">{scope}</div>
      {rank === null ? (
        <div className="cr-rank__value cr-tile__value--none">Unavailable</div>
      ) : (
        <div className="cr-rank__value">#{rank}</div>
      )}
      <div className="cr-rank__total">of {total} creators</div>
      {delta !== undefined && <CrDelta value={delta} />}
    </>
  )

  if (href) {
    return <a className="cr-rank" {...appLink(href)}>{body}</a>
  }
  return <div className="cr-rank">{body}</div>
}
