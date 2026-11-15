// ============ Creator hub read model (P2, pure) ============
//
// The owner dashboard's derived numbers: KPI windows against the UTC day
// edges the SQL buckets into, the activity feed, the month series, the
// readiness audit and the CSV export. Pure functions — no React, no store,
// no network.
//
// Two honesty rules run through this module:
//
//   1. A window the log does not fully cover is `null`, not 0. The event log
//      began at a date, so "no rows in the previous window" from a log that
//      starts INSIDE that window is not "nothing happened" — it is "we cannot
//      know". The UI says "No earlier data" for that case.
//   2. The feed never carries buyer identity. Unlocks count money and routes,
//      never people: `SaleRow` already has the buyer stripped, and nothing
//      here adds a field back.
import type { ID, PublishedItinerary } from '../data/types'
import type { FunnelDailyRow } from './pubFunnel'
import { funnelWindowStart, utcDayKey, utcDayStart } from './pubFunnel'
import type { SaleRow } from './earnings'
import { livePubs } from './livePubs'
import { DAY_MS } from './dayCount'

export interface KpiFigures {
  views: number
  forks: number
  unlocks: number
  net: number
}

export interface KpiWindows {
  current: KpiFigures
  /** `null` when the log starts inside (or after) the previous window — the
   *  sums would be partial, and a partial sum must not pose as a total. */
  previous: KpiFigures | null
  /** current − previous, per figure; `null` wherever `previous` is. */
  delta: KpiFigures | null
}

function sumWindow(
  daily: readonly FunnelDailyRow[],
  sales: readonly SaleRow[],
  start: number,
  now: number,
): KpiFigures {
  const figures: KpiFigures = { views: 0, forks: 0, unlocks: 0, net: 0 }
  for (const row of daily) {
    const at = Date.parse(`${row.day}T00:00:00Z`)
    if (at >= start && at <= now) {
      figures.views += row.views
      figures.forks += row.forks
    }
  }
  for (const sale of sales) {
    if (sale.grantedAt >= start && sale.grantedAt <= now) {
      figures.unlocks += 1
      figures.net += sale.netInr
    }
  }
  return figures
}

/** Earliest instant any input row records. The day rows are UTC day keys; the
 *  sales are epoch ms. */
function logStart(daily: readonly FunnelDailyRow[], sales: readonly SaleRow[]): number | null {
  let earliest: number | null = null
  for (const row of daily) {
    const at = Date.parse(`${row.day}T00:00:00Z`)
    if (earliest === null || at < earliest) earliest = at
  }
  for (const sale of sales) {
    if (earliest === null || sale.grantedAt < earliest) earliest = sale.grantedAt
  }
  return earliest
}

/** Current and previous `days`-day windows over UTC day edges, with deltas.
 *  The previous window is `null` when the log starts inside it — a partially
 *  covered window says "No earlier data", never 0. */
export function kpiWindows(
  daily: readonly FunnelDailyRow[],
  sales: readonly SaleRow[],
  days: number,
  now: number,
): KpiWindows {
  const currentStart = funnelWindowStart(days, now)
  const previousStart = currentStart - days * DAY_MS
  const current = sumWindow(daily, sales, currentStart, now)
  const start = logStart(daily, sales)
  const covered = start !== null && start <= previousStart
  const previous = covered ? sumWindow(daily, sales, previousStart, currentStart - 1) : null
  const delta = previous
    ? {
        views: current.views - previous.views,
        forks: current.forks - previous.forks,
        unlocks: current.unlocks - previous.unlocks,
        net: current.net - previous.net,
      }
    : null
  return { current, previous, delta }
}

export type ActivityEvent =
  | { kind: 'unlocked'; at: number; route: string; netInr: number }
  | { kind: 'forked'; at: number; route: string; count: number }
  | { kind: 'published'; at: number; route: string }
  | { kind: 'updated'; at: number; route: string }

/** Dated events for the feed, newest first. Unlocks carry the route and the
 *  amount after fee, never a buyer; forks are folded to one event per route
 *  per UTC day; published and updated come from the route's own stamps. */
