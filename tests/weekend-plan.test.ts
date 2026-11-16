import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trip } from '../src/data/types'
import {
  PARTY_MAX, addIsoDays, applyForkPlan, clampParty, dateRangeLabel, endForSpan, headEstimateInr,
  isoDayOf, pickLabel, planLine, sanitizeForkPlan, weekendStarts,
} from '../src/lib/weekendPlan'
import { rememberFork, takeForkAttribution } from '../src/lib/growthAttribution'

const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
})
afterEach(() => { vi.unstubAllGlobals() })

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d)

describe('weekend quick picks', () => {
  it('offers the next two Saturdays on or after today', () => {
    expect(weekendStarts(at(2026, 11, 16))).toEqual(['2026-11-21', '2026-11-28']) // Monday
    expect(weekendStarts(at(2026, 11, 21))).toEqual(['2026-11-21', '2026-11-28']) // Saturday itself
    expect(weekendStarts(at(2026, 11, 22))).toEqual(['2026-11-28', '2026-12-05']) // Sunday
    expect(weekendStarts(at(2026, 12, 21))).toEqual(['2026-12-26', '2027-01-02']) // across a year end
  })

  it('keeps the route span and labels the pick', () => {
    expect(endForSpan('2026-11-21', 3)).toBe('2026-11-23')
    expect(pickLabel('2026-11-21', '2026-11-23')).toBe('Sat 21 – Mon 23 Nov')
    expect(pickLabel('2026-11-28', '2026-12-02')).toBe('Sat 28 Nov – Wed 2 Dec')
    expect(endForSpan('2026-11-21', 0)).toBeNull()
    expect(endForSpan('2026-11-21', 2.5)).toBeNull()
  })
})

describe('date arithmetic and ticket dates', () => {
  it('moves whole days across month, year and leap-day edges', () => {
    expect(addIsoDays('2026-11-30', 2)).toBe('2026-12-02')
    expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addIsoDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addIsoDays('2026-02-30', 1)).toBeNull()
    expect(isoDayOf(at(2026, 3, 5))).toBe('2026-03-05')
  })

  it('formats the ticket range with one month name, or two across a month end', () => {
    expect(dateRangeLabel('2026-11-21', '2026-11-23')).toBe('21–23 Nov')
    expect(dateRangeLabel('2026-11-30', '2026-12-02')).toBe('30 Nov – 2 Dec')
    expect(dateRangeLabel('2026-11-21', '2026-11-21')).toBe('21 Nov')
    expect(dateRangeLabel('not-a-date', '2026-11-21')).toBe('')
  })
})

describe('party size', () => {
  it('clamps to one to twenty whole people', () => {
    expect(clampParty(0)).toBe(1)
    expect(clampParty(-3)).toBe(1)
    expect(clampParty(1)).toBe(1)
    expect(clampParty(4.4)).toBe(4)
    expect(clampParty(4.6)).toBe(5)
    expect(clampParty(PARTY_MAX)).toBe(20)
    expect(clampParty(21)).toBe(20)
    expect(clampParty(Number.NaN)).toBe(1)
    expect(clampParty(Number.POSITIVE_INFINITY)).toBe(1)
  })
})

describe('ticket lines', () => {
  it('shows Free or the real price, and omits a price it cannot read', () => {
    expect(planLine(undefined)).toEqual({ kind: 'free' })
    expect(planLine(null)).toEqual({ kind: 'free' })
    expect(planLine(0)).toEqual({ kind: 'free' })
    expect(planLine(199)).toEqual({ kind: 'price', inr: 199 })
    expect(planLine(Number.NaN)).toBeNull()
    expect(planLine(-5)).toBeNull()
  })

  it('keeps the stored per-head estimate as it is, and omits an unknown one', () => {
    expect(headEstimateInr(18000)).toBe(18000)
    expect(headEstimateInr(0)).toBeNull()
    expect(headEstimateInr(undefined)).toBeNull()
    expect(headEstimateInr(Number.NaN)).toBeNull()
    expect(headEstimateInr(-1)).toBeNull()
  })
})

describe('applying a plan to the copy', () => {
  const source = { id: 't1', startDate: '2026-11-01', endDate: '2026-11-05', travellers: 2, startLocation: 'Kochi', days: [] } as unknown as Trip

  it('moves the start, keeps the route span, and sets the party without touching the source', () => {
    const copy = applyForkPlan(source, { startDate: '2026-11-21', travellers: 4, startTown: 'Kochi' })
    expect(copy).toMatchObject({ startDate: '2026-11-21', endDate: '2026-11-25', travellers: 4, startLocation: 'Kochi' })
    expect(source.startDate).toBe('2026-11-01')
    expect(source.travellers).toBe(2)
  })

  it('keeps the dates when the source has no usable span, and still applies the party', () => {
    const broken = { ...source, startDate: '', endDate: '' } as Trip
    const copy = applyForkPlan(broken, { startDate: '2026-11-21', travellers: 30, startTown: null })
    expect(copy).toMatchObject({ startDate: '', endDate: '', travellers: 20 })
  })
})

describe('plan through sign-in', () => {
  it('keeps the answers for the same route and gives nothing to another route', () => {
    rememberFork('pub_weekend', { source: 'creator', campaign: null, plan: { startDate: '2026-11-21', travellers: 4, startTown: 'Kochi' } })
    expect(takeForkAttribution('pub_other', false)).toBeNull()
    expect(takeForkAttribution('pub_weekend', false)).toEqual({
      source: 'creator', campaign: null, plan: { startDate: '2026-11-21', travellers: 4, startTown: 'Kochi' },
    })
    expect(takeForkAttribution('pub_weekend')?.plan?.travellers).toBe(4)
    expect(takeForkAttribution('pub_weekend')).toBeNull()
  })

  it('leaves the plan key out when there is no plan, so older callers see the same shape', () => {
    rememberFork('pub_plain', { source: 'creator', campaign: null })
    const back = takeForkAttribution('pub_plain')
    expect(back).toEqual({ source: 'creator', campaign: null })
    expect(back && 'plan' in back).toBe(false)
  })

  it('drops a stored plan that fails validation', () => {
    storage.set('yf.pending-publication-fork', JSON.stringify({
      pubId: 'pub_bad', source: 'creator', campaign: null, at: Date.now(), plan: { startDate: 'soon', travellers: 4 },
    }))
    const back = takeForkAttribution('pub_bad', false)
    expect(back).not.toBeNull()
    expect(back && 'plan' in back).toBe(false)
    expect(sanitizeForkPlan({ startDate: 'soon', travellers: 4 })).toBeNull()
  })
})

describe('sanitizeForkPlan', () => {
  it('normalises a stored date, clamps the party and trims the town', () => {
    expect(sanitizeForkPlan({ startDate: '2026-11-21T08:00', travellers: 99, startTown: '  Kochi  ' }))
      .toEqual({ startDate: '2026-11-21', travellers: 20, startTown: 'Kochi' })
    expect(sanitizeForkPlan({ startDate: '2026-11-21', travellers: 3, startTown: '   ' }))
      .toEqual({ startDate: '2026-11-21', travellers: 3, startTown: null })
    expect(sanitizeForkPlan(null)).toBeNull()
    expect(sanitizeForkPlan({ startDate: '2026-11-21' })).toBeNull()
  })
})
