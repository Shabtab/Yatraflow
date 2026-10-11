// ============ Filters — search field ============
// The search box both catalog pages share: an icon at the left, a clear button
// at the right when there is text. The visible look is the ex-search block in
// styles.css. The label is for screen readers.
import { useEffect, useId, useState } from 'react'
import { Search, X } from 'lucide-react'

/** A phone has room for a short placeholder only; the long one is cut off. */
export function useShortPlaceholder(): boolean {
  const [short, setShort] = useState(() => typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 640px)').matches ?? false))
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 640px)')
    if (!query) return
    const sync = () => setShort(query.matches)
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return short
}

export function SearchField({ value, onChange, label, placeholder, shortPlaceholder }: {
  value: string
  onChange: (next: string) => void
  /** The accessible name of the field. It is not drawn. */
  label: string
  placeholder: string
  /** The placeholder to use on a phone. */
  shortPlaceholder: string
}) {
  const inputId = useId()
  const useShort = useShortPlaceholder()
  return (
    <div className="ex-search">
      <label className="sr-only" htmlFor={inputId}>{label}</label>
      <Search className="ex-search-icon" size={18} aria-hidden />
      <input id={inputId} className="ex-search-input" type="search" autoComplete="off"
        placeholder={useShort ? shortPlaceholder : placeholder} value={value}
        onChange={e => onChange(e.target.value)} />
      {value.trim() !== '' && (
        <button type="button" className="ex-search-clear" aria-label="Clear search" onClick={() => onChange('')}>
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  )
}