export function activityFeed(
  sales: readonly SaleRow[],
  daily: readonly FunnelDailyRow[],
  pubs: PublishedItinerary[],
  now: number,
  limit = 20,
): ActivityEvent[] {
  const titleOf = new Map(pubs.map(pub => [pub.id, pub.title] as const))
  const events: ActivityEvent[] = []
  for (const sale of sales) {
    if (sale.grantedAt <= now) {
      events.push({ kind: 'unlocked', at: sale.grantedAt, route: sale.title, netInr: sale.netInr })
    }
  }
  const forksByDay = new Map<string, { pubId: string; at: number; count: number }>()
  for (const row of daily) {
    if (row.forks <= 0 || !titleOf.has(row.pubId)) continue
    const at = utcDayStart(Date.parse(`${row.day}T00:00:00Z`))
    const key = `${row.pubId}#${row.day}`
    const folded = forksByDay.get(key)
    if (folded) folded.count += row.forks
    else forksByDay.set(key, { pubId: row.pubId, at, count: row.forks })
  }
  for (const { pubId, at, count } of forksByDay.values()) {
    const route = titleOf.get(pubId)
    if (route !== undefined && at <= now) events.push({ kind: 'forked', at, route, count })
  }
  for (const pub of pubs) {
    if (pub.publishedAt <= now) events.push({ kind: 'published', at: pub.publishedAt, route: pub.title })
    if (pub.refreshedAt !== undefined && pub.refreshedAt > pub.publishedAt && pub.refreshedAt <= now) {
      events.push({ kind: 'updated', at: pub.refreshedAt, route: pub.title })
    }
  }
  return events
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(0, limit))
}

export interface MonthPoint {
  /** `YYYY-MM`, the UTC calendar month. */
  month: string
  grossInr: number
}

/** Gross takings per UTC calendar month, for the last `months` months ending
 *  with the month `now` falls in. Empty months are real 0s, so the series
 *  never skips a month and a chart cannot join across a gap. */
export function grossByMonth(sales: readonly SaleRow[], months: number, now: number): MonthPoint[] {
  const count = Math.max(1, Math.floor(months))
  const anchor = new Date(utcDayStart(now))
  const buckets: MonthPoint[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - offset, 1))
    buckets.push({ month: cursor.toISOString().slice(0, 7), grossInr: 0 })
  }
  const byMonth = new Map(buckets.map(point => [point.month, point] as const))
  for (const sale of sales) {
    if (sale.grantedAt > now) continue
    const point = byMonth.get(utcDayKey(sale.grantedAt).slice(0, 7))
    if (point) point.grossInr += sale.amountPaidInr
  }
  return buckets
}

export type ReadinessKey = 'cover' | 'cost' | 'freeDays' | 'season' | 'freshness'

export interface ReadinessCheck {
  key: ReadinessKey
  /** The live routes that fail this check, in the order given. */
  failing: ID[]
}

export interface ReadinessReport {
  checks: ReadinessCheck[]
  /** True when no live route fails any check. */
  ready: boolean
}

const FRESH_WINDOW_MS = 90 * DAY_MS

/** The D5 audit over the LIVE routes only — an unpublished route needs no
 *  cover and no season text, so counting it would flag work nobody can see.
 *  Five checks: cover, trip cost, free days on paid routes, season text, and
 *  an update within the last 90 days. */
export function readiness(pubs: PublishedItinerary[], now: number): ReadinessReport {
  const live = livePubs(pubs)
  const failing: Record<ReadinessKey, ID[]> = {
    cover: [],
    cost: [],
    freeDays: [],
    season: [],
    freshness: [],
  }
  for (const pub of live) {
    if (!pub.coverImageUrl) failing.cover.push(pub.id)
    if (!(pub.estimatedBudgetPerPersonInr > 0)) failing.cost.push(pub.id)
    if (pub.premiumPriceInr && pub.freeDayIndexes.length === 0) failing.freeDays.push(pub.id)
    if (!pub.bestSeason) failing.season.push(pub.id)
    if (now - (pub.refreshedAt ?? pub.publishedAt) > FRESH_WINDOW_MS) failing.freshness.push(pub.id)
  }
  const checks: ReadinessCheck[] = [
    { key: 'cover', failing: failing.cover },
    { key: 'cost', failing: failing.cost },
    { key: 'freeDays', failing: failing.freeDays },
    { key: 'season', failing: failing.season },
    { key: 'freshness', failing: failing.freshness },
  ]
  return { checks, ready: checks.every(check => check.failing.length === 0) }
}

/** RFC 4180 CSV for the activity feed: one header row, ISO dates, and every
 *  field that holds a comma, a quote or a newline wrapped and doubled. */
export function activityCsv(rows: readonly ActivityEvent[]): string {
  const header = 'kind,date,route,count,amount_inr'
  const lines = rows.map(row => {
    const count = row.kind === 'forked' ? String(row.count) : ''
    const amount = row.kind === 'unlocked' ? String(row.netInr) : ''
    return [row.kind, new Date(row.at).toISOString(), row.route, count, amount]
      .map(csvField)
      .join(',')
  })
  return [header, ...lines].join('\r\n')
}

function csvField(value: string): string {
  // A cell that opens with a formula character is spreadsheet code, not text:
  // an apostrophe BEFORE the RFC 4180 quoting keeps Excel from executing it.
  const safe = /^[=+@-]/.test(value) ? `'${value}` : value
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}
