// P11 trip kit: the day ribbon. One button per day, drawn over a route line
// that runs teal where a day is open and marigold where it is not.
// A locked day shows its number and a count, never a place name.
import { useEffect, useRef, type CSSProperties, type JSX, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { motionTiming, prefersReducedMotion, staggerStep } from '../../lib/motion'
import { ribbonScrollTarget } from '../../lib/ribbonScroll'

export interface RibbonDay {
  index: number
  title: string
  state: 'free' | 'yours' | 'locked'
  placeCount: number
  /** The town on line two. Absent when the title carries no usable place. */
  place?: string
  /** Ride along only: "read" after this visitor opened the day, "now" for the day on screen. */
  status?: 'read' | 'now'
}

const STATUS_WORD: Record<NonNullable<RibbonDay['status']>, string> = {
  read: 'read ✓',
  now: 'open now',
}

const DOT_LABEL: Record<RibbonDay['state'], string> = {
  free: 'Free to read',
  yours: 'Yours',
  locked: 'In the paid plan',
}

/** The place word for one tile. A locked day never names a place or a title.
 *  A real town field wins. Otherwise the title gives the day's destination:
 *  the end of "A → B", the town after a closing "to", or the head of "Town — what happens". */
export function ribbonPlaceOf(
  day: { title: string; state: 'free' | 'yours' | 'locked' },
  field?: string,
): string | undefined {
  if (day.state === 'locked') return undefined
  const given = field?.trim()
  if (given) return given
  const title = day.title.trim()
  const isCapitalised = (word: string): boolean => {
    const first = word[0]
    return first === first.toUpperCase() && first !== first.toLowerCase()
  }
  const isNameWord = (word: string): boolean => /^[\p{L}-]+$/u.test(word)
  const town = (text: string | undefined) => {
    const clean = text?.trim().replace(/[.,;:!]+$/, '')
    return clean && clean.length <= 24 && isCapitalised(clean) ? clean : undefined
  }
  if (title.includes('→')) return town(title.split('→').pop())
  const words = title.replace(/[.,;:!]+$/, '').trim().split(/\s+/)
  const toIndex = words.lastIndexOf('to')
  if (toIndex >= 0 && toIndex < words.length - 1) {
    const candidate = words.slice(toIndex + 1)
    if (candidate.length <= 2 && candidate.every(word => isCapitalised(word) && isNameWord(word))) {
      return town(candidate.join(' '))
    }
  }
  const lead = /^([^—]{2,24}) — /.exec(title)
  return lead ? town(lead[1]) : undefined
}

/** The route line: one equal band per day, in the day's own colour. */
function routeLine(days: readonly RibbonDay[]): string {
  const n = Math.max(1, days.length)
  const stops = days.map((d, i) => {
    const colour = d.state === 'locked' ? 'var(--pw-marigold-300)' : 'var(--pw-route)'
    return `${colour} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/** Ease-out for the glide. The curve is the app's `--ease-paper`. */
const glide = (t: number): number => 1 - Math.pow(1 - t, 3)

/** Scroll the strip to `target`. The duration is a motion token. Reduced motion jumps. */
function glideTo(host: HTMLElement, target: number, frame: { current: number }): void {
  cancelAnimationFrame(frame.current)
  const from = host.scrollLeft
  if (prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
    host.scrollLeft = target
    return
  }
  const { duration } = motionTiming('--motion-slow')
  const start = performance.now()
  const step = (now: number) => {
    const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1
    host.scrollLeft = from + (target - from) * glide(t)
    if (t < 1) frame.current = requestAnimationFrame(step)
  }
  frame.current = requestAnimationFrame(step)
}

/** Centre the day, so a neighbour shows on each side where the strip allows. */
function revealDay(host: HTMLElement, day: Element, frame: { current: number }): void {
  const inset = parseFloat(getComputedStyle(host).scrollPaddingInlineStart) || 0
  const box = (el: Element | null | undefined) => el ? el.getBoundingClientRect() : undefined
  const item = day.closest('li')
  const target = ribbonScrollTarget({
    host: host.getBoundingClientRect(),
    inset,
    scrollLeft: host.scrollLeft,
    max: host.scrollWidth - host.clientWidth,
    day: day.getBoundingClientRect(),
    prev: box(item?.previousElementSibling?.querySelector('.pi-rib')),
    next: box(item?.nextElementSibling?.querySelector('.pi-rib')),
  })
  if (target !== null) glideTo(host, target, frame)
}

export function DayRibbon(p: {
  label: string
  /** `progress` is the share of free days read, 0 to 1. Ride along only. */
  head: { kicker: string; figure: string; sub: string; tag?: ReactNode; progress?: number }
  days: readonly RibbonDay[]
  /** The day on screen in the ride-along view. Absent in the overview. */
  current: number | null
  /** What a locked day's second line says. */
  lockedWord: string
  onPick: (index: number) => void
}): JSX.Element {
  const track = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const selectedDay = p.current
  useEffect(() => {
    if (selectedDay === null) return
    const host = track.current
    const current = host?.querySelector('[aria-current="true"]')
    if (!host || !current) return
    revealDay(host, current, frame)
  }, [selectedDay])
  useEffect(() => () => { cancelAnimationFrame(frame.current) }, [])
  return (
    <section className="pi-ribbon" aria-label={p.label}>
      <div className="pi-ribbon-head">
        <span className="pi-kicker">{p.head.kicker}</span>
        <b className="pi-ribbon-figure">{p.head.figure}</b>
        <span className="pi-ribbon-sub">{p.head.sub}</span>
        {p.head.progress !== undefined ? (
          <span className="pi-ribbon-progress" aria-hidden="true">
            <span style={{ '--pi-progress': String(Math.min(1, Math.max(0, p.head.progress))) } as CSSProperties} />
          </span>
        ) : null}
        {p.head.tag}
      </div>
      <div className="pi-ribbon-track pi-ribbon-track--short" ref={track}>
        <span className="pi-ribbon-line" aria-hidden="true" style={{ '--pi-line': routeLine(p.days) } as CSSProperties} />
        <span className="pi-ribbon-end" aria-hidden="true" />
        <ol className="pi-ribbon-days">
          {p.days.map((d, n) => (
            <li key={d.index} style={{ '--i': staggerStep(n) } as CSSProperties}>
              <button
                type="button"
                className={'pi-rib pi-rib--' + d.state + (d.status ? ' pi-rib--' + d.status : '')}
                aria-current={p.current === d.index ? 'true' : undefined}
                onFocus={event => { if (track.current) revealDay(track.current, event.currentTarget, frame) }}
                onClick={() => { p.onPick(d.index) }}
              >
                <span className="pi-rib-top">
                  <span className="pi-rib-day">Day {d.index + 1}</span>
                  {d.state === 'locked'
                    ? <span className="pi-rib-lock" role="img" aria-label={DOT_LABEL.locked}><Lock size={12} aria-hidden /></span>
                    : <span className="pi-rib-dot" role="img" aria-label={DOT_LABEL[d.state]} />}
                </span>
                <span className="pi-rib-title">
                  {d.state === 'locked' ? p.lockedWord : d.place ?? d.title}
                </span>
                <span className="pi-rib-sub">
                  {d.state === 'locked' ? `${d.placeCount} ${d.placeCount === 1 ? 'place' : 'places'}`
                    : d.status ? STATUS_WORD[d.status]
                    : `${d.placeCount} ${d.placeCount === 1 ? 'place' : 'places'}`}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
