// ============ Sharing what you bought (ROADMAP I-21) ============
// Buyers are the distribution channel (research §4.5), so a purchase needs an
// artifact its owner will voluntarily circulate — and one place to produce it,
// because two surfaces offer it (the shelf, and the moment right after paying)
// and the fallback chain is the part that is easy to get inconsistent.
//
// The card itself is the SERVER's job: `api/i.js` renders the "I bought …"
// framing only when `owns_publication` confirms the entitlement is for that
// publication. This module just builds the address, hands it to the system
// share sheet, and falls back to the clipboard — the same share-then-copy shape
// ShareTab uses for a snapshot link.
//
// The web Share API being present or absent decides which path runs, not which
// link is produced: both carry the entitlement, so a copy pasted by hand
// previews exactly like a shared one.

import { nativeCopyText, nativeShareText } from './native'
import { currentBuyerShareUrl, purchaseShareMessage, withShareRef } from './shareUrl'
import { toast } from '../components/ui'

/** What sharing needs from a purchase. Deliberately not the whole
 *  `PurchaseRow`: the shelf's own rules (is the plan still listed) belong to
 *  the shelf, not to the mechanics of handing a link to the OS. */
export interface ShareablePurchase {
  pubId: string
  entitlementId: string
  title: string
}

/** Offer the buyer's card to the system share sheet, falling back to the
 *  clipboard where no sheet exists (most desktops). Resolves true when the link
 *  actually went somewhere the buyer can paste it. */
export async function sharePurchase(purchase: ShareablePurchase): Promise<boolean> {
  // #230 — the buyer's card is its own attribution channel: whatever transport
  // carries it (share sheet or clipboard), the link inside says `ref=buyer`.
  const url = withShareRef(currentBuyerShareUrl(purchase.pubId, purchase.entitlementId), 'buyer')
  const text = purchaseShareMessage(purchase.title, url)
  // `nativeShareText` never throws: 'unavailable' covers a dismissed sheet on
  // some platforms as well as a browser without the API, so the clipboard
  // fallback is also what keeps a slow dismissal from looking like a failure.
  if (await nativeShareText({ text, title: purchase.title, url }) === 'shared') return true
  const copied = await nativeCopyText(url)
  toast(copied
    ? 'Purchase link copied — when you paste it, the card says what you bought'
    : 'Could not copy the link — open the plan and copy its address.')
  return copied
}
