// ============ Saved shelf (My Trips) ============
// MR8's hearts write ids into `lib/uiPrefs`, and nothing read them back — the
// save was decoration with no destination. This is the destination: every
// saved day and stop, grouped by trip, each row a link to the exact day and
// stop it names. Removing a row flips the SAME id the heart wrote, through the
// same pure helpers, so the heart and the shelf are one store rather than two
// views that agree by accident.

import { useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import type { Trip } from '../data/types'
import { appLink } from '../lib/appLink'
import { loadSavedIds, saveSavedIds, flipSavedId } from '../lib/uiPrefs'
import { savedShelfFor } from '../lib/savedShelf'

export function SavedShelf({ trips }: { trips: Trip[] }) {
  // Storage is the authority and the render reads it. The shelf is cheap (one
  // short key per trip), so reading it here is simpler than a copy in state that
  // could disagree with the hearts — and the hearts are pressed on ANOTHER page,
  // which this copy could not see anyway; returning to My Trips remounts this
  // component and re-reads. A removal writes first and then re-renders, so the
  // two can never drift.
  const [, bump] = useState(0)

  const groups = trips
    .map(trip => ({ trip, rows: savedShelfFor(trip, loadSavedIds(trip.id)) }))
    .filter(group => group.rows.length > 0)

  const total = groups.reduce((n, group) => n + group.rows.length, 0)
  if (total === 0) return null

  function forget(tripId: string, id: string) {
    saveSavedIds(tripId, flipSavedId(loadSavedIds(tripId), id))
    bump(n => n + 1)
  }

  return (
    <section className="saved-shelf" aria-labelledby="saved-shelf-heading">
      <div className="saved-shelf-head">
        <h3 id="saved-shelf-heading" className="trip-other-heading">
          <Bookmark size={15} aria-hidden /> Saved for later
        </h3>
        <span className="trip-other-count">{total} saved</span>
      </div>
      {/* The one sentence that separates the two kinds: a day is the whole day,
          an experience is the single stop inside it. */}
      <p className="saved-shelf-hint">
        A saved day opens that whole day on the timeline. A saved experience opens the stop itself.
      </p>
      {groups.map(({ trip, rows }) => (
        <div key={trip.id} className="saved-group">
          <a className="saved-group-trip" {...appLink(`/trip/${trip.id}`)}>{trip.name}</a>
          <ul className="saved-list">
            {rows.map(row => (
              <li key={row.id} className="saved-row">
                <a className="saved-row-link" {...appLink(row.route)}>
                  <span className="saved-row-kind">{row.kind === 'day' ? 'Day' : 'Stop'}</span>
                  <span className="saved-row-title">{row.title}</span>
                  <span className="saved-row-meta num">{row.meta}</span>
                </a>
                <button className="icon-btn saved-unsave" aria-label={`Remove ${row.title} from saved`}
                  onClick={() => forget(trip.id, row.id)}><X size={14} aria-hidden /></button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
