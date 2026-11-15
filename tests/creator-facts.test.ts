import { describe, expect, it } from 'vitest'
import { creatorPick, plannedKilometres, planningNotes, publicationFacts, validPlanningNotes } from '../src/lib/creatorFacts'
import { beginLedger, applyLedger, settleLedger } from '../src/store/fieldIntents'
import type { PrivateUserProfile, PublishedItinerary } from '../src/data/types'

const route: PublishedItinerary = {
  id: 'live', creatorId: 'creator', tripId: 'trip', title: 'Kerala', tagline: '', routeSummary: [],
  durationDays: 1, estimatedBudgetPerPersonInr: 0, travelStyle: 'balanced', travelTips: [],
  warningsAndAssumptions: [], freeDayIndexes: [0], publishedAt: 1, views: 0, copies: 0,
}

describe('creator facts', () => {
  it('matches the SQL note limits and counts Unicode characters', () => {
    for (const value of [[], ['a'], ['a', 'b', 'c'], ['🚗'.repeat(140)]]) expect(validPlanningNotes(value)).toBe(true)
    for (const value of [[''], [' \n'], ['a'.repeat(141)], ['a', 'b', 'c', 'd'], [1], {}, 'note']) {
      expect(validPlanningNotes(value)).toBe(false)
      expect(() => planningNotes(value)).toThrow()
    }
    expect(planningNotes(null)).toBeUndefined()
  })
  it('selects only a live route owned by this creator', () => {
    expect(creatorPick([route], 'creator', 'live')).toBe(route)
    expect(creatorPick([{ ...route, unpublishedAt: 1 }], 'creator', 'live')).toBeUndefined()
    expect(creatorPick([route], 'other', 'live')).toBeUndefined()
    expect(creatorPick([route], 'creator', null)).toBeUndefined()
  })
  it('does not invent absent distance and excludes unpublished routes', () => {
    expect(plannedKilometres([route])).toBeUndefined()
    expect(plannedKilometres([{ ...route, plannedKm: 0 }])).toBe(0)
    expect(plannedKilometres([{ ...route, plannedKm: 42 }, { ...route, plannedKm: 99, unpublishedAt: 1 }])).toBe(42)
  })
  it('parses the SQL timestamp and fails closed on malformed facts', () => {
    expect(publicationFacts({ reviewed_at: '2026-10-14T00:00:00Z', planned_km: 340 }).reviewedAt).toBe(Date.parse('2026-10-14T00:00:00Z'))
    expect(publicationFacts({}).plannedKm).toBeUndefined()
    for (const row of [{ planned_km: -1 }, { planned_km: 20000 }, { reviewed_at: 'bad' }, { best_months: 4096 }]) expect(() => publicationFacts(row)).toThrow()
  })
  it('rolls back refused picks and keeps accepted notes', () => {
    const base: PrivateUserProfile = { name: 'Creator', isCreator: true, creatorAvailable: true, languages: [], travelStyles: [] }
    let ledger = beginLedger(undefined, base, 1, { featuredPubId: 'live' })
    ledger = beginLedger(ledger, base, 2, { planningNotes: ['Start early.'] })
    ledger = settleLedger(ledger, 1, 'failed')
    ledger = settleLedger(ledger, 2, 'accepted')
    expect(applyLedger(ledger, base)).toEqual({ ...base, planningNotes: ['Start early.'] })
  })
})
