// ============ Creator earnings projections (pre-payments) ============
// Payments don't exist yet (M7 · Razorpay). The only honest arithmetic
// available today is price × forks — "if every fork had bought the unlock".
// The UI labels this a projection; it is never money. When M7 lands, real
// payout rows replace the ledger's empty state and the fee constant below
// gets the real platform-fee model (see ARCHITECTURE.md "Creator earnings
// contract (M7)").
import type { PublishedItinerary } from '../data/types'

export interface ProjectedEarning {
  pubId: string
  title: string
  priceInr: number
  forks: number
  grossInr: number   // price × forks
  netInr: number     // gross − platform fee (0 until the fee model exists)
}

export interface EarningsProjection {
  rows: ProjectedEarning[]     // priciest potential first
  potentialInr: number         // Σ gross
  netInr: number               // Σ net
  unpricedCount: number        // live publications published as fully free
}

/** Projected platform fee until M7 defines the real one. */
export const PROJECTED_PLATFORM_FEE_INR = 0

export function projectEarnings(pubs: PublishedItinerary[]): EarningsProjection {
  const rows: ProjectedEarning[] = pubs
    .filter(p => (p.premiumPriceInr ?? 0) > 0)
    .map(p => {
      const grossInr = p.premiumPriceInr! * p.copies
      return { pubId: p.id, title: p.title, priceInr: p.premiumPriceInr!, forks: p.copies, grossInr, netInr: grossInr - PROJECTED_PLATFORM_FEE_INR }
    })
    .sort((a, b) => b.grossInr - a.grossInr)
  return {
    rows,
    potentialInr: rows.reduce((s, r) => s + r.grossInr, 0),
    netInr: rows.reduce((s, r) => s + r.netInr, 0),
    unpricedCount: pubs.filter(p => (p.premiumPriceInr ?? 0) === 0).length,
  }
}
