import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { OverviewRouteCard } from '../src/components/trips/OverviewRouteCard'
import { overviewRouteRows, type OverviewRouteRow } from '../src/lib/overviewTruth'
import {
  OVERVIEW_PIN_HIT_DIAMETER,
  groupOverviewPins,
  overviewPinAriaLabel,
  overviewPinDetailLines,
  overviewPinStopId,
  overviewPinTag,
  overviewPinText,
  overviewPinTitle,
  overviewRoadSummary,
  overviewRouteSegments,
  overviewRoutePath,
  overviewTerrainModel,
  projectOverviewRoute,
} from '../src/lib/overviewRouteMap'
import { firstFailedOverviewRead, overviewReadRole, type OverviewReadKey } from '../src/lib/overviewReads'
import type { RoadLeg } from '../src/lib/routing'

const stop = (over: Partial<{ id: string; title: string; lat: number; lng: number; status: string; orderInDay: number }> = {}) => ({
  id: 's1',
  title: 'Stop one',
  lat: 15.5,
  lng: 73.9,
  status: 'confirmed',
  orderInDay: 0,
  ...over,
})

const tripOf = (over: Record<string, unknown> = {}) => ({
  startLocation: 'Bengaluru',
  startLocationCoords: { lat: 12.97, lng: 77.59 },
  destinations: ['Goa'],
  days: [{
    index: 0,
    stops: [stop()],
  }],
  destinationCoords: [],
  roundTrip: false,
  transportMode: 'car',
  ...over,
}) as never as Parameters<typeof overviewRouteRows>[0]

const leg = (over: Partial<RoadLeg> = {}): RoadLeg => ({
  distanceKm: 100,
  durationMinutes: 120,
  source: 'osrm',
  geometry: [],
  ...over,
})

const road = (legs: RoadLeg[], status: 'pending' | 'ok' | 'failed' = 'ok') => ({ status, legs })

describe('overview route rows', () => {
  it('keeps one row per chain point with stable keys, titles and stop ids', () => {
    const rows = overviewRouteRows(tripOf({
      days: [
        { index: 0, stops: [stop({ id: 'a', title: 'Mysuru', lat: 12.3, lng: 76.6 })] },
        { index: 1, stops: [stop({ id: 'b', title: 'Kochi', lat: 9.93, lng: 76.27 })] },
      ],
    }))
    expect(rows.map(row => row.key)).toEqual(['start', 'stop:a', 'stop:b'])
    expect(rows.map(row => row.title)).toEqual(['Bengaluru', 'Mysuru', 'Kochi'])
    expect(rows.map(row => row.dayIndex)).toEqual([null, 0, 1])
    expect(rows.map(row => row.stopId)).toEqual([null, 'a', 'b'])
  })

  it('keeps the destination row before the return row on a round trip (#1006)', () => {
    const rows = overviewRouteRows(tripOf({
      roundTrip: true,
      destinationCoords: [{ lat: 9.93, lng: 76.27 }],
      destinations: ['Kochi'],
    }))
    expect(rows.map(row => row.kind)).toEqual(['start', 'stop', 'destination', 'return'])
    expect(rows.at(-2)).toMatchObject({ key: 'destination', title: 'Kochi' })
    expect(rows.at(-1)).toMatchObject({ key: 'return', title: 'Bengaluru' })
  })

  it('drops an invalid coordinate but leaves the next row without an arriving leg', () => {
    const rows = overviewRouteRows(tripOf({
      days: [{
        index: 0,
        stops: [
          stop({ id: 'bad', title: 'Bad', lat: 0, lng: 0 }),
          stop({ id: 'good', title: 'Good', lat: 15.5, lng: 73.9, orderInDay: 1 }),
        ],
      }],
    }), road([leg(), leg()]))
    expect(rows.map(row => row.key)).toEqual(['start', 'stop:good'])
    expect(rows[1].chainIndex).toBe(2)
    expect(rows[1].arrivingLeg).toBeNull()
  })

  it('takes arriving legs only from a measured road and keeps the estimate flag', () => {
    const trip = tripOf({
      days: [{
        index: 0,
        stops: [
          stop({ id: 'a', title: 'Mysuru', lat: 12.3, lng: 76.6 }),
          stop({ id: 'b', title: 'Kochi', lat: 9.93, lng: 76.27, orderInDay: 1 }),
        ],
      }],
    })
    expect(overviewRouteRows(trip, road([leg(), leg()], 'pending')).every(row => row.arrivingLeg === null)).toBe(true)
    const measured = overviewRouteRows(trip, road([
      leg({ distanceKm: 120, durationMinutes: 150 }),
      leg({ distanceKm: 80, durationMinutes: 90, source: 'estimate', estimated: true }),
    ]))
    expect(measured[1].arrivingLeg).toEqual({ distanceKm: 120, durationMinutes: 150, estimated: false })
    expect(measured[2].arrivingLeg).toEqual({ distanceKm: 80, durationMinutes: 90, estimated: true })
  })

  it('returns no route with fewer than two valid points', () => {
    expect(overviewRouteRows(tripOf({ days: [] }))).toEqual([])
  })
})

