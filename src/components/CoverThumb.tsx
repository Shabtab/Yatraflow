import { useDestinationCover } from '../hooks/useDestinationCover'
import { pickTripQueryCandidates } from '../lib/tripThumb'

/**
 * Cover thumbnail for trip / itinerary cards. Resolution order:
 *   1. explicit owner URL (coverImageUrl)   — always wins
 *   2. auto Wikipedia photo of the destination (query / candidates)
 *   3. emoji fallback                        — when nothing else resolves
 *
 * `variant="wide"` mirrors the Explore card (16/9); `variant="short"` the
 * Trips list card (16/7). `routeLabel` overlays the start → end caption.
 *
 * `query` may be a single string (just that one place) OR a trip-shaped
 * object whose destinations/startLocation/name are walked in order to find
 * the first Wikipedia lead image (the card never blanks on a single miss).
 */
export function CoverThumb({
  query, explicitUrl, emoji = '🧭', variant = 'wide', routeLabel,
  trip,
}: {
  query?: string | null
  /** When provided, used to derive an ordered list of candidate queries
   *  (last destination → other stops → start city → trip name) and override
   *  `query` for the auto-cover lookup. */
  trip?: { name: string; startLocation?: string; destinations?: string[] } | null
  explicitUrl?: string | null
  emoji?: string
  variant?: 'wide' | 'short'
  routeLabel?: string
}) {
  const candidates = trip ? pickTripQueryCandidates(trip) : (query ? [query] : [])
  const auto = useDestinationCover(candidates)
  const url = explicitUrl || auto || null
  const cls = variant === 'short' ? 'itin-emoji' : 'itin-cover'
  return (
    <div
      className={cls}
      style={url ? { backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      {routeLabel && <span className="itin-cover-route">{routeLabel}</span>}
      {!url && <span className="itin-cover-fallback" aria-hidden="true">{emoji}</span>}
    </div>
  )
}
