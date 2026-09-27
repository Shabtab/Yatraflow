// ============ Unlock flow (M7 · Premium) — browser side of the rail ==========
// The purchase journey, from the public page's Unlock button to a granted
// entitlement:
//
//   1. `POST /api/checkout` { pubId } with the session JWT →
//      { orderId, keyId, amountPaise }  (price verified server-side)
//   2. Razorpay's checkout.js modal collects the payment.
//   3. `POST /api/payments-verify` with the callback + session JWT →
//      signature-checked mark-paid + `claim_paid_order` grant.
//   4. Entitlements re-read from Supabase (RLS: own rows only).
//
// The webhook is the crash-recovery path for a tab closed between 2 and 3;
// nothing here needs to know about it.
//
// Entitlements are deliberately NOT in the store's hydrate cache: they matter
// on one surface (the public itinerary), they are cheap to re-read on demand,
// and keeping them out avoids touching the hydration paths every store test
// pins. The table may not exist yet (migration unapplied) — every read
// degrades to "no entitlements", which is exactly the pre-M7 behavior.

import { supabase } from './supabase'
import { ENTITLEMENT_COLUMNS, type Entitlement } from './payments'
import type { PlatformSale } from './adminStats'
import { toast } from '../components/ui'

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void
      on?: (event: string, handler: (response: unknown) => void) => void
    }
  }
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

let scriptPromise: Promise<boolean> | null = null

/** Load Razorpay's checkout.js once. Resolves false when it cannot load
 *  (offline, blocked) — the caller toasts instead of opening a dead modal. */
export function loadRazorpay(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (window.Razorpay) return Promise.resolve(true)
  if (!scriptPromise) {
    scriptPromise = new Promise(resolve => {
      const script = document.createElement('script')
      script.src = CHECKOUT_SRC
      script.async = true
      script.onload = () => resolve(!!window.Razorpay)
      script.onerror = () => {
        scriptPromise = null // allow a retry on the next click
        resolve(false)
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

/** The buyer's entitlement rows, via the anon client (RLS limits to own
 *  rows). A missing table, a failed read or a logged-out visitor all read
 *  as "no entitlements" — the honest pre-purchase state. */
export async function fetchMyEntitlements(userId: string | null): Promise<Entitlement[]> {
  if (!userId) return []
  try {
    const { data, error } = await supabase
      .from('entitlements')
      .select(ENTITLEMENT_COLUMNS)
      .eq('user_id', userId)
    if (error) throw error
    // The epoch-ms fields arrive as ISO strings; shape them for the type.
    return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      userId: (row.user_id as string | null) ?? null,
      pubId: row.pub_id as string,
      orderId: row.order_id as string,
      amountPaidInr: row.amount_paid_inr as number,
      grantedAt: new Date(row.granted_at as string).getTime(),
    }))
  } catch (e) {
    console.error('[yatraflow] entitlements read failed', e)
    return []
  }
}

/** The buyer's entitlement rows for the SHELF (I-20), where a failed read and
 *  an empty shelf are different truths.
 *
 *  `fetchMyEntitlements` above deliberately degrades to []: on the public
 *  itinerary a dropped connection must not break the page, and "no
 *  entitlements" is the honest pre-purchase state there. On a shelf whose whole
 *  job is to say what you own, that same degradation would tell a paying
 *  customer they own nothing — so this one REJECTS (after logging), exactly
 *  like `fetchCreatorSales`, and the page owns the error state. */
export async function fetchMyPurchases(userId: string | null): Promise<Entitlement[]> {
  if (!userId) return []
  const { data, error } = await supabase
    .from('entitlements')
    .select(ENTITLEMENT_COLUMNS)
    .eq('user_id', userId)
  if (error) {
    console.error('[yatraflow] purchases read failed', error)
    throw error
  }
  // Coerced at the MAPPING boundary, not cast: the shelf is the one surface
  // that adds these amounts together, so a single unreadable value would
  // otherwise poison the buyer's total (NaN) or quietly understate it
  // (`0 + null === 0`). `buildPurchaseShelf` flags the row from what it finds
  // here, so this returns the raw reading and lets that layer decide what is
  // readable — the two must not disagree about the same row.
  return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    pubId: row.pub_id as string,
    orderId: row.order_id as string,
    amountPaidInr: row.amount_paid_inr as number,
    grantedAt: new Date(row.granted_at as string).getTime(),
  }))
}