describe('overview route projection and pins', () => {
  const rows = overviewRouteRows(tripOf({
    roundTrip: true,
    days: [{
      index: 0,
      stops: [
        stop({ id: 'a', title: 'Mysuru', lat: 12.3, lng: 76.6 }),
        stop({ id: 'b', title: 'Kochi', lat: 9.93, lng: 76.27, orderInDay: 1 }),
      ],
    }],
  }))

  it('keeps north up and centres the drawn bounds', () => {
    const points = projectOverviewRoute(rows, 400, 200, 20)
    expect(points[0].y).toBeLessThan(points[1].y)
    const xs = points.map(point => point.x)
    const ys = points.map(point => point.y)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(200, 5)
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(100, 5)
  })

  it('merges a co-located start and return into one 44px-class target', () => {
    expect(OVERVIEW_PIN_HIT_DIAMETER).toBe(44)
    const points = projectOverviewRoute(rows, 720, 340, 32)
    const pins = groupOverviewPins(points, OVERVIEW_PIN_HIT_DIAMETER)
    const startEnd = pins.find(pin => pin.tag === 'Start and end')
    expect(startEnd?.rowKeys).toEqual(['start', 'return'])
    expect(startEnd?.interactive).toBe(true)
  })

  it('targets a grouped stop only when every stop row names the same stop', () => {
    const points = projectOverviewRoute(rows)
    const oneStop = groupOverviewPins(points).find(pin =>
      pin.rows.some(row => row.kind === 'stop'),
    )
    expect(oneStop && overviewPinStopId(oneStop)).toBe('a')

    const closeStops = overviewRouteRows(tripOf({
      days: [{
        index: 0,
        stops: [
          stop({ id: 'a', title: 'A', lat: 12.1, lng: 77.1 }),
          stop({ id: 'b', title: 'B', lat: 12.1001, lng: 77.1001, orderInDay: 1 }),
        ],
      }],
    }))
    const merged = groupOverviewPins(projectOverviewRoute(closeStops))
      .find(pin => pin.rows.filter(row => row.kind === 'stop').length === 2)
    expect(merged && overviewPinStopId(merged)).toBeNull()
  })

  it('keeps a pin label true to what the pin can do', () => {
    const pins = groupOverviewPins(projectOverviewRoute(rows, 720, 340, 32), OVERVIEW_PIN_HIT_DIAMETER)
    const startEnd = pins.find(pin => pin.tag === 'Start and end')!
    const stopPin = pins.find(pin => overviewPinStopId(pin) === 'a')!

    expect(overviewPinAriaLabel(startEnd, { canOpen: true, hasMapAction: true, hasStopTarget: false }))
      .toContain('Opens the Map.')
    expect(overviewPinAriaLabel(stopPin, { canOpen: true, hasMapAction: true, hasStopTarget: true }))
      .toContain('Opens the Map at this stop.')
    expect(overviewPinAriaLabel(stopPin, { canOpen: true, hasMapAction: true, hasStopTarget: false }))
      .toContain('Choose a route row to target a stop.')

    const blocked = overviewPinAriaLabel(stopPin, { canOpen: false, hasMapAction: true, hasStopTarget: false })
    expect(blocked).not.toContain('Opens the Map')
    expect(blocked).toContain('This pin is too close to another pin. Choose a route row to open the Map.')

    const readOnly = overviewPinAriaLabel(startEnd, { canOpen: false, hasMapAction: false, hasStopTarget: false })
    expect(readOnly).not.toContain('Map')
  })

  it('names each row in a grouped pin and follows the active row', () => {
    const closeStops = overviewRouteRows(tripOf({
      startLocationCoords: { lat: 12.1, lng: 77.1 },
      days: [{
        index: 0,
        stops: [
          stop({ id: 'a', title: 'A', lat: 12.1001, lng: 77.1001 }),
          stop({ id: 'b', title: 'B', lat: 12.1002, lng: 77.1002, orderInDay: 1 }),
          stop({ id: 'far', title: 'Far', lat: 9.93, lng: 76.27, orderInDay: 2 }),
        ],
      }],
    }))
    const merged = groupOverviewPins(projectOverviewRoute(closeStops))
      .find(pin => pin.rows.length === 3)
    expect(merged).toBeDefined()
    expect(overviewPinTitle(merged!)).toBe('Bengaluru')
    expect(overviewPinTag(merged!)).toBe('Start')
    expect(overviewPinDetailLines(merged!)).toEqual([
      'Start: Bengaluru',
      'Day 1: A',
      'Day 1: B',
    ])
    expect(overviewPinTitle(merged!, 'stop:b')).toBe('B')
    expect(overviewPinTag(merged!, 'stop:b')).toBe('Day 1')
    expect(overviewPinDetailLines(merged!, 2)).toEqual([
      'Start: Bengaluru',
      '+2 more route rows in the stop list.',
    ])
    expect(overviewPinText('A very long grouped route name that must stay inside', 20))
      .toBe('A very long group...')
  })

  it('keeps one curve path for each leg', () => {
    const points = projectOverviewRoute(rows)
    const segments = overviewRouteSegments(points)
    expect(segments).toHaveLength(rows.length - 1)
    expect(segments.every(Boolean)).toBe(true)
  })

  it('keeps short turns and repeated points within each leg bounds', () => {
    const points = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 101, y: 1 },
      { x: 101, y: 1 }, { x: 0, y: 0 },
    ].map((point, index) => ({ ...point, row: { ...rows[0], chainIndex: index } }))
    const segments = overviewRouteSegments(points)
    segments.forEach((segment, index) => {
      const values = segment!.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
      const a = points[index]
      const b = points[index + 1]
      expect(values.slice(0, 2)).toEqual([a.x, a.y])
      expect(values.slice(6, 8)).toEqual([b.x, b.y])
      for (let i = 2; i < 6; i += 2) {
        expect(values[i]).toBeGreaterThanOrEqual(Math.min(a.x, b.x))
        expect(values[i]).toBeLessThanOrEqual(Math.max(a.x, b.x))
        expect(values[i + 1]).toBeGreaterThanOrEqual(Math.min(a.y, b.y))
        expect(values[i + 1]).toBeLessThanOrEqual(Math.max(a.y, b.y))
      }
    })
  })

  it('keeps one direction through every join, so the route has no corner', () => {
    // A zigzag: each leg turns hard, so an independently clamped handle would
    // leave two different tangent directions at the join.
    const points = [
      { x: 0, y: 0 }, { x: 120, y: 80 }, { x: 240, y: 0 }, { x: 360, y: 90 },
    ].map((point, index) => ({ ...point, row: { ...rows[0], chainIndex: index } }))
    const segments = overviewRouteSegments(points)
    expect(segments.every(Boolean)).toBe(true)
    const parsed = segments.map(segment => (segment as string).match(/-?\d+(?:\.\d+)?/g)!.map(Number))
    for (let index = 1; index < parsed.length; index++) {
      const previous = parsed[index - 1]
      const current = parsed[index]
      const joint = points[index]
      // The incoming handle points back from the joint; the outgoing one forward.
      const incoming = { x: previous[4] - joint.x, y: previous[5] - joint.y }
      const outgoing = { x: current[2] - joint.x, y: current[3] - joint.y }
      const cross = incoming.x * outgoing.y - incoming.y * outgoing.x
      const lengths = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y)
      // Collinear (cross is zero relative to the two lengths) and opposed.
      expect(Math.abs(cross)).toBeLessThanOrEqual(lengths * 1e-6 + 1e-6)
      expect(incoming.x * outgoing.x + incoming.y * outgoing.y).toBeLessThan(0)
    }
  })

  it.each([[[0, 0], [10, 0], [20, 10]], [[0, 0], [0, 10], [10, 20]]])('keeps axis-aligned joins smooth: %j', (...coords) => {
    const points = coords.map(([x, y], chainIndex) => ({ x, y, row: { ...rows[0], chainIndex } }))
    const [before, after] = overviewRouteSegments(points).map(segment => segment!.match(/-?\d+(?:\.\d+)?/g)!.map(Number))
    const incoming = [before[6] - before[4], before[7] - before[5]], outgoing = [after[2] - after[0], after[3] - after[1]]
    expect(incoming[0] * outgoing[0] + incoming[1] * outgoing[1]).toBeGreaterThan(0)
    expect(incoming[0] * outgoing[1] - incoming[1] * outgoing[0]).toBeCloseTo(0)
  })
  it('leaves a gap when an invalid point breaks the chain', () => {
    const rowsWithGap = overviewRouteRows(tripOf({
      days: [{
        index: 0,
        stops: [
          stop({ id: 'bad', title: 'Bad', lat: 0, lng: 0 }),
          stop({ id: 'good', title: 'Good', lat: 15.5, lng: 73.9, orderInDay: 1 }),
        ],
      }],
    }))
    const segments = overviewRouteSegments(projectOverviewRoute(rowsWithGap))
    expect(segments).toHaveLength(rowsWithGap.length - 1)
    expect(segments[segments.length - 1]).toBeNull()
  })

  it('joins the legs into one stroke, and restarts it after a gap', () => {
    const joined = overviewRoutePath(projectOverviewRoute(rows))
    expect(joined.match(/M /g)).toHaveLength(1)
    expect(joined.match(/ C /g)).toHaveLength(rows.length - 1)

    const rowsWithGap = overviewRouteRows(tripOf({
      days: [{
        index: 0,
        stops: [
          stop({ id: 'bad', title: 'Bad', lat: 0, lng: 0 }),
          stop({ id: 'good', title: 'Good', lat: 15.5, lng: 73.9, orderInDay: 1 }),
        ],
      }],
    }))
    // The single leg crosses the gap, so the stroke has no command at all.
    expect(overviewRoutePath(projectOverviewRoute(rowsWithGap))).toBe('')
  })
})

