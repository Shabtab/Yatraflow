// ============ My trips — the labelled facts ============
// Budget, travel time and dates as three labelled columns. The grid card and
// the Up next card both use it, so the facts read the same on both.
import type { ReactNode } from 'react'
import { Calendar, Clock, Wallet } from 'lucide-react'

export function TripFacts({ budget, travel, dates }: {
  /** The per-person budget text. The page owns it, so the estimate marker stays in one place. */
  budget: ReactNode
  travel: ReactNode
  dates: ReactNode
}) {
  return (
    <ul className="mt-stats">
      <li>
        <Wallet size={15} aria-hidden className="mt-stat-ico" />
        <span className="mt-stat-lab">Budget</span>
        <span className="mt-stat-val">{budget}</span>
      </li>
      <li>
        <Clock size={15} aria-hidden className="mt-stat-ico" />
        <span className="mt-stat-lab">Travel</span>
        <span className="mt-stat-val">{travel}</span>
      </li>
      <li>
        <Calendar size={15} aria-hidden className="mt-stat-ico" />
        <span className="mt-stat-lab">Dates</span>
        <span className="mt-stat-val">{dates}</span>
      </li>
    </ul>
  )
}
