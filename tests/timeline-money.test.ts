// ============ #338 / #343 — per-day money: keyed by INDEX, finite by guard ============
//
// #338 — buckets and their readers disagreed. `computeTotals` built `byDay`
// positionally but read it with `byDay[day.index]`, the round-trip drive home
// went to `byDay[len - 1]` positionally, an expense's `dayIndex` was CLAMPED to
// the last day, while `entryByDay`/`lodgingByDay` keyed by `d.index` — so on a
// trip with a skipped index (a deleted middle day leaves 0,2,3) a day could
// show another day's total, and the Timeline's own lookup clamped to boot.
//
// #343 — `entryFeeInrPerPerson * travellers` with either value undefined is
// NaN, and one NaN multiplies through the trip total, the strip and the print
// card. Display read the raw fields too, so a missing fee rendered the literal
// string "₹undefined".
//
// These tests drive the REAL `computeTotals` with rows a hand-edit or an old
// hydration can actually produce — no mocks, because the bug lived exactly
// where the mocks were finite.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { computeTotals, formatInr } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import { DaySpark } from '../src/pages/trip/timeline/DaySpark'
import type { Expense, ItineraryDay, ItineraryStop, Trip } from '../src/data/types'

const base = structuredClone(seedData.trips[0]) as Trip

function stop(id: string, lat: number, lng: number, over: Partial<ItineraryStop> = {}): ItineraryStop {
  return {
    id, title: id, category: 'sightseeing', locationName: id,
    lat, lng, visitMinutes: 45,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', status: 'confirmed', orderInDay: 1,
    ...over,
  }
}

function day(index: number, stops: ItineraryStop[]): ItineraryDay {
  return { id: `d${index}`, index, stops }
}

/** A trip whose days are sparse (indexes 0,2,3 — what deleting a middle day
 *  leaves) and/or out of array order. The store resequences its own writes, but
 *  hydrated rows and hand-edited JSON reach the engine as they are. */
function tripWith(days: ItineraryDay[], over: Partial<Trip> = {}): Trip {
  return { ...structuredClone(base), days, expenses: [], ...over }
}

const byIndex = (t: ReturnType<typeof computeTotals>, index: number) =>
  t.byDay.find(b => b.dayIndex === index)!

const dayIndexes = (t: ReturnType<typeof computeTotals>) => t.byDay.map(b => b.dayIndex)

function sumByDay(t: ReturnType<typeof computeTotals>): number {
  return t.byDay.reduce((s, d) => s + d.totalInr, 0)
}

