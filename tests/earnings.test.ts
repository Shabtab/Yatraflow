// ============ Earnings projection helper (pre-payments) ============
// The Earnings tab's projection view runs on this arithmetic — pin it.
import { describe, it, expect } from 'vitest'
import { projectEarnings, PROJECTED_PLATFORM_FEE_INR } from '../src/lib/earnings'
import type { PublishedItinerary } from '../src/data/types'

const pub = (over: Partial<PublishedItinerary>): PublishedItinerary => ({
  id: 'pub-x', tripId: 't1', creatorId: 'c1', title: 'Kerala', tagline: '',
  routeSummary: ['Kochi'], durationDays: 3, estimatedBudgetPerPersonInr: 5000,
  travelStyle: 'balanced', travelTips: [], warningsAndAssumptions: [],
  freeDayIndexes: [0], publishedAt: 1, views: 0, copies: 0, ...over,
})

describe('projectEarnings', () => {
  it('projects price × forks per priced publication and totals them', () => {
    const r = projectEarnings([
      pub({ id: 'a', title: 'Kerala', premiumPriceInr: 199, copies: 7 }),
      pub({ id: 'b', title: 'Goa', premiumPriceInr: 149, copies: 2 }),
    ])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ pubId: 'a', priceInr: 199, forks: 7, grossInr: 1393, netInr: 1393 })
    expect(r.potentialInr).toBe(1691)
    expect(r.netInr).toBe(1691 - 2 * PROJECTED_PLATFORM_FEE_INR)
  })

  it('never invents money for unpriced publications — counts them instead', () => {
    const r = projectEarnings([
      pub({ id: 'free', premiumPriceInr: undefined, copies: 50 }),
      pub({ id: 'zero', premiumPriceInr: 0, copies: 9 }),
      pub({ id: 'priced', premiumPriceInr: 99, copies: 1 }),
    ])
    expect(r.rows.map(x => x.pubId)).toEqual(['priced'])
    expect(r.potentialInr).toBe(99)
    expect(r.unpricedCount).toBe(2)
  })

  it('lists a priced publication with zero forks (a visible ₹0 row), sorted by potential', () => {
    const r = projectEarnings([
      pub({ id: 'low', title: 'Low', premiumPriceInr: 99, copies: 1 }),
      pub({ id: 'high', title: 'High', premiumPriceInr: 199, copies: 3 }),
      pub({ id: 'none', title: 'NoForks', premiumPriceInr: 149, copies: 0 }),
    ])
    expect(r.rows.map(x => x.pubId)).toEqual(['high', 'low', 'none'])
    expect(r.rows.find(x => x.pubId === 'none')?.grossInr).toBe(0)
  })
})