describe('overview road summary and terrain', () => {
  const measuredRows: OverviewRouteRow[] = [
    { key: 'start', kind: 'start', lat: 12, lng: 77, dayIndex: null, stopId: null, title: 'A', chainIndex: 0, arrivingLeg: null },
    { key: 'stop:a', kind: 'stop', lat: 13, lng: 77, dayIndex: 0, stopId: 'a', title: 'B', chainIndex: 1, arrivingLeg: { distanceKm: 100, durationMinutes: 120, estimated: false } },
    { key: 'stop:b', kind: 'stop', lat: 14, lng: 77, dayIndex: 1, stopId: 'b', title: 'C', chainIndex: 2, arrivingLeg: { distanceKm: 80, durationMinutes: 90, estimated: false } },
  ]
  const rows: OverviewRouteRow[] = [
    { key: 'start', kind: 'start', lat: 12, lng: 77, dayIndex: null, stopId: null, title: 'A', chainIndex: 0, arrivingLeg: null },
    { key: 'stop:a', kind: 'stop', lat: 13, lng: 77, dayIndex: 0, stopId: 'a', title: 'B', chainIndex: 1, arrivingLeg: { distanceKm: 100, durationMinutes: 120, estimated: false } },
    { key: 'stop:b', kind: 'stop', lat: 14, lng: 77, dayIndex: 1, stopId: 'b', title: 'C', chainIndex: 2, arrivingLeg: { distanceKm: 80, durationMinutes: 90, estimated: true } },
  ]

  it('separates pending, failed, measured, partly estimated and schematic states', () => {
    expect(overviewRoadSummary(rows, road([], 'pending'), 'car').state).toBe('pending')
    expect(overviewRoadSummary(rows, road([], 'failed'), 'car').state).toBe('failed')
    expect(overviewRoadSummary(measuredRows, road([leg(), leg()]), 'car')).toMatchObject({
      state: 'measured',
      caption: 'Schematic route',
      distanceKm: 180,
      durationMinutes: 210,
    })
    expect(overviewRoadSummary(rows, road([leg(), leg()]), 'car')).toMatchObject({
      state: 'estimated',
      caption: 'Schematic route',
      estimatedLegs: 1,
    })
    expect(overviewRoadSummary(rows, null, 'car').note).toBeNull()
    expect(overviewRoadSummary(rows, null, 'train')).toMatchObject({
      state: 'schematic',
      caption: 'Schematic route',
      distanceKm: null,
      durationMinutes: null,
    })
  })

  it('treats a dropped first chain point as an incomplete road', () => {
    const leadingGap: OverviewRouteRow[] = [
      { key: 'stop:a', kind: 'stop', lat: 13, lng: 77, dayIndex: 0, stopId: 'a', title: 'B', chainIndex: 1, arrivingLeg: { distanceKm: 100, durationMinutes: 120, estimated: false } },
      { key: 'stop:b', kind: 'stop', lat: 14, lng: 77, dayIndex: 1, stopId: 'b', title: 'C', chainIndex: 2, arrivingLeg: { distanceKm: 80, durationMinutes: 90, estimated: false } },
    ]
    expect(overviewRoadSummary(leadingGap, road([leg(), leg()]), 'car')).toMatchObject({
      state: 'incomplete',
      distanceKm: null,
      durationMinutes: null,
    })
  })

  it('treats a dropped final chain point as an incomplete road', () => {
    const trailingGap = overviewRouteRows(tripOf({
      destinationCoords: [{ lat: 0, lng: 0 }],
    }), road([leg(), leg()]))
    expect(trailingGap.at(-1)?.chainPointCount).toBe(3)
    expect(overviewRoadSummary(trailingGap, road([leg(), leg()]), 'car')).toMatchObject({
      state: 'incomplete',
      distanceKm: null,
      durationMinutes: null,
    })
  })

  it('keeps the terrain model to the flat plain', () => {
    expect(overviewTerrainModel()).toEqual({ kind: 'flat' })
  })
})

