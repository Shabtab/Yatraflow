// ============ #829 — an expense edit tells the truth ============
//
// Two defects, one symptom. The Budget tab's inline editor announced "Expense
// updated" and closed no matter what, because `updateExpense` returned `void`
// and the editor could not tell an applied write from a refused one or from a
// line that no longer existed. The row then re-rendered from the store with the
// OLD figure — "the amount got permanent but the tab still shows old data".
//
// The second half is the patch itself: the editor used to send its WHOLE form,
// so every field the person never touched was re-asserted from a snapshot taken
// at mount. A newer version of the line — a collaborator's edit over realtime —
// was overwritten by stale values on the next save.
//
// The store half runs against the REAL store (seed data + the same Supabase
// stub the other store suites use), so "applied" means the line really changed
// and the totals really moved. The editor half is pinned by reading the source,
// because the editor is a React component and this suite runs in node with no
// DOM — the same choice budget-amount-policy.test.ts makes for the same reason.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { seedData } from '../src/data/seed'

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = () => {
    const builder: Record<string, unknown> = {}
    builder.update = () => builder
    builder.insert = () => builder
    builder.delete = () => builder
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.lt = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => resolve({ data: null, error: null })).then(res)
    return builder
  }
  return { isSupabaseConfigured: false, supabase: { from: () => makeBuilder() } }
})

import { addExpense, duplicateTrip, tripById, updateExpense, _setTripWriteDebounceMs } from '../src/store/store'
import { computeTotals } from '../src/lib/engine'
import type { Expense } from '../src/data/types'

_setTripWriteDebounceMs(0)

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let owner = 0
/** A trip with one known line on it, and that line. */
function tripWithLine(amountInr = 500): { tripId: string; line: Expense } {
  const trip = duplicateTrip(seedData.trips[0], `budget-owner-${++owner}`)
  addExpense(trip.id, { label: 'Probe line', category: 'food', amountInr } as Omit<Expense, 'id'>)
  const line = tripById(trip.id)!.expenses.find(e => e.label === 'Probe line')!
  return { tripId: trip.id, line }
}

const lineNow = (tripId: string, id: string) => tripById(tripId)!.expenses.find(e => e.id === id)!

describe('#829 — the store reports what it did', () => {
  it('an applied edit really changes the line and the totals', () => {
    const { tripId, line } = tripWithLine(500)
    const before = computeTotals(tripById(tripId)!).byCategory['food']

    const outcome = updateExpense(tripId, line.id, { amountInr: 900 })

    expect(outcome).toBe('applied')
    // Not just a return value: the row and the money both moved, so a caller
    // that trusts 'applied' is trusting something true.
    expect(lineNow(tripId, line.id).amountInr).toBe(900)
    expect(computeTotals(tripById(tripId)!).byCategory['food']).toBe((before ?? 0) + 400)
  })

  it('a refused amount is reported as refused, and the line is untouched', () => {
    for (const bad of [-5, 0, NaN, Infinity]) {
      const { tripId, line } = tripWithLine(500)
      expect(updateExpense(tripId, line.id, { amountInr: bad })).toBe('refused')
      expect(lineNow(tripId, line.id).amountInr, `${String(bad)} must not land`).toBe(500)
    }
  })

  it('a line that is no longer there is reported, not silently skipped', () => {
    const { tripId } = tripWithLine()
    // This is the case that used to close the editor and announce success on a
    // row that did not exist any more.
    expect(updateExpense(tripId, 'not-a-real-line', { amountInr: 100 })).toBe('no-such-line')
  })

  it('a patch without an amount passes through untouched', () => {
    const { tripId, line } = tripWithLine(500)
    expect(updateExpense(tripId, line.id, { label: 'Renamed' })).toBe('applied')
    expect(lineNow(tripId, line.id).label).toBe('Renamed')
    expect(lineNow(tripId, line.id).amountInr).toBe(500)
  })

  it('the return type is a verdict, not void', () => {
    const store = read('../src/store/store.ts')
    expect(store).toMatch(/export type ExpenseWriteOutcome = 'applied' \| 'refused' \| 'no-such-line'/)
    expect(store).toMatch(/export function updateExpense\([^)]*\): ExpenseWriteOutcome/)
  })
})

describe('#829 — the editor speaks only for a write that happened', () => {
  const tab = read('../src/pages/trip/BudgetTab.tsx')
  /** The ExpenseEditor's submit handler, bounded by the form it returns — a
   *  fixed-length slice silently truncated once the explanatory comment grew. */
  const submit = (() => {
    const from = tab.indexOf('function ExpenseEditor')
    return tab.slice(from, tab.indexOf('  return (', from))
  })()

  it('branches on the outcome instead of assuming success', () => {
    const outcomeAt = submit.indexOf('const outcome = updateExpense(')
    const successAt = submit.indexOf("toast('Expense updated')")
    expect(outcomeAt, 'the editor must capture the outcome').toBeGreaterThan(-1)
    expect(successAt, 'the editor still announces the save').toBeGreaterThan(outcomeAt)
    // Both non-applied paths must return BEFORE the success line, or they would
    // fall through into the false claim this issue is about.
    const refusedAt = submit.indexOf("if (outcome === 'refused') return")
    const missingAt = submit.indexOf("if (outcome === 'no-such-line')")
    expect(refusedAt).toBeGreaterThan(-1)
    expect(missingAt).toBeGreaterThan(-1)
    expect(refusedAt).toBeLessThan(successAt)
    expect(missingAt).toBeLessThan(successAt)
  })

  it('keeps the editor open when the write was refused', () => {
    const refusedAt = submit.indexOf("if (outcome === 'refused') return")
    const doneAt = submit.indexOf('onDone()')
    // The refusal returns before onDone, so the typed values survive as the retry.
    expect(refusedAt).toBeGreaterThan(-1)
    expect(doneAt).toBeGreaterThan(-1)
    expect(refusedAt).toBeLessThan(doneAt)
  })

  it('sends only the fields the person changed', () => {
    expect(tab).toMatch(/function changedFields\(form: FormState, baseline: Expense\)/)
    // The editor must measure against the line it OPENED with, not the live
    // prop: diffing against a moved prop would resend the stale values.
    expect(tab).toMatch(/const openedWith = useRef\(expense\)/)
    expect(tab).toMatch(/changedFields\(form, openedWith\.current\)/)
    expect(tab).not.toMatch(/updateExpense\(trip\.id, expense\.id, patchOf\(form\)\)/)
  })

  it('an untouched field is absent from the patch, a cleared one is present', () => {
    // The rule, stated as the code it has to be: a field equal to the baseline
    // is skipped; a cleared field becomes undefined so the clear is expressible.
    const fn = tab.slice(tab.indexOf('function changedFields'), tab.indexOf('function PayerSelect'))
    expect(fn).toMatch(/if \(next\.amountInr !== baseline\.amountInr\) patch\.amountInr = next\.amountInr/)
    expect(fn).toMatch(/if \(next\.paidBy !== baseline\.paidBy\) patch\.paidBy = next\.paidBy/)
    expect(fn).toMatch(/if \(next\.stopId !== baseline\.stopId\) patch\.stopId = next\.stopId/)
  })
})
