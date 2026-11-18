// ============ The route card's height curve ============
// Paints the geometry `elevationPlot.ts` returns. The curve is illustrative:
// it joins the public terrain estimates at the trip's own places and never
// claims the ground between them.
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RouteHeightCurveRun, RouteHeightPoint, RouteHeightStats } from '../../lib/elevation'
import { buildRouteHeightPlot, heightLabelY, strokeClearOfBox } from '../../lib/elevationPlot'
import { overviewPinText } from '../../lib/overviewRouteMap'

/** The corner overlay's box in chart units. It mirrors `.ovw-elev-inset` in
 *  overview-route-card.css (top 8, left 8, 60 square). The margin keeps a
 *  stroke from grazing its border. */
const INSET_BOX = { left: 8, top: 8, right: 68, bottom: 68 }
const INSET_MARGIN = 6
/** A narrower chart has no corner free of its labels: the desktop card's own
 *  chart is about 320 to 470 px, the 390 phone chart about 340 px, so both
 *  clear this floor and the geometry decides the rest. */
const INSET_MIN_WIDTH = 280
/** The sun's halo radius plus 2 px: how far right of the inset the sun steps
 *  when the inset shows, so the two never overlap. */
const SUN_CLEAR = 26

/** The SVG fills the CONTENT box of its frame, so measure that box only. */
function useDrawableWidth(fallback: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const read = (entry?: ResizeObserverEntry) => {
      if (entry) return Math.max(1, entry.contentRect.width)
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      return Math.max(1, rect.width - border - padding)
    }
    setWidth(read())
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setWidth(read(entries[0])))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