describe('#338 — per-day money follows the day INDEX', () => {
  // Three days in a chain, coords that produce real legs between them.
  const sparseDays = () => [
    day(0, [stop('a', 9.5, 76.3)]),
    day(2, [stop('b', 10.1, 76.9)]),
    day(3, [stop('c', 10.8, 77.4)]),
  ]

  it('exposes one bucket per real day, keyed by its index — no clamping', () => {
    const t = computeTotals(tripWith(sparseDays()))
    expect(dayIndexes(t)).toEqual([0, 2, 3])
  })

  it('an expense tagged to a day lands on THAT day, not the last one', () => {
    const expenses: Expense[] = [{ id: 'e2', label: 'Day 3 stay', category: 'accommodation', amountInr: 3000, dayIndex: 2 }]
    const t = computeTotals(tripWith(sparseDays(), { expenses }))
    expect(byIndex(t, 2).expensesInr).toBeCloseTo(3000, 4)
    // The old clamp put this on the LAST bucket; the first day must not carry it.
    expect(byIndex(t, 0).expensesInr).toBeCloseTo(0, 4)
    expect(byIndex(t, 3).expensesInr).toBeCloseTo(0, 4)
  })

  it('an expense naming a day that no longer exists is NOT re-attributed to the last day', () => {
    const expenses: Expense[] = [{ id: 'gone', label: 'Day that was deleted', category: 'food', amountInr: 1000, dayIndex: 5 }]
    const t = computeTotals(tripWith(sparseDays(), { expenses }))
    // Unattached: spread with the trip-level costs (1000 / 3 days), never the
    // full 1000 on the last bucket.
    for (const b of t.byDay) expect(b.expensesInr).toBeCloseTo(1000 / 3, 4)
    expect(byIndex(t, 3).expensesInr).not.toBeCloseTo(1000, 4)
  })

  it('each day keeps its own transport, entry fees and stops on a sparse trip', () => {
    const days = sparseDays()
    days[1].stops[0].entryFeeInrPerPerson = 250
    const t = computeTotals(tripWith(days))
    // The entry fee rides the stop's own day: the bucket for index 2 carries
    // ₹250 × travellers on top of its transport, and no other bucket carries it.
    const feeTotal = 250 * base.travellers
    expect(byIndex(t, 2).totalInr - byIndex(t, 2).transportInr).toBeCloseTo(feeTotal, 4)
    expect(byIndex(t, 0).totalInr - byIndex(t, 0).transportInr).toBeCloseTo(0, 4)
    expect(byIndex(t, 0).stops).toBe(1)
    expect(byIndex(t, 3).stops).toBe(1)
    // Days 2 and 3 each measure a real leg from the day before them. Day 0
    // wakes at its own first stop (this fixture has no geocoded start), so 0 is
    // correct there — while 2 and 3 read 0 until the wake-up origin was keyed
    // by day INDEX instead of array position (the trip walked itself).
    expect(byIndex(t, 0).transportInr).toBeCloseTo(0, 4)
    expect(byIndex(t, 2).transportInr).toBeGreaterThan(0)
    expect(byIndex(t, 3).transportInr).toBeGreaterThan(0)
  })

  it('array order cannot move a day’s money', () => {
    const sorted = tripWith(sparseDays(), { roundTrip: true })
    const shuffled = tripWith([sparseDays()[2], sparseDays()[0], sparseDays()[1]], { roundTrip: true })
    expect(dayIndexes(computeTotals(shuffled))).toEqual([3, 0, 2])
    const a = computeTotals(sorted)
    const b = computeTotals(shuffled)
    for (const idx of [0, 2, 3]) {
      expect(byIndex(b, idx).totalInr).toBeCloseTo(byIndex(a, idx).totalInr, 4)
      expect(byIndex(b, idx).transportInr).toBeCloseTo(byIndex(a, idx).transportInr, 4)
      expect(byIndex(b, idx).distanceKm).toBeCloseTo(byIndex(a, idx).distanceKm, 4)
    }
    // …including the round-trip drive home, which the old code charged to the
    // LAST ARRAY POSITION rather than the last day.
    expect(byIndex(b, 3).transportInr).toBeCloseTo(byIndex(a, 3).transportInr, 4)
  })

  it('the per-day stacks still sum to the trip total on every shape', () => {
    for (const days of [sparseDays(), [sparseDays()[1]], []]) {
      const t = computeTotals(tripWith(days, { roundTrip: true }))
      expect(sumByDay(t)).toBeCloseTo(t.totalCostInr, 4)
    }
  })
})

