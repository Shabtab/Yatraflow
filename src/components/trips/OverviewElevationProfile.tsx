// ============ The route card's height curve ============
// Paints the geometry `elevationPlot.ts` returns. The curve is illustrative:
// it joins the public terrain estimates at the trip's own places and never
// claims the ground between them.
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RouteHeightCurveRun, RouteHeightPoint, RouteHeightStats } from '../../lib/elevation'
import { buildRouteHeightPlot, heightLabelY } from '../../lib/elevationPlot'
import { overviewPinText } from '../../lib/overviewRouteMap'

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
}: {
  points: readonly RouteHeightPoint[]
  runs: readonly RouteHeightCurveRun[]
  stats: RouteHeightStats
  compact: boolean
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
    <div ref={ref} className="ovw-elev">
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
        <circle className="ovw-elev-sun-halo" cx={width * 0.141} cy={height * 0.207} r={24} aria-hidden="true" />
        <circle className="ovw-elev-sun" cx={width * 0.141} cy={height * 0.207} r={15} aria-hidden="true" />
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
          {labelled.map(mark => {
            const anchor = mark.x > width * 0.72 ? 'end' : 'start'
            const dx = anchor === 'end' ? -7 : 7
            const name = overviewPinText(mark.title, compact ? 14 : 20)
            const heightText = `${Math.round(mark.elevationM).toLocaleString('en-IN')} m`
            // The label's own box decides its side: above the stroke or below
            // it, on whichever side holds more room, so the line never crosses
            // the words at either end of the curve.
            const nameY = heightLabelY({
              markX: mark.x,
              markY: mark.y,
              anchor,
              labelWidth: Math.max(name.length, heightText.length) * 6.2,
              runs: plot.runs,
              padTop: plot.pad.top,
              baseY: plot.baseY,
            })
            return (
              <g key={`label-${mark.title}-${mark.distanceKm}`}>
                <text className="ovw-elev-name" x={mark.x + dx} y={nameY} textAnchor={anchor}>
                  {name}
                </text>
                <text className="ovw-elev-height" x={mark.x + dx} y={nameY + 13} textAnchor={anchor}>
                  {heightText}
                </text>
              </g>
            )
          })}
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
    </div>
  )
}
