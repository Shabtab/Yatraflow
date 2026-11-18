// ============ My trips — per-day state strip ============
// One cell per day with a colour bar and a word, so colour never carries the
// state alone: "All clear", "3 to fix" or "Not planned". The cells come from
// the engine's grouped warnings (see lib/tripDayStrip).
import type { DayCell } from '../../lib/tripDayStrip'

export function DayStrip({ cells }: { cells: DayCell[] }) {
  if (cells.length === 0) return null
  return (
    <ul className="mt-days" aria-label="Day checks">
      {cells.map(cell => (
        <li key={cell.dayNumber} className={`mt-day mt-day--${cell.tone}`}>
          <span className="mt-day-n">Day {cell.dayNumber}</span>
          <i className="mt-day-bar" aria-hidden="true" />
          <span className="mt-day-label">{cell.label}</span>
        </li>
      ))}
    </ul>
  )
}
