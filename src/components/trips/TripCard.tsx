// ============ My trips — grid card and list row ============
// One markup, two looks. The grid shows three labelled columns (budget, travel,
// dates). The list switch restyles the same card as a row. The whole card is
// one link on the title; the delete button and the next-step row sit above it.
import type { CSSProperties, ReactNode } from 'react'
import { Check, ChevronRight, Flag, Trash2 } from 'lucide-react'
import { appLink } from '../../lib/appLink'
import { cap } from '../../lib/labels'
import { nextStepRoute } from '../../lib/tripNextStep'
import { routeLine, travelHoursText } from '../../lib/tripsCard'
import { cardNextStep, rangeText, statusOf } from '../../lib/tripsPage'
import type { Trip, CachedUser } from '../../data/types'
import type { PresenceAttrs } from '../../lib/usePresenceList'
import { Planners } from './Planners'
import { TripCover } from './TripCover'
import { TripFacts } from './TripFacts'

export interface TripCardProps {
  trip: Trip
  today: Date
  /** The per-person budget text. The page owns it, so the estimate marker stays in one place. */
  budget: ReactNode
  totalTravelMinutes: number
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

export function TripCard({ trip, today, budget, totalTravelMinutes, users, meId, enterIndex, coverSizes, presence, onDelete }: TripCardProps) {
  const status = statusOf(trip, today)
  const step = cardNextStep(trip, today)
  const plannerCount = (trip.members ?? []).length
  const enterDelay: CSSProperties = { animationDelay: `calc(var(--stagger-step) * ${Math.min(enterIndex, 8)})` }
  return (
    <article className="mt-card" data-status={status} style={enterDelay} {...presence}>
      <TripCover trip={trip} status={status} sizes={coverSizes} />
      <div className="mt-card-main">
        <div className="mt-card-body">
          <div className="mt-card-head">
            <h3 className="mt-card-title">
              <a className="mt-card-link" {...appLink(`/trip/${trip.id}`)}>{trip.name}</a>
            </h3>
            <p className="mt-route">{routeLine(trip)}</p>
          </div>
          <TripFacts budget={budget} travel={travelHoursText(totalTravelMinutes)} dates={rangeText(trip, today)} />
          {step && (step.kind === 'done' ? (
            <p className="mt-task mt-task--done"><Check size={15} aria-hidden /><span className="mt-task-label">{step.label}</span></p>
          ) : (
            <a className="mt-task" {...appLink(nextStepRoute(trip, step))}>
              <Flag size={15} aria-hidden /><span className="mt-task-label">{step.label}</span><ChevronRight size={15} aria-hidden className="mt-task-chev" />
            </a>
          ))}
          <div className="mt-card-chips">
            <span className="mt-chip">{cap(trip.travelStyle)}</span>
            {plannerCount > 1 && <span className="mt-chip mt-chip--plain">{plannerCount} planners</span>}
          </div>
        </div>
        <div className="mt-card-foot">
          <Planners trip={trip} users={users} meId={meId} />
          <button type="button" className="icon-btn mt-del" aria-label={`Delete ${trip.name}`} onClick={() => onDelete(trip)}>
            <Trash2 size={16} aria-hidden />
          </button>
        </div>
      </div>
    </article>
  )
}
