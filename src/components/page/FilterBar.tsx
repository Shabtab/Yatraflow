// ============ Filter bar ============
// The layout shell of a filter bar. It owns the frame, the stacking host that
// lets select menus open above the cards, the row of search and selects, the
// phone Filters button that folds the selects, and the chip row with its
// trailing actions and Clear button. It owns no filter state. The page passes
// every control in as a slot, so any page can fill it: Explore today, and a
// page with a different set of controls later. The class names are the
// ex-filterbar set in styles.css.
import { useId, useState, type ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'

export interface FilterBarProps {
  /** The accessible name of the bar. */
  label: string
  /** The search field. It sits first in the top row. */
  search?: ReactNode
  /** The selects, each in an ex-select wrapper. On a phone they fold behind a Filters button. */
  selects?: ReactNode
  /** How many selects are away from their default. It shows as a badge on the Filters button. */
  activeSelectCount?: number
  /** The label of the Filters button. */
  selectsLabel?: string
  /** The chip group. It sits first in the chip row. */
  chips?: ReactNode
  /** Controls after a divider in the chip row, such as a Saved toggle. */
  trailing?: ReactNode
  /** The Clear button shows when this is given. Pass it only while a filter is active. */
  onClear?: () => void
  /** The label of the Clear button. */
  clearLabel?: string
  /** Extra classes on the bar. */
  className?: string
}

export function FilterBar({
  label,
  search,
  selects,
  activeSelectCount = 0,
  selectsLabel = 'Filters',
  chips,
  trailing,
  onClear,
  clearLabel = 'Clear filters',
  className,
}: FilterBarProps) {
  const selectsId = useId()
  const [selectsOpen, setSelectsOpen] = useState(false)
  const hasSelects = selects !== undefined && selects !== null
  const hasTrailing = trailing !== undefined && trailing !== null
  const hasChipRow = Boolean(chips) || hasTrailing || onClear !== undefined
  const barClassName = className ? `ex-filterbar filterbar-host ${className}` : 'ex-filterbar filterbar-host'
  return (
    <div className={barClassName} role="search" aria-label={label}>
      <div className="ex-filter-row">
        {search}
        {hasSelects ? (
          <>
            <button type="button" className="btn btn-secondary ex-filters-toggle" aria-expanded={selectsOpen}
              aria-controls={selectsId} onClick={() => setSelectsOpen(open => !open)}>
              <SlidersHorizontal size={15} aria-hidden />{selectsLabel}
              {activeSelectCount > 0 && <span className="ex-filters-count">{activeSelectCount}</span>}
            </button>
            <div className={`ex-selects${selectsOpen ? ' is-open' : ''}`} id={selectsId}>
              {selects}
            </div>
          </>
        ) : null}
      </div>
      {hasChipRow ? (
        <div className="ex-chip-row">
          {chips}
          {hasTrailing ? (
            <>
              <span className="ex-chip-divider" aria-hidden="true" />
              {trailing}
            </>
          ) : null}
          {onClear ? (
            <button type="button" className="btn btn-quiet ex-clear" onClick={onClear}>
              <X size={13} aria-hidden />{clearLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
