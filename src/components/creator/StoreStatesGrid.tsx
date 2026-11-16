// ============ States covered (creator storefront, G3b) ============
// A tile per state and union territory, placed where the state sits. The data is
// coverage only: a tile is covered or not yet, and its label is the ISO code plus
// the route count. Counts come from the state codes a publish stored. The shape
// module is never imported here; the publish path owns it.
import type { PublishedItinerary } from '../../data/types'
import { INDIA_STATE_COUNT, INDIA_STATES } from '../../data/indiaStates'
import { coveredStates } from '../../lib/creatorFacts'
import type { ReadState } from '../../lib/readState'

export function StoreStatesGrid({ pubs, read }: {
  pubs: PublishedItinerary[]
  read: ReadState
}) {
  if (read === 'reading') return <p className="container cr-states-note" role="status">Route states: Loading</p>
  if (read === 'failed') return <p className="container cr-states-note" role="status">Route states: Unavailable</p>
  const counts = coveredStates(pubs)
  if (!counts) return null
  const covered = counts.size
  return (
    <section className="container cr-states" aria-label="States covered">
      <div className="cr-states-head">
        <h2 className="cr-states-title">States covered · {covered} of {INDIA_STATE_COUNT}</h2>
        <span className="cr-states-note">Planned routes</span>
      </div>
      <div className="cr-states-grid" role="list">
        {INDIA_STATES.map(state => {
          const routes = counts.get(state.code) ?? 0
          const isCovered = routes > 0
          return (
            <div
              key={state.code}
              role="listitem"
              className="cr-states-tile"
              data-covered={isCovered}
              style={{ gridColumn: state.col + 1, gridRow: state.row + 1 }}
              aria-label={isCovered ? `${state.name}: ${routes} planned ${routes === 1 ? 'route' : 'routes'}` : `${state.name}: not yet`}
              title={isCovered ? `${state.name}: ${routes} planned ${routes === 1 ? 'route' : 'routes'}` : `${state.name}: not yet`}
            >
              <span className="cr-states-code" aria-hidden="true">{state.code}</span>
              {isCovered && <span className="cr-states-count" aria-hidden="true">{routes}</span>}
            </div>
          )
        })}
      </div>
      <div className="cr-states-legend">
        <span><i className="cr-states-mark" data-covered="true" aria-hidden="true" />Planned</span>
        <span><i className="cr-states-mark" data-covered="false" aria-hidden="true" />Not yet</span>
      </div>
    </section>
  )
}
