// ============ Explore — price label ============
// The storefront's own figure, or the free claim. Both read from the
// publication; neither is derived from anything private. `premiumPriceInr` is
// the storefront's charge, and 0 or undefined means entirely free. It prints an
// exact figure, never a rounded one, and never a figure the catalog lacks.
// The grid card and the featured card both draw it.
import { Lock } from 'lucide-react'
import type { PublishedItinerary } from '../../data/types'
import { formatInr } from '../../lib/engine'

export function ExplorePriceTag({ pub }: { pub: Pick<PublishedItinerary, 'premiumPriceInr'> }) {
  const price = pub.premiumPriceInr ?? 0
  return (
    <span className={`ex-price-tag${price > 0 ? ' is-paid' : ''}`}>
      {price > 0 && <Lock size={12} aria-hidden />}
      {price > 0 ? formatInr(price) : 'Free'}
    </span>
  )
}
