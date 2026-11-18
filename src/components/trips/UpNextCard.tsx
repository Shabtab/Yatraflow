// ============ My trips — the pinned "Up next" card ============
// The trip that starts soonest, or the one under way. The cover carries the
// date stamp, the title and the route. The body holds the countdown, the next
// step with its action, the per-day state strip, the planners, the per-person
// cost with the distance, and the Share and Open trip links.
import type { ReactNode } from 'react'
import { ArrowRight, Check, Flag, Trash2 } from 'lucide-react'
import { appLink } from '../../lib/appLink'
import { nextStepRoute } from '../../lib/tripNextStep'
import { kmText, meterLabel, routeLine } from '../../lib/tripsCard'
import { cardNextStep, countdownText, dateStamp, planning, statusOf, stepActionLabel } from '../../lib/tripsPage'
import type { DayCell } from '../../lib/tripDayStrip'
import type { Trip, CachedUser } from '../../data/types'
import { DayStrip } from './DayStrip'
import { Planners } from './Planners'
import { TripCover, FEATURED_SIZES } from './TripCover'
import { TripStamp } from './TripStamp'

export interface UpNextCardProps {
  trip: Trip
  today: Date
  budget: ReactNode
  /** Planned road distance of the whole trip, in km. */
  distanceKm: number
  /** One cell per day, from the engine's warnings. */
  dayCells: DayCell[]
  users: CachedUser[]
  meId: string | null
  onDelete: (trip: Trip) => void
}

export function UpNextCard({ trip, today, budget, distanceKm, dayCells, users, meId, onDelete }: UpNextCardProps) {
  const status = statusOf(trip, today)
  const countdown = countdownText(trip, today)
  const { planned, total } = planning(trip)
  const meterText = meterLabel(planned, total)
  const step = cardNextStep(trip, today)
  const plannerCount = (trip.members ?? []).length
  const detailRoute: `/${string}` = `/trip/${trip.id}`
  const shareRoute: `/${string}` = `/trip/${trip.id}/share`
  const actionLabel = step ? stepActionLabel(step.kind) : null
  return (
    <article className="mt-card mt-feat" data-status={status}>
      <TripCover trip={trip} status={status} sizes={FEATURED_SIZES}>
        <TripStamp stamp={dateStamp(trip)} />
        <div className="mt-feat-over">
          <span className="mt-feat-kicker">Up next</span>
          <h3 className="mt-card-title">
            <a className="mt-card-link" {...appLink(detailRoute)}>{trip.name}</a>
          </h3>
          <p className="mt-feat-route">{routeLine(trip)}</p>
        </div>
      </TripCover>
      <div className="mt-feat-body">
        {countdown && <p className="mt-feat-when"><b>{countdown}</b></p>}
        {step && (step.kind === 'done' ? (
          <p className="mt-next mt-next--done">
            <span className="mt-next-tile"><Check size={18} aria-hidden /></span>
            <span className="mt-next-copy"><b>{step.label}</b></span>
          </p>
        ) : (
          <div className="mt-next">
            <span className="mt-next-tile"><Flag size={18} aria-hidden /></span>
            <span className="mt-next-copy">
              <span className="mt-next-kicker">Your next step</span>
              <b>{step.label}</b>
            </span>
            {actionLabel && <a className="btn btn-primary btn-sm mt-next-go" {...appLink(nextStepRoute(trip, step))}>{actionLabel}</a>}
          </div>
        ))}
        <div className="mt-days-wrap">
          <p className="mt-days-cap">{meterText} · Estimated checks</p>
          <DayStrip cells={dayCells} />
        </div>
        <div className="mt-feat-foot">
          <div className="mt-feat-planners">
            <Planners trip={trip} users={users} meId={meId} />
            {plannerCount > 1 && <span>{plannerCount} planners</span>}
          </div>
          <p className="mt-feat-cost">{budget} · {kmText(distanceKm)}</p>
        </div>
        <div className="mt-feat-actions">
          <button type="button" className="icon-btn mt-del" aria-label={`Delete ${trip.name}`} onClick={() => onDelete(trip)}>
            <Trash2 size={16} aria-hidden />
          </button>
          <a className="btn btn-secondary" {...appLink(shareRoute)}>Share</a>
          <a className="btn btn-primary" {...appLink(detailRoute)}>Open trip<ArrowRight size={16} aria-hidden /></a>
        </div>
      </div>
    </article>
  )
}
