import type { ActivityEvent } from '../../lib/creatorHub'
import type { RowsView } from '../../lib/readState'
import type { UnlockRead } from '../TrendChart'
import { formatInr } from '../../lib/engine'
import { StateBlock } from '../page/StateBlock'
import { CrSectionHead } from './CrSectionHead'

function eventText(event: ActivityEvent): string {
  switch (event.kind) {
    case 'unlocked': return `${event.route} unlocked · ${formatInr(event.netInr)} net`
    case 'forked': return `${event.route} · ${event.count} ${event.count === 1 ? 'fork' : 'forks'}`
    case 'published': return `${event.route} published`
    case 'updated': return `${event.route} updated`
  }
}

export function HubActivity({ events, salesRead, trafficRead, publicationsView, salesKeptAt, trafficKeptAt }: {
  events: readonly ActivityEvent[]
  salesRead: UnlockRead
  trafficRead: UnlockRead
  publicationsView: RowsView
  salesKeptAt: number | null
  trafficKeptAt: number | null
}) {
  const publicationsKnown = publicationsView === 'rows' || publicationsView === 'empty' || publicationsView === 'kept'
  const partial = salesRead !== 'ready' || trafficRead !== 'ready' || !publicationsKnown
  const rows = events.filter(event => event.kind === 'unlocked' ? salesRead === 'ready'
    : event.kind === 'forked' ? trafficRead === 'ready' && publicationsKnown : publicationsKnown)
  return (
    <section className="cr-card cr-hub-activity" aria-labelledby="hub-activity-h">
      <CrSectionHead title="Activity" id="hub-activity-h" />
      {partial && <StateBlock kind={salesRead === 'failed' || trafficRead === 'failed' || publicationsView === 'failed' ? 'failed' : 'loading'} size="compact"
        title="Some activity is unavailable." body="Only events from loaded reads appear here. Use the read controls above to try again." />}
      {(salesKeptAt !== null || trafficKeptAt !== null || publicationsView === 'kept') &&
        <p className="cr-tile__note">Some events use the last loaded reads. Check the read times above.</p>}
      {rows.length > 0 ? <ul className="cr-hub-events">
        {rows.map((event, index) => <li className="cr-hub-event" data-kind={event.kind} key={`${event.kind}-${event.at}-${index}`}>
          <span className="cr-hub-event-dot" aria-hidden="true" />
          <span>{eventText(event)}</span>
          <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</time>
        </li>)}
      </ul> : !partial && <StateBlock kind="empty" size="compact" title="No recorded activity yet." />}
    </section>
  )
}
