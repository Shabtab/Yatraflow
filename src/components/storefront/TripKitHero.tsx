// P11 trip kit: the cover and the buy card. Presentation only.
// The page builds every gate: which button shows, which notice shows, which
// price. These components draw what they are handed and decide nothing about
// access.
import type { ReactNode } from 'react'
import { DAY_MS } from '../../lib/dayCount'

/** The id the "Overview" section link scrolls to. */
export const HERO_SECTION_ID = 'pi-sec-top'

export function TripKitHero({ onCover, photo, art, back, kicker, title, subtitle, route, facts, byline, asideLabel, aside, tabs, ride }: {
  /** Receives the cover element, so the page can watch it leave the screen. */
  onCover: (el: HTMLElement | null) => void
  /** The cover photo element. Absent when the plan has none. */
  photo?: ReactNode
  /** The generated scene drawn when there is no photo, so the cover is never a flat block. */
  art?: ReactNode
  back: ReactNode
  kicker: string
  title: string
  subtitle?: string
  route: string
  facts: string[]
  byline?: ReactNode
  asideLabel: string
  aside: ReactNode
  tabs: ReactNode
  /** Only readable day photos reach the ride-along introduction. */
  ride?: { photos: ReadonlyArray<{ index: number; src?: string; art?: ReactNode; title: string }>; facts?: ReadonlyArray<{ value: string; label: string }>; notice?: ReactNode }
}): JSX.Element {
  const copy = <div className="pi-hero-copy">
    {back}
    <span className="pi-kicker pi-hero-kicker">{kicker}</span>
    <h1 className="pi-hero-title">{title}</h1>
    {subtitle ? <p className="pi-hero-sub">{subtitle}</p> : null}
    <p className="pi-hero-route">{route}</p>
    {ride ? byline : null}
    {ride?.facts ? <dl className="pi-ride-facts">
      {ride.facts.map(f => <div key={f.label}><dt>{f.value}</dt><dd>{f.label}</dd></div>)}
    </dl> : facts.length > 0 ? <ul className="pi-hero-facts">
      {facts.map((f) => <li key={f}>{f}</li>)}
    </ul> : null}
    {!ride ? byline : null}
  </div>
  if (ride) return (
    <header id={HERO_SECTION_ID} className={'pi-ride-intro' + (ride.photos.length ? ' pi-ride-intro--photos' : '')} ref={onCover}>
      {copy}
      {ride.photos.length > 0 ? (
        <div className="pi-ride-mosaic" aria-label="Pictures from the open days">
          {ride.photos.map((p) => (
            <figure className={'pi-ride-photo' + (p.src ? '' : ' pi-ride-photo--art')} key={p.index}>
              {p.src
                ? <img src={p.src} alt="" decoding="async" onError={(e) => { e.currentTarget.hidden = true }} />
                : p.art}
              <figcaption><span className="pi-badge"><small>Day</small><b>{p.index + 1}</b></span><span>{p.title}</span></figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {tabs ? <div className="pi-hero-tabs">{tabs}</div> : null}
      {ride.notice ? <div className="pi-ride-notice">{ride.notice}</div> : null}
    </header>
  )
  return (
    <header id={HERO_SECTION_ID} className={'pi-hero' + (photo ? '' : art ? ' pi-hero--art' : '')} ref={onCover}>
      {photo ?? (art ? <div className="pi-hero-art" aria-hidden="true">{art}</div> : null)}
      <div className="pi-hero-scrim" aria-hidden="true" />
      {copy}
      <aside className="pi-hero-aside" aria-label={asideLabel}>{aside}</aside>
      {tabs ? <div className="pi-hero-tabs">{tabs}</div> : null}
    </header>
  )
}

/** "updated 20 days ago". Whole days, from the publication's own stamp. */
export function updatedAgo(stamp: number, now: number): string {
  const days = Math.floor((now - stamp) / DAY_MS)
  if (!Number.isFinite(days) || days < 0) return ''
  if (days === 0) return 'updated today'
  if (days === 1) return 'updated yesterday'
  if (days < 60) return `updated ${days} days ago`
  return `updated ${Math.floor(days / 30)} months ago`
}

export function BuyCard(p: {
  /** Absent while the gate has no answer: no price is claimed then. */
  price?: string
  note: string
  /** One entry per day. Shown only when some day is locked. */
  split?: ReadonlyArray<'open' | 'locked'>
  splitLabel?: string
  /** The line under the bar: the page's own preview-split sentence. */
  splitNote?: string
  quote?: string
  quoteBy?: string
  /** The gate's buttons and notices, built by the page. */
  children: ReactNode
}): JSX.Element {
  const split = p.split && p.split.includes('locked') ? p.split : null
  return (
    <div className="pi-buy">
      {p.price !== undefined ? <p className="pi-buy-price"><b>{p.price}</b>{p.note ? <span>{p.note}</span> : null}</p> : null}
      {split ? (
        <div className="pi-split" role="img" aria-label={p.splitLabel}>
          {split.map((s, i) => <span key={i} className={'pi-split-seg pi-split-' + s} />)}
        </div>
      ) : null}
      {p.splitNote ? <p className="pi-buy-note">{p.splitNote}</p> : null}
      {p.quote ? (
        <blockquote className="pi-buy-quote">
          {p.quote}
          {p.quoteBy ? <cite>{p.quoteBy}</cite> : null}
        </blockquote>
      ) : null}
      <div className="pi-buy-actions">{p.children}</div>
    </div>
  )
}
