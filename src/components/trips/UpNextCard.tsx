// ============ My trips — the pinned "Up next" card ============
// The trip that starts soonest, or the one under way. It shows the countdown,
// how much of the plan exists, and the first thing that still needs booking.
import { useId, type ReactNode } from 'react'
import { Flag, Trash2 } from 'lucide-react'
import { appLink } from '../../lib/appLink'
import { meterPercent, routeLine, travelHoursText } from '../../lib/tripsCard'
import { countdownText, nextStep, planning, rangeText, statusOf } from '../../lib/tripsPage'
import type { Trip, User } from '../../data/types'
import { Planners } from './Planners'
import { TripCover } from './TripCover'
import { TripFacts } from './TripFacts'

export interface UpNextCardProps {
  trip: Trip
  today: Date
  budget: ReactNode
  totalTravelMinutes: number
  users: User[]
  meId: string | null
  onDelete: (trip: Trip) => void
}

export function UpNextCard({ trip, today, budget, totalTravelMinutes, users, meId, onDelete }: UpNextCardProps) {
  const meterLabelId = useId()
  const status = statusOf(trip, today)
  const countdown = countdownText(trip, today)
  const { planned, total } = planning(trip)
  const step = nextStep(trip, today)
  const plannerCount = (trip.members ?? []).length
  const detailHref = appLink(`/trip/${trip.id}`)
  return (
    <article className="mt-card mt-feat" data-status={status}>
      <TripCover trip={trip} status={status} />
      <div className="mt-feat-body">
        <h3 className="mt-card-title">
          <a className="mt-card-link" {...detailHref}>{trip.name}</a>
        </h3>
        {countdown && <p className="mt-feat-when"><b>{countdown}</b></p>}
        <p className="mt-route">{routeLine(trip)}</p>
        <TripFacts budget={budget} travel={travelHoursText(totalTravelMinutes)} dates={rangeText(trip, today)} />
        <div className="mt-feat-planners">
          <Planners trip={trip} users={users} meId={meId} />
          {plannerCount > 1 && <span>{plannerCount} planners</span>}
        </div>
        <div className="mt-meter">
          {total > 0 ? (
            <>
              <p className="mt-meter-label" id={meterLabelId}><b>{planned} of {total}</b> days planned</p>
              <div
                className="mt-meter-bar"
                role="progressbar"
                aria-labelledby={meterLabelId}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={planned}
                aria-valuetext={`${planned} of ${total} days planned`}
              >
                <i style={{ width: `${meterPercent(planned, total)}%` }} />
              </div>
            </>
          ) : (
            <p className="mt-meter-label">No days planned yet</p>
          )}
        </div>
        {step && (
          <p className="mt-next">
            <Flag size={15} aria-hidden />
            <span><b>Next step:</b> Day {step.day} · {step.title}</span>
          </p>
        )}
        <div className="mt-feat-actions">
          <a className="btn btn-primary" {...detailHref}>Continue planning</a>
          <button type="button" className="icon-btn mt-del" aria-label={`Delete ${trip.name}`} onClick={() => onDelete(trip)}>
            <Trash2 size={16} aria-hidden />
          </button>
        </div>
      </div>
    </article>
  )
}
