// ============ M6 · B4 — settlement math (pure extraction) ============
// The balances card and the greedy fewest-transfers settlement live in
// src/lib/settlement.ts; the store-action tests (m6-together.test.ts) cover
// the persistence wiring but never reach this arithmetic — this file is its
// only coverage. I-19 re-based the balances onto the OPEN tagged lines, so
// settling a line now genuinely removes it; the I-19 cases below are the
// regression guard for that. #548 moved the split from the traveller count to
// the members themselves and dropped non-member payers from the population,
// so the net-zero claim now holds even when the two counts diverge — the
// invariant cases at the bottom pin it. See the module header in settlement.ts.
import { describe, it, expect } from 'vitest'
import { computeBalances, settleBalances, fairSharePerHead, linesTotal, openTaggedLines } from '../src/lib/settlement'
import type { BalanceRow } from '../src/lib/settlement'
import type { User } from '../src/data/types'

const user = (id: string, name: string): User => ({
  id,
  email: `${id}@example.com`,
  profile: { name, avatarEmoji: '🙂' },
} as unknown as User)

describe('computeBalances', () => {
  const members = [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }]

  it('measures the OPEN tagged lines, split evenly as the fair share', () => {
    // 30_000 across 3 travellers → 10_000 each, and 'a' fronted all of it.
    const expenses = [{ id: 'e1', paidBy: 'a', amountInr: 30_000 }] as never[]
    const rows = computeBalances(members, expenses, 3)
    expect(rows.find(r => r.id === 'a')!.bal).toBe(20_000)
    expect(rows.find(r => r.id === 'b')!.bal).toBe(-10_000)
    expect(rows.find(r => r.id === 'c')!.bal).toBe(-10_000)
  })

  it('nets to zero across the crew (so the transfers have nothing left over)', () => {
    const expenses = [{ id: 'e1', paidBy: 'a', amountInr: 30_000 }] as never[]
    const rows = computeBalances(members, expenses, 3)
    expect(rows.reduce((s, r) => s + r.bal, 0)).toBeCloseTo(0, 6)
  })

  it('no lines yet → nobody owes anybody anything', () => {
    expect(computeBalances(members, [], 3).map(r => r.bal)).toEqual([0, 0, 0])
  })

  it('credits tagged lines to their payer', () => {
    const expenses = [
      { id: 'e1', paidBy: 'a', amountInr: 6_000 },
      { id: 'e2', paidBy: 'a', amountInr: 4_000 },
    ] as never[]
    // 10_000 of open lines over 3 heads; 'a' fronted all 10_000, so a is up
    // and b/c are down by the per-head share.
    const rows = computeBalances(members, expenses, 3)
    expect(rows.find(r => r.id === 'a')!.paid).toBe(10_000)
    expect(rows.find(r => r.id === 'a')!.bal).toBeCloseTo(10_000 - 10_000 / 3, 6)
    expect(rows.find(r => r.id === 'b')!.bal).toBeCloseTo(-10_000 / 3, 6)
  })

  it('I-19: a SETTLED line genuinely leaves the balances', () => {
    // e2 is squared up, so it is gone from BOTH sides — the fair share is the
    // 30_000 still open, and b's 6_000 credit is not counted at all.
    const expenses = [
      { id: 'e1', paidBy: 'a', amountInr: 30_000 },
      { id: 'e2', paidBy: 'b', amountInr: 6_000, settled: { by: 'a', at: 1 } },
    ] as never[]
    const rows = computeBalances(members, expenses, 3)
    expect(rows.find(r => r.id === 'b')!.paid).toBe(0)
    expect(rows.find(r => r.id === 'b')!.bal).toBe(-10_000)
    expect(rows.find(r => r.id === 'a')!.bal).toBe(20_000)
  })

  it('I-19: settling every line zeroes the card', () => {
    const settled = { by: 'a', at: 1 }
    const expenses = [
      { id: 'e1', paidBy: 'a', amountInr: 30_000, settled },
      { id: 'e2', paidBy: 'b', amountInr: 6_000, settled },
    ] as never[]
    expect(computeBalances(members, expenses, 3).map(r => r.bal)).toEqual([0, 0, 0])
  })

  it('expands a per-person line to the full head count', () => {
    // 2 travellers, per-person line of 2_000 → 'a' fronted 4_000, and the fair
    // share is that same 4_000 over the 2 heads.
    const expenses = [{ id: 'e1', paidBy: 'a', amountInr: 2_000, perPerson: true }] as never[]
    const rows = computeBalances(members.slice(0, 2), expenses, 2)
    expect(rows.find(r => r.id === 'a')!.paid).toBe(4_000)
    expect(rows.find(r => r.id === 'a')!.bal).toBe(2_000)
    expect(rows.find(r => r.id === 'b')!.bal).toBe(-2_000)
  })

  it('untagged lines stay in the shared kitty — no credit and no fair share', () => {
    const expenses = [{ id: 'e1', amountInr: 5_000 }] as never[]
    const rows = computeBalances(members, expenses, 3)
    expect(rows.every(r => r.paid === 0)).toBe(true)
    expect(rows.every(r => r.bal === 0)).toBe(true)
  })

  it('a payer who is not a member credits nobody, and owes nobody (#548)', () => {
    // The ghost line is outside the fair share too, so the card still nets to
    // zero — the old code made every member owe a share of it.
    const expenses = [{ id: 'e1', paidBy: 'ghost', amountInr: 9_000 }] as never[]
    const rows = computeBalances(members, expenses, 3)
    expect(rows.every(r => r.paid === 0)).toBe(true)
    expect(rows.every(r => r.bal === 0)).toBe(true)
  })

  it('a 0 head count cannot divide by zero (floor of 1 traveller)', () => {
    // Expansion floors at 1 head — a per-person line counts once — and the
    // split floors at the member count. Nothing is NaN, and the crew nets to
    // zero.
    const expenses = [{ id: 'e1', paidBy: 'a', amountInr: 1_000, perPerson: true }] as never[]
    const rows = computeBalances(members, expenses, 0)
    expect(rows.find(r => r.id === 'a')!.paid).toBe(1_000)
    expect(rows.every(r => Number.isFinite(r.bal))).toBe(true)
    expect(rows.reduce((s, r) => s + r.bal, 0)).toBeCloseTo(0, 6)
  })

  it('sorts richest-first for the balances card', () => {
    const expenses = [
      { id: 'e1', paidBy: 'a', amountInr: 15_000 },
      { id: 'e2', paidBy: 'b', amountInr: 0 },
    ] as never[]
    const rows = computeBalances(members, expenses, 3)
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(rows[0].bal).toBeGreaterThanOrEqual(rows[rows.length - 1].bal)
  })

  it('resolves users through the injected lookup', () => {
    const rows = computeBalances(members, [], 3, id => user(id, `User ${id}`))
    expect(rows[0].user?.profile.name).toBe('User a')
  })
})

