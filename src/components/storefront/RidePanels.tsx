// P11 trip kit: the ride-along view. Presentation only.
// RideDayPanel draws the day on screen. The page hands it the timeline, or the
// locked note, already built from the read model the viewer is allowed to see.
// A locked panel takes no photo prop and no timeline, so the type keeps a
// locked day's picture and names off it.
import { useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { ChevronDown, Lock } from 'lucide-react'
import { staggerStep } from '../../lib/motion'
import { RegionArt } from '../RegionArt'
import { TripArt } from '../trips/TripArt'
import { pubArtId } from '../../lib/pubDayArt'
import { useRideProgress } from '../../lib/rideProgress'

export type RideState = 'free' | 'yours' | 'locked'

const TAG: Record<RideState, string> = { free: 'Free to read', yours: 'Yours', locked: 'Paid plan' }

export interface RideArtProps {
  publicationId: string
  index: number
  planPlaces: readonly string[]
  slotPlaces?: readonly string[]
}

function RideArt(p: RideArtProps & { photo?: string; thumbnail?: boolean }) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null)
  return <>
    <RegionArt
      id={pubArtId({ seed: `${p.publicationId}:day:${p.index}`, slotPlaces: p.slotPlaces, planPlaces: p.planPlaces })}
      ratio={p.thumbnail ? '4:3' : '16:9'}
      sizes={p.thumbnail ? '84px' : '(max-width: 720px) 100vw, 880px'}
      fallback={<TripArt region="generic" />}
    />
    {p.photo && p.photo !== failedPhoto && <img src={p.photo} alt="" loading="lazy" decoding="async" onError={() => { setFailedPhoto(p.photo ?? null) }} />}
  </>
}

export function RideDayPanel(p: RideArtProps & {
  state: RideState
  /** Set for a readable day with its own cover. Never for a locked day. */
  photo?: string
  /** The day badge, built by the page. */
  badge: ReactNode
  title: string
  /** The pace word. Absent when the card may not claim one. */
  pace?: string
  meta: string
  placeCount?: number
  budget: ReactNode
  /** The timeline of a readable day, or the lock note of a locked one. */
  children: ReactNode
  /** The locked note's action or notice. */
  footer?: ReactNode
}): JSX.Element {
  const photo = p.state === 'locked' ? undefined : p.photo
  const title = p.state === 'locked' ? `Day ${p.index + 1}` : p.title
  return (
    <article className={'pi-ride pi-ride--' + p.state} aria-label={`${title}, ${TAG[p.state].toLowerCase()}`}>
      <div className="pi-ride-band pi-ride-band--photo">
        <RideArt {...p} slotPlaces={p.state === 'locked' ? undefined : p.slotPlaces} photo={photo} />
        <span className="pi-pill pi-ride-tag">{TAG[p.state]}</span>
      </div>
      <div className="pi-ride-head">
        {p.badge}
        <div className="pi-ride-titles">
          <div className="pi-ride-titleline">
            <h2 className="pi-ride-title">{title}</h2>
            {p.state !== 'locked' && p.pace ? <span className="pi-pill pi-pill--sand">{p.pace}</span> : null}
          </div>
          <p className="pi-ride-meta">{p.state === 'locked' ? p.placeCount === undefined ? 'In the full plan' : `${p.placeCount} places` : p.meta}</p>
        </div>
      </div>
      {p.state !== 'locked' && <div className="pi-ride-budget">{p.budget}</div>}
      <div className="pi-ride-body">{p.children}</div>
      {p.footer ? <div className="pi-ride-foot">{p.footer}</div> : null}
    </article>
  )
}

/** One row of "The other days". Every row opens its day: the button is real on
 *  a locked day too, because opening a locked day shows its counts and the way
 *  to buy, never a name. */
export function RideOtherRow(p: RideArtProps & {
  state: RideState
  index: number
  title: string
  photo?: string
  /** "A → B → C" for a readable day, a count line for a locked one. */
  line: string
  placeCount?: number
  km: string
  drive: string
  stagger?: number
  onOpen: () => void
}): JSX.Element {
  const photo = p.state === 'locked' ? undefined : p.photo
  const read = useRideProgress(p.publicationId).has(p.index) && p.state === 'free'
  return (
    <li className={'pi-other pi-other--' + p.state} style={{ '--i': staggerStep(p.stagger ?? 0) } as CSSProperties}>
      <span className={'pi-other-thumb' + (photo ? ' pi-other-thumb--photo' : '')} aria-hidden="true">
        <RideArt {...p} slotPlaces={p.state === 'locked' ? undefined : p.slotPlaces} photo={photo} thumbnail />
        {p.state === 'locked' && <Lock className="pi-other-art-lock" size={15} />}
      </span>
      <span className="pi-other-num" aria-hidden="true"><small>Day</small><b>{p.index + 1}</b></span>
      <span className="pi-other-main">
        <span className="pi-other-titleline">
          <span className="pi-other-title">{p.state === 'locked' ? `Day ${p.index + 1}` : p.title}</span>
          <span className={'pi-pill pi-pill--' + (p.state === 'locked' ? 'paid' : 'ok')}>{read ? 'Read ✓' : TAG[p.state]}</span>
        </span>
        <span className="pi-other-line">{p.state === 'locked' ? p.placeCount === undefined ? 'In the full plan' : `${p.placeCount} places` : p.line}</span>
      </span>
      <span className="pi-other-road">
        {p.state !== 'locked' && <><b>{p.km}</b><span>{p.drive}</span></>}
      </span>
      <button type="button" className="pi-other-open" aria-label={`Open Day ${p.index + 1}`} onClick={p.onOpen}>
        <ChevronDown size={18} aria-hidden />
      </button>
    </li>
  )
}
