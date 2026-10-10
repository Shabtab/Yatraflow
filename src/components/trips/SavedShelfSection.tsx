// ============ My trips — the saved shelf ============
// Every saved day and stop (the Timeline's hearts), grouped by trip. Each row
// links to the exact day or stop it names. Removing a row flips the same id
// the heart wrote, through the same pure helpers, so the heart and the shelf
// are one store. Nothing is drawn when nothing is saved.
import { useId, useRef, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import type { Trip } from '../../data/types'
import { appLink } from '../../lib/appLink'
import { savedShelfFor, type ShelfRow } from '../../lib/savedShelf'
import { loadSavedIds, saveSavedIds, flipSavedId } from '../../lib/uiPrefs'

export interface SavedShelfSectionProps {
  trips: Trip[]
}

/** Entrance delay for the row at this position. Capped like the trip cards, so
 *  a long shelf does not keep the last rows waiting. */
function enterDelay(index: number): CSSProperties {
  return { animationDelay: `calc(var(--stagger-step) * ${Math.min(index, 8)})` }
}

export function SavedShelfSection({ trips }: SavedShelfSectionProps) {
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  // Storage is the authority and the render reads it. The hearts are pressed on
  // another page, so a copy in state could drift; a removal writes first and
  // then re-renders, so the two cannot disagree.
  const [, bump] = useState(0)

  const groups = trips
    .map(trip => ({ trip, rows: savedShelfFor(trip, loadSavedIds(trip.id)) }))
    .filter(group => group.rows.length > 0)

  const total = groups.reduce((n, group) => n + group.rows.length, 0)
  if (total === 0) return null

  // Each group's rows continue the count from the group before, so the stagger
  // runs down the whole shelf rather than restarting in every trip.
  const firstIndexOf = groups.reduce<number[]>((starts, group, i) => {
    const previous = i === 0 ? 0 : starts[i - 1] + groups[i - 1].rows.length
    return [...starts, previous]
  }, [])

  function forget(tripId: string, id: string) {
    saveSavedIds(tripId, flipSavedId(loadSavedIds(tripId), id))
    // The button is about to unmount. Keep focus on the shelf instead of body.
    titleRef.current?.focus()
    bump(n => n + 1)
  }

  return (
    <section className="mt-shelf" aria-labelledby={titleId}>
      <div className="mt-section-head">
        <h2 className="mt-section-title" id={titleId} ref={titleRef} tabIndex={-1}>
          Saved for later ({total})
        </h2>
      </div>
      {/* The one sentence that separates the two kinds: a day is the whole day,
          an experience is the single stop inside it. */}
      <p className="mt-shelf-hint">
        A saved day opens that whole day on the timeline. A saved experience opens the stop itself.
      </p>
      {groups.map(({ trip, rows }, groupIndex) => (
        <div key={trip.id} className="mt-shelf-group">
          <h3 className="mt-shelf-trip">
            <a className="mt-shelf-trip-link" {...appLink(`/trip/${trip.id}`)}>{trip.name}</a>
          </h3>
          <ul className="mt-shelf-list">
            {rows.map((row: ShelfRow, rowIndex) => (
              <li key={row.id} className="mt-shelf-item" style={enterDelay(firstIndexOf[groupIndex] + rowIndex)}>
                <div className="mt-shelf-row">
                  <a className="mt-shelf-link" {...appLink(row.route)}>
                    <span className="mt-shelf-kind">{row.kind === 'day' ? 'Day' : 'Stop'}</span>
                    <span className="mt-shelf-text">
                      <span className="mt-shelf-name">{row.title}</span>
                      <span className="mt-shelf-meta num">{row.meta}</span>
                    </span>
                  </a>
                  <button
                    type="button"
                    className="icon-btn mt-shelf-unsave"
                    aria-label={`Remove ${row.title} from saved`}
                    onClick={() => forget(trip.id, row.id)}
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
