// ============ Route-height plot geometry ============
// Layout for the simple height curve. The component paints what this returns,
// so the scale and the peak are testable without a DOM.
//
// The scale starts at sea level and never stretches a low trip into a mountain.
// There is no vertical axis and no sampling detail: the card shows the shape,
// the places and the highest one.
import type { RouteHeightCurveRun, RouteHeightPoint, RouteHeightStats } from './elevation'
import type { RoadPointKind } from './tripRoad'

export interface RouteHeightPlotMark {
  x: number
  y: number
  title: string
  kind: RoadPointKind
  dayIndex: number | null
  distanceKm: number
  elevationM: number
}

export interface RouteHeightPlotPeak {
  x: number
  y: number
  elevationM: number
  title: string
  dayIndex: number | null
}

export interface RouteHeightPlotRun {
  line: string
  area: string
  /** The plotted anchors the stroke runs through, in plot units. A label's
   *  placement reads the stroke's own height at its x range from these. */
  points: Array<{ x: number; y: number }>
}

/** The plot box the stroke is drawn into. The area and the line both start and
 *  end on these two x values, and the plot's clip path is the same rect. */
export interface RouteHeightPlotEdges {
  left: number
  right: number
}

export interface RouteHeightPlot {
  width: number
  height: number
  pad: { left: number; right: number; top: number; bottom: number }
  /** The plot's own left and right edge, where the stroke starts and ends. */
  edges: RouteHeightPlotEdges
  baseY: number
  topM: number
  maxDistanceKm: number
  runs: RouteHeightPlotRun[]
  marks: RouteHeightPlotMark[]
  peak: RouteHeightPlotPeak | null
  ticksX: Array<{ x: number; label: string }>
}

const HEIGHT_STEPS = [200, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000, 8000]

/** A round top for the scale, with a 1000 m floor so low routes stay calm. */
export function niceRouteHeightTop(maxM: number): number {
  const target = Math.max(1000, maxM * 1.08)
  return HEIGHT_STEPS.find(step => step >= target) ?? Math.ceil(target / 1000) * 1000
}

/** Nearby anchors share a displayed mark. */
const STROKE_SPACING_PX = 40

/** Two anchors closer than this, in plot units, draw as one. A sub-pixel span
 *  turns a place's own height into a near-vertical stroke, which reads as a
 *  hook at the plot's edge. */
const MIN_ANCHOR_GAP = 1

/**
 * One calm cubic through the stroke's own anchors.
 *
 * The tangents come from Fritsch and Carlson's monotone rule: a tangent never
 * points far enough to overshoot the two heights it joins. The curve
 * stays between them, so a gentle hill reads gentle and no peak appears where
 * the data has none.
 */
export function smoothRouteHeightPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  const count = points.length
  if (count === 0) return ''
  const first = points[0]
  if (count === 1) return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`
  const spans: number[] = []
  const slopes: number[] = []
  for (let index = 0; index < count - 1; index++) {
    const span = points[index + 1].x - points[index].x
    spans.push(span)
    slopes.push(span > 0 ? (points[index + 1].y - points[index].y) / span : 0)
  }
  const tangents: number[] = new Array(count)
  tangents[0] = slopes[0]
  tangents[count - 1] = slopes[count - 2]
  for (let index = 1; index < count - 1; index++) {
    // A place that turns the route up or down gets a flat tangent, so the curve
    // rounds over it instead of overshooting past its own height.
    tangents[index] = slopes[index - 1] * slopes[index] > 0
      ? (slopes[index - 1] + slopes[index]) / 2
      : 0
  }
  for (let index = 0; index < count - 1; index++) {
    const slope = slopes[index]
    if (slope === 0) {
      tangents[index] = 0
      tangents[index + 1] = 0
      continue
    }
    let before = tangents[index] / slope
    let after = tangents[index + 1] / slope
    if (before < 0) before = 0
    if (after < 0) after = 0
    const magnitude = before * before + after * after
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude)
      before *= scale
      after *= scale
    }
    tangents[index] = before * slope
    tangents[index + 1] = after * slope
  }
  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`
  for (let index = 0; index < count - 1; index++) {
    const from = points[index]
    const to = points[index + 1]
    const span = spans[index]
    // Two places at one distance give no room for a curve. Draw the step.
    if (span <= 0) {
      if (to.y !== from.y) path += ` L ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
      continue
    }
    const controlStart = `${(from.x + span / 3).toFixed(2)} ${(from.y + (tangents[index] * span) / 3).toFixed(2)}`
    const controlEnd = `${(to.x - span / 3).toFixed(2)} ${(to.y - (tangents[index + 1] * span) / 3).toFixed(2)}`
    path += ` C ${controlStart}, ${controlEnd}, ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
  }
  return path
}

