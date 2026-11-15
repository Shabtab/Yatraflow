import type { PublishedItinerary } from '../../data/types'
import type { ReadinessKey, ReadinessReport } from '../../lib/creatorHub'
import { ReadinessFix } from './ReadinessFix'
import { CrSectionHead } from './CrSectionHead'

const LABELS: Record<ReadinessKey, string> = {
  cover: 'Cover image',
  cost: 'Trip cost',
  freeDays: 'Free preview days',
  season: 'Best season',
  freshness: 'Updated within 90 days',
}

export function HubReadiness({ report, pubs, kept }: {
  report: ReadinessReport
  pubs: readonly PublishedItinerary[]
  kept: boolean
}) {
  const complete = report.checks.filter(check => check.failing.length === 0).length
  return (
    <section className="cr-card cr-hub-readiness" aria-labelledby="hub-readiness-h">
      <CrSectionHead title="Page readiness" id="hub-readiness-h" note={`${complete} of 5`} />
      {kept && <p className="cr-tile__note">Based on the last loaded publications.</p>}
      <ul className="cr-hub-checks">
        {report.checks.map(check => <li className="cr-hub-check" key={check.key}>
          <span>{LABELS[check.key]}</span>
          {check.failing.length === 0 ? <span className="cr-tile__note">Ready</span> : <ReadinessFix checkLabel={LABELS[check.key]} failing={check.failing} pubs={pubs} />}
        </li>)}
      </ul>
    </section>
  )
}