export function OverviewElevationProfile({
  points,
  runs,
  stats,
  compact,
  children,
}: {
  points: readonly RouteHeightPoint[]
  runs: readonly RouteHeightCurveRun[]
  stats: RouteHeightStats
  compact: boolean
  /** Overlay content rendered inside the chart box (position: relative). */
  children?: ReactNode
}) {
  const { ref, width } = useDrawableWidth(compact ? 420 : 720)
  const height = Math.max(compact ? 150 : 170, Math.min(280, Math.round(width * 0.45)))
  // The plot is the card's whole drawing box, so the curve's x scale runs from
  // its left edge to its right edge: no bleed-in gap at either end.
  const plot = useMemo(
    () => buildRouteHeightPlot(points, runs, stats, width, height, { left: 0, right: width }),
    [points, runs, stats, width, height],
  )
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const skyId = `ovw-sky-${uid}`
  const landId = `ovw-land-${uid}`
  const plotId = `ovw-plot-${uid}`

  // Only the two ends of the trip carry a label on the curve, each with its
  // real place name and real height. The stop list names every other place.
  const labelled = useMemo(
    () => plot.marks.filter(mark => mark.kind === 'start' || mark.kind === 'destination'),
    [plot],
  )

  // Each end label's own words and baseline. The render reads them, and so does
  // the inset check below, so both agree on where the words sit.
  const endLabels = useMemo(() => labelled.map(mark => {
    const anchor = mark.x > width * 0.72 ? 'end' as const : 'start' as const
    const dx = anchor === 'end' ? -7 : 7
    const name = overviewPinText(mark.title, compact ? 14 : 20)
    const heightText = `${Math.round(mark.elevationM).toLocaleString('en-IN')} m`
    const labelWidth = Math.max(name.length, heightText.length) * 6.2
    // The label's own box decides its side: above the stroke or below
    // it, on whichever side holds more room, so the line never crosses
    // the words at either end of the curve.
    const nameY = heightLabelY({
      markX: mark.x,
      markY: mark.y,
      anchor,
      labelWidth,
      runs: plot.runs,
      padTop: plot.pad.top,
      baseY: plot.baseY,
    })
    return { mark, anchor, dx, name, heightText, labelWidth, nameY }
  }), [labelled, width, compact, plot])

  // The overlay in the top-left corner (`.ovw-elev-inset`, 8 px in, 60 px square)
  // shows only when the chart is wide enough and it covers neither the stroke
  // nor an end label. A route that starts high puts both in that corner.
  const insetRoom = useMemo(() => {
    if (width < INSET_MIN_WIDTH) return false
    const box = { left: INSET_BOX.left - INSET_MARGIN, top: INSET_BOX.top - INSET_MARGIN, right: INSET_BOX.right + INSET_MARGIN, bottom: INSET_BOX.bottom + INSET_MARGIN }
    if (!strokeClearOfBox(plot.runs, box)) return false
    return endLabels.every(({ mark, anchor, dx, labelWidth, nameY }) => {
      const left = anchor === 'end' ? mark.x + dx - labelWidth : mark.x + dx
      const right = left + labelWidth
      // The name sits 11 px above its baseline, the height line 17 px below it.
      return right < box.left || left > box.right || nameY + 17 < box.top || nameY - 11 > box.bottom
    })
  }, [width, plot, endLabels])

  // The decorative sun shares the top-left corner with the inset. When the
  // inset shows, the sun steps right of it by its halo, so the two never
  // overlap; when it hides, the sun keeps its own place.
  const sunCx = insetRoom ? Math.max(width * 0.141, INSET_BOX.right + SUN_CLEAR) : width * 0.141

  const peak = plot.peak
  const peakBoxH = 34
  const peakLabel = peak ? overviewPinText(peak.title, compact ? 18 : 24) : ''
  const peakBoxW = Math.min(
    Math.max(80, width - 20),
    Math.max(compact ? 132 : 156, Math.round(peakLabel.length * 6.4) + 24),
  )
  const peakBoxX = Math.max(6, width - peakBoxW - 10)
  const peakBoxY = 8

  return (
    <div ref={ref} className="ovw-elev" data-inset-room={insetRoom ? 'true' : 'false'}>
      <svg
        className="ovw-elev-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={[
          'Illustrative route heights from public terrain estimates.',
          `Lowest place ${Math.round(stats.minM)} metres, highest place ${Math.round(stats.maxM)} metres.`,
          peak ? `The highest is ${peak.title}.` : '',
        ].filter(Boolean).join(' ')}
      >
        <defs>
          <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="ovw-elev-sky-top" />
            <stop offset="0.6" className="ovw-elev-sky-bottom" />
          </linearGradient>
          <linearGradient id={landId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="ovw-elev-land-top" />
            <stop offset="1" className="ovw-elev-land-bottom" />
          </linearGradient>
          {/* One clip for the line and every fill: the plot rect at the card's
              own corner radius. The curve stops on the plot edge. */}
          <clipPath id={plotId}>
            <rect x="0" y="0" width={width} height={height} rx="18" />
          </clipPath>
        </defs>

        <rect x="0" y="0" width={width} height={height} fill={`url(#${skyId})`} />
        <circle className="ovw-elev-sun-halo" cx={sunCx} cy={height * 0.207} r={24} aria-hidden="true" />
        <circle className="ovw-elev-sun" cx={sunCx} cy={height * 0.207} r={15} aria-hidden="true" />
        <rect className="ovw-elev-band" x="0" y={plot.baseY} width={width} height={height - plot.baseY} aria-hidden="true" />

        {/* Two far ranges are the same plotted curve scaled up from the baseline.
            They add depth behind the route and carry no height of their own. */}
        <g clipPath={`url(#${plotId})`}>
          {plot.runs.map((run, index) => (
            <g key={`run-${index}`}>
              <path className="ovw-elev-hill-far" d={run.area} transform={`translate(0 ${plot.baseY}) scale(1 1.12) translate(0 ${-plot.baseY})`} aria-hidden="true" />
              <path className="ovw-elev-hill-near" d={run.area} transform={`translate(0 ${plot.baseY}) scale(1 1.04) translate(0 ${-plot.baseY})`} aria-hidden="true" />
              <path className="ovw-elev-area" d={run.area} fill={`url(#${landId})`} />
              {/* `pathLength={1}` lets the CSS dash draw run the whole curve once,
                  instead of leaving it dotted at its real length. */}
              <path className="ovw-elev-line" d={run.line} pathLength={1} />
              <path className="ovw-elev-line-centre" d={run.line} aria-hidden="true" />
            </g>
          ))}
        </g>

        {/* One group, so the marks arrive as one beat in the CSS cascade. */}
        <g className="ovw-elev-marks">
          {plot.marks.map(mark => (
            <circle
              key={`${mark.kind}-${mark.distanceKm}-${mark.title}`}
              className={`ovw-elev-dot is-${mark.kind}`}
              cx={mark.x}
              cy={mark.y}
              r={mark.kind === 'destination' ? 7 : mark.kind === 'start' ? 6 : 4.5}
            />
          ))}
        </g>

        <g className="ovw-elev-labels">
          {endLabels.map(({ mark, anchor, dx, name, heightText, nameY }) => (
            <g key={`label-${mark.title}-${mark.distanceKm}`}>
              <text className="ovw-elev-name" x={mark.x + dx} y={nameY} textAnchor={anchor}>
                {name}
              </text>
              <text className="ovw-elev-height" x={mark.x + dx} y={nameY + 13} textAnchor={anchor}>
                {heightText}
              </text>
            </g>
          ))}
        </g>

        {peak && (
          <g className="ovw-elev-peak">
            <line
              className="ovw-elev-leader"
              x1={peak.x}
              y1={peak.y}
              x2={peakBoxX + 16}
              y2={peakBoxY + peakBoxH}
            />
            <rect x={peakBoxX} y={peakBoxY} width={peakBoxW} height={peakBoxH} rx="8" />
            <text className="ovw-elev-peak-title" x={peakBoxX + 10} y={peakBoxY + 14}>
              {peakLabel}
            </text>
            <text className="ovw-elev-peak-value" x={peakBoxX + 10} y={peakBoxY + 27}>
              {Math.round(peak.elevationM).toLocaleString('en-IN')} m
              {peak.dayIndex != null ? ` · Day ${peak.dayIndex + 1}` : ''}
            </text>
          </g>
        )}

        <g className="ovw-elev-axes">
          {plot.ticksX.map((tick, index) => (
            <text
              key={`x-${tick.label}`}
              className="ovw-elev-axis is-x"
              x={tick.x}
              y={plot.baseY + 18}
              textAnchor={index === 0 ? 'start' : index === plot.ticksX.length - 1 ? 'end' : 'middle'}
            >
              {tick.label}
            </text>
          ))}
        </g>
      </svg>
      {children}
    </div>
  )
}