export function buildRouteHeightPlot(
  points: readonly RouteHeightPoint[],
  runs: readonly RouteHeightCurveRun[],
  stats: RouteHeightStats,
  width: number,
  height: number,
  /** The plot's own x edges. Default: the padded box the card has always used. */
  edges?: RouteHeightPlotEdges,
): RouteHeightPlot {
  const pad = {
    left: width < 380 ? 18 : 22,
    right: width < 380 ? 14 : 18,
    top: 30,
    bottom: 30,
  }
  const edgeLeft = Math.max(0, Math.min(width - 1, edges?.left ?? pad.left))
  const edgeRight = Math.max(edgeLeft + 1, Math.min(width, edges?.right ?? width - pad.right))
  const plotW = edgeRight - edgeLeft
  const plot = { left: edgeLeft, right: edgeRight } satisfies RouteHeightPlotEdges
  const plotH = Math.max(1, height - pad.top - pad.bottom)
  const baseY = height - pad.bottom
  const maxDistanceKm = Math.max(1, points[points.length - 1]?.distanceKm ?? 1)
  const topM = niceRouteHeightTop(stats.maxM)
  const xOf = (distanceKm: number) => edgeLeft + (distanceKm / maxDistanceKm) * plotW
  const yOf = (elevationM: number) => baseY - (Math.max(0, Math.min(topM, elevationM)) / topM) * plotH

  // Keep every run endpoint and turn in the path. Mark fewer nearby places.
  void runs
  const groups: RouteHeightPoint[][] = []
  let group: RouteHeightPoint[] = []
  const flush = () => { if (group.length) groups.push(group); group = [] }
  for (const point of points) {
    if (point.breakBefore || point.elevationM == null) flush()
    if (point.elevationM != null) group.push(point)
  }
  flush()
  const anchors = groups.map(groupPoints => groupPoints.filter((point, index) => {
    if (index === 0 || index === groupPoints.length - 1 || point === stats.peak) return true
    const before = groupPoints[index - 1].elevationM ?? 0
    const value = point.elevationM ?? 0
    const after = groupPoints[index + 1].elevationM ?? 0
    return (value < before && value <= after) || (value > before && value >= after)
  }))
  const selected = anchors.map(groupPoints => {
    const priority = [...groupPoints].sort((a, b) => Number(b === stats.peak) - Number(a === stats.peak))
    const chosen: RouteHeightPoint[] = []
    for (const point of priority) {
      if (chosen.every(other => Math.abs(xOf(point.distanceKm) - xOf(other.distanceKm)) >= STROKE_SPACING_PX)) chosen.push(point)
    }
    return groupPoints.filter(point => chosen.includes(point))
  })
  const marks: RouteHeightPlotMark[] = selected.flat().map(point => ({
      x: xOf(point.distanceKm),
      y: yOf(point.elevationM as number),
      title: point.title,
      kind: point.kind,
      dayIndex: point.dayIndex,
      distanceKm: point.distanceKm,
      elevationM: point.elevationM as number,
    }))
  const plotRuns: RouteHeightPlotRun[] = anchors.flatMap((groupPoints, runIndex) => {
    const raw = groupPoints.map(point => ({ x: xOf(point.distanceKm), y: yOf(point.elevationM ?? 0) }))
    // Collapse the sub-pixel cluster: two places that share one pixel would
    // otherwise draw a vertical hook. A true zero span stays, because it is the
    // documented step between two heights at one distance.
    const plotted: Array<{ x: number; y: number }> = []
    for (const next of raw) {
      const last = plotted[plotted.length - 1]
      if (last && next.x > last.x && next.x - last.x < MIN_ANCHOR_GAP) continue
      plotted.push(next)
    }
    if (plotted.length === 0) return []
    // The first run starts on the plot's left edge and the last run ends on its
    // right edge, so the area and the line reach both edges exactly.
    if (runIndex === 0 && plotted[0].x > edgeLeft) plotted.unshift({ x: edgeLeft, y: plotted[0].y })
    if (runIndex === anchors.length - 1) {
      const tail = plotted[plotted.length - 1]
      if (tail.x < edgeRight) plotted.push({ x: edgeRight, y: tail.y })
    }
    const line = smoothRouteHeightPath(plotted)
    if (plotted.length === 1) return [{ line, area: '', points: plotted }]
    return [{ line, area: `${line} L ${plotted[plotted.length - 1].x.toFixed(2)} ${baseY} L ${plotted[0].x.toFixed(2)} ${baseY} Z`, points: plotted }]
  })

  const peakPoint = stats.peak
  const peak: RouteHeightPlotPeak | null = peakPoint && peakPoint.elevationM != null
    ? {
      x: xOf(peakPoint.distanceKm),
      y: yOf(peakPoint.elevationM),
      elevationM: peakPoint.elevationM,
      title: peakPoint.title,
      dayIndex: peakPoint.dayIndex,
    }
    : null

  const ticksX = [0, maxDistanceKm / 2, maxDistanceKm].map(distanceKm => ({
    x: xOf(distanceKm),
    label: `${Math.round(distanceKm).toLocaleString('en-IN')} km`,
  }))

  return { width, height, pad, edges: plot, baseY, topM, maxDistanceKm, runs: plotRuns, marks, peak, ticksX }
}

