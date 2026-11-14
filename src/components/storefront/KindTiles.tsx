// P11 trip kit: the places of a plan, by kind, as tiles. Counts only, so a
// locked day's places may be part of the tally without a name.
import type { CSSProperties } from 'react'
import { KIND_LABEL, type KindCount } from '../../lib/publicStorefront'
import { staggerStep } from '../../lib/motion'
import { KIND_CATEGORY } from './KindChip'
import { CatIcon } from '../icons'

export function KindTiles(p: { kinds: KindCount[] }): JSX.Element | null {
  if (p.kinds.length === 0) return null
  return (
    <ul className="pi-tiles">
      {p.kinds.map((k, n) => (
        <li key={k.kind} className={'pi-tile sf-kind--' + k.kind} style={{ '--i': staggerStep(n) } as CSSProperties}>
          <span className="pi-tile-icon" aria-hidden="true"><CatIcon category={KIND_CATEGORY[k.kind]} size={20} /></span>
          <b className="pi-tile-count">{k.count}</b>
          <span className="pi-tile-label">{k.count === 1 ? KIND_LABEL[k.kind].one : KIND_LABEL[k.kind].many}</span>
        </li>
      ))}
    </ul>
  )
}
