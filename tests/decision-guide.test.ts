// ============ Grounded decision guidance (decisionGuide.ts) ============
// Deterministic offline recommendation tests — node env, pure logic. Uses the
// seeded demo trip directly (a full Trip), so no store/supabase mock is needed.
import { describe, it, expect } from 'vitest'
import { seedData } from '../src/data/seed'
import type { TripDecision } from '../src/data/types'
import { decisionContext, contextLine, recommendForDecision } from '../src/lib/decisionGuide'

function trip() {
  return seedData.trips[0]
}

function decision(overrides: Partial<TripDecision> = {}): TripDecision {
  return {
    id: 'd-1',
    tripId: 'trip-1',
    question: 'Where do we stay near Munnar?',
    options: [
      { id: 'o-a', label: 'Homestay', costImpactInr: 4000, timeImpactMin: 30 },
      { id: 'o-b', label: 'Resort', costImpactInr: 12000, timeImpactMin: 45 },
    ],
    votesByUserId: {},
    status: 'open',
    raisedBy: 'u-1',
    createdAt: 1,
    ...overrides,
  }
}

describe('decisionContext', () => {
  it('returns engine totals + health for a real trip', () => {
    const ctx = decisionContext(trip())
    expect(ctx.totals.totalCostInr).toBeGreaterThan(0)
    expect(ctx.health.score).toBeGreaterThanOrEqual(5)
    expect(ctx.health.score).toBeLessThanOrEqual(100)
  })

  it('contextLine summarises road time, cost and health', () => {
    const line = contextLine(decisionContext(trip()))
    expect(line).toContain('on the road')
    expect(line).toContain('total')
    expect(line).toContain('health')
  })
})

describe('recommendForDecision', () => {
  it('returns null for a resolved decision', () => {
    const ctx = decisionContext(trip())
    expect(recommendForDecision(trip(), decision({ status: 'resolved', resolvedOptionId: 'o-a' }), ctx)).toBeNull()
  })

  it('recommends the lowest-cost option when costs are declared', () => {
    const ctx = decisionContext(trip())
    const r = recommendForDecision(trip(), decision(), ctx)!
    expect(r.optionId).toBe('o-a')
    expect(r.basis).toBe('cost')
    expect(r.reason).toContain('budget')
  })

  it('recommends the least-time option when no costs but times are declared', () => {
    const d = decision({
      options: [
        { id: 'x', label: 'Direct route', timeImpactMin: 10 },
        { id: 'y', label: 'Scenic detour', timeImpactMin: 90 },
      ],
    })
    const r = recommendForDecision(trip(), d, decisionContext(trip()))!
    expect(r.optionId).toBe('x')
    expect(r.basis).toBe('time')
  })

  it('leans with the leading vote when no impact is declared', () => {
    const d = decision({
      options: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
      ],
      votesByUserId: { u1: 'b', u2: 'b', u3: 'a' },
    })
    const r = recommendForDecision(trip(), d, decisionContext(trip()))!
    expect(r.basis).toBe('tie')
    expect(r.optionId).toBe('b')
  })

  it('returns null for an optionless decision', () => {
    expect(recommendForDecision(trip(), decision({ options: [] }), decisionContext(trip()))).toBeNull()
  })
})
