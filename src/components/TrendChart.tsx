// ============ Recorded-traffic trend ============
//
// The one chart on the creator hub, and deliberately only one: visits (area),
// forks (line) and unlocks (marks) over the selected window, drawn from the
// SAME series the table below reads (`buildDailySeries`), so the panel and the
// rows cannot describe different periods.
//
// Choices worth naming:
//   * ONE shared scale for all three steps. A second axis would make unlocks
//     look healthy next to a visits collapse, which is the opposite of what a
//     conversion chart is for. Unlocks are sparse by nature and honestly read
//     as marks near the floor.
//   * EMPTY DAYS STAY. The series carries them (see `buildDailySeries`), so a
//     quiet week draws a quiet line instead of being compressed into a slope
//     that never happened.
//   * MONOTONE CUBIC smoothing, not Catmull-Rom: a smoothed line must never
//     overshoot between two points, because on a chart of counts an overshoot
//     draws traffic that never happened and an area that dips below zero.
//     Fritsch–Carlson tangents keep the curve inside the data.
//   * No gridline furniture: the peak and the zero are the only numbers the
//     line needs, and both are stated in the panel head, the axis row and the
//     hover guide. The window's date span is labelled underneath.
//   * Colour comes from CSS classes, never hex here, so the panel follows the
//     theme like every other surface.
import { useId, useState } from 'react'
import type { FunnelDayPoint } from '../lib/pubFunnel'

const W = 600
const H = 150
const PAD_X = 8
const PAD_Y = 12

type Pt = { x: number; y: number }

/** One point's position. `n === 1` has no span to divide by, so it centres. */
function xAt(i: number, n: number): number {
  if (n <= 1) return W / 2
  return PAD_X + (i / (n - 1)) * (W - PAD_X * 2)
}

function yAt(v: number, peak: number): number {
  const usable = H - PAD_Y * 2
  return H - PAD_Y - (peak > 0 ? (v / peak) * usable : 0)
}

/** One segment of the line: how far it runs, and how steeply. */
type Seg = { dx: number; slope: number }

/**
 * Adjacent pairs of a list.
 *
 * The curve maths below is written in terms of neighbours, and this is what
 * lets it say `[a, b]` instead of reaching back and forth through `xs[i - 1]`
 * and `xs[i + 1]`. The arithmetic is unchanged; only the addressing is.
 */
function adjacentPairs<T>(xs: T[]): Array<[T, T]> {
  const out: Array<[T, T]> = []
  let prev: T | undefined
  for (const x of xs) {
    if (prev !== undefined) out.push([prev, x])
    prev = x
  }
  return out
}

/** The weighted-mean tangent where two consecutive segments meet. */
function meanTangent(prev: Seg, next: Seg): number {
  const w1 = 2 * next.dx + prev.dx
  const w2 = next.dx + 2 * prev.dx
  return (w1 + w2) / (w1 / prev.slope + w2 / next.slope)
}

/**
 * A monotone cubic through the points (Fritsch–Carlson tangents).
 *
 * Plain straight segments read as a spreadsheet; a naive Catmull-Rom spline
 * reads as marketing and *lies* — it bulges past the data between spikes, so a
 * bar chart of counts would show visits that never happened and the filled area
 * would dip below the zero line. Monotone tangents give the same smoothness
 * with the guarantee that the curve stays inside the points it connects.
 */