export interface PaidHeightBand {
  x: number
  width: number
  /** "Days 5–8 · paid plan". Built from day numbers only, never from a place. */
  label: string
  /** Set for a paid run before the first or after the last free place. */
  edge?: 'start' | 'end'
}

/** "Day 5" for one day, "Days 5–8" for a run. */
export function paidDaysLabel(first: number, last: number): string {
  return first === last ? `Day ${first + 1} · paid plan` : `Days ${first + 1}–${last + 1} · paid plan`
}

/**
 * One band for each stretch of paid days that sits between two free places.
 * The band spans the chart's own gap, so it carries no height and no name.
 * A paid run before the first place or after the last one has no gap.
 * It gets a thin band in the chart's margin, with `edge` set, and the
 * page writes its label beside the chart.
 */
/** One paid run of days, drawn on the plot's own distance-to-x scale. */
export interface HeightDayRun {
  startX: number
  endX: number
  /** 0-based index of the run's first paid day. */
  firstDay: number
  /** 0-based index of the first day after the run. Null when the run ends the trip. */
  nextDay: number | null
}

/**
 * One x range for each run of paid days. The x comes from the plot's own
 * distance scale, so the band starts where the first paid day starts and ends
 * where the day after it starts. Several runs give several bands, and there is
 * never a gap between a band and the line.
 */
export function paidDayXRuns(
  points: readonly RouteHeightPoint[],
  plot: Pick<RouteHeightPlot, 'width' | 'pad' | 'maxDistanceKm'> & { edges?: RouteHeightPlotEdges },
  paidIndexes: readonly number[],
  dayIndexes: readonly number[],
): HeightDayRun[] {
  const left = plot.edges?.left ?? plot.pad.left
  const right = plot.edges?.right ?? plot.pad.left + Math.max(1, plot.width - plot.pad.left - plot.pad.right)
  const plotW = Math.max(1, right - left)
  const xOf = (km: number) => left + (km / plot.maxDistanceKm) * plotW
  const startX = new Map<number, number>()
  const endX = new Map<number, number>()
  for (const point of points) {
    if (point.dayIndex == null || point.elevationM == null) continue
    if (!startX.has(point.dayIndex)) startX.set(point.dayIndex, xOf(point.distanceKm))
    endX.set(point.dayIndex, xOf(point.distanceKm))
  }
  const days = [...new Set(dayIndexes)].sort((a, b) => a - b)
  const paid = [...new Set(paidIndexes)].filter(day => days.includes(day)).sort((a, b) => a - b)
  const runs: HeightDayRun[] = []
  for (let i = 0; i < paid.length; i++) {
    const firstDay = paid[i]
    let lastDay = firstDay
    while (i + 1 < paid.length && paid[i + 1] === lastDay + 1) { lastDay = paid[i + 1]; i++ }
    const nextDay = days.find(day => day > lastDay) ?? null
    // A day with no place falls back to the last drawn x before it, so the
    // band still touches the line on both sides.
    const fallbackBefore = (day: number) => {
      const known = days.filter(other => other < day && endX.has(other))
      return known.length > 0 ? endX.get(known[known.length - 1]) as number : left
    }
    runs.push({
      startX: startX.get(firstDay) ?? fallbackBefore(firstDay),
      endX: nextDay == null ? right : startX.get(nextDay) ?? endX.get(lastDay) ?? right,
      firstDay,
      nextDay,
    })
  }
  return runs
}

