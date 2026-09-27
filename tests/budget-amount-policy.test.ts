// ============ #382 — one amount rule, spoken everywhere ============
//
// The bug this pins: negative, infinite and not-a-number amounts passed the
// capture form (a falsy check is the whole gate — '-5', '1e3' and 'Infinity'
// all walk through it), passed the store (every writer wrote what it was
// handed) and passed the codec (hydration mapped rows as read). One bad row
// then poisoned every figure on the Budget tab — ₹NaN totals, NaN% bars that
// collapse silently, an Infinity amount that read as a reassuring ₹0 a day —
// and the row was durable, surviving reloads and syncs.
//
// The rule is now ONE module (lib/expenseAmount), and every path speaks it.
// The teeth live where the old code failed: the codec drop, the settlement
// arithmetic, the pacing map and the compact formatter.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { allowedAmount, amountRefusal, amountVerdict } from '../src/lib/expenseAmount'
import { rowToTrip, tripToRow } from '../src/lib/tripRow'
import { computeTotals, formatInr, formatInrShort, safeToSpendPerDay } from '../src/lib/engine'
import { computeBalances, linesTotal } from '../src/lib/settlement'
import { seedData } from '../src/data/seed'
import type { Expense, Trip } from '../src/data/types'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const members = [{ userId: 'owner-1', role: 'owner' as const, joinedAt: 1 }]

const expense = (id: string, amountInr: number, extra: Partial<Expense> = {}): Expense => ({
  id, label: `Line ${id}`, category: 'activities', amountInr, ...extra,
})

describe('#382 — the rule itself', () => {
  it('refuses what used to poison the tab, and names why', () => {
    expect(amountVerdict(500)).toEqual({ ok: true, amountInr: 500 })
    for (const bad of [NaN, Infinity, -Infinity, -5, 0]) {
      const v = amountVerdict(bad)
      expect(v.ok, `${String(bad)} must be refused`).toBe(false)
      expect(allowedAmount(bad)).toBeNull()
      expect(amountRefusal(bad)).toBeTruthy()
    }
  })

  it('names each refusal distinctly', () => {
    expect(amountVerdict(NaN)).toEqual({ ok: false, reason: 'not-a-number' })
    expect(amountVerdict(Infinity)).toEqual({ ok: false, reason: 'not-finite' })
    expect(amountVerdict(-500)).toEqual({ ok: false, reason: 'negative' })
    expect(amountVerdict(0)).toEqual({ ok: false, reason: 'zero' })
    expect(amountRefusal(-500)).toMatch(/cannot be negative/)
    expect(amountRefusal(500)).toBeNull()
  })

  it('a non-number is not-a-number, not zero', () => {
    // The old falsy gate made every non-number look like a blank field; the
    // verdict keeps the two apart so the sentence can differ.
    expect(amountVerdict('500' as unknown as number).ok).toBe(false)
    expect(amountVerdict(undefined as unknown as number)).toEqual({ ok: false, reason: 'not-a-number' })
  })
})

describe('#382 — the codec drops what the writer refuses', () => {
  const tripWithPoison = (): Trip => {
    const base = structuredClone(seedData.trips[0])
    base.expenses = [
      expense('ok', 1200, { dayIndex: 0 }),
      expense('nan', NaN, { dayIndex: 0 }),
      expense('inf', Infinity, { dayIndex: 0 }),
      expense('neg', -800, { dayIndex: 0 }),
      expense('zero', 0, { dayIndex: 0 }),
    ]
    return base
  }

  it('a hand-poisoned row hydrates without its bad lines', () => {
    // Old behaviour: all five rows passed through untouched and the totals,
    // settlement math and pacing figure all consumed them.
    const row = tripToRow(tripWithPoison(), 'owner-1')
    const back = rowToTrip({ ...row, created_at: 1, updated_at: 2 }, members)
    expect(back.expenses.map(e => e.id)).toEqual(['ok'])
  })

  it('a clean row round-trips untouched', () => {
    const base = structuredClone(seedData.trips[0])
    base.expenses = [expense('a', 100), expense('b', 250, { perPerson: true })]
    const row = tripToRow(base, 'owner-1')
    const back = rowToTrip({ ...row, created_at: 1, updated_at: 2 }, members)
    expect(back.expenses).toEqual(base.expenses)
  })

  it('the real totals stay finite however corrupt the row is', () => {
    const totals = computeTotals(tripWithPoison())
    for (const v of [totals.totalCostInr, totals.costPerDayInr, totals.costPerPersonInr, totals.byDay[0]?.expensesInr]) {
      expect(Number.isFinite(v as number)).toBe(true)
    }
  })
})

describe('#382 — the money arithmetic cannot be poisoned', () => {
  const poison: Expense[] = [expense('a', 1000), expense('bad', NaN), expense('worse', Infinity), expense('neg', -50)]

  it('settlement totals stay finite (per-person expansion included)', () => {
    // The expansion multiplies raw — a NaN line used to NaN the whole sum.
    expect(Number.isFinite(linesTotal(poison, 3))).toBe(true)
    const rows = computeBalances(members, poison, 3)
    for (const r of rows) expect(Number.isFinite(r.bal)).toBe(true)
  })

  it('pacing never reads an unreadable spend as ₹0 a day', () => {
    const base = { days: seedData.trips[0].days, startDate: '2026-10-01', endDate: '2026-10-04', budgetPerPersonInr: 5000, travellers: 2 }
    // Old behaviour: { perDayInr: 0 } — a reassuring zero for a figure that
    // cannot be measured.
    expect(safeToSpendPerDay(base, Infinity)).toBeNull()
    expect(safeToSpendPerDay(base, NaN)).toBeNull()
    // A huge-but-finite blowout is still a real number and still prints.
    const blown = safeToSpendPerDay(base, 999999)
    expect(blown).not.toBeNull()
    expect(blown!.perDayInr).toBeLessThan(0)
    expect(Number.isFinite(blown!.perDayInr)).toBe(true)
    // No target is still its own honest null.
    expect(safeToSpendPerDay({ ...base, budgetPerPersonInr: 0 }, 1000)).toBeNull()
  })

  it('the formatters print an em dash, never ₹NaN', () => {
    // formatInr's guard is #369's, pinned here so it cannot regress;
    // formatInrShort's is new — a NaN fell through every comparison there.
    expect(formatInr(NaN)).toBe('—')
    expect(formatInr(Infinity)).toBe('—')
    expect(formatInrShort(NaN)).toBe('—')
    expect(formatInrShort(Infinity)).toBe('—')
    expect(formatInrShort(2500)).toBe('₹3k')
  })
})

describe('#382 — every path speaks the one module', () => {
  it('the store refuses on add, edit and undo-restore', () => {
    const store = read('../src/store/store.ts')
    expect(store.match(/amountVerdict\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(store.match(/amountRefusal\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('the codec and the settlement math filter through the same rule', () => {
    expect(read('../src/lib/tripRow.ts')).toMatch(/allowedAmount\(e\.amountInr\)/)
    expect(read('../src/lib/settlement.ts')).toMatch(/allowedAmount\(e\.amountInr\)/)
  })

  it('the capture form’s gate is the module, not a falsy check', () => {
    expect(read('../src/pages/trip/BudgetTab.tsx')).toMatch(/amountRefusal\(Number\(form\.amount\)\)/)
  })
})
