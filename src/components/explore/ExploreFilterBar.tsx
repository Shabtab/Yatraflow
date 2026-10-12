// ============ Explore — filter bar ============
// The search field, three selects, then the travel-style chips with counts, the
// Saved toggle and Clear. The page owns the state and the URL. This bar only
// shows it and reports taps. The frame, the stacking host and the phone Filters
// fold come from FilterBar. This file only fills its slots.
import { ArrowDownUp, Heart } from 'lucide-react'
import { Select } from '../Select'
import { FilterChip } from '../filters/FilterChip'
import { SearchField } from '../filters/SearchField'
import { FilterBar } from '../page/FilterBar'

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
  const selectCount = (duration !== 'all' ? 1 : 0) + (maxBudget !== '' ? 1 : 0) + (sortKey !== 'popular' ? 1 : 0)
  return (
    <FilterBar
      label="Filter itineraries"
      search={
        <SearchField value={query} onChange={onQueryChange} label="Search by route, place or creator"
          placeholder="Search a route, place or creator" shortPlaceholder="Search routes" />
      }
      activeSelectCount={selectCount}
      selects={
        <>
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
        </>
      }
      chips={
        <div className="ex-chips" role="group" aria-label="Travel style">
          <FilterChip pressed={style === 'all'} onClick={onAllStyles}>All styles</FilterChip>
          {styles.map(option => (
            <FilterChip key={option.value} pressed={style === option.value} count={option.count}
              onClick={() => onToggleStyle(option.value)}>
              {option.label}
            </FilterChip>
          ))}
        </div>
      }
      trailing={
        // Saved sits in the same wrapping row as the style chips.
        <button type="button" className="ex-chip ex-chip-saved" aria-pressed={savedOnly} onClick={onToggleSaved}>
          <Heart size={14} aria-hidden fill={savedOnly ? 'currentColor' : 'none'} />
          Saved{savedCount > 0 && <span className="ex-chip-count">{savedCount}</span>}
        </button>
      }
      onClear={filtersActive ? onClear : undefined}
    />
  )
}