describe('#343 — one non-finite field cannot poison the money', () => {
  const broken = (over: Partial<ItineraryStop> = {}, tripOver: Partial<Trip> = {}) => {
    const days = [day(0, [stop('a', 9.5, 76.3, over)]), day(1, [stop('b', 10.1, 76.9)])]
    return computeTotals(tripWith(days, tripOver))
  }

  it('an undefined entry fee reads as 0 — totals stay finite, never NaN', () => {
    const t = broken({ entryFeeInrPerPerson: undefined as unknown as number })
    expect(Number.isFinite(t.totalCostInr)).toBe(true)
    expect(t.byDay.every(d => Number.isFinite(d.totalInr))).toBe(true)
    expect(formatInr(t.totalCostInr)).not.toContain('NaN')
    // …and it is genuinely zero, not a silent surcharge
    expect(t.totalCostInr).toBeCloseTo(broken({ entryFeeInrPerPerson: 0 }).totalCostInr, 4)
  })

  it('a NaN entry fee is treated the same way', () => {
    const t = broken({ entryFeeInrPerPerson: NaN })
    expect(t.byDay.every(d => Number.isFinite(d.totalInr))).toBe(true)
    expect(t.totalCostInr).toBeCloseTo(broken({ entryFeeInrPerPerson: 0 }).totalCostInr, 4)
  })

  it('an undefined expense amount no longer spreads NaN over every day', () => {
    const expenses: Expense[] = [{ id: 'e', label: 'Broken line', category: 'food', amountInr: undefined as unknown as number }]
    const t = broken({}, { expenses })
    expect(Number.isFinite(t.totalCostInr)).toBe(true)
    expect(t.byDay.every(d => Number.isFinite(d.expensesInr))).toBe(true)
    expect(t.totalCostInr).toBeCloseTo(broken({}, { expenses: [{ ...expenses[0], amountInr: 0 }] }).totalCostInr, 4)
  })

  it('a missing travellers count reads as 1 instead of NaN on the per-person lines', () => {
    const expenses: Expense[] = [{ id: 'e', label: 'Per head', category: 'food', amountInr: 500, perPerson: true }]
    const t = broken({}, { travellers: undefined as unknown as number, expenses })
    expect(Number.isFinite(t.totalCostInr)).toBe(true)
    expect(Number.isFinite(t.costPerPersonInr)).toBe(true)
    expect(formatInr(t.costPerPersonInr)).not.toContain('NaN')
    // one traveller → one share, not a multiplication by NaN
    expect(t.totalCostInr).toBeCloseTo(broken({}, { travellers: 1, expenses }).totalCostInr, 4)
  })

  it('a whole trip of undefined money still produces finite per-day and trip figures', () => {
    const days = [day(0, [stop('a', 9.5, 76.3, { entryFeeInrPerPerson: undefined as unknown as number, transportCostInrTotal: undefined as unknown as number })])]
    const t = computeTotals(tripWith(days, {
      travellers: undefined as unknown as number,
      expenses: [{ id: 'e', label: 'Broken', category: 'food', amountInr: NaN }],
    }))
    expect(Number.isFinite(t.totalCostInr)).toBe(true)
    expect(Number.isFinite(t.costPerDayInr)).toBe(true)
    expect(Number.isFinite(t.costPerPersonInr)).toBe(true)
    expect(t.byDay.every(d => [d.expensesInr, d.transportInr, d.totalInr].every(Number.isFinite))).toBe(true)
    expect(sumByDay(t)).toBeCloseTo(t.totalCostInr, 4)
  })
})

describe('#343 — the display half', () => {
  it('DaySpark drops non-finite coordinates instead of drawing NaN', () => {
    const bad = stop('bad', NaN, 76.3)
    expect(renderToString(createElement(DaySpark, { stops: [bad, stop('ok', 9.5, 76.3)] }))).toBe('')
    const markup = renderToString(createElement(DaySpark, { stops: [stop('a', 9.5, 76.3), stop('b', 10.1, 76.9)] }))
    expect(markup).toContain('<polyline')
    expect(markup).not.toContain('NaN')
    // one real point is not a shape
    expect(renderToString(createElement(DaySpark, { stops: [stop('a', 9.5, 76.3), bad] }))).toBe('')
  })

  it('the Timeline renders a money field only when it is finite', () => {
    const daySection = readFileSync(new URL('../src/pages/trip/timeline/DaySection.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    // The rendered value sits inside its finite guard — a raw interpolation is
    // exactly the "₹undefined" the audit found, so the guard must wrap it.
    expect(daySection).toMatch(/Number\.isFinite\(s\.entryFeeInrPerPerson\) && <span>/)
    expect(daySection).toMatch(/Number\.isFinite\(s\.transportCostInrTotal\) && <span>/)
    // Neither field may be interpolated anywhere WITHOUT that guard: one
    // interpolation, one guard — count them rather than trust the eyeball.
    expect((daySection.match(/₹\{s\.entryFeeInrPerPerson\}/g) ?? []).length)
      .toBe((daySection.match(/Number\.isFinite\(s\.entryFeeInrPerPerson\)/g) ?? []).length)
    expect((daySection.match(/₹\{s\.transportCostInrTotal\}/g) ?? []).length)
      .toBe((daySection.match(/Number\.isFinite\(s\.transportCostInrTotal\)/g) ?? []).length)
  })
})