describe('openTaggedLines / linesTotal', () => {
  const settled = { by: 'a', at: 1 }

  it('keeps only the open lines whose payer is in the crew', () => {
    const expenses = [
      { id: 'e1', paidBy: 'a', amountInr: 1_000 },
      { id: 'e2', amountInr: 2_000 },
      { id: 'e3', paidBy: 'b', amountInr: 3_000, settled },
      { id: 'e4', paidBy: 'ghost', amountInr: 4_000 },
    ] as never[]
    // #548: a payer who has left the trip is outside the balances population.
    expect(openTaggedLines(expenses, ['a', 'b']).map(e => e.id)).toEqual(['e1'])
  })

  it('linesTotal expands per-person lines to the head count', () => {
    const expenses = [
      { id: 'e1', amountInr: 1_000 },
      { id: 'e2', amountInr: 1_000, perPerson: true },
    ] as never[]
    expect(linesTotal(expenses, 3)).toBe(4_000)
    // Floor of 1: a 0/undefined head count expands to one head, never to zero.
    expect(linesTotal(expenses, 0)).toBe(2_000)
  })

  it('is the figure the card measures and the nudge prints (they cannot drift)', () => {
    const expenses = [
      { id: 'e1', paidBy: 'a', amountInr: 30_000 },
      { id: 'e2', paidBy: 'b', amountInr: 6_000, settled },
    ] as never[]
    // The settled 6_000 is outside the open population, so the share comes off
    // the 30_000 alone — and every row is its own credits minus that share.
    expect(fairSharePerHead(2, linesTotal(openTaggedLines(expenses, ['a', 'b']), 2))).toBe(15_000)
    const rows = computeBalances([{ userId: 'a' }, { userId: 'b' }], expenses, 2)
    expect(rows.map(r => r.bal)).toEqual([15_000, -15_000])
  })
})

