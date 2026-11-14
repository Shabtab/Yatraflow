import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Journey } from '../src/lib/engine'
import { RideTimeline, rideLeg, rideNodeLabels, savedRideLeg } from '../src/components/storefront/ride/RideTimeline'
import { RideDayPanel, RideOtherRow } from '../src/components/storefront/RidePanels'
import { DayCard } from '../src/components/storefront/DayCard'
import { DayRibbon } from '../src/components/storefront/DayRibbon'
import { summariseDay } from '../src/lib/publicStorefront'
import { RideLockedPreview } from '../src/components/storefront/ride/RideLockedPreview'
import { rideHeightPoints } from '../src/components/storefront/ride/RideElevation'
import { seedData } from '../src/data/seed'
import { buildRouteHeightPoints } from '../src/lib/elevation'

const stop = {
  id: 'lake', title: 'Lake', category: 'nature', locationName: 'Nako', lat: 31, lng: 78,
  visitMinutes: 60, entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
  priority: 'must-do', status: 'confirmed', orderInDay: 0, notes: 'Walk on the bank.',
  legDistanceKm: 72, legTravelMinutes: 114,
} satisfies Journey['points'][number]['stop']
const leg = { fromTitle: 'Kalpa', toTitle: 'Nako', distanceKm: 100, durationMinutes: 200 }
const journey = {
  dayIndex: 2, direction: 'outbound', startTitle: 'Kalpa', endTitle: 'Nako', startTime: '08:00', arrivalTime: '09:54',
  distanceKm: 72, driveMinutes: 114, dwellMinutes: 60, totalMinutes: 174, transportCostInr: 0,
  fuelLitres: null, fuelPricePerL: null, halts: [], endsAtStart: false,
  points: [
    { kind: 'start', title: 'Kalpa', lat: 31, lng: 78, stop: { ...stop, id: 'start', auto: true }, synthesized: true, legIn: null, arrive: '08:00', depart: '08:00', dwellMinutes: 0 },
    { kind: 'visit', title: 'Nako', lat: 31, lng: 78, stop, synthesized: false, legIn: leg, arrive: '09:54', depart: '10:54', dwellMinutes: 60 },
  ],
} satisfies Journey

