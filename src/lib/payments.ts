// ============ Payments rail (M7 · Premium) — pure domain logic ============
// Everything here is node-safe and side-effect free so the verify gate can
// pin it. The Supabase tables and the Vercel functions are the machinery;
// THIS file is the contract they all share:
//
//   1. The user clicks Unlock on a priced publication.
//   2. `POST /api/checkout` verifies the price SERVER-SIDE from the
//      published_itineraries row (never from the request body), creates a
//      Razorpay order, and writes a `purchase_orders` row.
//   3. Razorpay's checkout.js collects the payment; the browser then calls
//      `POST /api/payments-verify`, which checks Razorpay's HMAC signature,
//      marks the order paid and writes the `entitlements` row.
//   4. The webhook (`POST /api/payments-webhook`) is the crash-recovery path
//      for a user who closes the tab between steps 3's success and its
//      verify call — it performs the same idempotent grant.
//
// `createEntitlementFromOrder` is the one grant function both server paths
// mirror; the migration pins its SQL twin. Nothing in this file decides
// WHO may read a locked day — that is RLS (entitlements) + the fork gate.

export const CURRENCY = 'INR'

/** Razorpay test-mode max is ₹1,00,000 per order; the UI caps creators lower
 *  at publish time. Enforced server-side before an order is created. */
export const MAX_ORDER_AMOUNT_INR = 100_000

/** Razorpay minimum practical amount (₹1) — a zero/negative price cannot be
 *  charged and must never reach the gateway. */
export const MIN_ORDER_AMOUNT_INR = 1

export interface OrderDraft {
  pubId: string
  tripId: string
  buyerId: string
  /** Server-verified amount in whole rupees (the publication's price). */
  amountInr: number
  /** Razorpay's own id (`order_…`), returned by the gateway. */
  razorpayOrderId: string
  keyId: string
  /** 14-char receipt cap — Razorpay rejects longer receipts. */
  receipt: string
}

/** Draft the gateway order from server-trusted values only. The price comes
 *  from the publications table read inside the checkout function, never from
 *  the client request — a tampered body must not change what is charged.
 *  Throws RangeError on an unpriceable or out-of-bounds publication. */
export function draftOrder(input: {
  pubId: string
  tripId: string
  buyerId: string
  priceInr: number | null | undefined
  razorpayOrderId: string
  keyId: string
}): OrderDraft {
  const amount = input.priceInr
  if (!Number.isInteger(amount) || (amount ?? 0) < MIN_ORDER_AMOUNT_INR) {
    throw new RangeError(`publication price is not a chargeable amount: ${String(input.priceInr)}`)
  }
  if ((amount ?? 0) > MAX_ORDER_AMOUNT_INR) {
    throw new RangeError(`publication price exceeds the gateway cap: ${String(amount)}`)
  }
  return {
    pubId: input.pubId,
    tripId: input.tripId,
    buyerId: input.buyerId,
    amountInr: amount!,
    razorpayOrderId: input.razorpayOrderId,
    keyId: input.keyId,
    // Razorpay receipts are capped at 40 chars in practice; 14 keeps the
    // composite short, sortable and collision-free per (buyer, pub) pair.
    receipt: receiptFor(input.pubId, input.buyerId),
  }
}

/** Deterministic receipt: `r_<8-char pub>_<4-char buyer>` — ≤14 chars. */
export function receiptFor(pubId: string, buyerId: string): string {
  return `r${hash8(pubId)}${hash4(buyerId)}`
}

function hash8(s: string): string {
  return hash(s, 8)
}
function hash4(s: string): string {
  return hash(s, 4)
}
/** FNV-1a, base-36 — stable, dependency-free, good enough for receipts. */
function hash(s: string, chars: number): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36).padStart(chars, '0').slice(0, chars)
}

// ---- Signature verification (the verify function's core check) ----

