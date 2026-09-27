// ============ What an expense amount is allowed to be (#382) ============
//
// ONE rule, spoken by every path that can put a number on an expense line: the
// capture form, the store's writers, the row codec's hydration, the settlement
// arithmetic and the pacing figure. It used to be enforced nowhere — the form's
// gate was a falsy check (so '-5', '1e3' and 'Infinity' walked through), the
// native min= on the input is bypassable by typing, the store wrote whatever it
// was handed, and the codec passed rows through as read. The importer was the
// ONLY path that refused bad amounts, and nothing else spoke to it.
//
// One bad row then poisoned every figure on the Budget tab: ₹NaN totals, NaN%
// bars that collapse silently, an Infinity amount that read as a reassuring
// ₹0 a day — and the row was durable, surviving reloads and syncs.
//
// The rule is the importer's own, lifted so the two can never disagree: a
// persisted amount is a FINITE number of rupees ABOVE ZERO. Negatives are
// refused, never silently subtracted — this is a planning bill with no credit
// or refund concept, and a negative line is either a mistake or a feature
// nobody asked for; either way it says so or it does not persist. Zero stays
// unrepresentable, deliberately: a zero line adds no information to the plan,
// the form has always blocked it, and the importer would drop it on the way
// back in through a file.

export type AmountRefusal = 'not-a-number' | 'not-finite' | 'negative' | 'zero'

/** The verdict on a candidate amount — the ONE rule, as data. */
export function amountVerdict(amount: unknown): { ok: true; amountInr: number } | { ok: false; reason: AmountRefusal } {
  if (typeof amount !== 'number' || Number.isNaN(amount)) return { ok: false, reason: 'not-a-number' }
  if (!Number.isFinite(amount)) return { ok: false, reason: 'not-finite' }
  if (amount < 0) return { ok: false, reason: 'negative' }
  if (amount === 0) return { ok: false, reason: 'zero' }
  return { ok: true, amountInr: amount }
}

/** The amount a line may carry, or null when it may not carry one. */
export function allowedAmount(amount: unknown): number | null {
  const verdict = amountVerdict(amount)
  return verdict.ok ? verdict.amountInr : null
}

const REFUSALS: Record<AmountRefusal, string> = {
  'not-a-number': 'Enter an amount in rupees.',
  'not-finite': 'That is not a real amount — enter rupees.',
  negative: 'An amount cannot be negative — enter rupees to add the cost, or remove the line.',
  zero: 'Enter an amount above zero.',
}

/** The sentence a refusal says, in the form's own voice. Null when there is
 *  nothing to refuse. */
export function amountRefusal(amount: unknown): string | null {
  const verdict = amountVerdict(amount)
  return verdict.ok ? null : REFUSALS[verdict.reason]
}
