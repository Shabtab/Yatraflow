// Horizon 3.2: detour budget.
// Each day earns a finite detour budget; suggestions spend it visibly and the
// planner stops offering beyond it.
import { describe, it, expect } from 'vitest'
import { dayDetourBudgetMin, budgetSharePct, splitByDetourBudget } from '../src/lib/detourBudget'

describe('detour budget', () => {
  it('gives relaxed crews more room than packed ones', () => {
    expect(dayDetourBudgetMin({ travelStyle: 'relaxed' })).toBeGreaterThan(
      dayDetourBudgetMin({ travelStyle: 'packed' }),
    )
  })

  it('shrinks on dense days with many planned stops', () => {
    expect(dayDetourBudgetMin({ plannedStops: 6 })).toBeLessThan(dayDetourBudgetMin({ plannedStops: 1 }))
  })

  it('never drops below a usable floor', () => {
    expect(dayDetourBudgetMin({ travelStyle: 'packed', plannedStops: 20 })).toBeGreaterThanOrEqual(15)
  })

  it('reports spend as a share of budget', () => {
    expect(budgetSharePct(15, 60)).toBe(25)
  })

  it('defers hits past the budget in journey order', () => {
    const items = [{ id: 'a', detourMin: 20 }, { id: 'b', detourMin: 20 }, { id: 'c', detourMin: 30 }]
    const { within, deferred } = splitByDetourBudget(items, 45)
    expect(within.map(i => i.id)).toEqual(['a', 'b'])
    expect(deferred.map(i => i.id)).toEqual(['c'])
  })

  it('keeps on-route hits (zero detour) regardless of spend', () => {
    const items = [{ id: 'a', detourMin: 50 }, { id: 'b', detourMin: 0 }]
    const { within, deferred } = splitByDetourBudget(items, 45)
    expect(within.map(i => i.id)).toEqual(['b'])
    expect(deferred.map(i => i.id)).toEqual(['a'])
  })
})
