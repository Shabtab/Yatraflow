// ============ Location autocomplete ============
// Debounced search against Open-Meteo's free geocoding API (no API key).
// Keyboard navigable: ↑/↓ to move, Enter to pick, Esc to dismiss.
import { useEffect, useRef, useState } from 'react'

export interface PlaceHit {
  id: number
  name: string
  latitude: number
  longitude: number
  admin1?: string
  country?: string
  country_code?: string
}

interface Props {
  value: string
  onChange: (v: string) => void
  /** Fired when the user picks a real place — gives you verified coordinates. */
  onPick?: (place: PlaceHit) => void
  placeholder?: string
  error?: string
  autoFocus?: boolean
  /** Bias results toward India by default; set false for worldwide. */
  indiaOnly?: boolean
}

export function LocationInput({ value, onChange, onPick, placeholder, error, autoFocus, indiaOnly = true }: Props) {
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // track whether the last edit was typing vs a programmatic pick
  const skipSearchRef = useRef(false)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function runSearch(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.trim().length < 2) { setHits([]); setLoading(false); setSearched(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const cc = indiaOnly ? '&countryCode=IN' : ''
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=6&language=en&format=json${cc}`,
        )
        const data = await res.json()
        const results: PlaceHit[] = data.results ?? []
        setHits(results)
        setSearched(true)
        setOpen(true)
        setHighlight(0)
        setLoading(false)
      } catch {
        setHits([])
        setSearched(true)
        setLoading(false)
      }
    }, 280)
  }

  function choose(hit: PlaceHit) {
    skipSearchRef.current = true
    onChange(hit.name + (hit.admin1 ? `, ${hit.admin1}` : ''))
    onPick?.(hit)
    setOpen(false)
    setHits([])
    setLoading(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || hits.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (hits[highlight]) choose(hits[highlight]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className="input"
        style={error ? { borderColor: 'var(--danger)' } : undefined}
        value={value}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={e => {
          onChange(e.target.value)
          skipSearchRef.current = false
          runSearch(e.target.value)
        }}
        onFocus={() => { if (hits.length > 0) setOpen(true) }}
        onKeyDown={onKeyDown}
        aria-autocomplete="list"
        aria-expanded={open}
        role="combobox"
      />
      {loading && <span className="loc-spinner" aria-label="Searching places" />}
      {open && hits.length > 0 && (
        <ul className="loc-dropdown" role="listbox">
          {hits.map((hit, i) => (
            <li key={hit.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`loc-option ${i === highlight ? 'hl' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(hit)}
              >
                <span className="loc-pin">📍</span>
                <span className="loc-name">{hit.name}</span>
                <span className="loc-region">{[hit.admin1, hit.country].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && searched && hits.length === 0 && value.trim().length >= 2 && (
        <div className="loc-empty">No places matched “{value.trim()}”. You can still use this text as-is.</div>
      )}
    </div>
  )
}