function smoothPath(pts: Pt[]): string {
  if (pts.length === 0) return ''
  const start = pts[0]
  if (pts.length === 1) return `M${start.x.toFixed(2)},${start.y.toFixed(2)}`

  // Every point carries the run and the tangent it LEAVES with, so the curve
  // out of a point is decided by the two segments on either side of it. The
  // final point has no segment of its own: it inherits the last slope.
  const anchors: Array<{ at: Pt; tan: number; dx: number }> = []
  let prevSeg: Seg | undefined
  let endPoint: Pt | undefined
  for (const [a, b] of adjacentPairs(pts)) {
    const dx = b.x - a.x
    const seg: Seg = { dx, slope: dx === 0 ? 0 : (b.y - a.y) / dx }
    // Tangents: flat at local extrema, weighted mean elsewhere.
    const tan = prevSeg === undefined
      ? seg.slope
      : prevSeg.slope * seg.slope <= 0
        ? 0
        : meanTangent(prevSeg, seg)
    anchors.push({ at: a, tan, dx })
    prevSeg = seg
    endPoint = b
  }
  if (prevSeg && endPoint) anchors.push({ at: endPoint, tan: prevSeg.slope, dx: 0 })

  let d = `M${start.x.toFixed(2)},${start.y.toFixed(2)}`
  for (const [a, b] of adjacentPairs(anchors)) {
    const c1x = a.at.x + a.dx / 3
    const c1y = a.at.y + (a.tan * a.dx) / 3
    const c2x = b.at.x - a.dx / 3
    const c2y = b.at.y - (b.tan * a.dx) / 3
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${b.at.x.toFixed(2)},${b.at.y.toFixed(2)}`
  }
  return d
}

function seriesPoints(points: FunnelDayPoint[], peak: number, pick: (p: FunnelDayPoint) => number): Pt[] {
  return points.map((p, i) => ({ x: xAt(i, points.length), y: yAt(pick(p), peak) }))
}

/** "23 Sep" — the axis wants a date, not a timestamp. */
function axisDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** How the unlock stage's only source — the sales ledger — is doing. Unlocks
 *  come from sales, so an unread ledger means the unlocks are UNKNOWN, and a
 *  blank or a zero in that slot would read as "nobody bought". Three states
 *  rather than a boolean because waiting and failing are different sentences. */
export type UnlockRead = 'ready' | 'reading' | 'failed'

export function TrendChart({ points, label, unlockRead = 'ready' }: { points: FunnelDayPoint[]; label: string; unlockRead?: UnlockRead }) {
  // Unique per instance: the hub renders more than one chart (a fixture page,
  // or a future comparison), and duplicate SVG gradient ids would cross-wire.
  const fadeId = useId()
  /** The latched day, WITH the window it was latched in.
   *
   *  Storing the index alone made a window change silently re-label it — index 40
   *  of ninety days is not index 40 of seven — and clearing it from an effect (the
   *  obvious repair) is a setState in an effect body, which the hooks lint refuses.
   *  It refuses for a good reason: a latch from another window is simply unreadable,
   *  so a comparison does what the effect would have, without the render. */
  const [latch, setLatch] = useState<{ label: string; index: number } | null>(null)

  // WHICH series peaked, not just how high: "peak 131 a day" named no series on
  // a chart that draws three, so the panel's only quantified number was the one
  // thing a reader could not attribute.
  const peakPoint = points.reduce<{ v: number; series: 'visits' | 'forks' | 'unlocks'; day: string }>(
    (best, p) => {
      let next = best
      const candidates: Array<[typeof best.series, number]> = [['visits', p.views], ['forks', p.forks], ['unlocks', p.unlocks]]
      for (const [series, v] of candidates) if (v > next.v) next = { v, series, day: p.day }
      return next
    },
    { v: 0, series: 'visits', day: points[0]?.day ?? '' },
  )
  const peak = peakPoint.v
  const totalViews = points.reduce((s, p) => s + p.views, 0)
  const totalForks = points.reduce((s, p) => s + p.forks, 0)
  const totalUnlocks = points.reduce((s, p) => s + p.unlocks, 0)
  const quiet = peak === 0
  const first = points[0]?.day
  const last = points[points.length - 1]?.day
  // The index is kept alongside the point: the guide line and the readout both
  // need to know WHERE on the axis the active day sits, not only which day it
  // is. Tracking the index is also what lets the drawing below read a day
  // without a non-null assertion.
  const activeIndex = latch !== null && latch.label === label && !quiet ? latch.index : null
  // A computed index into a plain array is the shape Codacy's object-injection
  // rule refuses; `find` says the same thing with an honest `| undefined`.
  const active = activeIndex === null ? null : (points.find((_, i) => i === activeIndex) ?? null)
  /** The readout's spoken twin — the same numbers as the tooltip, labelled the same
   *  way rather than written as a sentence. The sentence form reads "1 forks" for a
   *  single fork — the small wrongness the hub's own `unit` helper exists to stop —
   *  and the labels keep the two readings identical besides. */
  const activeSpoken = active === null ? '' : `${axisDay(active.day)} · Visits: ${active.views.toLocaleString('en-IN')}, Forks: ${active.forks.toLocaleString('en-IN')}, Unlocks: ${unlockRead === 'ready' ? active.unlocks.toLocaleString('en-IN') : unlockRead === 'reading' ? 'reading' : 'not read'}.`

  /** Nearest day index to the pointer, or null when there is nothing to track.
   *  The SVG scales to its container, so the mouse position is converted through
   *  the rendered box rather than assumed. */
  const indexAt = (e: React.PointerEvent<SVGSVGElement>): number | null => {
    if (quiet || points.length === 0) return null
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width === 0) return null
    const xView = ((e.clientX - box.left) / box.width) * W
    const t = (xView - PAD_X) / (W - PAD_X * 2)
    const i = Math.round(t * (points.length - 1))
    return Math.max(0, Math.min(points.length - 1, i))
  }

  const trackPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const i = indexAt(e)
    if (i !== null) setDay(i)
  }

  /** The tap TOGGLES, and only for a pointer that cannot hover.
   *
   *  A tap has to latch — a finger has no hover, and clearing on lift would make
   *  the panel unusable on the phone this app ships to — but a latch with no
   *  release is a trap: `onPointerLeave` below is mouse-only by design, and Escape
   *  is not a key a phone has. Tapping the day that is already showing is the one
   *  gesture that can mean "never mind", so it dismisses. A mouse keeps plain
   *  assignment: it clears by leaving, and a click that blanked the readout under
   *  the cursor would fight the hover it is already using. */
  const latchPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const i = indexAt(e)
    if (i === null) return
    setLatch(current => (
      e.pointerType !== 'mouse' && current !== null && current.label === label && current.index === i
        ? null
        : { label, index: i }
    ))
  }

  /** Every writer goes through here, so the guard and the window label cannot
   *  drift apart. */
  const setDay = (index: number) => {
    if (quiet || points.length === 0) return
    setLatch({ label, index: Math.max(0, Math.min(points.length - 1, index)) })
  }

  /** Moves the latch by one day, starting from -1 when the current latch belongs to
   *  another window — so a keyboard walk after a window change begins at the first
   *  day rather than continuing a stranger's index. */
  const stepLatch = (to: (from: number | null, last: number) => number) => {
    if (quiet || points.length === 0) return
    setLatch(current => {
      const from = current !== null && current.label === label ? current.index : null
      return { label, index: to(from, points.length - 1) }
    })
  }

  const tipPct = active && activeIndex !== null ? Math.max(6, Math.min(94, (xAt(activeIndex, points.length) / W) * 100)) : 0

  return (
    <figure className="hub-chart">
      <svg
        className={`hub-chart-svg${quiet ? ' is-quiet' : ''}`}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Recorded traffic over ${label}: ${totalViews} visits, ${totalForks} forks${unlockRead === 'ready' ? `, ${totalUnlocks} unlocks` : unlockRead === 'reading' ? '; unlocks still being read' : '; unlocks could not be read'}.`}
        onPointerMove={trackPointer}
        onPointerDown={latchPointer}
        onPointerLeave={e => { if (e.pointerType === 'mouse') setLatch(null) }}
        // Keyboard parity with the pointer: the chart is a reading tool, and a
        // readout only a mouse can reach is a readout half the users never see.
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { stepLatch((from, last) => Math.min(last, (from ?? -1) + 1)); e.preventDefault() }
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { stepLatch((from, last) => Math.max(0, (from === null ? last + 1 : from) - 1)); e.preventDefault() }
          else if (e.key === 'Home') { setDay(0); e.preventDefault() }
          else if (e.key === 'End') { setDay(points.length - 1); e.preventDefault() }
          else if (e.key === 'Escape') setLatch(null)
        }}
        onBlur={() => { setLatch(null) }}
      >
        <defs>
          <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="hc-fade-top" />
            <stop offset="100%" className="hc-fade-bottom" />
          </linearGradient>
        </defs>
        <line className="hc-zero" x1="0" y1={H - PAD_Y} x2={W} y2={H - PAD_Y} vectorEffect="non-scaling-stroke" />
        {!quiet && (
          <>
            <path
              className="hc-views-area"
              fill={`url(#${fadeId})`}
              d={`${smoothPath(seriesPoints(points, peak, p => p.views))} L${xAt(points.length - 1, points.length).toFixed(2)},${H - PAD_Y} L${xAt(0, points.length).toFixed(2)},${H - PAD_Y} Z`}
            />
            <path className="hc-views-line" d={smoothPath(seriesPoints(points, peak, p => p.views))} vectorEffect="non-scaling-stroke" />
            <path className="hc-forks-line" d={smoothPath(seriesPoints(points, peak, p => p.forks))} vectorEffect="non-scaling-stroke" />
            {/* Only marks we actually read: an unread ledger draws no unlock
                dots rather than dots at zero. The mark wears the SAME hue as
                the row's unlock figure (`--ink-amber`), so the unlock stage is
                one colour everywhere on the page and saffron stays reserved for
                publish/invite actions. */}
            {unlockRead === 'ready' && points.map((p, i) => (p.unlocks > 0 ? (
              <circle key={p.day} className="hc-unlock" cx={xAt(i, points.length)} cy={yAt(p.unlocks, peak)} r="4" />
            ) : null))}
            {/* The guide: one vertical line and one dot per series at the day
                under the pointer. Drawn last so it sits over the fills. */}
            {active && activeIndex !== null && (
              <>
                <line className="hc-guide" x1={xAt(activeIndex, points.length)} y1={PAD_Y} x2={xAt(activeIndex, points.length)} y2={H - PAD_Y} vectorEffect="non-scaling-stroke" />
                <circle className="hc-hover-dot" cx={xAt(activeIndex, points.length)} cy={yAt(active.views, peak)} r="4.5" />
                <circle className="hc-hover-dot is-forks" cx={xAt(activeIndex, points.length)} cy={yAt(active.forks, peak)} r="3.5" />
              </>
            )}
          </>
        )}
      </svg>

      {/* Axis: the window's own span, so the line can be read without a legend
          of dates. Kept as DOM text (not SVG) so it stays crisp at any width. */}
      <div className="hub-chart-axis">
        <span>{first ? axisDay(first) : ''}</span>
        <span className="hub-chart-peak">
          {quiet ? 'Nothing recorded in this window' : `Peak ${peak.toLocaleString('en-IN')} ${peakPoint.series} on ${axisDay(peakPoint.day)}`}
        </span>
        <span>{last ? axisDay(last) : ''}</span>
      </div>

      {/* The hover readout. DOM, not SVG, so the type stays crisp on a phone
          where the drawing itself is scaled down. */}
      {active && (
        <div className="hub-chart-tip" style={{ left: `clamp(72px, ${tipPct}%, calc(100% - 72px))` }}>
          <b>{axisDay(active.day)}</b>
          <span>Visits {active.views.toLocaleString('en-IN')}</span>
          <span>Forks {active.forks.toLocaleString('en-IN')}</span>
          {unlockRead === 'ready'
            ? <span>Unlocks {active.unlocks.toLocaleString('en-IN')}</span>
            : <span className="muted">{unlockRead === 'reading' ? 'Unlocks reading…' : 'Unlocks not read'}</span>}
        </div>
      )}

      {/* The readout's VOICE. A live region inserted at the same moment as its
          content is not reliably announced, so this one stays in the DOM and only
          its text changes; the visible tooltip above is untouched. Without it the
          keyboard path was silence — the arrow keys moved a `hover` index into a
          plain div while the chart's own label went on describing the WINDOW
          totals, so focus brought a static description of different numbers. */}
      <span className="sr-only" role="status" aria-atomic="true">{activeSpoken}</span>

      <figcaption className="hub-chart-key">
        <span className="hc-key"><i className="hc-swatch hc-swatch-views" aria-hidden />Visits <b className="num">{totalViews.toLocaleString('en-IN')}</b></span>
        <span className="hc-key"><i className="hc-swatch hc-swatch-forks" aria-hidden />Forks <b className="num">{totalForks.toLocaleString('en-IN')}</b></span>
        <span className="hc-key"><i className="hc-swatch hc-swatch-unlocks" aria-hidden />Unlocks <b className="num">{unlockRead === 'ready' ? totalUnlocks.toLocaleString('en-IN') : unlockRead === 'reading' ? 'reading…' : 'not read'}</b></span>
      </figcaption>
    </figure>
  )
}
