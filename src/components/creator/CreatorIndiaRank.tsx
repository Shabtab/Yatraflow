import { useDb, rereadPublicSlices } from '../../store/store'
import { creatorRankSummary } from '../../lib/creatorRank'
import { sliceState } from '../../lib/readState'
import { appLink } from '../../lib/appLink'
import { countNoun } from '../../lib/creatorCopy'

export function CreatorIndiaRank({ creatorId }: { creatorId: string }) {
  const db = useDb()
  const summary = creatorRankSummary(db.published, db.users, creatorId,
    sliceState(db.sliceReads, 'suggested itineraries'), sliceState(db.sliceReads, 'profiles'))
  if (summary.kind === 'unranked') return null
  return <div className="cr-india-rank" role={summary.kind === 'failed' ? 'status' : undefined}>
    {summary.kind === 'ready'
      ? <a {...appLink('/creators')}>India rank: #{summary.position.rank} · Of {countNoun(summary.position.total, 'creator')} · All time</a>
      : summary.kind === 'reading' ? <span>India rank: Loading…</span>
        : <><span>India rank: Unavailable</span><button type="button" className="btn btn-outline btn-sm"
            onClick={() => { void rereadPublicSlices() }}>Retry ranking</button></>}
  </div>
}