describe('ride presentation', () => {
  it('hides locked creator titles across page parts, including attributes and scene choices', () => {
    const title = 'Dhankar cliffs & into Pin Valley'
    const summary = summariseDay({ id: 'paid', index: 1, title, stops: [] }, 90, 'withheld')
    expect(summary.title).toBe('Day 2')
    const rawSummary = { ...summary, title }
    const art = { publicationId: 'pub', index: 1, planPlaces: ['Spiti'], slotPlaces: [title] }
    const parts = [
      createElement(DayCard, { state: 'locked', summary: rawSummary, budget: { drive: 90, places: 120, window: 480, from: '09:19', to: '17:49' } }),
      createElement(DayRibbon, { label: 'Days', head: { kicker: 'Plan', figure: '2', sub: 'days' },
        days: [{ ...rawSummary, state: 'locked' }], current: null, lockedWord: 'Locked', onPick: () => {} }),
      createElement(RideLockedPreview, { ...art, card: { state: 'locked', summary: rawSummary }, lastIndex: 1, facts: ['30 km', '90 minutes'], action: null }),
      createElement(RideDayPanel, { ...art, state: 'locked', title, badge: 'Day 2', meta: '90 minutes', budget: '09:19 to 17:49', children: null }),
      createElement(RideOtherRow, { ...art, state: 'locked', title, line: '2 places', km: '30 km', drive: '90 minutes', onOpen: () => {} }),
    ]
    for (const part of parts) {
      const html = renderToStaticMarkup(part)
      expect(html).toContain('Day 2')
      expect(html).not.toContain('Dhankar')
      expect(html).not.toContain('Pin Valley')
      expect(html).not.toMatch(/90 minutes|30 km|09:19|17:49|time budget|driving/)
    }
    const panel = (slotPlaces: string[]) => renderToStaticMarkup(createElement(RideDayPanel, {
      ...art, slotPlaces, state: 'locked', title, badge: 'Day 2', meta: '', budget: null, children: null,
    }))
    expect(panel(['Munnar'])).toBe(panel(['Jaipur']))
    for (const state of ['free', 'yours'] as const) {
      const readable = summariseDay({ id: 'open', index: 0, title: 'Open creator day', stops: [] }, 0, false)
      expect(readable.title).toBe('Open creator day')
      const html = renderToStaticMarkup(createElement(DayCard, { state, summary: readable, places: [] }))
        + renderToStaticMarkup(createElement(DayRibbon, { label: 'Days', head: { kicker: 'Plan', figure: '1', sub: 'day' },
          days: [{ ...readable, state }], current: 0, lockedWord: 'Locked', onPick: () => {} }))
        + renderToStaticMarkup(createElement(RideDayPanel, { ...art, state, title: readable.title,
          badge: 'Day 1', meta: '', budget: null, children: null }))
      expect(html.match(/Open creator day/g)?.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('withholds locked-day terrain points and breaks the line across them', () => {
    const points = rideHeightPoints({ ...seedData.trips[0], days: [
      { id: 'a', index: 0, stops: [{ ...stop, id: 'a' }] },
      { id: 'locked', index: 1, stops: [{ ...stop, id: 'secret', title: 'Hidden place', lat: 32 }] },
      { id: 'b', index: 2, stops: [{ ...stop, id: 'b', lat: 33 }] },
    ] }, [0, 2])
    expect(points.map(point => point.key)).toEqual(['a', 'b'])
    expect(JSON.stringify(points)).not.toContain('Hidden place')
    expect(buildRouteHeightPoints(points)[1].breakBefore).toBe(true)
  })
  it('withholds wire-locked terrain even when its index is listed as free', () => {
    const points = rideHeightPoints({ ...seedData.trips[0], days: [
      { id: 'open', index: 0, stops: [stop] },
      { id: 'locked', index: 1, locked: true, stops: [{ ...stop, title: 'SECRET774', lat: 34.774774 }] },
    ] }, [0, 1])
    expect(points).toHaveLength(1)
    expect(JSON.stringify(points)).not.toMatch(/SECRET774|34\.774774/)
  })
  it('keeps a gap when the wire lock has no stops', () => {
    const points = rideHeightPoints({ ...seedData.trips[0], days: [
      { id: 'first', index: 0, stops: [stop] },
      { id: 'locked', index: 1, locked: true, stops: [] },
      { id: 'last', index: 2, stops: [{ ...stop, id: 'last', lat: 33 }] },
    ] }, [0, 1, 2])
    expect(points).toHaveLength(2)
    expect(buildRouteHeightPoints(points)[1].breakBefore).toBe(true)
  })
  it('omits missing, invalid and air legs rather than using the engine fallback', () => {
    expect(savedRideLeg({}, leg)).toBeNull()
    expect(savedRideLeg({ legDistanceKm: NaN, legTravelMinutes: 10 }, leg)).toBeNull()
    expect(savedRideLeg(stop, { ...leg, kind: 'air' })).toBeNull()
    expect(savedRideLeg(stop, leg)).toEqual({ km: 72, minutes: 114 })
  })

  it('shows an engine road leg as approximate and never an air or empty leg', () => {
    expect(rideLeg(stop, leg)).toEqual({ km: 72, minutes: 114, approx: false })
    expect(rideLeg({}, leg)).toEqual({ km: 100, minutes: 200, approx: true })
    expect(rideLeg({}, { ...leg, kind: 'air' })).toBeNull()
    expect(rideLeg({}, { ...leg, distanceKm: 0, durationMinutes: 0 })).toBeNull()
    expect(rideLeg({}, null)).toBeNull()
  })

  describe('start and end lines beside a locked day', () => {
    // Day 9 follows locked day 8. The engine starts it at day 8's last stop.
    const borrowedStart = { ...journey.points[0], title: 'Chandratal Lake', stop: { ...stop, id: 'day8-last', auto: true } }
    const borrowedEnd = { ...journey.points[1], kind: 'destination', title: 'Secret Camp', synthesized: true, stop: { ...stop, id: 'day10-first', auto: true } } satisfies Journey['points'][number]
    const j = { ...journey, startTitle: 'Chandratal Lake', endTitle: 'Secret Camp', points: [borrowedStart, journey.points[1], borrowedEnd] } satisfies Journey
    const own = new Set(['lake'])

    it('names the day, not the place, when the neighbour is locked', () => {
      const labels = rideNodeLabels(j, { dayNumber: 9, ownStopIds: own, prevLocked: true, nextLocked: true })
      expect(labels).toEqual({ start: 'Start of day 9', end: 'End of day 9' })
      const html = renderToStaticMarkup(createElement(RideTimeline, { journey: j, labels, timeFormat: '24h', children: null }))
      expect(html).not.toContain('Chandratal')
      expect(html).not.toContain('Secret Camp')
    })

    it('masks a place from a locked day further away, across an empty free day', () => {
      // Day 2 is locked, day 3 is free with no stops, day 4 is on screen: the
      // adjacent day is readable, but the engine named day 2's last stop.
      const labels = rideNodeLabels(j, { dayNumber: 4, ownStopIds: own, prevLocked: false, nextLocked: false,
        lockedNames: ['Chandratal Lake', 'Secret Camp (end)'] })
      expect(labels).toEqual({ start: 'Start of day 4', end: 'End of day 4' })
    })

    it('keeps the place when the neighbour is readable', () => {
      const labels = rideNodeLabels(j, { dayNumber: 9, ownStopIds: own, prevLocked: false, nextLocked: false })
      expect(labels).toEqual({ start: 'Leave Chandratal Lake', end: 'Head on to Secret Camp' })
    })

    it('keeps a line that names one of the day’s own stops', () => {
      const ownEnd = { ...journey, points: [journey.points[0], journey.points[1]] } satisfies Journey
      const labels = rideNodeLabels(ownEnd, { dayNumber: 3, ownStopIds: own, prevLocked: false, nextLocked: true })
      expect(labels.end).toBe('Finish at Nako')
    })

    it('says Night in only for a stay', () => {
      const stay = { ...journey, points: [journey.points[0], { ...journey.points[1], stop: { ...stop, category: 'hotel' } }] } satisfies Journey
      expect(rideNodeLabels(stay, { dayNumber: 3, ownStopIds: own, prevLocked: false, nextLocked: false }).end).toBe('Night in Nako')
    })
  })

  it('renders real clocks, the saved leg and a separate creator note', () => {
    const labels = rideNodeLabels(journey, { dayNumber: 3, ownStopIds: new Set(['lake']), prevLocked: false, nextLocked: false })
    const html = renderToStaticMarkup(createElement(RideTimeline, { journey, labels, timeFormat: '24h', children: null }))
    expect(html).toContain('Leave ' + 'Kalpa')
    expect(html).toContain('09:54')
    expect(html).toContain('72 km · 1h 54m')
    expect(html).not.toContain('100 km')
    expect(html).toContain('Walk on the bank.')
    expect(html).toContain('pi-ride-note')
    expect(html).toContain('Finish at')
  })

  it('renders region art when a day has no photo', () => {
    const html = renderToStaticMarkup(createElement(RideDayPanel, {
      publicationId: 'pub', index: 0, planPlaces: ['Spiti'], state: 'free',
      badge: 'Day 1', title: 'A day', meta: '2 places', budget: null, children: null,
    }))
    expect(html).toContain('yf-art-picture')
    expect(html).toContain('<picture')
  })

  it('keeps paid previews to categories and counts', () => {
    const html = renderToStaticMarkup(createElement(RideLockedPreview, {
      publicationId: 'pub', index: 4, lastIndex: 7, planPlaces: ['Spiti'], action: 'Unlock days 5 to 8',
      card: { state: 'locked', summary: { index: 4, title: 'Paid day', placeCount: 2, travelMinutes: 0, pace: null, hasFlight: false,
        kinds: [{ kind: 'temple', count: 1 }, { kind: 'nature', count: 1 }] } },
    }))
    expect(html).toContain('1 temple and 1 nature stop')
    expect(html).toContain('Days 5 to 8 open together')
    expect(html).toContain('In the paid plan')
    expect(html).not.toContain('Lake')
  })
})
