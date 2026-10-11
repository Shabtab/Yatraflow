// ============ Explore — the four labelled facts ============
// Days, Budget, Places and Forks, in the order cardColumns() gives them. Label
// over value, the same pattern as the My trips cards.
import type { PublishedItinerary } from '../../data/types'
import { cardColumns } from '../../lib/explorePage'

export function ExploreFacts({ pub }: { pub: PublishedItinerary }) {
  return (
    <dl className="ex-facts">
      {cardColumns(pub).map(fact => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
