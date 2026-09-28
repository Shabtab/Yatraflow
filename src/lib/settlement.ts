// Settlement math (M6 · B4) — the one part of the settle-up feature that is
// arithmetic rather than wiring, extracted from BudgetTab so it can carry unit
// tests (the store-action tests never reach this code). Pure: no store, no
// React, no dates — members in, balances and transfers out.
//
// Semantics (I-19 re-based the first one; the component and these tests moved
// with it):
//  - Fair share is the OPEN (unsettled) TAGGED lines split per head, and those
//    same lines credit whoever fronted them. Both sides come from one
//    population, so the balances net to zero and the settlement transfers
//    balance exactly. It used to be the whole trip estimate
//    (`totals.totalCostInr`), which made "mark settled" a pure record: the right
//    behaviour for a planner, the wrong one for settling up. The estimate still
//    lives in the Budget tab's metric strip, where a planning figure belongs.
//  - SETTLED lines are dropped in here rather than by the caller, so no call
//    site can quietly re-introduce them (the I-19 invariant, pinned by tests).
//  - Only lines TAGGED with a payer move a balance; untagged lines stay in the
//    shared kitty and move nobody — they are outside the fair share too.
//  - A per-person line is multiplied by the head count — whoever fronted it
//    paid for everyone — using the same floor of 1 as the division, so a
//    0/undefined head count cannot divide by zero.
//  - A payer who is not a member (stale row, removed crew member) credits
//    nobody: balances are computed over members only.
import type { Expense, ID, User } from '../data/types'
import { allowedAmount } from './expenseAmount'

export interface BalanceRow {
  id: ID
  user?: User
  /** Total amount this member fronted (tagged lines, perPerson expanded). */
  paid: number
  /** paid − fairShare. Positive = owed money; negative = owes. */
  bal: number
}

export interface Transfer {
  from: { id: ID; user?: User }
  to: { id: ID; user?: User }
  amount: number
}

/** The per-head fair share the balances are measured against (exported for the
 *  card's copy, which prints it even when balances are hidden). */
export function fairSharePerHead(travellers: number, totalCostInr: number): number {
  return totalCostInr / Math.max(1, travellers)
}

/** One line's credited amount: a per-person line covers the whole head count.
 *  #382: an amount the store would refuse counts as zero here rather than
 *  poisoning every balance — the rule is the writers' own
 *  (lib/expenseAmount), so the settlement math and the Budget tab can never
 *  disagree about what a line is worth. */
function lineAmount(e: Expense, heads: number): number {
  const amount = allowedAmount(e.amountInr)
  if (amount === null) return 0
  return e.perPerson ? amount * heads : amount
}

/** Total of a set of lines, with per-person amounts expanded. No policy of its
 *  own — callers choose the population (the card sums the settled history with
 *  this to print what has already left the balances). */
export function linesTotal(expenses: Expense[], travellers: number): number {
  const heads = Math.max(1, travellers)
  let total = 0
  for (const e of expenses) total += lineAmount(e, heads)
  return total
}

/**
 * The population the balances measure: the OPEN lines that have a payer.
 * Settled lines are done and untagged ones sit in the shared kitty without
 * owing anybody anything — neither belongs in a "who owes whom" figure. One
 * predicate, both consumers (the balances and the card's "still to square up"
 * total), so the two figures can never disagree.
 */
export function openTaggedLines(expenses: Expense[]): Expense[] {
  return expenses.filter(e => !e.settled && e.paidBy)
}

/**
 * Per-member balances for a trip: everyone's fair share is the OPEN tagged
 * lines' total split per head, and those same lines credit whoever fronted
 * them, with per-person lines expanded to the full head count. Because both
 * sides come from one population the balances net to zero across the crew and
 * the settlement transfers balance exactly; settle every line and every row
 * reads 0.
 *
 * Pass the trip's WHOLE expense list — settled lines are filtered in here
 * (I-19), never by the caller. Sorted richest-first (the balances card's
 * display order). `getUser` is an injected lookup so this module never imports
 * the store.
 */
export function computeBalances(
  members: { userId: ID }[],
  expenses: Expense[],
  travellers: number,
  getUser?: (id: ID) => User | undefined,
): BalanceRow[] {
  const heads = Math.max(1, travellers)
  const open = openTaggedLines(expenses)
  const fairShare = fairSharePerHead(heads, linesTotal(open, heads))
  const paid = new Map<ID, number>()
  for (const e of open) {
    paid.set(e.paidBy as ID, (paid.get(e.paidBy as ID) ?? 0) + lineAmount(e, heads))
  }
  return members
    .map(m => ({
      id: m.userId,
      user: getUser?.(m.userId),
      paid: paid.get(m.userId) ?? 0,
      bal: (paid.get(m.userId) ?? 0) - fairShare,
    }))
    .sort((a, b) => b.bal - a.bal)
}

/**
 * Greedy fewest-transfers settlement: richest creditor meets biggest debtor
 * until everyone is even. The ±0.5 threshold is the rounding tolerance —
 * sub-50-paise residues (float dust from the per-head split) are treated as
 * settled rather than minting a 1-paise transfer. Rows are copied before
 * mutating; the input is never touched.
 *
 * Note on the returned transfers: `from`/`to` are references into the copied
 * working rows, so by the time the loop finishes their `bal` carries the
 * POST-settlement residual (≈ 0), not the balance the row started with. No
 * caller reads `bal` off a transfer today — the card renders `user` and
 * `amount` — but treat `from.bal`/`to.bal` as scratch, not data.
 */
export function settleBalances(balances: BalanceRow[]): Transfer[] {
  const creditors = balances.filter(b => b.bal > 0.5).map(b => ({ ...b })).sort((a, b) => b.bal - a.bal)
  const debtors = balances.filter(b => b.bal < -0.5).map(b => ({ ...b })).sort((a, b) => a.bal - b.bal)
  const out: Transfer[] = []
  let ci = 0, di = 0
  while (ci < creditors.length && di < debtors.length) {
    const amt = Math.min(creditors[ci].bal, -debtors[di].bal)
    out.push({ from: debtors[di], to: creditors[ci], amount: amt })
    creditors[ci].bal -= amt
    debtors[di].bal += amt
    if (creditors[ci].bal <= 0.5) ci++
    if (-debtors[di].bal <= 0.5) di++
  }
  return out
}
