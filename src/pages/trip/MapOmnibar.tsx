/**
 * #418 — the map's own search: discover a place anywhere on the route, then file
 * it deliberately.
 *
 * This surface is deliberately dumb. It owns the query, the result list and the
 * placement buttons, and it calls back for everything else: it never reads the
 * store, never writes a stop, and never decides where a place goes on its own —
 * `mapPlacement.ts` lists the choices and this renders them, so "no implicit
 * write" is a property of the file rather than a promise in a comment.
 *
 * The rail keeps its own two searches: the corridor search (corridor-wide
 * discovery, ranked by detour) and a slot's own search (fill THIS part). This one
 * exists because discovery and placement were coupled differently on each of
 * them, and there was no map-level surface where a place could be found and then
 * explicitly filed.
 */
import { useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import type { PlaceHit } from '../../lib/geocode'
import { InlineIcon } from '../../components/icons'
import { searchAnnouncement } from '../../lib/railA11y'
import { placementPrompt, type PlacementOption } from './mapPlacement'

export type OmnibarHit = { h: PlaceHit; km: number | null; off: number | null }

const PAGE = 5

export function MapOmnibar({
  query,
  onQueryChange,
  onSubmit,
  busy,
  quotaOut,
  results,
  selectedId,
  placement,
  scopeKm,
  onSelect,
  onClear,
  onPlace,
}: {
  query: string
  onQueryChange: (q: string) => void
  onSubmit: () => void
  busy: boolean
  /** the provider's own pause — say why the box is inert rather than showing a dead control */
  quotaOut: boolean
  results: OmnibarHit[]
  selectedId: string | number | null
  /** the choices for the selected hit, from mapPlacement.ts (empty until one is selected) */
  placement: PlacementOption[]
  /** the trip's current detour scope, so an out-of-scope hit can say so */
  scopeKm: number
  onSelect: (id: string | number | null) => void
  onClear: () => void
  onPlace: (option: PlacementOption) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const rows = useMemo(
    () => (showAll ? results : results.slice(0, PAGE)),
    [results, showAll],
  )
  const selected = results.find(r => r.h.id === selectedId) ?? null
  const short = query.trim().length > 0 && query.trim().length < 2

  return (
    <section className="card" aria-label="Search the map" style={{ padding: 10, marginBottom: 10 }}>
      <form
        className="row-between"
        style={{ gap: 8 }}
        onSubmit={e => {
          e.preventDefault()
          onSubmit()
        }}
      >
        <input
          className="input"
          value={query}
          disabled={quotaOut}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="Search the map - find a place, then choose where it goes…"
          aria-label="Search the map for a place to add"
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-outline btn-sm"
          type="submit"
          disabled={busy || quotaOut}
          title={quotaOut ? 'Search is paused by the provider’s own quota guard' : undefined}
          style={{ flex: '0 0 auto' }}
        >
          {busy ? 'Searching…' : quotaOut ? 'Search paused' : 'Find'}
        </button>
        {(results.length > 0 || selectedId != null) && (
          <button className="btn btn-outline btn-sm" type="button" onClick={onClear} style={{ flex: '0 0 auto' }}>
            Clear
          </button>
        )}
      </form>

      {quotaOut && (
        <p className="muted small" role="status" style={{ margin: '8px 0 0' }}>
          Search is paused by the provider’s own quota guard — suggestions and the rails keep working.
        </p>
      )}
      {short && (
        <p className="muted small" role="status" style={{ margin: '8px 0 0' }}>
          Keep typing - search starts at 2 characters.
        </p>
      )}

      {/* One announcement for the whole result set, so a screen reader hears the
          search land without reading every row. */}
      <span className="sr-only" role="status" aria-live="polite">
        {searchAnnouncement(query, results.length, rows.length)}
      </span>

      {results.length > 0 && (
        <div
          className="map-search-results"
          role="listbox"
          aria-label={`Map search results. ${rows.length} of ${results.length} shown. Use the arrow keys to move between them, then Enter to select one.`}
          style={{ marginTop: 8 }}
        >
          {rows.map((r, rowIndex) => {
            const isSelected = selectedId != null && r.h.id === selectedId
            const inScope = r.off != null && r.off <= scopeKm
            return (
              <div
                key={r.h.id as string}
                role="option"
                aria-selected={isSelected}
                tabIndex={isSelected || (selectedId == null && rowIndex === 0) ? 0 : -1}
                className={`row-between${isSelected ? ' is-selected' : ''}`}
                style={{ gap: 8, opacity: inScope ? 1 : 0.66 }}
                onClick={() => onSelect(isSelected ? null : (r.h.id as string | number))}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(isSelected ? null : (r.h.id as string | number))
                  }
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <InlineIcon icon={MapPin} size={12} gap={4} vAlign="-1px" />
                  {r.h.name}
                  <span className="muted small">
                    {r.km == null ? ' · position unknown' : ` · ~${Math.round(r.km)} km in`}
                    {r.off == null ? ' · detour unknown' : ` · ${r.off <= scopeKm ? `${Math.round(r.off)} km off-route` : `${Math.round(r.off)} km off-route, beyond your ${scopeKm} km scope`}`}
                  </span>
                </span>
                <span className="small" style={{ flex: '0 0 auto' }}>{isSelected ? 'Selected' : 'Select'}</span>
              </div>
            )
          })}
          {results.length > PAGE && (
            <button className="btn btn-outline btn-sm" type="button" onClick={() => setShowAll(v => !v)} style={{ marginTop: 6 }}>
              {showAll ? `Show top ${PAGE}` : `Show all ${results.length}`}
            </button>
          )}
        </div>
      )}

      {/* The explicit placement step. Nothing here has happened yet: these are the
          choices, and one of them is a click. */}
      {selected && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{placementPrompt(selected.h.name)}</p>
          <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
            {placement.map(option => (
              <span key={`${option.kind}:${option.slotKey ?? ''}`} style={{ minWidth: 0, flex: '1 1 220px' }}>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  disabled={option.disabled}
                  onClick={() => onPlace(option)}
                  style={{ width: '100%' }}
                >
                  {option.label}
                </button>
                <span className="muted small" style={{ display: 'block', marginTop: 2 }}>
                  {option.disabled && option.reason ? option.reason : option.hint}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
