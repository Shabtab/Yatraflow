import { useState } from 'react'
import type { Trip } from '../data/types'
import { updateTrip } from '../store/store'
import { fetchFirstAvailableThumb, pickTripQueryCandidates } from '../lib/tripThumb'
import { useDestinationCover } from '../hooks/useDestinationCover'

/**
 * Owner-facing control to set / change / clear a trip's cover image.
 *   • "Use destination photo" fetches a popular Wikipedia image of the trip's
 *     headline destination and stores it as coverImageUrl (the default the
 *     product prefers — see types.ts).
 *   • A custom URL lets the owner override with any image.
 *   • "Use emoji only" clears the image so the card falls back to the emoji.
 * The choice is carried over on fork / publish via store.ts.
 */
export function CoverImagePicker({ trip, editable }: { trip: Trip; editable: boolean }) {
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState('')
  // Try the headline destination first, then earlier stops / start city, so
  // a single "no photo on Wikipedia" page doesn't make the cover picker look
  // empty when a perfectly good image exists for the next stop.
  const candidates = pickTripQueryCandidates(trip)
  const auto = useDestinationCover(candidates)
  const current = trip.coverImageUrl ?? auto ?? null

  function setCover(url: string | undefined) {
    updateTrip(trip.id, { coverImageUrl: url })
  }
  async function onAuto() {
    setBusy(true)
    try {
      const u = await fetchFirstAvailableThumb(candidates)
      setCover(u ?? undefined)
    } finally { setBusy(false) }
  }
  function onCustom() {
    const v = custom.trim()
    if (!v) return
    setCover(v)
    setCustom('')
  }

  return (
    <div className="cover-picker">
      <div
        className="cover-picker-preview"
        style={current ? { backgroundImage: `url("${current}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        {!current && <span className="cover-picker-emoji">{trip.coverEmoji}</span>}
      </div>
      {editable && (
        <div className="cover-picker-controls">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onAuto}>
            {busy ? 'Finding photo…' : trip.coverImageUrl ? 'Refresh destination photo' : 'Use destination photo'}
          </button>
          <div className="cover-picker-custom">
            <input
              className="input" placeholder="Paste an image URL…" value={custom}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onCustom() } }}
            />
            <button type="button" className="btn btn-outline btn-sm" onClick={onCustom}>Set</button>
          </div>
          {trip.coverImageUrl && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCover(undefined)}>Use emoji only</button>
          )}
        </div>
      )}
    </div>
  )
}
