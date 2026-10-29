// ============ Step 6 of the build: When, Who, Budget ============
// Three rules a reader cannot check from the rendered page: that the departure
// time is on When, that the drivers controls appear only on a driving trip, and
// that the Budget step asks a question and shows the group total. Source
// contracts, like the repo's other page pins (tests/ runs in node, AGENTS §1).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { stepOfError } from '../src/lib/createSteps'

const page = readFileSync('src/pages/CreateTrip.tsx', 'utf8').replace(/\r\n/g, '\n')

// File order is Where, When, How, Who, Budget. The step order is different; see
// tests/create-flow-where-how.test.ts for why these are read as ranges.
function block(from: string, to: string): string {
  const start = page.indexOf(from)
  expect(start, `no block starting at ${from}`).toBeGreaterThan(-1)
  const end = page.indexOf(to, start + from.length)
  expect(end, `no block ending at ${to}`).toBeGreaterThan(start)
  return page.slice(start, end)
}

const WHEN = '{/* ---- 3 - When ---- */}'
const HOW = '{/* ---- 2 - How:'
const WHO = '{/* ---- 4 - Who:'
const BUDGET = '{/* ---- Budget:'
const REFINE = '{/* ---- Refine:'

describe('When owns the departure time', () => {
  it('puts its error on When, where the control is', () => {
    // The schedule reads the value, but the field lives on When. An error that
    // points anywhere else opens a screen with nothing to fix on it.
    expect(stepOfError('dayStartTime')).toBe('when')
  })

  it('renders the departure field inside the When block', () => {
    const when = block(WHEN, HOW)
    expect(when).toContain('ct-day-start')
    expect(when).toContain('Departure time')
  })

  it('keeps the field labelled and hinted, not just a bare input', () => {
    const when = block(WHEN, HOW)
    // A time input with no label is a control a screen reader cannot name, and
    // the hint is where the 08:30 default is stated.
    expect(when).toMatch(/<label className="ct-lbl" htmlFor="ct-day-start">/)
    expect(when).toContain('id="ct-day-start-hint"')
  })
})

describe('Who shows the drivers controls only on a driving trip', () => {
  it('renders the drivers drawer inside the Who block', () => {
    const who = block(WHO, BUDGET)
    expect(who).toContain('adv-drawer')
  })

  it('gates the drawer on the driving policy, not on the mode string', () => {
    // One shared answer (transportPolicy) decides every driving surface. A mode
    // check here would drift the first time a mode changed.
    const who = block(WHO, BUDGET)
    expect(who).toMatch(/drivingPolicy\.showsDrivingControls && \([\s\S]{0,200}adv-drawer/)
  })

  it('gates the vulnerable-traveller switch the same way', () => {
    const who = block(WHO, BUDGET)
    expect(who).toMatch(/drivingPolicy\.showsDrivingControls && \([\s\S]{0,300}Drivers sharing the wheel/)
  })
})

describe('Budget asks a question and shows both numbers', () => {
  it('compares the chosen target with the current plan estimate', () => {
    expect(page).toContain('const suggestedBudget = suggestedBudgetTarget(bill.perHead)')
    expect(block(BUDGET, REFINE)).toContain('budgetTargetMessage(f.budgetPerPersonInr, bill.perHead)')
  })

  it('disables an unavailable estimate and describes the shortcut', () => {
    const budget = block(BUDGET, REFINE)
    expect(budget).toContain('disabled={suggestedBudget == null}')
    expect(budget).toContain("aria-describedby={createFunnelOn('budget') ? 'ct-budget-guidance' : undefined}")
    expect(budget).toContain('id="ct-budget-guidance"')
    expect(budget).toContain('if (suggestedBudget == null) return;')
  })

  it('asks the question rather than naming the field', () => {
    const budget = block(BUDGET, REFINE)
    expect(budget).toContain('What is your budget?')
    expect(budget).not.toContain('<h2>Budget per head</h2>')
  })

  it('shows the group total beside the per-person figure', () => {
    // A per-head number alone makes the traveller do the multiplication. Both
    // figures come from the same state, so they cannot disagree.
    const budget = block(BUDGET, REFINE)
    expect(budget).toContain('budgetPerPersonInr.toLocaleString')
    expect(budget).toMatch(/Group &#8377;\{\(f\.budgetPerPersonInr \* f\.travellers\)/)
  })

  it('keeps the exact-amount field, because a slider cannot say 13,750', () => {
    const budget = block(BUDGET, REFINE)
    expect(budget).toContain('exact amount')
    expect(budget).toContain('fieldRefs.current.budgetPerPersonInr')
  })
})

describe('the refine controls sit on Budget, where the price is decided', () => {
  it('gates the bed and style rows to the Budget step', () => {
    // Both change the PRICE, not the route, so they are not Review material.
    expect(page).toMatch(/<div className="ct-refine" hidden=\{guided && step !== 'budget'\}>/)
  })
})