describe('overview read alert order', () => {
  it('shows both failed reads without claiming a road measurement', () => {
    const rows = overviewRouteRows(tripOf())
    const first = firstFailedOverviewRead(new Set(['elevation', 'weather']))
    const html = renderToStaticMarkup(createElement(OverviewRouteCard, {
      rows,
      road: { chain: null, legs: null, status: 'failed', retry: () => {} },
      transportMode: 'car',
      elevation: { view: 'failed', result: null, points: [], retry: () => {} },
      elevationRole: overviewReadRole('elevation', first),
    }))
    expect(html).toContain('Heights could not load.')
    expect(html).toContain('Road not measured.')
    expect(html).not.toContain('The road is still measured.')
    expect(html.match(/role="alert"/g)).toHaveLength(1)
    expect(html.indexOf('Heights could not load.')).toBeLessThan(html.indexOf('Road not measured.'))
    expect(html.match(/Try again/g)).toHaveLength(2)
    const source = readFileSync('src/components/trips/OverviewRouteCard.tsx', 'utf8')
    expect(source).toContain('onClick={elevation.retry}')
    expect(source).toContain('onClick={road.retry}')
  })
  it('alerts on the first failed read, then switches when it recovers', () => {
    const all = new Set(['decisions', 'activity', 'weather'] as const)
    expect(firstFailedOverviewRead(all)).toBe('decisions')
    expect(overviewReadRole('decisions', firstFailedOverviewRead(all))).toBe('alert')
    expect(overviewReadRole('activity', firstFailedOverviewRead(all))).toBe('status')
    const afterRecovery = new Set(['activity', 'weather'] as const)
    expect(firstFailedOverviewRead(afterRecovery)).toBe('activity')
  })

  it('returns no override when no read failed', () => {
    expect(firstFailedOverviewRead(new Set<OverviewReadKey>())).toBeNull()
    expect(overviewReadRole('weather', null)).toBeUndefined()
  })

  it('gives the one alert to a failed height read before weather, never both', () => {
    const both = new Set(['elevation', 'weather'] as const)
    expect(firstFailedOverviewRead(both)).toBe('elevation')
    expect(overviewReadRole('elevation', firstFailedOverviewRead(both))).toBe('alert')
    expect(overviewReadRole('weather', firstFailedOverviewRead(both))).toBe('status')
    const recovered = new Set(['weather'] as const)
    expect(firstFailedOverviewRead(recovered)).toBe('weather')
    expect(overviewReadRole('weather', firstFailedOverviewRead(recovered))).toBe('alert')
  })
})
