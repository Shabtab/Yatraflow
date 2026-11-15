// ============ Creator hub read model — spec 5.1 tests =============
//
// Logic only: UTC window edges, null previous before the log start, a feed
// that never names a buyer, RFC 4180 CSV escaping, and readiness that
// ignores unpublished routes. No markup.
import { describe, expect, it } from 'vitest'
import type { PublishedItinerary } from '../src/data/types'
import type { SaleRow } from '../src/lib/earnings'
import { activityCsv, activityFeed, grossByMonth, kpiWindows, readiness } from '../src/lib/creatorHub'
import { funnelWindowStart, utcDayStart } from '../src/lib/pubFunnel'

const DAY = 86400000
const NOW = Date.UTC(2026, 10, 15, 18, 30)

function pub(overrides: Partial<PublishedItinerary> = {}): PublishedItinerary {
  return {
    id: 'p1',
    tripId: 't1',
    creatorId: 'c1',
    title: 'Route one',
    tagline: '',
    routeSummary: ['Kochi'],
    durationDays: 3,
    estimatedBudgetPerPersonInr: 10000,
    travelStyle: 'relaxed',
    bestSeason: 'Oct to Mar',
    coverImageUrl: 'cover.jpg',
    travelTips: [],
    warningsAndAssumptions: [],
    freeDayIndexes: [0],
    publishedAt: NOW - 3 * DAY,
    views: 10,
    copies: 5,
    ...overrides,
  }
}

function sale(overrides: Partial<SaleRow> = {}): SaleRow {
  return { pubId: 'p1', title: 'Route one', amountPaidInr: 499, feeInr: 75, netInr: 424, grantedAt: NOW, ...overrides }
}

describe('kpiWindows', () => {
  it('sums over UTC day edges: a row at the window start counts, one before does not', () => {
    const start = funnelWindowStart(7, NOW)
    const daily = [
      { pubId: 'p1', day: new Date(start).toISOString().slice(0, 10), views: 3, forks: 1 },
      { pubId: 'p1', day: new Date(start - 1).toISOString().slice(0, 10), views: 100, forks: 100 },
    ]
    const windows = kpiWindows(daily, [], 7, NOW)
    expect(windows.current.views).toBe(3)
    expect(windows.current.forks).toBe(1)
    expect(utcDayStart(NOW)).toBe(Date.UTC(2026, 10, 15))
  })

  it('delta is null before the log start, and previous is null when the log starts inside it', () => {
    const start = funnelWindowStart(7, NOW)
    const daily = [
      { pubId: 'p1', day: new Date(start).toISOString().slice(0, 10), views: 2, forks: 0 },
      { pubId: 'p1', day: new Date(start - 3 * DAY).toISOString().slice(0, 10), views: 7, forks: 9 },
    ]
    const windows = kpiWindows(daily, [], 7, NOW)
    expect(windows.previous).toBeNull()
    expect(windows.delta).toBeNull()
    expect(windows.current.views).toBe(2)
    expect(windows.current.forks).toBe(0)
  })

  it('a log that fully covers the previous window gets real sums and deltas', () => {
    const daily = [
      { pubId: 'p1', day: '2026-11-02', views: 5, forks: 1 },
      { pubId: 'p1', day: '2026-11-09', views: 8, forks: 2 },
    ]
    const sales = [sale({ grantedAt: Date.UTC(2026, 10, 2, 12) })]
    const windows = kpiWindows(daily, sales, 7, NOW)
    expect(windows.previous).toEqual({ views: 5, forks: 1, unlocks: 1, net: 424 })
    expect(windows.current).toEqual({ views: 8, forks: 2, unlocks: 0, net: 0 })
    expect(windows.delta).toEqual({ views: 3, forks: 1, unlocks: -1, net: -424 })
  })
})

