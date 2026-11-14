import { Fragment, type ReactNode } from 'react'
import { Car, Flag, Moon } from 'lucide-react'
import type { Journey, ScheduledLeg } from '../../../lib/engine'
import { minutesToHM } from '../../../lib/engine'
import { formatHM, formatHMRange } from '../../../lib/timefmt'
import { CatIcon } from '../../icons'
import { Avatar } from '../../ui'
import type { CachedUser } from '../../../data/types'

/** A saved leg is optional. The engine's distance fallback is not a saved leg. */
export function savedRideLeg(stop: { legDistanceKm?: number; legTravelMinutes?: number }, leg: ScheduledLeg | null) {
  const km = stop.legDistanceKm
  const minutes = stop.legTravelMinutes
  if (leg?.kind === 'air' || km == null || minutes == null || !Number.isFinite(km) || !Number.isFinite(minutes)
    || km < 0 || minutes < 0 || (km === 0 && minutes === 0)) return null
  return { km, minutes }
}

/** A drive between stops: the saved pair when there is one, else the engine's
 *  road estimate, marked approximate. Air legs and empty legs show nothing. */
export function rideLeg(stop: { legDistanceKm?: number; legTravelMinutes?: number }, leg: ScheduledLeg | null) {
  const saved = savedRideLeg(stop, leg)
  if (saved) return { ...saved, approx: false }
  if (!leg || leg.kind === 'air' || !Number.isFinite(leg.distanceKm) || !Number.isFinite(leg.durationMinutes)
    || leg.distanceKm < 0.5 || leg.durationMinutes < 1) return null
  return { km: leg.distanceKm, minutes: leg.durationMinutes, approx: true }
}

/** A place name reduced to letters and digits, without a "(start)" or "(end)" suffix. */
function placeKey(name: string): string {
  return name.toLowerCase().replace(/\((start|end)\)/g, '').replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The start and end lines of a ride day. A line that names a place from outside
 *  this day's own stops comes from the day before or after. When that day is
 *  locked for this viewer, the line names the day instead, so no paid place leaks. */
export function rideNodeLabels(journey: Journey, p: {
  dayNumber: number
  ownStopIds: ReadonlySet<string>
  /** The nearest day before or after with stops is locked. Empty days are skipped, as the engine skips them. */
  prevLocked: boolean
  nextLocked: boolean
  /** Stop names on locked days. A line that names one is masked, whatever path the engine took. */
  lockedNames?: readonly string[]
}): { start: string; end: string } {
  const first = journey.points[0]
  const last = journey.points.length > 0 ? journey.points[journey.points.length - 1] : undefined
  const borrowed = (point: Journey['points'][number] | undefined) =>
    !point || point.synthesized || point.stop.auto === true || !p.ownStopIds.has(point.stop.id)
  const locked = (p.lockedNames ?? []).map(placeKey).filter(k => k.length >= 3)
  const namesLocked = (title: string) => { const k = placeKey(title); return k.length > 0 && locked.some(n => k.includes(n) || n.includes(k)) }
  const start = (p.prevLocked && borrowed(first)) || (borrowed(first) && namesLocked(journey.startTitle))
    ? `Start of day ${p.dayNumber}` : `Leave ${journey.startTitle}`
  if (!last) return { start, end: `End of day ${p.dayNumber}` }
  if (borrowed(last) && (p.nextLocked || namesLocked(journey.endTitle))) return { start, end: `End of day ${p.dayNumber}` }
  const word = last.stop.category === 'hotel' || last.stop.slotKey === 'stay' ? 'Night in'
    : last.stop.auto === true || last.synthesized ? 'Head on to'
    : 'Finish at'
  return { start, end: `${word} ${journey.endTitle}` }
}

export function RideTimeline({ journey, timeFormat, creator, labels, children }: {
  journey: Journey
  timeFormat: '12h' | '24h'
  creator?: CachedUser
  /** From `rideNodeLabels`. The page knows which days this viewer may read. */
  labels: { start: string; end: string }
  children: ReactNode
}) {
  if (journey.points.length === 0) return <>{children}</>
  const end = journey.points[journey.points.length - 1]
  return (
    <ol className="pi-tl pi-ride-timeline">
      <li className="pi-tl-row pi-ride-node">
        <span className="pi-tl-time">{formatHM(journey.startTime, timeFormat)}</span>
        <span className="pi-tl-rail"><i className="pi-tl-dot pi-ride-node-dot"><Flag size={12} aria-hidden /></i></span>
        <div className="pi-tl-body"><b>{labels.start}</b></div>
      </li>
      {journey.points.slice(1).map((point, position) => {
        const leg = rideLeg(point.stop, point.legIn)
        const anchor = point.stop.auto === true
        const number = journey.points.slice(1, position + 1).filter(previous => !previous.stop.auto).length + 1
        return (
          <Fragment key={point.stop.id}>
            {leg && <li className="pi-tl-row pi-ride-leg">
              <span /><span className="pi-tl-rail" />
              <div><Car size={15} aria-hidden /><span>{leg.approx ? '~' : ''}{Math.round(leg.km)} km · {minutesToHM(leg.minutes)}</span></div>
            </li>}
            {!anchor && <li className="pi-tl-row pi-tl-row--stop">
              <span className="pi-tl-time"><b>{formatHM(point.arrive, timeFormat)}</b><small>to {formatHM(point.depart, timeFormat)}</small></span>
              <span className="pi-tl-rail"><i className="pi-tl-dot">{number}</i></span>
              <div className="pi-tl-body pi-ride-stop">
                <span className={'pi-ride-stop-icon cat-' + point.stop.category}><CatIcon category={point.stop.category} /></span>
                <div className="pi-ride-stop-copy">
                  <div className="pi-tl-toprow"><b className="pi-tl-title">{point.stop.title}</b><span className="pi-pill pi-pill--ok">Timed</span></div>
                  <div className="pi-tl-meta">{[point.stop.locationName, `${minutesToHM(point.dwellMinutes)} here`, point.stop.entryFeeInrPerPerson > 0 ? `₹${point.stop.entryFeeInrPerPerson}/person` : 'free entry'].filter(Boolean).join(' · ')}</div>
                  {point.stop.openTime && <div className="pi-tl-meta">Open {formatHMRange(point.stop.openTime, point.stop.closeTime, timeFormat)}</div>}
                  {point.stop.description && <p className="pi-tl-desc">{point.stop.description}</p>}
                </div>
                {point.stop.notes?.trim() && <div className="pi-ride-note"><Avatar user={creator} /><p><b>{creator?.profile.name ?? 'Creator'}&apos;s note.</b> {point.stop.notes}</p></div>}
              </div>
            </li>}
          </Fragment>
        )
      })}
      <li className="pi-tl-row pi-ride-node pi-ride-node--end">
        <span className="pi-tl-time">{formatHM(end.depart, timeFormat)}</span>
        <span className="pi-tl-rail"><i className="pi-tl-dot pi-ride-node-dot"><Moon size={12} aria-hidden /></i></span>
        <div className="pi-tl-body"><b>{labels.end}</b></div>
      </li>
    </ol>
  )
}
