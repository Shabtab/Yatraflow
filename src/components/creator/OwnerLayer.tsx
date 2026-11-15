import { ReadinessFix } from './ReadinessFix'
import { countNoun, sourceDisplayLabel } from '../../lib/creatorCopy'
import type { PublishedItinerary, PublicUser } from '../../data/types'
import { readiness, kpiWindows, type ReadinessKey } from '../../lib/creatorHub'
import { ownerActivityCsv, type OwnerRead, type OwnerReads } from '../../lib/creatorOwnerReads'
import { funnelWindowStart, formatPct } from '../../lib/pubFunnel'
import { appLink } from '../../lib/appLink'
import { Avatar, CopyButton } from '../ui'
import { StateBlock } from '../page/StateBlock'
import { CrMeterRow } from './CrMeterRow'
import type { ReadState } from '../../lib/readState'

const CHECK_LABELS: Record<ReadinessKey, string> = {
  cover: 'Add a route cover', cost: 'Set a trip cost', freeDays: 'Add free days to paid routes',
  season: 'Add the best season', freshness: 'Review routes within 90 days',
}

function ReadNote<T>({ read, label, retry, rowCount }: { read: OwnerRead<T>; label: string; retry: () => void; rowCount?: number }) {
  const actions = <button className="btn btn-ghost btn-sm" onClick={retry}>Try again</button>
  if (read.kind === 'reading') return <StateBlock size="compact" kind="loading" title={`Loading ${label}`} />
  if (read.kind === 'failed') return <StateBlock size="compact" kind="failed" title={`Could not load ${label}`} actions={actions} />
  if (read.kind === 'kept') return <StateBlock size="compact" kind="kept" title={`Kept ${label}`}
    body={`Refresh failed. Last read ${new Date(read.at).toLocaleString()}.`} actions={actions} />
  if ((rowCount ?? read.data.length) === 0) return <StateBlock size="compact" kind="empty" title={`No ${label} in this range`} />
  return null
}

function downloadCsv(csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'creator-activity.csv'
  link.click()
  URL.revokeObjectURL(url)
}

export interface OwnerLayerProps {
  creator: PublicUser
  pubs: PublishedItinerary[]
  pubsRead: ReadState
  retryPubs: () => void
  shareLink: string
  now: number
  reads: OwnerReads
  retry: () => void
  onPreview: () => void
}

