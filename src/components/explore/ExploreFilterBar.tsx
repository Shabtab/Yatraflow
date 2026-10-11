// ============ Explore — filter bar ============
// The search field, three selects, then the travel-style chips with counts, the
// Saved toggle and Clear. The page owns the state and the URL. This bar only
// shows it and reports taps. The bar is a stacking host, so the select menus
// open above the cards. On a phone the selects fold behind a Filters button.
import { useId, useState } from 'react'
import { ArrowDownUp, Heart, SlidersHorizontal, X } from 'lucide-react'
import { Select } from '../Select'
import { FilterChip } from '../filters/FilterChip'
import { SearchField } from '../filters/SearchField'

export interface StyleOption { value: string; label: string; count: number }

const DURATION_OPTIONS = [
  { value: 'all', label: 'Any length' },
  { value: 'short', label: '≤3 days' },
  { value: 'medium', label: '4–6 days' },
  { value: 'long', label: '7+ days' },
]
const BUDGET_OPTIONS = [
  { value: '', label: 'Any budget' },
  { value: '10000', label: 'Under ₹10k' },
  { value: '20000', label: 'Under ₹20k' },
  { value: '35000', label: 'Under ₹35k' },
  { value: '60000', label: 'Under ₹60k' },
]
const SORT_OPTIONS = [
  { value: 'popular', label: 'Most popular' },
  { value: 'newest', label: 'Newest first' },
  { value: 'budget-asc', label: 'Budget: low → high' },
  { value: 'budget-desc', label: 'Budget: high → low' },
  { value: 'duration', label: 'Longest first' },
]

export function ExploreFilterBar({
  query, onQueryChange,
  styles, style, onAllStyles, onToggleStyle,
  savedOnly, savedCount, onToggleSaved,
  duration, onDuration, maxBudget, onBudget, sortKey, onSort,
  filtersActive, onClear,
}: {
  query: string
  onQueryChange: (next: string) => void
  styles: StyleOption[]
  style: string
  onAllStyles: () => void
  onToggleStyle: (style: string) => void
  savedOnly: boolean
  savedCount: number
  onToggleSaved: () => void
  duration: string
  onDuration: (value: string) => void
  maxBudget: string
  onBudget: (value: string) => void
  sortKey: string
  onSort: (value: string) => void
  filtersActive: boolean
  onClear: () => void
}) {
  const selectsId = useId()
  const [selectsOpen, setSelectsOpen] = useState(false)
  const selectCount = (duration !== 'all' ? 1 : 0) + (maxBudget !== '' ? 1 : 0) + (sortKey !== 'popular' ? 1 : 0)
  return (
    <div className="ex-filterbar filterbar-host" role="search" aria-label="Filter itineraries">
      <div className="ex-filter-row">
        <SearchField value={query} onChange={onQueryChange} label="Search by route, place or creator"
          placeholder="Search a route, place or creator" shortPlaceholder="Search routes" />
        <button type="button" className="btn btn-secondary ex-filters-toggle" aria-expanded={selectsOpen}
          aria-controls={selectsId} onClick={() => setSelectsOpen(open => !open)}>
          <SlidersHorizontal size={15} aria-hidden />Filters
          {selectCount > 0 && <span className="ex-filters-count">{selectCount}</span>}
        </button>
        <div className={`ex-selects${selectsOpen ? ' is-open' : ''}`} id={selectsId}>
          <div className="ex-select">
            <Select value={duration} onChange={onDuration} aria-label="Duration" options={DURATION_OPTIONS} />
          </div>
          <div className="ex-select">
            <Select value={maxBudget} onChange={onBudget} aria-label="Max budget" options={BUDGET_OPTIONS} />
          </div>
          <div className="ex-select ex-select--sort">
            <ArrowDownUp className="ex-select-icon" size={15} aria-hidden />
            <Select value={sortKey} onChange={onSort} aria-label="Sort by" options={SORT_OPTIONS} />
          </div>
        </div>
      </div>
      <div className="ex-chip-row">
        <div className="ex-chips" role="group" aria-label="Travel style">
          <FilterChip pressed={style === 'all'} onClick={onAllStyles}>All styles</FilterChip>
          {styles.map(option => (
            <FilterChip key={option.value} pressed={style === option.value} count={option.count}
              onClick={() => onToggleStyle(option.value)}>
              {option.label}
            </FilterChip>
          ))}
        </div>
        <span className="ex-chip-divider" aria-hidden="true" />
        {/* Saved sits in the same wrapping row as the style chips. */}
        <button type="button" className="ex-chip ex-chip-saved" aria-pressed={savedOnly} onClick={onToggleSaved}>
          <Heart size={14} aria-hidden fill={savedOnly ? 'currentColor' : 'none'} />
          Saved{savedCount > 0 && <span className="ex-chip-count">{savedCount}</span>}
        </button>
        {filtersActive && (
          <button type="button" className="btn btn-quiet ex-clear" onClick={onClear}>
            <X size={13} aria-hidden />Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
