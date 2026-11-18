// ============ My trips — Memories ============
// Trips that ended, as tilted postcards: cover with a postmark, name, dates,
// days, stops and planned km, an Open link, and "Plan it again". The last tile
// shows the km planned and the trips with friends. Both are plans, not
// tracked journeys, so the tile says "planned".
import type { CSSProperties } from 'react'
import { RotateCcw } from 'lucide-react'
import { appLink } from '../../lib/appLink'
import { daysText, kmText, stopCountText } from '../../lib/tripsCard'
import { activityStopCount } from '../../lib/tripNextStep'
import { postmark, rangeText, statusOf } from '../../lib/tripsPage'
import type { Trip } from '../../data/types'
import { SectionHead } from '../page/SectionHead'
import { TripCover, GRID_SIZES } from './TripCover'

/** Postcards lean a little, left and right in turn. */
const TILTS = ['-1.5deg', '1.2deg', '-0.8deg', '1.6deg']

export interface MemoryCard {
  trip: Trip
  distanceKm: number
}

export function MemoriesSection({ titleId, memories, today, travel, copyingId, onPlanAgain }: {
  titleId: string
  memories: MemoryCard[]
  today: Date
  travel: { kmPlanned: number; withFriends: number }
  /** The id of the trip being copied now, or null. */
  copyingId: string | null
  onPlanAgain: (trip: Trip) => void
}) {
  if (memories.length === 0) return null
  return (
    <section aria-labelledby={titleId} className="mt-memories">
      <SectionHead id={titleId} title={<>Memories <span className="mt-count">{memories.length}</span></>} />
      <ul className="mt-pc-grid">
        {memories.map(({ trip, distanceKm }, index) => (
          <li key={trip.id} className="mt-pc" style={{ '--mt-tilt': TILTS[index % TILTS.length] } as CSSProperties}>
            <TripCover trip={trip} status={statusOf(trip, today)} sizes={GRID_SIZES} showTag={false}>
              <span className="mt-pc-mark">{postmark(trip)}</span>
            </TripCover>
            <div className="mt-pc-body">
              <h3 className="mt-pc-title">{trip.name}</h3>
              <p className="mt-pc-when">{rangeText(trip, today)}</p>
              <p className="mt-pc-facts">{daysText(trip.days.length)} · {stopCountText(activityStopCount(trip))} · {kmText(distanceKm)}</p>
              <div className="mt-pc-actions">
                <a className="mt-pc-link" {...appLink(`/trip/${trip.id}`)}>Open</a>
                <button type="button" className="mt-pc-link" disabled={copyingId !== null} onClick={() => onPlanAgain(trip)}>
                  <RotateCcw size={14} aria-hidden />{copyingId === trip.id ? 'Copying' : 'Plan it again'}
                </button>
              </div>
            </div>
          </li>
        ))}
        <li className="mt-travel">
          <span className="mt-travel-kicker">Your travel so far</span>
          <dl className="mt-travel-grid">
            <div><dt>km planned</dt><dd>{Math.round(travel.kmPlanned).toLocaleString('en-IN')}</dd></div>
            <div><dt>trips with friends</dt><dd>{travel.withFriends}</dd></div>
          </dl>
        </li>
      </ul>
    </section>
  )
}
