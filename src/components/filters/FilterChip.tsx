// ============ Filters — toggle chip ============
// A pill button that is either pressed or not. Pressed fills with the ink
// colour. An optional count sits after the label. The look is the ex-chip block
// in styles.css.
import type { ReactNode } from 'react'

export function FilterChip({ pressed, onClick, count, className, children }: {
  pressed: boolean
  onClick: () => void
  /** A number shown after the label. Leave it out for none. */
  count?: number
  /** An extra class, for a chip that wears its own pressed colour. */
  className?: string
  children: ReactNode
}) {
  return (
    <button type="button" className={className ? `ex-chip ${className}` : 'ex-chip'} aria-pressed={pressed} onClick={onClick}>
      {children}
      {count !== undefined && <span className="ex-chip-count">{count}</span>}
    </button>
  )
}
