import { Lock } from 'lucide-react'
import type { DayCardProps } from '../DayCard'
import { describeKinds } from '../../../lib/publicStorefront'
import { CatIcon } from '../../icons'
import { KIND_CATEGORY } from '../KindChip'
import { RideDayPanel, type RideArtProps } from '../RidePanels'
import type { ReactNode } from 'react'

const KIND_CATEGORY_BY_KIND = new Map(Object.entries(KIND_CATEGORY))

export function RideLockedPreview(p: RideArtProps & {
  card: DayCardProps
  lastIndex: number
  action: ReactNode
  /** Distance and drive time. The other-days list shows the same facts for a locked day. */
  facts?: readonly string[]
}) {
  const { summary } = p.card
  const run = p.index === p.lastIndex ? `day ${p.index + 1}` : `days ${p.index + 1} to ${p.lastIndex + 1}`
  const kinds = summary.kinds.flatMap(kind => Array.from({ length: kind.count }, () => kind.kind))
  return <RideDayPanel {...p} state="locked" title={`Day ${p.index + 1}`}
    badge={<div className="pi-badge"><small>Day</small><b>{p.index + 1}</b></div>}
    meta="" placeCount={summary.placeCount} budget={null}
    footer={<div className="pi-ride-paid-foot"><Lock size={16} aria-hidden /><p>{describeKinds(summary.kinds)}{summary.kinds.length > 0 ? ', with clocks, opening hours and notes. ' : ''}{run[0].toUpperCase() + run.slice(1)} {p.index === p.lastIndex ? 'opens with the full plan.' : 'open together.'}</p>{p.action}</div>}>
    <ol className="pi-ride-skeletons" aria-label={`${summary.placeCount} stops in the paid plan`}>
      {kinds.map((kind, index) => <li key={index}>
        <span className={'pi-ride-stop-icon sf-kind--' + kind}><CatIcon category={KIND_CATEGORY_BY_KIND.get(kind) ?? ''} /></span>
        <span className="pi-ride-skeleton-lines" aria-hidden="true"><i /><i /></span>
        <span className="pi-pill pi-pill--paid"><Lock size={11} aria-hidden />In the paid plan</span>
      </li>)}
    </ol>
  </RideDayPanel>
}