/** The SALES of the logged-in creator's publications (I-11). Reads through
 *  the security-definer `get_creator_sales` RPC, scoped by the caller's own
 *  auth.uid() — the RLS-policy path could answer 200-with-zero-rows when the
 *  creator policy was missing live (a partially-applied migration), which
 *  rendered "No sales yet" over real sales, indistinguishable from an
 *  honestly empty ledger. Through the RPC the same accident surfaces as an
 *  error (function not found) instead of silent emptiness.
 *
 *  REJECTS on a failed read (after logging it) instead of degrading to []:
 *  an empty ledger and a broken read are different truths. The caller owns
 *  the error state. */
/** Reports a failed read, distinguishing a FAILURE from a CANCELLATION.
 *
 *  A read the caller cancelled is not a failed read: the effect that asked for
 *  it has gone away (React's dev double-mount tears every effect down once, then
 *  runs it again), so logging it as a failure makes ordinary navigation look
 *  like a broken ledger — and it was the loudest console error on the hub. A
 *  TIMEOUT is a real failure and still logs as one: the page aborts on its own
 *  timer with a `TimeoutError` reason precisely so the two can be told apart. */
function reportReadFailure(subject: string, error: unknown, signal?: AbortSignal): void {
  const timedOut = (signal?.reason as DOMException | undefined)?.name === 'TimeoutError'
  if (signal?.aborted && !timedOut) console.debug(`[yatraflow] ${subject} read cancelled`, error)
  else console.error(`[yatraflow] ${subject} read failed`, error)
}

export async function fetchCreatorSales(opts: { signal?: AbortSignal } = {}): Promise<Entitlement[]> {
  const query = supabase.rpc('get_creator_sales')
  // The caller's signal is HONOURED, not ignored: a page that has given up
  // waiting for this read (a timeout, or an effect that was torn down) must be
  // able to stop it rather than leave it answering a question nobody is still
  // asking. Same contract as `routing.ts`.
  const { data, error } = await (opts.signal ? query.abortSignal(opts.signal) : query)
  if (error) {
    reportReadFailure('creator sales', error, opts.signal)
    throw error
  }
  return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    userId: row.user_id as string,
    pubId: row.pub_id as string,
    orderId: row.order_id as string,
    amountPaidInr: row.amount_paid_inr as number,
    grantedAt: new Date(row.granted_at as string).getTime(),
  }))
}

/** One day of a publication's RECORDED funnel steps, as the RPC returns it. */
export interface FunnelDailyRow {
  pubId: string
  /** UTC day the steps happened on, `YYYY-MM-DD` (the SQL buckets by UTC). */
  day: string
  views: number
  forks: number
}

/**
 * The recorded funnel steps for the logged-in creator's OWN publications,
 * bucketed by day (I-22 / I-15).
 *
 * Through the definer `get_creator_funnel` RPC, scoped inside by the caller's
 * own auth.uid() — the `fetchCreatorSales` precedent. Like it, this REJECTS on
 * a failed read instead of degrading to [] : "nothing recorded yet" and "the
 * log could not be read" are different truths, and a funnel that quietly reads
 * zero over real traffic is the conflation the sales ledger already fixed
 * once.
 *
 * DAILY BUCKETS, not a fixed window: the page owns the window control, so
 * switching 7/30/90 days costs no round trip. The default covers the log's
 * whole life, which is what lets the UI name the day recording began — it
 * matters, because the lifetime counters on each publication PREDATE this log
 * and the two are not the same number.
 */
export async function fetchCreatorFunnel(opts: { days?: number; signal?: AbortSignal } = {}): Promise<FunnelDailyRow[]> {
  const query = supabase.rpc('get_creator_funnel', { p_days: opts.days ?? 730 })
  const { data, error } = await (opts.signal ? query.abortSignal(opts.signal) : query)
  if (error) {
    reportReadFailure('creator funnel', error, opts.signal)
    throw error
  }
  return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
    pubId: row.pub_id as string,
    day: String(row.day ?? '').slice(0, 10),
    views: Number(row.views ?? 0),
    forks: Number(row.forks ?? 0),
  }))
}

/**
 * Every sale on the platform, for the masteradmin console's revenue row.
 *
 * Reads through the admin-gated `admin_revenue` RPC (`is_admin()` inside the
 * function). REJECTS rather than degrading to [] — an empty platform and an
 * unapplied migration are different truths, and a console that quietly shows
 * ₹0 revenue is worse than one that says it could not read the books.
 *
 * The RPC returns facts only (when, how much, which publication, and which
 * creator is owed) and never a buyer, so nothing here can leak an identity into
 * the console. The creator IS a payee, and it is what lets the console charge
 * the fee ladder per creator rather than once over the platform total.
 */