describe('activityFeed', () => {
  it('never carries a buyer id, name or town', () => {
    const events = activityFeed(
      [sale({ grantedAt: NOW - 1 })],
      [{ pubId: 'p1', day: new Date(NOW - DAY).toISOString().slice(0, 10), views: 0, forks: 2 }],
      [pub(), pub({ id: 'p2', title: 'Route two', publishedAt: NOW - 2 * DAY, refreshedAt: NOW - DAY })],
      NOW,
    )
    expect(events.length).toBe(5)
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('userId')
    expect(serialized).not.toContain('buyer')
    for (const event of events) {
      expect(Object.keys(event)).not.toContain('userId')
    }
    expect(events[0]).toMatchObject({ kind: 'unlocked', route: 'Route one', netInr: 424 })
    expect(events[1]).toMatchObject({ kind: 'updated', route: 'Route two' })
    expect(events[2]).toMatchObject({ kind: 'forked', route: 'Route one', count: 2 })
    expect(events[3]).toMatchObject({ kind: 'published', route: 'Route two' })
    expect(events[4]).toMatchObject({ kind: 'published', route: 'Route one' })
  })

  it('folds forks per route per UTC day and sorts newest first', () => {
    const day = new Date(NOW - DAY).toISOString().slice(0, 10)
    const events = activityFeed(
      [],
      [
        { pubId: 'p1', day, views: 0, forks: 2 },
        { pubId: 'p1', day, views: 0, forks: 1 },
      ],
      [pub()],
      NOW,
    )
    expect(events).toEqual([
      { kind: 'forked', at: utcDayStart(NOW - DAY), route: 'Route one', count: 3 },
      { kind: 'published', at: NOW - 3 * DAY, route: 'Route one' },
    ])
  })
})

describe('grossByMonth', () => {
  it('buckets by UTC calendar month, zeros for empty months', () => {
    const series = grossByMonth(
      [
        sale({ grantedAt: Date.UTC(2026, 9, 10), amountPaidInr: 499 }),
        sale({ grantedAt: NOW, amountPaidInr: 999 }),
      ],
      3,
      NOW,
    )
    expect(series.map(point => point.month)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(series.map(point => point.grossInr)).toEqual([0, 499, 999])
  })
})

describe('readiness', () => {
  it('ignores unpublished routes and reports failing route ids per check', () => {
    const stale = NOW - 91 * DAY
    const pubs = [
      pub({ id: 'bad', coverImageUrl: undefined, bestSeason: undefined, publishedAt: stale }),
      pub({ id: 'paid-nofree', premiumPriceInr: 499, freeDayIndexes: [] }),
      pub({ id: 'gone', unpublishedAt: NOW, coverImageUrl: undefined, bestSeason: undefined, publishedAt: stale }),
    ]
    const report = readiness(pubs, NOW)
    const byKey = Object.fromEntries(report.checks.map(check => [check.key, check.failing]))
    expect(byKey).toEqual({
      cover: ['bad'],
      cost: [],
      freeDays: ['paid-nofree'],
      season: ['bad'],
      freshness: ['bad'],
    })
    expect(report.ready).toBe(false)
  })

  it('a fully filled live route is ready, and freshness honours refreshedAt', () => {
    const report = readiness(
      [pub({ refreshedAt: NOW - 10 * DAY, publishedAt: NOW - 200 * DAY })],
      NOW,
    )
    expect(report.ready).toBe(true)
  })
})

describe('activityCsv', () => {
  it('escapes commas and quotes per RFC 4180, header row first, ISO dates', () => {
    const csv = activityCsv([
      { kind: 'unlocked', at: Date.UTC(2026, 10, 15), route: 'Kochi, "quoted"', netInr: 424 },
    ])
    const lines = csv.replaceAll('\r\n', '\n').split('\n')
    expect(lines[0]).toBe('kind,date,route,count,amount_inr')
    expect(lines[1]).toBe('unlocked,2026-11-15T00:00:00.000Z,"Kochi, ""quoted""",,424')
  })
})
