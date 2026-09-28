// ============ Create funnel: honesty helpers (#378) ============
// Three gaps where the create form silently did something other than what the
// user typed, all fixed by saying so instead:
//
//  1. The bill prices self-drive fuel only when BOTH economy and price parse
//     (tripStarter's `economy && price`); a one-sided or out-of-band input fell
//     back to the blended ₹/km table with no notice. Settings warns
//     `priceIgnored` for its half of this — Create now says the same thing,
//     with the actual blended rate named.
//  2. Pinned plans are indexed against the day count at add time and were never
//     re-validated when the dates changed — a shortened trip left rows pointing
//     at days that no longer exist. `revalidateCommitments` is the one policy,
//     applied centrally on the day-count change (not per widget), so the
//     calendar, a template and the day-out shapes all behave identically.
//  3. A commitment typed into the composer row but never "Add"ed was dropped at
//     submit without a word — the same honesty hole as unpicked stop text
//     (#375), and the same answer: block with the text named, never discard.
//
// Pure module: no react/network imports, node-testable (AGENTS §1).

import { MODE_COST_PER_KM, parseFuelEconomyKmL, parseFuelPricePerL } from './engine'

/**
 * The notice for a fuel block whose numbers the bill cannot use together.
 * Returns null when nothing needs saying: both fields empty, or both parsing.
 * One-sided and out-of-band inputs each get their own sentence — the point is
 * that the blended rate is billing, and the message names it.
 */
export function fuelFallbackNotice(mode: string, economyRaw: string, priceRaw: string): string | null {
  const rate = MODE_COST_PER_KM[mode] ?? MODE_COST_PER_KM.car
  const ecoTyped = economyRaw.trim() !== ''
  const priceTyped = priceRaw.trim() !== ''
  const eco = parseFuelEconomyKmL(economyRaw)
  const price = parseFuelPricePerL(priceRaw)
  const ecoBad = ecoTyped && eco == null
  const priceBad = priceTyped && price == null

  if (ecoBad && priceBad) {
    return `The mileage and fuel price you typed are both out of range, so the bill prices the blended ₹${rate}/km rate — fix or clear them.`
  }
  if (ecoBad) {
    return price != null
      ? `The mileage you typed is out of range, so the fuel math can't use it — the bill prices the blended ₹${rate}/km rate.`
      : `That mileage is out of range, and without a fuel price the bill prices the blended ₹${rate}/km rate anyway.`
  }
  if (priceBad) {
    return `The fuel price you typed is out of range (₹50–₹250 per litre), so the bill prices the blended ₹${rate}/km rate — fix or clear it.`
  }
  if (eco == null && price != null) {
    return `Your fuel price is unused until you set a mileage — the bill prices the blended ₹${rate}/km rate instead.`
  }
  if (eco != null && price == null) {
    return `Mileage alone doesn't set the rate — add a fuel price too, or the bill keeps the blended ₹${rate}/km.`
  }
  return null
}

/** The clamp policy's result: the rows that survive, plus what to say. */
export interface RevalidatedCommitments<T> {
  kept: T[]
  /** Rows whose day fell off the end and were moved to the last day. */
  movedCount: number
  /** Rows dropped under the drop policy (0 under clamp). */
  droppedCount: number
}

/**
 * Re-validate pinned plans against a NEW day count. CLAMP preserves what the
 * user typed (title, type, time all survive; the day moves to the last day)
 * and the toast makes the move loud — nothing is silent in either direction.
 * An invalid day count (0: dates missing or inverted) keeps every row — there
 * is no new span to validate against, and submit blocks on the dates anyway.
 */
export function revalidateCommitments<T extends { dayIndex: number }>(
  list: readonly T[],
  dayCount: number,
  policy: 'clamp' | 'drop' = 'clamp',
): RevalidatedCommitments<T> {
  if (!(dayCount >= 1)) return { kept: [...list], movedCount: 0, droppedCount: 0 }
  const kept: T[] = []
  let movedCount = 0
  let droppedCount = 0
  for (const row of list) {
    if (row.dayIndex < dayCount) {
      kept.push(row)
    } else if (policy === 'clamp') {
      kept.push({ ...row, dayIndex: dayCount - 1 })
      movedCount++
    } else {
      droppedCount++
    }
  }
  return { kept, movedCount, droppedCount }
}

/** What the clamp/drop toast says — singular for one, both counts when both. */
export function commitmentMoveMessage(moved: number, dropped = 0): string {
  const parts: string[] = []
  if (moved > 0) parts.push(`${moved} pinned plan${moved === 1 ? '' : 's'} moved to the last day`)
  if (dropped > 0) parts.push(`${dropped} dropped — their day no longer exists`)
  return parts.length ? `${parts.join('; ')}.` : ''
}

/**
 * The composer row's submit decision: a typed-but-unadded plan blocks the save
 * with the text named — the user either adds it or clears it, exactly the
 * contract #375 set for unpicked stop text. Whitespace is not a plan.
 */
export function composerRowError(title: string): string | null {
  const t = title.trim().replace(/\s+/g, ' ')
  if (!t) return null
  const shown = t.length > 48 ? `${t.slice(0, 47)}…` : t
  return `Add “${shown}” as a pinned plan — or clear the row.`
}

/**
 * The ticket's fuel line, built from the PARSED numbers the bill actually
 * uses — the old line printed raw strings, so non-numeric typing showed on
 * the ticket while the math ignored it. Each segment survives only when its
 * parse does; the tank segment needs the economy, because "km per tank" does.
 */
export function ticketFuelSegments(economyRaw: string, priceRaw: string, tankRaw: string): string[] {
  const segs: string[] = []
  const eco = parseFuelEconomyKmL(economyRaw)
  const price = parseFuelPricePerL(priceRaw)
  const tankNum = Number(String(tankRaw).trim())
  const tankOk = Number.isFinite(tankNum) && tankNum >= 5 && tankNum <= 300
  if (eco != null) segs.push(`${eco} km/L`)
  if (price != null) segs.push(`₹${price}/L`)
  if (eco != null && tankOk) segs.push(`${tankNum} L tank`)
  return segs
}
