import { useEffect, useId, useMemo, useState } from 'react'
import type { Trip } from '../../../data/types'
import { isWireLocked } from '../../../lib/lockedDay'
import { measureRouteHeights, type RouteHeightInput, type RouteHeightsResult } from '../../../lib/elevation'
import { activeElevationTileLoader } from '../../../lib/elevationTiles'
import {
  buildRouteHeightPlot,
  heightCaption,
  heightDayLabels,
  heightRangeText,
  paidBandLabel,
  paidDayXRuns,
  roundHeight50,
} from '../../../lib/elevationPlot'

type HeightState = { kind: 'loading' } | RouteHeightsResult

export function rideHeightPoints(trip: Trip, freeIndexes: readonly number[]): RouteHeightInput[] {
  const points: RouteHeightInput[] = []
  let chainIndex = 0
  for (const day of [...trip.days].sort((a, b) => a.index - b.index)) {
    if (isWireLocked(day) || !freeIndexes.includes(day.index)) {
      chainIndex += 1
      continue
    }
    for (const stop of [...day.stops].filter(stop => stop.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)) {
      points.push({ key: stop.id, title: stop.title, kind: 'stop', dayIndex: day.index, lat: stop.lat, lng: stop.lng, chainIndex })
      chainIndex += 1
    }
  }
  return points
}

// The paid-band helpers live in `elevationPlot.ts`, next to the plot they read.
export { paidDaysLabel, paidHeightBands, type PaidHeightBand } from '../../../lib/elevationPlot'

/**
 * Measures the heights at the given days' places. The result is loading,
 * failed, empty or measured. These states stay separate.
 */
export function useRouteHeights(trip: Trip, dayIndexes: readonly number[]) {
  const points = useMemo(() => rideHeightPoints(trip, dayIndexes), [trip, dayIndexes])
  const paidIndexes = useMemo(() => trip.days.map(day => day.index).filter(index => !dayIndexes.includes(index)), [trip, dayIndexes])
  const [loaded, setLoaded] = useState<{ points: readonly RouteHeightInput[]; result: RouteHeightsResult } | null>(null)
  const result: HeightState = loaded?.points === points ? loaded.result : { kind: 'loading' }
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      controller.abort()
      setLoaded({ points, result: { kind: 'failed', reason: 'tiles' } })
    }, 12_000)
    void measureRouteHeights(points, activeElevationTileLoader(), controller.signal).then(value => {
      if (!controller.signal.aborted) setLoaded({ points, result: value })
    }).catch(() => { if (!controller.signal.aborted) setLoaded({ points, result: { kind: 'failed', reason: 'tiles' } }) })
      .finally(() => { window.clearTimeout(timer) })
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [points])
  return { result, paidIndexes }
}

// The chart's own box. The plot is 308 wide and 80 tall, inset 4 units from
// each side and sitting on the baseline at y=84.
const CHART_W = 316
const CHART_H = 100
const CHART_LEFT = 4
const CHART_RIGHT = 312
const CHART_BASELINE = 84
const PLOT_W = CHART_RIGHT - CHART_LEFT
const PLOT_H = CHART_BASELINE - CHART_LEFT
const DAY_LABEL_Y = 97
const BAND_LABEL_Y = 76
/** The sky rect's radius. The clip path repeats it, so the stroke and the
 *  fills stop on the plot's own rounded edge. */
const PLOT_RADIUS = 10

/**
 * One curve through the whole trip. The plot splits its groups where the data
 * breaks, so the runs are joined here with a straight step. No gap, no box.
 */
function oneHeightPath(runs: ReadonlyArray<{ line: string }>): string {
  let path = ''
  for (const run of runs) {
    const head = run.line.match(/^M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/)
    if (!head) continue
    path += path.length === 0 ? run.line : ` L ${head[1]} ${head[2]}${run.line.slice(head[0].length)}`
  }
  return path
}