export function OwnerLayer({ creator, pubs, pubsRead, retryPubs, shareLink, now, reads, retry, onPreview }: OwnerLayerProps) {
  const report = readiness(pubs, now)
  const done = report.checks.filter(check => check.failing.length === 0).length
  const start = funnelWindowStart(30, now)
  const daily = reads.funnel.data?.filter(row => {
    const at = Date.parse(`${row.day}T00:00:00Z`)
    return at >= start && at <= now
  }) ?? []
  const sales = reads.sales.data?.filter(row => row.grantedAt >= start && row.grantedAt <= now) ?? []
  const visits = reads.visits.data?.filter(row => {
    const at = Date.parse(`${row.day}T00:00:00Z`)
    return at >= start && at <= now
  }) ?? []
  const figures = kpiWindows(daily, sales, 30, now).current
  const pageVisits = visits.reduce((sum, row) => sum + row.visits, 0)
  const readable = (read: OwnerRead<unknown>) => read.kind === 'ready' || read.kind === 'kept'
  const metrics = [
    { label: 'Page visits', value: readable(reads.visits) ? pageVisits : null, tone: 'route' },
    { label: 'Route opens', value: readable(reads.funnel) ? figures.views : null, tone: 'lagoon' },
    { label: 'Copies', value: readable(reads.funnel) ? figures.forks : null, tone: 'lagoon-deep' },
    { label: 'Unlocks', value: readable(reads.sales) ? figures.unlocks : null, tone: 'marigold' },
  ] as const
  const max = Math.max(1, ...metrics.map(metric => metric.value ?? 0))
  const sourceMax = Math.max(1, ...(reads.sources.data ?? []).map(row => row.views))
  const canExport = [reads.funnel, reads.sales, reads.visits].every(readable)
  return (
    <section className="container cr-own" aria-label="Private creator activity">
      <div className="cr-divider cr-own-divider">
        <span>Your page · only you see this part</span>
        <span>Visitors see everything above, nothing below</span>
      </div>
      <div className="cr-own-bar">
        <Avatar user={creator} />
        <div className="cr-own-identity">
          <strong>This is your public page</strong>
          <p>{shareLink} · live · {pubsRead === 'ready' ? countNoun(pubs.length, 'route') : 'Routes unavailable'}</p>
        </div>
        <div className="cr-own-actions">
          <button className="btn btn-secondary btn-sm" onClick={onPreview}>Preview as a visitor</button>
          <a className="btn btn-secondary btn-sm" {...appLink('/creator-hub')}>Edit page</a>
          <CopyButton text={shareLink} label="Share" />
        </div>
      </div>
      <div className="cr-own-grid">
        <section className="cr-card cr-own-readiness" aria-label="Page readiness">
          <h2 className="cr-card__title">Page readiness</h2>
          {pubsRead !== 'ready' && <StateBlock size="compact"
            kind={pubsRead === 'reading' ? 'loading' : pubs.length ? 'kept' : 'failed'}
            title={pubsRead === 'reading' ? 'Loading readiness' : pubs.length ? 'Kept readiness checks' : 'Could not load readiness'}
            body="The checklist needs a current route list."
            actions={pubsRead === 'failed' ? <button className="btn btn-ghost btn-sm" onClick={retryPubs}>Try again</button> : undefined} />}
          {pubsRead === 'ready' && pubs.length === 0
            ? <StateBlock size="compact" kind="empty" title="Publish a route to check readiness" />
            : (pubsRead === 'ready' || pubs.length > 0) && <>
              <p>{done} of 5 done{pubsRead !== 'ready' ? ' · last loaded routes' : ''}</p>
              <ul className="cr-own-checks">{report.checks.map(check => (
                <li className="cr-own-check" key={check.key}>
                  <span>{check.failing.length ? 'Open' : 'Done'} · {CHECK_LABELS[check.key]}</span>
                  <ReadinessFix className="btn btn-ghost btn-sm" checkLabel={CHECK_LABELS[check.key]}
                    failing={check.failing} pubs={pubs} />
                </li>
              ))}</ul>
            </>}
        </section>
        <section className="cr-card cr-own-activity" aria-label="Your activity · private">
          <h2 className="cr-card__title">Your activity · private</h2>
          <p>{new Date(start).toISOString().slice(0, 10)} to {new Date(now).toISOString().slice(0, 10)} · UTC</p>
          <button className="btn btn-ghost btn-sm" disabled={!canExport}
            onClick={() => downloadCsv(ownerActivityCsv(daily, sales, visits, now))}>Export CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={retry}>Refresh activity</button>
          <ReadNote read={reads.visits} rowCount={visits.length} label="page visits" retry={retry} />
          <ReadNote read={reads.funnel} rowCount={daily.length} label="route activity" retry={retry} />
          <ReadNote read={reads.sales} rowCount={sales.length} label="unlocks" retry={retry} />
          {metrics.map(metric => <CrMeterRow key={metric.label} label={metric.label} tone={metric.tone}
            value={metric.value ?? 'Unavailable'} pct={(metric.value ?? 0) / max * 100} />)}
          <p className="cr-own-ratios">{readable(reads.funnel) && readable(reads.sales)
            ? figures.views > 0
              ? `${formatPct(figures.forks / figures.views * 100)} copies per open · ${formatPct(figures.unlocks / figures.views * 100)} unlocks per open`
              : 'Ratios need route opens.'
            : 'Ratios unavailable.'}</p>
        </section>
        <section className="cr-card cr-own-sources" aria-label="Where visits came from">
          <h2 className="cr-card__title">Where visits came from</h2>
          <p>Route opens and copies by share source, over the last 30 days. Page visits are counted separately.</p>
          <ReadNote read={reads.sources} label="share sources" retry={retry} />
          {readable(reads.sources) && reads.sources.data?.map(row => <CrMeterRow key={row.source}
            label={sourceDisplayLabel(row.source)} value={row.views} pct={row.views / sourceMax * 100} tone="lagoon"
            note={countNoun(row.forks, 'copy', 'copies')} />)}
        </section>
      </div>
      <p className="cr-own-note">Dated counts for your own use. Nothing here is shown to visitors.</p>
    </section>
  )
}
