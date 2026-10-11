// ============ Explore — creators ============
// Each creator with a live plan, ranked by forks. Each row links to the
// creator's public page. The panel is not drawn when no creator has a plan.
import { useId } from 'react'
import { Sparkles } from 'lucide-react'
import type { User } from '../../data/types'
import { appLink } from '../../lib/appLink'
import type { CreatorTile } from '../../lib/explorePage'
import { Avatar } from '../ui'

export function CreatorsPanel({ rows, users }: { rows: CreatorTile[]; users: User[] }) {
  const titleId = useId()
  if (rows.length === 0) return null
  return (
    <section className="ex-panel" aria-labelledby={titleId}>
      <h2 className="ex-panel-title" id={titleId}>Creators</h2>
      <ul className="ex-creators">
        {rows.map(row => (
          <li key={row.id}>
            <a className="ex-creator" {...appLink(`/creator/${row.id}`)}>
              <Avatar user={users.find(user => user.id === row.id)} />
              <span className="ex-creator-text">
                <span className="ex-creator-name">
                  {row.name}
                  {row.isCreator && <Sparkles size={12} aria-hidden className="ex-inline-icon" />}
                </span>
                <span className="ex-creator-meta">
                  {row.plans} {row.plans === 1 ? 'itinerary' : 'itineraries'} · {row.forks} {row.forks === 1 ? 'fork' : 'forks'}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
