// ============ My trips — grid card and list row ============
// One markup, two looks. The cover carries the glass date stamp and the status
// line. The body has the title, one meta line and a bar with one segment per
// day. The foot has the planners, the next step and the delete button. The list
// switch restyles the same card as a row. The whole card is one link on the
// title; the delete button and the next-step link sit above it.
import type { CSSProperties, ReactNode } from 'react'
import { Check, ChevronRight, Flag, Trash2 } from 'lucide-react'
import { appLink } from '../../lib/appLink'
import { nextStepRoute, plannedDayFlags } from '../../lib/tripNextStep'
import { routeLine } from '../../lib/tripsCard'
import { cardNextStep, cardStatusLine, dateStamp, planning, statusOf } from '../../lib/tripsPage'
import { staggerStep } from '../../lib/motion'
import type { Trip, CachedUser } from '../../data/types'
import type { PresenceAttrs } from '../../lib/usePresenceList'
import { Planners } from './Planners'
import { TripCover } from './TripCover'
import { TripStamp } from './TripStamp'

export interface TripCardProps {
  trip: Trip
  today: Date
  /** The per-person budget text. The page owns it, so the estimate marker stays in one place. */
  budget: ReactNode
  /** True when the trip meets the "Ready to go" rule (see lib/tripDayStrip). */
  readyToGo: boolean
  /** Open checks from the day strip (`openChecks`). */
  toFix: number
  users: CachedUser[]
  meId: string | null
  /** Position in the grid. It sets the entrance delay. */
  enterIndex: number
  /** The cover slot's real width. The list layout passes its narrow fixed column. */
  coverSizes?: string
  /** Worn by the list that plays this card's exit (usePresenceList). */
  presence?: PresenceAttrs
  onDelete: (trip: Trip) => void
}

export function TripCard({ trip, today, budget, readyToGo, toFix, users, meId, enterIndex, coverSizes, presence, onDelete }: TripCardProps) {
  const status = statusOf(trip, today)
  const step = cardNextStep(trip, today)
  const statusLine = cardStatusLine(trip, today, readyToGo, toFix)
  const flags = plannedDayFlags(trip)
  const { planned, total } = planning(trip)
  // The stamp pops in after its own card, so it reads the same grid step.
  // `--mt-grid-at` holds the first grid back until the toolbar has arrived (09-trips-list.css).
  const enterDelay = { animationDelay: `calc(var(--mt-step) * (var(--mt-grid-at, 0) + ${staggerStep(enterIndex)}))`, '--mt-enter': staggerStep(enterIndex) } as CSSProperties
  return (
    <article className="mt-card" data-status={status} style={enterDelay} {...presence}>
      <TripCover trip={trip} status={status} sizes={coverSizes} showTag={false}>
        <TripStamp stamp={dateStamp(trip)} />
        <span className={`mt-status mt-status--${readyToGo ? 'ready' : status}`}>{statusLine}</span>
      </TripCover>
      <div className="mt-card-main">
        <div className="mt-card-body">
          <div className="mt-card-head">
            <h3 className="mt-card-title">
              <a className="mt-card-link" {...appLink(`/trip/${trip.id}`)}>{trip.name}</a>
            </h3>
            {/* On the list rows the cover pill is hidden, so the status line shows here. */}
            <p className="mt-card-state">{statusLine}</p>
          </div>
          <p className="mt-meta">{routeLine(trip)} · {budget}</p>
          {flags.length > 0 && (
            <div
              className="mt-prog"
              role="meter"
              aria-label="Days with activities"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={planned}
              aria-valuetext={`${planned} of ${total} days`}
            >
              {flags.map((isPlanned, index) => <i key={index} className={isPlanned ? 'is-full' : undefined} />)}
            </div>
          )}
        </div>
        <div className="mt-card-foot">
          <Planners trip={trip} users={users} meId={meId} />
          {step && (step.kind === 'done' ? (
            <p className="mt-task mt-task--done"><Check size={15} aria-hidden /><span className="mt-task-label">{step.label}</span></p>
          ) : (
            <a className="mt-task" {...appLink(nextStepRoute(trip, step))}>
              <Flag size={15} aria-hidden /><span className="mt-task-label">{step.label}</span><ChevronRight size={15} aria-hidden className="mt-task-chev" />
            </a>
          ))}
          {trip.members?.some(m => m.userId === meId && m.role === 'owner') && <button type="button" className="icon-btn mt-del" aria-label={`Delete ${trip.name}`} onClick={() => onDelete(trip)}>
            <Trash2 size={16} aria-hidden />
          </button>}
        </div>
      </div>
    </article>
  )
}