export async function fetchAdminRevenue(limit = 1000): Promise<PlatformSale[]> {
  const { data, error } = await supabase
    .rpc('admin_revenue', { p_limit: limit })
  if (error) {
    console.error('[yatraflow] admin revenue read failed', error)
    throw error
  }
  return (Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => ({
    grantedAt: new Date(row.granted_at as string).getTime(),
    amountPaidInr: row.amount_paid_inr as number,
    pubId: row.pub_id as string,
    creatorId: row.creator_id as string,
  }))
}

async function sessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function postJson(url: string, token: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await response.json().catch(() => ({}))
  return { status: response.status, json }
}

export type UnlockOutcome = 'unlocked' | 'cancelled' | 'failed' | 'already' | 'logged-out'

/**
 * Run the whole purchase for one publication. Returns the outcome so the
 * page can refresh entitlements and re-render the (now un-locked) days.
 * Every failure toasts here — the caller just switches on the result.
 */
export async function purchaseUnlock(input: {
  pubId: string
  title: string
  onUnlocked: () => void
}): Promise<UnlockOutcome> {
  const token = await sessionToken()
  if (!token) {
    toast('Log in to buy the full plan.', 'err')
    return 'logged-out'
  }

  // 1. Server creates the order (price verified from the row, not from us).
  let session: { orderId: string; keyId: string; amountPaise: number }
  try {
    const { status, json } = await postJson('/api/checkout', token, { pubId: input.pubId })
    if (status === 409) {
      // Both the plain already-unlocked case and the self-heal land here;
      // refresh either way — the self-heal may have JUST granted it, and the
      // page should show the unlocked days without demanding a reload.
      input.onUnlocked()
      const message = typeof json.error === 'string' && json.error ? json.error : 'This plan is already unlocked.'
      toast(message)
      return 'already'
    }
    if (status !== 200 || typeof json.orderId !== 'string' || typeof json.keyId !== 'string' || typeof json.amountPaise !== 'number') {
      const message = typeof json.error === 'string' ? json.error : 'Could not start the payment.'
      toast(message, 'err')
      return 'failed'
    }
    session = { orderId: json.orderId, keyId: json.keyId, amountPaise: json.amountPaise }
  } catch {
    toast('Could not reach the payment service — check your connection.', 'err')
    return 'failed'
  }

  // 2. The gateway modal. Without checkout.js there is nothing to open.
  const loaded = await loadRazorpay()
  if (!loaded || !window.Razorpay) {
    toast('The payment window could not load — check your connection or an ad blocker.', 'err')
    return 'failed'
  }
  const callback = await new Promise<Record<string, string> | null>(resolve => {
    const checkout = new window.Razorpay!({
      key: session.keyId,
      amount: session.amountPaise,
      currency: 'INR',
      name: 'YatraFlow',
      description: input.title,
      order_id: session.orderId,
      theme: { color: '#e07a3f' },
      handler: (response: Record<string, string>) => resolve(response),
      modal: { ondismiss: () => resolve(null) },
    })
    // payment.failed: a declined card or a gateway rejection closes the modal
    // WITHOUT calling handler or ondismiss — without this the promise never
    // resolves and the Unlock button stays stuck on "Opening payments…".
    checkout.on?.('payment.failed', (response: unknown) => {
      const description = (response as { error?: { description?: string } } | null)?.error?.description
      toast(description || 'The payment failed — no money was taken. Try again.', 'err')
      resolve(null)
    })
    checkout.open()
  })
  if (!callback) return 'cancelled'

  // 3. Signature-verified confirm + grant.
  try {
    const { status, json } = await postJson('/api/payments-verify', token, {
      razorpay_order_id: callback.razorpay_order_id,
      razorpay_payment_id: callback.razorpay_payment_id,
      razorpay_signature: callback.razorpay_signature,
    })
    if (status === 200) {
      input.onUnlocked()
      toast('Unlocked — every day of this plan is yours to fork. 🎉')
      return 'unlocked'
    }
    // 503 with the confirm-but-not-saved wording means the money moved and
    // the webhook may still land — say so instead of "failed".
    const message = typeof json.error === 'string' ? json.error : 'The payment could not be confirmed.'
    toast(message, 'err')
    return 'failed'
  } catch {
    toast('The payment went through but confirming it failed — refresh in a minute; the webhook will finish it.', 'err')
    return 'failed'
  }
}