/** The Ride along side card. Withheld days supply no terrain points. */
export function RideElevation({ trip, freeIndexes }: { trip: Trip; freeIndexes: readonly number[] }) {
  const dayIndexes = useMemo(() => trip.days.map(day => day.index), [trip])
  // Withheld coordinates must never reach a tile request, including from an older cached trip.
  const { result } = useRouteHeights(trip, freeIndexes)
  const paidIndexes = useMemo(() => [...dayIndexes].filter(index => !freeIndexes.includes(index)).sort((a, b) => a - b), [dayIndexes, freeIndexes])
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const skyId = `pi-height-sky-${uid}`
  const freeId = `pi-height-free-${uid}`
  const paidId = `pi-height-paid-${uid}`
  const plotId = `pi-height-plot-${uid}`

  const measured = result.kind === 'measured' ? result : null
  const plot = useMemo(
    () => (measured ? buildRouteHeightPlot(measured.points, measured.runs, measured.stats, PLOT_W + 32, PLOT_H + 60) : null),
    [measured],
  )
  const chart = useMemo(() => {
    if (!plot || !measured) return null
    const runs = paidDayXRuns(measured.points, plot, paidIndexes, dayIndexes)
    // The plot box is the sky rect. The stroke and the fills start and end on
    // its own left and right edges, and one clip path holds them to its radius.
    const left = plot.edges.left
    const right = plot.edges.right
    const line = oneHeightPath(plot.runs)
    const bounds = { startX: left, endX: right }
    const free: Array<{ x: number; width: number }> = []
    let cursor = left
    for (const run of runs) {
      if (run.startX > cursor) free.push({ x: cursor, width: run.startX - cursor })
      cursor = Math.max(cursor, run.endX)
    }
    if (cursor < right) free.push({ x: cursor, width: right - cursor })
    return {
      left,
      right,
      baseY: plot.baseY,
      line,
      area: line ? `${line} L ${right} ${plot.baseY} L ${left} ${plot.baseY} Z` : '',
      runs,
      free,
      labels: heightDayLabels(runs, bounds),
      bandLabel: paidBandLabel(paidIndexes, measured.stats.peak?.dayIndex ?? null),
    }
  }, [plot, paidIndexes, dayIndexes, measured])

  if (result.kind === 'empty') return null
  if (result.kind === 'loading') return (
    <section className="pi-card pi-ride-height pi-height-card" aria-labelledby="pi-ride-height-title">
      <div className="pi-height-heading"><h3 id="pi-ride-height-title">The road, by height</h3></div>
      <p className="pi-height-state" role="status">Loading route heights…</p>
    </section>
  )
  if (result.kind === 'failed') return (
    <section className="pi-card pi-ride-height pi-height-card" aria-labelledby="pi-ride-height-title">
      <div className="pi-height-heading"><h3 id="pi-ride-height-title">The road, by height</h3></div>
      <p className="pi-height-state">Route heights are not available.</p>
    </section>
  )
  if (!chart || !plot || !measured || !chart.line) return null

  const heights = measured.points.map(point => point.elevationM).filter((metres): metres is number => metres != null)
  const peak = measured.stats.peak
  const peakDayIndex = peak?.dayIndex ?? null
  const peakInPaid = peakDayIndex != null && paidIndexes.includes(peakDayIndex)
  const caption = heightCaption(heights, peak && peak.elevationM != null ? { elevationM: peak.elevationM, dayIndex: peakDayIndex } : null, paidIndexes)
  const formatM = (metres: number) => roundHeight50(metres).toLocaleString('en-IN')
  const aria = [
    `Height along the trip, from ${formatM(measured.stats.minM)} m to ${formatM(measured.stats.maxM)} m.`,
    peakInPaid ? 'The highest point is in the paid days.' : peakDayIndex != null ? `The highest point is on day ${peakDayIndex + 1}.` : '',
  ].filter(Boolean).join(' ')

  return <section className="pi-card pi-ride-height pi-height-card" aria-labelledby="pi-ride-height-title">
    <div className="pi-height-heading">
      <h3 id="pi-ride-height-title">The road, by height</h3>
      <span>{heightRangeText(measured.stats.minM, measured.stats.maxM)}</span>
    </div>
    <svg
      className="pi-height-chart"
      viewBox={`${plot.pad.left - CHART_LEFT} ${plot.baseY - CHART_BASELINE} ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label={aria}
    >
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="pi-height-sky-top" />
          <stop offset="1" className="pi-height-sky-bottom" />
        </linearGradient>
        <clipPath id={freeId}>
          {chart.free.map(span => <rect key={`free-${span.x}`} x={span.x} y="0" width={span.width} height={plot.height} />)}
        </clipPath>
        <clipPath id={paidId}>
          {chart.runs.map(run => <rect key={`paid-${run.startX}`} x={run.startX} y="0" width={Math.max(0, run.endX - run.startX)} height={plot.height} />)}
        </clipPath>
        <clipPath id={plotId}>
          <rect x={chart.left} y={plot.baseY - CHART_BASELINE} width={chart.right - chart.left} height={CHART_BASELINE} rx={PLOT_RADIUS} />
        </clipPath>
      </defs>
      <rect className="pi-height-sky" x={chart.left} y={plot.baseY - CHART_BASELINE} width={chart.right - chart.left} height={CHART_BASELINE} rx={PLOT_RADIUS} fill={`url(#${skyId})`} />
      {chart.runs.map(run => (
        <rect key={`band-${run.startX}`} className="pi-height-paid-band" x={run.startX} y={plot.baseY - CHART_BASELINE} width={Math.max(0, run.endX - run.startX)} height={CHART_BASELINE} />
      ))}
      <g clipPath={`url(#${plotId})`}>
        <path className="pi-height-area is-free" d={chart.area} clipPath={`url(#${freeId})`} />
        <path className="pi-height-area is-paid" d={chart.area} clipPath={`url(#${paidId})`} />
        <path className="pi-height-line" d={chart.line} pathLength={1} fill="none" />
      </g>
      <path className="pi-height-baseline" d={`M${chart.left} ${plot.baseY} H${chart.right}`} />
      {chart.labels.map(label => (
        <text key={`${label.text}-${label.x}`} className="pi-height-day" x={label.x} y={plot.baseY + (DAY_LABEL_Y - CHART_BASELINE)} textAnchor={label.anchor}>{label.text}</text>
      ))}
      {chart.runs.map(run => (
        <text key={`label-${run.startX}`} className="pi-height-band-label" x={run.startX + (run.endX - run.startX) / 2} y={plot.baseY + (BAND_LABEL_Y - CHART_BASELINE)} textAnchor="middle">{chart.bandLabel}</text>
      ))}
    </svg>
    {caption && <p className="pi-height-caption">{caption}</p>}
  </section>
}
