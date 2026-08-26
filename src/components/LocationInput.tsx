// ============ Location autocomplete ============
// Searches cities AND points of interest (via src/lib/geocode.ts — free, no key).
// Keyboard navigable: ↑/↓ to move, Enter to pick, Esc to dismiss.
import { useEffect, useId, useRef, useState } from 'react'
import { searchPlaces } from '../lib/geocode'
import type { PlaceHit } from '../lib/geocode'

export type { PlaceHit } from '../lib/geocode'

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
  const listId = useId()

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
        const results = await searchPlaces(q, { indiaOnly })
        setHits(results)
        setSearched(true)
        setOpen(true)
        setHighlight(0)
      } finally {
        setLoading(false)
      }
    }, 280)
  }

  function labelFor(hit: PlaceHit): string {
    if (hit.kind === 'poi') return hit.description ?? 'Point of interest'
    return [hit.admin1, hit.country].filter(Boolean).join(' · ')
  }

  function choose(hit: PlaceHit) {
    onChange(hit.name + (hit.kind === 'place' && hit.admin1 ? `, ${hit.admin1}` : ''))
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
          runSearch(e.target.value)
        }}
        onFocus={() => { if (hits.length > 0) setOpen(true) }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && hits[highlight] ? `${listId}-opt-${highlight}` : undefined}
      />
      {loading && <span className="loc-spinner" aria-label="Searching places" />}
      {open && hits.length > 0 && (
        <ul className="loc-dropdown" role="listbox" id={listId}>
          {hits.map((hit, i) => (
            <li key={hit.id} role="presentation">
              <button
                type="button"
                role="option"
                id={`${listId}-opt-${i}`}
                aria-selected={i === highlight}
                tabIndex={-1}
                className={`loc-option ${i === highlight ? 'hl' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(hit)}
              >
                {hit.thumb
                  ? <img className="loc-thumb" src={hit.thumb} alt="" loading="lazy" />
                  : <span className="loc-pin">{hit.kind === 'poi' ? '🏞️' : '📍'}</span>}
                <span className="loc-texts">
                  <span className="loc-name">{hit.name}</span>
                  <span className="loc-region">{labelFor(hit)}</span>
                </span>
                <span className={`loc-kind ${hit.kind}`}>{hit.kind === 'poi' ? 'POI' : 'City'}</span>
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