describe('settleBalances', () => {
  const row = (id: string, bal: number, name?: string): BalanceRow => ({ id, bal, user: name ? user(id, name) : undefined })

  it('settles a single debtor→creditor pair for the exact amount', () => {
    const transfers = settleBalances([row('a', 500), row('b', -500)])
    expect(transfers).toEqual([
      { from: expect.objectContaining({ id: 'b' }), to: expect.objectContaining({ id: 'a' }), amount: 500 },
    ])
  })

  it('netting: a mid-position member neither pays nor receives', () => {
    // a is owed 500, b owes 500 directly to a, c is even.
    const transfers = settleBalances([row('a', 500), row('b', -500), row('c', 0)])
    expect(transfers).toHaveLength(1)
    expect(transfers[0].from.id).toBe('b')
    expect(transfers[0].to.id).toBe('a')
  })

  it('balances 3-way debt with the fewest transfers (2, not 3)', () => {
    // b and c each owe 1_000; a fronted everything.
    const transfers = settleBalances([row('a', 2_000), row('b', -1_000), row('c', -1_000)])
    expect(transfers).toHaveLength(2)
    const totalToA = transfers.filter(t => t.to.id === 'a').reduce((s, t) => s + t.amount, 0)
    expect(totalToA).toBe(2_000)
  })

  it('splits a big debtor across two creditors', () => {
    // a and b are each owed 600; c owes 1_200 → two transfers from c.
    const transfers = settleBalances([row('a', 600), row('b', 600), row('c', -1_200)])
    expect(transfers).toHaveLength(2)
    expect(transfers.every(t => t.from.id === 'c')).toBe(true)
    expect(transfers.map(t => t.amount).sort((x, y) => y - x)).toEqual([600, 600])
  })

  it('treats float dust (< 0.5) as settled — no 1-paise transfers', () => {
    // 10_000 split 3 ways leaves a repeating residue; settle must not mint a
    // transfer for fractions of a paise.
    const rows = [
      row('a', 0.1),
      row('b', -0.07),
      row('c', -0.03),
    ]
    expect(settleBalances(rows)).toEqual([])
  })

  it('does not mutate the input rows', () => {
    const input = [row('a', 500), row('b', -500)]
    const before = JSON.stringify(input)
    settleBalances(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('returns nothing when everyone is even', () => {
    expect(settleBalances([row('a', 0), row('b', 0)])).toEqual([])
  })
})

// ============ #548 — the net-zero invariant when members ≠ travellers ========
// computeBalances used to divide the fair share by `travellers` while summing
// rows over `members` only, so any divergence stranded a residual no transfer
// could settle. The split now follows the members and non-member payers sit
// outside the population — these cases are the issue's verification: the sum
// is zero for random shapes, and the transfers leave every row even.
describe('#548 — the balances net to zero whatever the head count', () => {
  // Deterministic LCG so a failure reproduces exactly on every run.
  let seed = 548
  const rand = (): number => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296
    return seed / 4_294_967_296
  }
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!

  it('family shape: 4 travellers, 2 accounts — each account shoulders the kids', () => {
    // ₹40,000 tagged to 'a': the share is ₹20,000 per account, not ₹10,000 per
    // head — the old travellers split left ₹20,000 stranded on the card.
    const expenses = [{ id: 'e1', paidBy: 'a', amountInr: 40_000 }] as never[]
    const rows = computeBalances([{ userId: 'a' }, { userId: 'b' }], expenses, 4)
    expect(rows.find(r => r.id === 'a')!.bal).toBe(20_000)
    expect(rows.find(r => r.id === 'b')!.bal).toBe(-20_000)
    expect(rows.reduce((s, r) => s + r.bal, 0)).toBeCloseTo(0, 6)
    expect(settleBalances(rows)).toEqual([
      { from: expect.objectContaining({ id: 'b' }), to: expect.objectContaining({ id: 'a' }), amount: 20_000 },
    ])
  })

  it('a per-person line still expands to the TRAVELLER count, not the accounts', () => {
    // ₹2,000 per person across 4 travellers is ₹8,000 of real money fronted by
    // 'a'. The split is over the 2 accounts, so each share is ₹4,000 and 'a'
    // keeps the kids' half.
    const expenses = [{ id: 'e1', paidBy: 'a', amountInr: 2_000, perPerson: true }] as never[]
    const rows = computeBalances([{ userId: 'a' }, { userId: 'b' }], expenses, 4)
    expect(rows.find(r => r.id === 'a')!.paid).toBe(8_000)
    expect(rows.find(r => r.id === 'a')!.bal).toBe(4_000)
    expect(rows.find(r => r.id === 'b')!.bal).toBe(-4_000)
  })

  it('a non-member payer feeds neither side of the subtraction', () => {
    // Only the member line counts: the share is 4,000 per account over 2
    // accounts. The ghost's 9,000 would otherwise inflate every share.
    const expenses = [
      { id: 'e1', paidBy: 'ghost', amountInr: 9_000 },
      { id: 'e2', paidBy: 'a', amountInr: 8_000 },
    ] as never[]
    const rows = computeBalances([{ userId: 'a' }, { userId: 'b' }], expenses, 4)
    expect(rows.find(r => r.id === 'a')!.bal).toBe(4_000)
    expect(rows.find(r => r.id === 'b')!.bal).toBe(-4_000)
    expect(rows.reduce((s, r) => s + r.bal, 0)).toBeCloseTo(0, 6)
  })

  it('random shapes: the rows sum to zero and the transfers leave every row even', () => {
    for (let round = 0; round < 60; round++) {
      const travellers = Math.floor(rand() * 7) // 0..6, deliberately unequal to the members
      const crewIds = ['a', 'b', 'c', 'd'].slice(0, 1 + Math.floor(rand() * 4))
      const members = crewIds.map(id => ({ userId: id }))
      const expenses = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) => ({
        id: `e${i}`,
        paidBy: pick([...crewIds, 'ghost']),
        amountInr: 1 + Math.floor(rand() * 50_000),
        perPerson: rand() < 0.3,
        settled: rand() < 0.2 ? { by: 'a', at: 1 } : undefined,
      })) as never[]
      const rows = computeBalances(members, expenses, travellers)
      expect(rows.reduce((s, r) => s + r.bal, 0), `round ${round}: rows must sum to zero`).toBeCloseTo(0, 6)
      const transfers = settleBalances(rows)
      // A debtor's bal is negative: paying RAISES it toward zero; the
      // creditor's bal falls. Applying either sign the other way doubles the
      // imbalance instead of closing it.
      const balAfter = new Map(rows.map(r => [r.id, r.bal]))
      for (const t of transfers) {
        balAfter.set(t.from.id, balAfter.get(t.from.id)! + t.amount)
        balAfter.set(t.to.id, balAfter.get(t.to.id)! - t.amount)
      }
      for (const id of crewIds) {
        expect(Math.abs(balAfter.get(id)!), `round ${round}: ${id} must be even`).toBeLessThanOrEqual(0.5 + 1e-9)
      }
    }
  })
})
