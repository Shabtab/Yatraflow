// ============ #381 — pacing copy tells the truth about its basis ============
//
// Three defects pinned here: (1) once the trip was over the tile showed the
// whole lump remainder under a per-day label; (2) a budget-less trip was
// lectured as overspent — red −₹total, a "₹0 group target" hero and a Trim
// action that trimmed toward nothing; (3) the copy implied cash while the dial
// reads the planning estimate (settled payments never reach it).
//
// Product decision recorded on the issue (2026-09-25): RELABEL TO ESTIMATE
// HEADROOM. The dial keeps feeding on the planning estimate, settled payments
// are NOT plumbed in, and every copy surface names the basis instead. The
// zero-days lump label and the zero-budget degenerate state land with it.
//
// Tests are node-env with no DOM, so the page half is pinned by
// source-scanning guards over the component — they are written so each one
// FAILS on the pre-fix source (the old strings are asserted absent, the new
// ones present, and the new literals are deliberately spelled out of the
// component's comments so prose can't satisfy them).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'
import { daysRemaining, safeToSpendPerDay } from '../src/lib/engine'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const base = { ...structuredClone(seedData.trips[0]), budgetPerPersonInr: 5000, travellers: 2 } as Trip
const target = base.budgetPerPersonInr * base.travellers
const len = base.days.length

describe('#381 — the resolver keeps its honest edges (and the lump is the lump)', () => {
  it('zero days left: the figure is the WHOLE remaining lump, not a daily rate', () => {
    const after = new Date(new Date(base.endDate + 'T12:00:00').getTime() + 86400000)
    const p = safeToSpendPerDay(base, 3000, after)
    expect(p).not.toBeNull()
    expect(p!.daysLeft).toBe(0)
    // target − spent, undivided — the fraction the old label passed off as
    // "per day". Finite, so the tile can print it.
    expect(p!.perDayInr).toBe(target - 3000)
    expect(Number.isFinite(p!.perDayInr)).toBe(true)
  })

  it('zero days left AND overspent: the lump is negative and still a number', () => {
    const after = new Date(new Date(base.endDate + 'T12:00:00').getTime() + 86400000)
    const p = safeToSpendPerDay(base, target + 2500, after)
    expect(p!.daysLeft).toBe(0)
    expect(p!.perDayInr).toBe(-2500)
    expect(Number.isFinite(p!.perDayInr)).toBe(true)
  })

  it('days left: the lump divided by them, per person over travellers', () => {
    const before = new Date(base.startDate + 'T00:00:00')
    before.setDate(before.getDate() - 1)
    const p = safeToSpendPerDay(base, 1000, before)
    expect(p!.daysLeft).toBe(len)
    expect(p!.perDayInr).toBe((target - 1000) / len)
    expect(p!.perPersonPerDayInr).toBeCloseTo((target - 1000) / len / 2, 4)
  })

  it('no target, or an unreadable spend figure: no number is invented', () => {
    const noBudget = { ...base, budgetPerPersonInr: 0 } as Trip
    expect(safeToSpendPerDay(noBudget, 500)).toBeNull()
    expect(safeToSpendPerDay(base, Number.NaN)).toBeNull()
    expect(safeToSpendPerDay(base, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('dirty dates clamp to the full day count, never NaN', () => {
    const dirty = { ...base, startDate: '??', endDate: '??' } as unknown as Trip
    expect(daysRemaining(dirty)).toBe(len)
    // Noon on the end date is still the final day — today counts.
    expect(daysRemaining(base, new Date(base.endDate + 'T12:00:00'))).toBe(1)
    // A day past the end is over.
    expect(daysRemaining(base, new Date(new Date(base.endDate + 'T12:00:00').getTime() + 86400000))).toBe(0)
  })
})

describe('#381 — the tab speaks estimate headroom, not cash', () => {
  const src = read('../src/pages/trip/BudgetTab.tsx')
  const ws = read('../src/pages/TripWorkspace.tsx')

  it('the daily tile names its basis — headroom of the estimate, not spent cash', () => {
    expect(src).toMatch(/label="Budget headroom \/ day"/)
    expect(src).toMatch(/of the estimate/)
    // The cash-implying labels are gone from the surface entirely.
    expect(src).not.toMatch(/Safe to spend/)
    expect(src).not.toMatch(/Spent of target/)
  })

  it('zero days left renders under a lump label, never the per-day headline', () => {
    expect(src).toMatch(/pacing\.daysLeft === 0/)
    // The lump label has no slash suffix — the per-day headline must not be
    // reachable in that branch.
    expect(src).toMatch(/label="Budget headroom"\n/)
    expect(src).toMatch(/the whole lump, not a daily rate/)
    // Both signs of the lump have wording of their own.
    expect(src).toMatch(/left<\/>/)
    expect(src).toMatch(/over<\/>/)
  })

  it('a budget-less trip gets the degenerate state, not a scolding hero', () => {
    // The hero (and its Trim action and bar) render only against a real target.
    expect(src).toMatch(/\{hasTarget \? \(/)
    expect(src).toMatch(/Estimate so far/)
    expect(src).toMatch(/Set a per-person target to start pacing/)
    // The strip's target-relative tiles say "none set" instead of printing a
    // red negative or a +% over zero.
    expect(src).toMatch(/no group target set/)
    expect(src).toMatch(/no per-person target yet/)
    expect(src).toMatch(/set a per-person target to measure/)
  })

  it('the ask links to Settings when the workspace can open them', () => {
    expect(src).toMatch(/onOpenSettings &&/)
    expect(src).toMatch(/onClick=\{onOpenSettings\}/)
    // TripWorkspace passes the tab switch; BudgetTab stays optional-prop.
    expect(ws).toMatch(/onOpenSettings=\{\(\) => setTab\('settings'\)\}/)
  })
})