export interface HeightDayLabel {
  x: number
  text: string
  anchor: 'start' | 'middle' | 'end'
}

/** The name text sits this far above its baseline, and the height line this far
 *  below it. Both come from the rendered 11 px label in the Overview card. */
const LABEL_ABOVE = 12
const LABEL_BELOW = 16

/**
 * The baseline for an end label. The label goes fully above the stroke, or
 * fully below it, on the side with more room, so the line never crosses the
 * words. The stroke's own height comes from the plotted anchors in the label's
 * x range.
 */
export function heightLabelY(input: {
  markX: number
  markY: number
  anchor: 'start' | 'end'
  labelWidth: number
  runs: ReadonlyArray<{ points: ReadonlyArray<{ x: number; y: number }> }>
  padTop: number
  baseY: number
  gap?: number
}): number {
  const gap = input.gap ?? 6
  const dx = input.anchor === 'end' ? -7 : 7
  const left = input.anchor === 'end' ? input.markX + dx - input.labelWidth : input.markX + dx
  const right = left + input.labelWidth
  let minY = Infinity
  let maxY = -Infinity
  const include = (y: number) => {
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  // The stroke's height over the label's own x range. The anchors inside the
  // range count, and so does the curve at its two edges, interpolated from the
  // anchors that bracket them: a label often sits between two anchors.
  for (const run of input.runs) {
    const points = [...run.points].sort((a, b) => a.x - b.x)
    if (points.length === 0) continue
    if (points[points.length - 1].x < left || points[0].x > right) continue
    for (const point of points) if (point.x >= left && point.x <= right) include(point.y)
    include(routeHeightAt(points, left))
    include(routeHeightAt(points, right))
  }
  if (!Number.isFinite(minY)) {
    minY = input.markY
    maxY = input.markY
  }
  const roomAbove = minY - input.padTop
  const roomBelow = input.baseY - maxY
  // Above, the block's LAST line must clear the stroke, so the whole label
  // height below the baseline is spent first. Below, its first line must clear.
  const above = minY - gap - LABEL_BELOW
  const below = maxY + gap + LABEL_ABOVE
  const fitsAbove = above >= input.padTop + LABEL_ABOVE
  const fitsBelow = below <= input.baseY - LABEL_BELOW
  const chosen = roomAbove >= roomBelow
    ? (fitsAbove ? above : below)
    : (fitsBelow ? below : above)
  return Math.min(Math.max(chosen, input.padTop + LABEL_ABOVE), input.baseY - LABEL_BELOW)
}

/** The straight height between the two anchors that bracket `x`. The stroke is
 *  bounded by its anchors, so this is a safe read of its height at the edge. */
function routeHeightAt(points: ReadonlyArray<{ x: number; y: number }>, x: number): number {
  const first = points[0]
  const last = points[points.length - 1]
  if (x <= first.x) return first.y
  if (x >= last.x) return last.y
  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index]
    const to = points[index + 1]
    if (x < from.x || x > to.x) continue
    if (to.x === from.x) return Math.max(from.y, to.y)
    return from.y + ((to.y - from.y) * (x - from.x)) / (to.x - from.x)
  }
  return last.y
}

/** Two labels closer than this, in plot units, read as one. */
const DAY_LABEL_GAP = 28

/**
 * The axis labels: Day 1 at the start, the two edges of each paid run, then
 * "End". A label that would sit within 28 plot units of one already placed is
 * dropped, in that order, so the axis never stacks two words at one point.
 */
