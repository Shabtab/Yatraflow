// ============ Explore — the four labelled facts ============
// Days, Budget, Places and Forks, in the order cardColumns() gives them. Label
// over value, the same pattern as the My trips cards.
//
// The label already says what the figure counts, so the value drops its unit
// word: "10 days" prints as 10, and "~₹15k/person" prints as ~₹15k. Four facts
// then fit one row on a three-up card. The budget keeps its tilde because it is
// an estimate, and its tooltip says so.
import type { PublishedItinerary } from '../../data/types'
import { cardColumns } from '../../lib/explorePage'

/** The value without its unit word. The label carries the unit. */
function shortValue(label: string, value: string): string {
  if (label === 'Days') return value.replace(/\s*days?$/i, '')
  if (label === 'Budget') return value.replace(/\/person$/i, '')
  return value
}

export function ExploreFacts({ pub }: { pub: PublishedItinerary }) {
  return (
    <dl className="ex-facts">
      {cardColumns(pub).map(fact => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd title={fact.label === 'Budget' ? `Estimate: ${fact.value}` : undefined}>{shortValue(fact.label, fact.value)}</dd>
        </div>
      ))}
    </dl>
  )
}
