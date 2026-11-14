import { describe, expect, it } from 'vitest'
import type { RouteHeightPoint } from '../src/lib/elevation'
import {
  buildRouteHeightPlot,
  heightCaption,
  heightDayLabels,
  heightRangeText,
  paidBandLabel,
  paidDayXRuns,
} from '../src/lib/elevationPlot'

const PLOT_W = 308
const PLOT_H = 80

function point(dayIndex: number, distanceKm: number, elevationM: number): RouteHeightPoint {
  return {
    key: `p-${dayIndex}-${distanceKm}`,
    title: `Place ${dayIndex + 1}`,
    kind: 'stop',
    dayIndex,
    lat: 0,
    lng: 0,
    distanceKm,
    elevationM,
  } as unknown as RouteHeightPoint
}

/** A measured result with one place a day, the way the card feeds the plot. */
function plotOf(points: RouteHeightPoint[]) {
  const stats = {
    minM: Math.min(...points.map(p => p.elevationM ?? 0)),
    maxM: Math.max(...points.map(p => p.elevationM ?? 0)),
    peak: points.reduce((best, p) => ((p.elevationM ?? 0) > (best.elevationM ?? 0) ? p : best), points[0]),
    sampled: points.length,
    missing: 0,
  }
  const plot = buildRouteHeightPlot(points, [], stats, PLOT_W + 32, PLOT_H + 60)
  const plotW = plot.width - plot.pad.left - plot.pad.right
  const xOf = (km: number) => plot.pad.left + (km / plot.maxDistanceKm) * plotW
  return { plot, xOf }
}

describe('paidDayXRuns', () => {
  const days = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  const points = days.map(day => point(day, day * 10, 1000 + day * 100))

  it('maps a paid run onto the plot scale, from the first paid day to the day after', () => {
    const { plot, xOf } = plotOf(points)
    const runs = paidDayXRuns(points, plot, [4, 5, 6, 7], days)
    expect(runs).toHaveLength(1)
    expect(runs[0].startX).toBeCloseTo(xOf(40), 6)
    expect(runs[0].endX).toBeCloseTo(xOf(80), 6)
    expect(runs[0].firstDay).toBe(4)
    expect(runs[0].nextDay).toBe(8)
  })

  it('gives one band for each run and no gap anywhere else', () => {
    const { plot, xOf } = plotOf(points)
    const runs = paidDayXRuns(points, plot, [2, 3, 7], days)
    expect(runs.map(run => [run.startX, run.endX])).toEqual([
      [xOf(20), xOf(40)],
      [xOf(70), xOf(80)],
    ])
  })

  it('runs to the right edge when the paid days end the trip', () => {
    const { plot, xOf } = plotOf(points)
    const runs = paidDayXRuns(points, plot, [8, 9], days)
    expect(runs[0].endX).toBeCloseTo(xOf(90), 6)
    expect(runs[0].nextDay).toBeNull()
  })
})

describe('paidBandLabel', () => {
  it('says highest only when the peak is inside a paid run', () => {
    expect(paidBandLabel([4, 5, 6], 5)).toBe('highest · paid days')
    expect(paidBandLabel([4, 5, 6], 1)).toBe('paid days')
    expect(paidBandLabel([4, 5, 6], null)).toBe('paid days')
  })
})

describe('heightDayLabels', () => {
  it('labels Day 1, both edges of every paid run and the end', () => {
    const labels = heightDayLabels(
      [{ startX: 127.2, endX: 250.4, firstDay: 4, nextDay: 8 }],
      { startX: 4, endX: 312 },
    )
    expect(labels).toEqual([
      { x: 4, text: 'Day 1', anchor: 'start' },
      { x: 127.2, text: 'Day 5', anchor: 'middle' },
      { x: 250.4, text: 'Day 9', anchor: 'middle' },
      { x: 312, text: 'End', anchor: 'end' },
    ])
  })

  it('drops a label within 28 units of one already placed, in order', () => {
    const labels = heightDayLabels(
      [{ startX: 20, endX: 40, firstDay: 1, nextDay: 3 }],
      { startX: 4, endX: 50 },
    )
    expect(labels.map(label => label.text)).toEqual(['Day 1', 'Day 4'])
  })

  it('keeps the end label when the last paid run ends the trip', () => {
    const labels = heightDayLabels(
      [{ startX: 200, endX: 312, firstDay: 6, nextDay: null }],
      { startX: 4, endX: 312 },
    )
    expect(labels.map(label => label.text)).toEqual(['Day 1', 'Day 7', 'End'])
  })
})

describe('heightRangeText', () => {
  it('rounds to the nearest 50 and groups for India', () => {
    expect(heightRangeText(2050, 4550)).toBe('2,050 – 4,550 m')
    expect(heightRangeText(2049, 4551)).toBe('2,050 – 4,550 m')
    expect(heightRangeText(1100, 3650)).toBe('1,100 – 3,650 m')
    expect(heightRangeText(2076, 4524)).toBe('2,100 – 4,500 m')
  })
})

describe('heightCaption', () => {
  const paid = [4, 5, 6]

  it('writes both sentences from the numbers only', () => {
    const heights = [1200, 2600, 3100, 3300, 3600]
    expect(heightCaption(heights, { elevationM: 3651, dayIndex: 3 }, paid))
      .toBe('Most of the road sits above 3,000 m. The highest point, 3,650 m, is on day 4.')
  })

  it('drops the first sentence below 500 m', () => {
    const heights = [120, 220, 300]
    expect(heightCaption(heights, { elevationM: 300, dayIndex: 1 }, paid))
      .toBe('The highest point, 300 m, is on day 2.')
  })

  it('names no place when the highest point is in the paid days', () => {
    const heights = [1100, 2200, 3650]
    expect(heightCaption(heights, { elevationM: 3650, dayIndex: 5 }, paid))
      .toBe('Most of the road sits above 2,000 m. The highest point is in the paid days.')
  })

  it('rounds the median down to the nearest 500 m', () => {
    const heights = [1000, 1400, 2999]
    expect(heightCaption(heights, { elevationM: 2999, dayIndex: 0 }, paid)?.split('.')[0]).toBe('Most of the road sits above 1,000 m')
  })
})