export function heightDayLabels(
  runs: readonly HeightDayRun[],
  bounds: { startX: number; endX: number },
): HeightDayLabel[] {
  const placed: HeightDayLabel[] = []
  const add = (x: number, text: string, anchor: HeightDayLabel['anchor']) => {
    if (placed.some(other => Math.abs(other.x - x) < DAY_LABEL_GAP)) return
    placed.push({ x, text, anchor })
  }
  add(bounds.startX, 'Day 1', 'start')
  for (const run of runs) {
    add(run.startX, `Day ${run.firstDay + 1}`, 'middle')
    if (run.nextDay != null) add(run.endX, `Day ${run.nextDay + 1}`, 'middle')
  }
  add(bounds.endX, 'End', 'end')
  return placed
}

/** The band's own words. It says "highest" only when the peak is inside it. */
export function paidBandLabel(paidIndexes: readonly number[], peakDayIndex: number | null): string {
  const inPaid = peakDayIndex != null && paidIndexes.includes(peakDayIndex)
  return inPaid ? 'highest · paid days' : 'paid days'
}

/** Every height the card prints is rounded to 50 m, so nothing reads false. */
export function roundHeight50(metres: number): number {
  return Math.round(metres / 50) * 50
}

/** "2,050 – 4,550 m": the sampled range, rounded and grouped for India. */
export function heightRangeText(minM: number, maxM: number): string {
  return `${roundHeight50(minM).toLocaleString('en-IN')} – ${roundHeight50(maxM).toLocaleString('en-IN')} m`
}

/** The median of the sampled heights, in metres. Null when nothing was sampled. */
export function medianHeight(heights: readonly number[]): number | null {
  if (heights.length === 0) return null
  const sorted = [...heights].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * The card's caption, from the sampled heights only. It never names a place and
 * never says what a paid day holds.
 */
export function heightCaption(
  heights: readonly number[],
  peak: { elevationM: number; dayIndex: number | null } | null,
  paidIndexes: readonly number[],
): string | null {
  const sentences: string[] = []
  const median = medianHeight(heights)
  if (median != null) {
    const most = Math.floor(median / 500) * 500
    if (most >= 500) sentences.push(`Most of the road sits above ${most.toLocaleString('en-IN')} m.`)
  }
  if (peak) {
    const inPaid = peak.dayIndex != null && paidIndexes.includes(peak.dayIndex)
    if (inPaid) sentences.push('The highest point is in the paid days.')
    else if (peak.dayIndex != null) sentences.push(`The highest point, ${roundHeight50(peak.elevationM).toLocaleString('en-IN')} m, is on day ${peak.dayIndex + 1}.`)
    else sentences.push(`The highest point, ${roundHeight50(peak.elevationM).toLocaleString('en-IN')} m.`)
  }
  return sentences.length > 0 ? sentences.join(' ') : null
}

export function paidHeightBands(
  points: readonly RouteHeightPoint[],
  plot: Pick<RouteHeightPlot, 'width' | 'pad' | 'maxDistanceKm'>,
  paidIndexes: readonly number[],
): PaidHeightBand[] {
  const plotW = Math.max(1, plot.width - plot.pad.left - plot.pad.right)
  const xOf = (km: number) => plot.pad.left + (km / plot.maxDistanceKm) * plotW
  const bands: PaidHeightBand[] = []
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1].dayIndex
    const after = points[i].dayIndex
    if (before == null || after == null || after - before < 2) continue
    const between = paidIndexes.filter(day => day > before && day < after).sort((a, b) => a - b)
    if (between.length === 0) continue
    const x = xOf(points[i - 1].distanceKm)
    bands.push({ x, width: Math.max(0, xOf(points[i].distanceKm) - x), label: paidDaysLabel(between[0], between[between.length - 1]) })
  }
  const firstDay = points[0]?.dayIndex
  const lastDay = points[points.length - 1]?.dayIndex
  if (firstDay != null && lastDay != null) {
    const sorted = [...paidIndexes].sort((a, b) => a - b)
    const before = sorted.filter(day => day < firstDay)
    const after = sorted.filter(day => day > lastDay)
    if (before.length > 0) bands.unshift({ x: 0, width: plot.pad.left, label: paidDaysLabel(before[0], before[before.length - 1]), edge: 'start' })
    if (after.length > 0) bands.push({ x: plot.pad.left + plotW, width: plot.pad.right, label: paidDaysLabel(after[0], after[after.length - 1]), edge: 'end' })
  }
  return bands
}
