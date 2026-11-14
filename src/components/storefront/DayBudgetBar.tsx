// P11: one day's time budget, drawn from the engine's own minutes.
// Driving, at places, free. It reads minutes only, so a locked day may show it:
// A locked day supplies no clock edges, names or coordinates.
import type { CSSProperties } from 'react'
import { minutesToHM } from '../../lib/engine'
import { staggerStep } from '../../lib/motion'

export interface DayBudget {
  /** Minutes on the road. Ground legs only: a flight is not a drive. */
  drive: number
  /** Minutes spent at places. */
  places: number
  /** The planning window in minutes, from the day's start to the day's end. */
  window: number
  /** The window's edges, already formatted for the viewer's clock. */
  from?: string
  to?: string
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(Number.isFinite(n) ? n : 0, lo), hi)

export function DayBudgetBar(p: {
  budget: DayBudget
  /** "Day 4". It opens the accessible name. */
  label: string
  /** Show the written key under the bar. The ride-along header does. */
  legend?: boolean
  stagger?: number
}): JSX.Element {
  const window = Math.max(1, p.budget.window)
  const drive = clamp(p.budget.drive, 0, window)
  const places = clamp(p.budget.places, 0, window - drive)
  const free = window - drive - places
  const parts = [
    { key: 'drive', minutes: drive },
    { key: 'places', minutes: places },
    { key: 'free', minutes: free },
  ].filter((s) => s.minutes > 0)
  const clock = p.budget.from && p.budget.to ? `, ${p.budget.from} to ${p.budget.to}` : ''
  const name = `${p.label} time budget${clock}: driving ${minutesToHM(drive)}, at places ${minutesToHM(places)}, free ${minutesToHM(free)}`
  return (
    <div className="pi-budget" style={{ '--i': staggerStep(p.stagger ?? 0) } as CSSProperties}>
      <div
        className="pi-budget-bar"
        role="img"
        aria-label={name}
        style={{ gridTemplateColumns: parts.map((s) => `${s.minutes}fr`).join(' ') }}
      >
        {parts.map((s) => <span key={s.key} className={'pi-budget-seg pi-budget-' + s.key} />)}
      </div>
      {p.legend ? (
        <div className="pi-budget-key" aria-hidden="true">
          <span><i className="pi-budget-dot pi-budget-drive" />Driving {minutesToHM(drive)}</span>
          <span><i className="pi-budget-dot pi-budget-places" />At places {minutesToHM(places)}</span>
          <span><i className="pi-budget-dot pi-budget-free" />Free {minutesToHM(free)}</span>
        </div>
      ) : null}
    </div>
  )
}