export interface PaymentCallback {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

/**
 * Verify Razorpay's checkout callback signature:
 *   HMAC-SHA256(`${order_id}|${payment_id}`, KEY_SECRET) === signature
 * Implemented with WebCrypto so it runs on Vercel's Node runtime unchanged.
 * Constant-time comparison — a forged signature must not be able to
 * early-exit on a length mismatch alone.
 */
export async function verifyCallbackSignature(
  callback: PaymentCallback,
  keySecret: string,
): Promise<boolean> {
  const expected = await hmacHex(`${callback.razorpay_order_id}|${callback.razorpay_payment_id}`, keySecret)
  return timingSafeEqualHex(expected, callback.razorpay_signature)
}

async function hmacHex(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Length-independent compare: always walks both strings fully. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

// ---- Webhook signature (x-razorpay-signature) ----

/** The webhook signs the RAW request body with the webhook secret. */
export async function verifyWebhookSignature(rawBody: string, signature: string, webhookSecret: string): Promise<boolean> {
  const expected = await hmacHex(rawBody, webhookSecret)
  return timingSafeEqualHex(expected, signature)
}

// ---- Entitlements ----

export interface Entitlement {
  id: string
  /** Null when the buyer's account was hard-deleted (L2: the books keep the
   *  sale; the ledger renders "a deleted account"). */
  userId: string | null
  pubId: string
  /** Order that granted it — the audit trail back to the money. */
  orderId: string
  /** Rupees actually paid (price snapshot — the publication's price can change later). */
  amountPaidInr: number
  /** Epoch ms of the grant (the verify call or a webhook delivery). */
  grantedAt: number
}

/** The exact column list the migration defines for `entitlements` — the
 *  single string every read of the table must select. A column that exists
 *  only on one side of this list turns the read into a PostgREST 400 (and
 *  the silent-[] degradation), so the contract test pins the two together.
 *  Keep in sync with 20260918_payments_rail.sql. */
export const ENTITLEMENT_COLUMNS = 'id,user_id,pub_id,order_id,amount_paid_inr,granted_at' as const

export type OrderStatus = 'pending' | 'paid' | 'failed'

/** The exact column list the migration defines for `purchase_orders` — the
 *  single string every read of the table must select. Same contract as
 *  `ENTITLEMENT_COLUMNS`, and for the same reason: a column that exists on only
 *  one side of this list turns the read into a PostgREST 400 (and the silent-[]
 *  degradation). Keep in sync with 20260918_payments_rail.sql. */
export const ORDER_COLUMNS = 'id,user_id,pub_id,amount_inr,status,created_at,paid_at,refunded_paise' as const

/** One purchase order, as the buyer's shelf needs it (#407).
 *
 *  The ORDER is where the MONEY state lives, and it is the only row that
 *  survives a refund: `revoke_refunded_entitlement` sets the order `failed` and
 *  DELETES the entitlement row, so a shelf built from entitlements alone loses
 *  the purchase completely — the buyer's receipt disappears and a plan they paid
 *  for silently vanishes from "My purchases". */
export interface PurchaseOrder {
  id: string
  /** Null when the buyer's account was hard-deleted (the books keep the sale). */
  userId: string | null
  pubId: string
  /** Rupees charged — `amount_inr`, the gateway's own figure. */
  amountInr: number
  status: OrderStatus
  /** Epoch ms the order was created. */
  createdAt: number
  /** Epoch ms the gateway captured the money; null before that. */
  paidAt: number | null
  /** #554 — the CUMULATIVE paise refunded against this order (Razorpay's
   *  `payment.amount_refunded`, recorded by apply_order_refund). Zero for a
   *  sale with no refund. A partial refund leaves the order `paid` and the
   *  entitlement alive — this figure is how the shelf says "₹X of this came
   *  back" without erasing the sale. Kept in paise: the books stay exact. */
  refundedPaise: number
}

/** Whether this order's money was captured and later given back.
 *
 *  `failed` is written by EXACTLY ONE function — `revoke_refunded_entitlement` —
 *  and only `where status = 'paid'`, so a failed order is by construction one
 *  that WAS paid. No other path writes it: a declined card leaves the order
 *  `pending`, because the verify call that would mark it never runs. That is
 *  what makes "failed ⇒ refunded" a fact about this schema rather than an
 *  assumption, and it is why the shelf may read the status as the money state.
 *
 *  (`api/checkout.js` also consults this status when deciding whether an
 *  existing order may be reused — it must not re-serve one that was refunded.) */
export function isRefunded(order: Pick<PurchaseOrder, 'status'>): boolean {
  return order.status === 'failed'
}

/** The date a purchase's receipt should carry: when the money moved.
 *
 *  `paid_at` for an order that was paid (which every refunded one was), falling
 *  back to `created_at` for a row whose `paid_at` is somehow unset. Returning a
 *  number rather than a string keeps the shelf's own "could not be read"
 *  handling (`dateReadable`) in charge of how an unreadable date is described. */
export function orderMoneyAt(order: Pick<PurchaseOrder, 'paidAt' | 'createdAt'>): number {
  return order.paidAt ?? order.createdAt
}

/** The grant rule both server paths mirror, stated once: a PAID order grants
 *  exactly one entitlement keyed (userId, pubId); re-grants are no-ops (the
 *  unique index enforces it), and a FAILED or PENDING order grants nothing. */
export function orderGrantsEntitlement(status: OrderStatus, buyerId: string, pubId: string): boolean {
  return status === 'paid' && buyerId.length > 0 && pubId.length > 0
}

/** Client-side gate: does this viewer see a publication's locked days?
 *  The creator always sees their own publication; otherwise a paid
 *  entitlement is required. This is UI convenience only — the real gate is
 *  get_public_trip (the wire stubs unlocked/locked per auth.uid()) plus the
 *  fork's re-stub, which re-derive it server-side. A null e.userId (deleted
 *  buyer) can never match a live session. */
export function hasUnlock(entitlements: Entitlement[], userId: string | null, pubId: string, creatorId: string): boolean {
  if (userId && userId === creatorId) return true
  if (!userId) return false
  return entitlements.some(e => e.userId === userId && e.pubId === pubId)
}

/** What the checkout API returns to the browser: everything Razorpay's
 *  checkout.js needs to open, plus the ids the verify call echoes back. */
export interface CheckoutSession {
  orderId: string
  orderDraft: OrderDraft
  /** Amount in paise — checkout.js takes paise, not rupees. */
  amountPaise: number
  currency: typeof CURRENCY
  prefill: { name?: string; email?: string }
}
