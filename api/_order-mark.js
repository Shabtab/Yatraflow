// ============ The mark-paid write, made verifiable (#355) ====================
// `markOrderPaid` is called by all three payment functions — checkout's recovery
// branch, the browser verify call, and the webhook — and it used to end at
// `if (!response.ok) throw`. That check cannot tell three very different
// outcomes apart, because the PATCH is filtered `status=eq.pending`:
//
//   * the row was pending and is now paid            → marked
//   * the row was ALREADY paid (a retry, or the      → matched zero rows,
//     webhook racing the browser)                      and is a fine no-op
//   * the row was REFUNDED (`revoke_refunded_…`      → matched zero rows, and
//     flipped it to `failed`)                          granting would resurrect
//                                                      revoked access
//
// All three answer 2xx, so every caller reported success for all three. The fix
// is to stop guessing: `Prefer: return=representation` makes the response carry
// the rows actually updated, so an empty array is a fact rather than a silence.
// When it IS empty, the row is read back to learn what it says now — a follow-up
// read, never an assumption.
//
// The project host is read from the environment HERE rather than taken as a
// parameter, matching every other file in `api/`: a URL handed in is a URL that
// could have come from anywhere, while this one is looked up.
//
// Kept dependency-free and Vercel-compatible like the other `api/_*.js` files.
import { supabaseServiceHeaders } from './_supabase-headers.js'

/** The configured project, normalized once. Every caller 503s before reaching
 *  this when it is unset, so an empty string is a state the env check owns. */
function projectBase() {
  return (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
}

/**
 * Mark an order paid, and report which of the outcomes actually happened.
 *
 * @returns {Promise<{ marked: boolean, state: 'marked'|'already-paid'|'refunded'|'still-pending'|'missing' }>}
 *   `marked` is true only when THIS call moved the row. `state` names what the
 *   row says when it did not, so a caller can act on the difference instead of
 *   treating every 2xx as a success.
 */
export async function markOrderPaid(serviceKey, razorpayOrderId, paymentId, signal) {
  const url = `${projectBase()}/rest/v1/purchase_orders` +
    `?razorpay_order_id=eq.${encodeURIComponent(razorpayOrderId)}&status=eq.pending`
  const response = await fetch(url, {
    method: 'PATCH',
    headers: supabaseServiceHeaders(serviceKey, {
      'content-type': 'application/json',
      // representation, not minimal: the returned rows ARE the proof, and
      // `return=minimal` is what made a zero-row match indistinguishable from a
      // successful update.
      prefer: 'return=representation',
    }),
    body: JSON.stringify({ status: 'paid', razorpay_payment_id: paymentId, paid_at: new Date().toISOString() }),
    signal,
  })
  if (!response.ok) throw new Error(`order mark-paid failed: ${response.status}`)

  const rows = await response.json().catch(() => null)
  if (Array.isArray(rows) && rows.length > 0) return { marked: true, state: 'marked' }
  // Matched nothing: ask the row itself rather than assuming. A transient
  // failure of THIS read throws, which is deliberate — "we could not tell" must
  // not be reported as a state, because the whole point is that every caller can
  // now tell.
  return { marked: false, state: await readOrderState(serviceKey, razorpayOrderId, signal) }
}

/** What the order row says once a mark has failed to move it. */
async function readOrderState(serviceKey, razorpayOrderId, signal) {
  const url = `${projectBase()}/rest/v1/purchase_orders` +
    `?razorpay_order_id=eq.${encodeURIComponent(razorpayOrderId)}&select=status&limit=1`
  const response = await fetch(url, { headers: supabaseServiceHeaders(serviceKey), signal })
  if (!response.ok) throw new Error(`order state read failed: ${response.status}`)
  const rows = await response.json()
  const status = Array.isArray(rows) ? rows[0]?.status : undefined
  // `already-paid` is the RACE outcome and the reason this file exists: the
  // grant must still happen (that is the stranded-row recovery), but nothing
  // here may claim to have marked it.
  if (status === 'paid') return 'already-paid'
  // `refunded` is the money-came-back outcome. The entitlement was deleted with
  // it, so no caller may grant on this state.
  if (status === 'failed') return 'refunded'
  // The write did not stick, or the id names a row that is still pending.
  if (status === 'pending') return 'still-pending'
  // No local row at all: a foreign or test event, which every caller treats as
  // "nothing to do" rather than an error.
  return 'missing'
}
