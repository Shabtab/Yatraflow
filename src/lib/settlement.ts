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
//  - The fair share is split across the ACCOUNTS (members), not the traveller
//    count (#548): a guardian account shoulders the share of the travellers
//    who have no account of their own. Balances are rows over members, so the
//    split and the rows must measure the same population or the card can
//    never net to zero.
//  - A per-person line is multiplied by the trip's TRAVELLER count — whoever
//    fronted it paid for every human, accounted or not — with a floor of 1 so
//    a 0/undefined head count cannot divide by zero. Only the split is per
//    account; the expansion follows travellers, so the card's total still
//    matches the expense table's group-total display.
//  - A payer who is not a member (stale row, removed crew member) sits
//    outside the card entirely (#548): openTaggedLines drops their lines, so
//    they feed neither the fair share nor a credit. A line whose credit
//    landed nowhere would strand its own share on the other rows and break
//    the net-zero sum again. The line still shows in the settle strip, where
//    it can be marked settled.
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

/** The fair share each account owes: the total divided across `splitAcross`
 *  shares, floored at 1 (#548: the balances card passes its member count, so
 *  a family of four travellers on two accounts splits the total two ways).
 *  Exported for the card's copy, which prints it even when balances are
 *  hidden. */
export function fairSharePerHead(splitAcross: number, totalCostInr: number): number {
  return totalCostInr / Math.max(1, splitAcross)
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
 * The population the balances measure: the OPEN lines whose payer is in the
 * crew. Settled lines are done, untagged ones sit in the shared kitty without
 * owing anybody anything, and a payer who has left the trip credits nobody —
 * #548: such a line must not feed the fair share either, or its unclaimed
 * credit strands the share on the remaining rows and the card stops netting
 * to zero. One predicate, both consumers (the balances and the card's "still
 * to square up" total), so the two figures can never disagree.
 */
export function openTaggedLines(expenses: Expense[], memberIds: ID[]): Expense[] {
  const inCrew = new Set(memberIds)
  return expenses.filter(e => !e.settled && e.paidBy != null && inCrew.has(e.paidBy))
}

/**
 * Per-member balances for a trip: everyone's fair share is the OPEN
 * crew-tagged lines' total split across the MEMBERS (floor 1), and those same
 * lines credit whoever fronted them. Per-person lines expand to the trip's
 * traveller count, not the member count — the money fronted is real either
 * way — while the split follows the accounts (#548), so a guardian account
 * shoulders the travellers who have no account of their own. Both sides of
 * the subtraction draw on one population with one expansion, so the balances
 * net to zero across the crew and the settlement transfers balance exactly;
 * settle every line and every row reads 0.
 *
 * `travellers` drives the per-person expansion only; the split ignores it.
 * Pass the trip's WHOLE expense list — settled and non-member lines are
 * filtered in here (I-19 and #548), never by the caller. Sorted richest-first
 * (the balances card's display order). `getUser` is an injected lookup so
 * this module never imports the store.
 */
export function computeBalances(
  members: { userId: ID }[],
  expenses: Expense[],
  travellers: number,
  getUser?: (id: ID) => User | undefined,
): BalanceRow[] {
  const heads = Math.max(1, travellers)
  const open = openTaggedLines(expenses, members.map(m => m.userId))
  const fairShare = fairSharePerHead(members.length, linesTotal(open, heads))
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
