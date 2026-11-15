import { useState } from 'react'
import type { CreatorRankRow } from '../../lib/creatorRank'
import type { CachedUser } from '../../data/types'
import { Avatar, Chip } from '../ui'
import { appLink } from '../../lib/appLink'

export function RankTable({ rows, me, users, visibleCount, total, onShowMore }: {
  rows: CreatorRankRow[]
  me?: string | null
  users: CachedUser[]
  visibleCount: number
  total: number
  onShowMore: () => void
}) {
  const [plainTable, setPlainTable] = useState(false)
  const shown = rows.slice(0, Math.max(0, visibleCount))
  return (
    <section className="cr-card cr-rk-table" aria-labelledby="cr-rk-table-title">
      <div className="cr-head">
        <div>
          <h2 id="cr-rk-table-title" className="cr-head__title">Full rankings</h2>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" aria-pressed={plainTable} onClick={() => setPlainTable(value => !value)}>
          Show as a plain table
        </button>
      </div>

      {plainTable ? (
        <div className="cr-rk-table__scroll">
          <table className="cr-rk-table__plain">
            <thead>
              <tr><th scope="col">Rank</th><th scope="col">Creator</th><th scope="col">Known for</th><th scope="col">Forks</th><th scope="col">Live routes</th><th scope="col">Views</th><th scope="col">View page</th></tr>
            </thead>
            <tbody>
              {shown.map(row => <RankTableRow key={row.id} row={row} me={me} users={users} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="cr-rk-table__rows">
          {shown.map(row => <RankRow key={row.id} row={row} me={me} users={users} />)}
        </ul>
      )}

      {total > 0 && (
        <p className="cr-rk-table__count">Showing {shown.length} of {total}</p>
      )}
      {shown.length < rows.length && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onShowMore}>Show 25 more</button>
      )}
    </section>
  )
}

function RankRow({ row, me, users }: {
  row: CreatorRankRow
  me?: string | null
  users: CachedUser[]
}) {
  const user = users.find(candidate => candidate.id === row.id)
  const isMe = row.id === me
  return (
    <li className="cr-rk-table__row" data-you={isMe ? 'true' : undefined}>
      <span className="cr-rk-table__rank">{row.rank}</span>
      <span className="cr-rk-table__creator">
        <Avatar user={user} />
        <span>{row.name}</span>
        {isMe && <Chip tone="teal">You</Chip>}
      </span>
      <span className="cr-rk-table__known"><Chip>{row.knownFor}</Chip></span>
      <span className="cr-rk-table__value"><b>{row.forks}</b> forks</span>
      <span className="cr-rk-table__value"><b>{row.plans}</b> routes</span>
      <span className="cr-rk-table__value"><b>{row.views}</b> views</span>
      <a className="btn btn-secondary btn-sm" {...appLink(`/creator/${row.id}` as `/${string}`)}>View page</a>
    </li>
  )
}

function RankTableRow({ row, me, users }: {
  row: CreatorRankRow
  me?: string | null
  users: CachedUser[]
}) {
  const user = users.find(candidate => candidate.id === row.id)
  const isMe = row.id === me
  return (
    <tr data-you={isMe ? 'true' : undefined}>
      <td>{row.rank}</td>
      <td><span className="cr-rk-table__creator"><Avatar user={user} /><span>{row.name}</span>{isMe && <Chip tone="teal">You</Chip>}</span></td>
      <td><Chip>{row.knownFor}</Chip></td>
      <td>{row.forks}</td>
      <td>{row.plans}</td>
      <td>{row.views}</td>
      <td><a {...appLink(`/creator/${row.id}` as `/${string}`)}>View page</a></td>
    </tr>
  )
}
