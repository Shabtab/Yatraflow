import { describe, expect, it } from 'vitest'
import { budgetTargetMessage, suggestedBudgetTarget } from '../src/lib/createHonesty'

describe('budget target guidance', () => {
  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('has no shortcut for an unavailable estimate: %s', estimate => {
    expect(suggestedBudgetTarget(estimate)).toBeNull()
  })

  it.each([[1, 500], [500, 500], [500.01, 1000], [12178, 12500], [12500, 12500]])('suggests a target covering an estimate of %s', (estimate, target) => {
    expect(suggestedBudgetTarget(estimate)).toBe(target)
    expect(suggestedBudgetTarget(estimate)).toBeGreaterThanOrEqual(estimate)
  })
  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('asks for an estimate when it is unavailable: %s', estimate => {
    expect(budgetTargetMessage(15000, estimate)).toBe('Add dates and route points to get an estimate.')
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('keeps a missing target separate from a real estimate: %s', target => {
    expect(budgetTargetMessage(target, 12500)).toBe('The current estimate is ₹12,500 per person. Set a budget target to compare it.')
  })

  it('names the shortfall when the chosen plan exceeds the target', () => {
    expect(budgetTargetMessage(10000, 12500)).toBe('The current estimate is ₹12,500 per person. It is ₹2,500 above your target.')
  })

  it('names the remaining amount without promising a different room or transport choice', () => {
    expect(budgetTargetMessage(15000, 12500)).toBe('The current estimate is ₹12,500 per person. It is ₹2,500 below your target.')
  })

  it('compares the same rounded rupee values shown to the traveller', () => {
    expect(budgetTargetMessage(12500.1, 12500.4)).toBe('The current estimate matches your ₹12,500 target per person.')
  })
})
