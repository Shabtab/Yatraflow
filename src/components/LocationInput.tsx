// ============ Location autocomplete ============
// Searches cities AND points of interest (via src/lib/geocode.ts — free, no key).
// Keyboard navigable: ↑/↓ to move, Enter to pick, Esc to dismiss.
import { useEffect, useId, useRef, useState } from 'react'
import { googleEnabled, mapplsEnabled, searchPlaces } from '../lib/geocode'
import type { PlaceHit } from '../lib/geocode'
import { hasCoords } from '../lib/providers/hits'
import { useResolvePick } from './ResolvePickDialog'

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
  /** id for the inner input — lets `Field` associate its label (UI audit F-01). */
  id?: string
  /** Locks the control for viewers: no typing, no search, no pick. */
  disabled?: boolean
  /** id of the element carrying `error`'s text — binds the message to the input
   *  so a screen reader announces which control resolves it (UI audit F-01 pattern). */
  errorId?: string
}

/** The text a pick puts in the box. Exported so a caller that must remember
 *  WHICH label a pin belongs to (Settings' start pin, #410) speaks the same
 *  formula this component types — a private copy would drift from the box. */
export function pickLabel(hit: PlaceHit): string {
  return hit.name + (hit.kind === 'place' && hit.admin1 ? `, ${hit.admin1}` : '')
}

export function LocationInput({ value, onChange, onPick, placeholder, error, errorId, autoFocus, indiaOnly = true, id, disabled }: Props) {
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [highlight, setHighlight] = useState(0)
  /** true while a picked Mappls hit is getting its coordinates resolved */
  const [resolving, setResolving] = useState(false)
  /** pick-time resolution failure — shown under the field, clears on next search */
  const [pickErr, setPickErr] = useState('')
  // Shared resolve-or-prompt guard (#424): unknown-position picks get retry /
  // manual coordinates / explicit skip before the caller sees them. With the
  // other hooks, above every path out of this component (AGENTS §6e).
  const { resolvePick, dialog: resolvePickDialog } = useResolvePick()
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

  async function choose(hit: PlaceHit) {
    // Any pick the map cannot pin — a provider placeholder, a mixed (0, lng)
    // zero, or a place with no id to resolve through — goes through the shared
    // resolve-or-prompt guard (#424) before it reaches the caller: retry,
    // manual coordinates, or an explicit skip. A trip born at Null Island
    // measures its whole journey through the ocean (found live 2026-09-14).
    if (!hasCoords(hit)) {
      setResolving(true)
      try {
        const resolved = await resolvePick(hit)
        if (!resolved) { setPickErr('That place was not pinned on the map — pick another suggestion.'); return }
        hit = resolved
      } finally { setResolving(false) }
    }
    onChange(pickLabel(hit))
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
        id={id}
        className="input"
        disabled={disabled}
        style={error ? { borderColor: 'var(--danger)' } : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && errorId ? errorId : undefined}
        value={value}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={e => {
          onChange(e.target.value)
          setPickErr('')
          runSearch(e.target.value)
        }}
        onFocus={() => { if (hits.length > 0) setOpen(true) }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && hits[highlight] ? `${listId}-opt-${highlight}` : undefined}
      />
      {loading && <span className="loc-spinner" aria-label="Searching places" />}
      {resolving && <span className="loc-spinner" aria-label="Pinning the place" />}
      {/* Field-tied, so polite: an unpicked place can fail while a submit's
          FormErrorSummary is announcing — two role=alert regions would double-
          interrupt (see ui.tsx Field for the pattern). */}
      {pickErr && <div className="field-error small" role="status" aria-live="polite" style={{ color: 'var(--danger)', marginTop: 4 }}>{pickErr}</div>}
      {open && hits.length > 0 && (
        <ul className="loc-dropdown popover" role="listbox" id={listId}>
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
                <span className="loc-ico" aria-hidden="true">
                  {hit.thumb
                    ? <img className="loc-thumb" src={hit.thumb} alt="" loading="lazy" />
                    : <span className="loc-pin">{hit.kind === 'poi' ? '🏞️' : '📍'}</span>}
                </span>
                <span className="loc-texts">
                  <span className="loc-name">{hit.name}</span>
                  <span className="loc-region">{labelFor(hit)}</span>
                </span>
                <span className={`loc-kind ${hit.kind}`}>{hit.kind === 'poi' ? 'POI' : 'City'}</span>
              </button>
            </li>
          ))}
          <li className="loc-foot" role="presentation" aria-hidden="true">
            {googleEnabled()
              ? 'Place search · Google'
              : mapplsEnabled()
                ? 'Place search · Mappls · coords by OpenStreetMap'
                : 'Basic place search — add a maps key for richer results'}
          </li>
        </ul>
      )}
      {open && !loading && searched && hits.length === 0 && value.trim().length >= 2 && (
        <div className="loc-empty popover">No places matched “{value.trim()}”. You can still use this text as-is.</div>
      )}
      {resolvePickDialog}
    </div>
  )
}
