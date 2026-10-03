// ============ POST /api/payments-webhook — Razorpay crash recovery (M7) ======
import { supabaseServiceHeaders, supabaseAnonHeaders } from './_supabase-headers.js'
import { markOrderPaid } from './_order-mark.js'
// Razorpay POSTs `payment.captured` here. This is the path that catches a
// user who closes the tab between the gateway capturing the payment and the
// browser's /api/payments-verify call landing: the webhook marks the order
// paid and grants the entitlement with service_role, idempotently.
//
// Signature: the raw request body is HMAC-SHA256'd by Razorpay with
// RAZORPAY_WEBHOOK_SECRET and sent as the x-razorpay-signature header. The
// RAW body must be read for the check to hold — never a re-serialized copy.
//
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RAZORPAY_WEBHOOK_SECRET.

function json(res, status, body) {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.status(status)
  return res.send(JSON.stringify(body))
}

async function hmacHex(payload, secret) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/** Read the raw body as a string — webhook signatures cover exact bytes. */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > 1_000_000) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function fetchOrderRow(supabaseUrl, serviceKey, razorpayOrderId, signal) {
  // status=eq.paid is the refund guard: a late or replayed `payment.captured`
  // after a FULL refund must not re-grant — revoke_refunded_entitlement flips
  // the row paid -> failed, and without this filter the read would return it.
  // #554 — a PARTIAL refund keeps the row `paid`, so this filter does not
  // answer it; the duplicate-grant guard does (the entitlement row survived,
  // so the upsert's ignore-duplicates makes the re-grant a no-op).
  const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/purchase_orders` +
    `?razorpay_order_id=eq.${encodeURIComponent(razorpayOrderId)}&status=eq.paid&select=id,user_id,pub_id,price_snapshot_inr,status&limit=1`
  const response = await fetch(url, {
    headers: supabaseServiceHeaders(serviceKey),
    signal,
  })
  if (!response.ok) throw new Error(`order read failed: ${response.status}`)
  const rows = await response.json()
  return Array.isArray(rows) ? rows[0] ?? null : null
}

async function grantEntitlement(supabaseUrl, serviceKey, order, signal) {
  // service_role bypasses RLS; the unique (user_id, pub_id) index makes any
  // repeat delivery a no-op. The webhook grant is deliberately unconditional
  // beyond the paid-status check — no caller JWT exists here, and the
  // signature on the request IS the authorization.
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/entitlements?on_conflict=user_id,pub_id`, {
    method: 'POST',
    headers: supabaseServiceHeaders(serviceKey, {
      'content-type': 'application/json',
      // PostgREST upsert: a repeat delivery (the same webhook retried, or a
      // race with the browser verify) becomes a no-op UPDATE instead of a
      // unique violation — idempotency lives here, not in a 409 handler.
      prefer: 'return=minimal,resolution=ignore-duplicates',
    }),
    body: JSON.stringify({
      user_id: order.user_id,
      pub_id: order.pub_id,
      order_id: order.id,
      amount_paid_inr: order.price_snapshot_inr,
    }),
    signal,
  })
  if (!response.ok && response.status !== 409) {
    throw new Error(`entitlement grant failed: ${response.status}`)
  }
}

/** Apply a refund through the service-only RPC and REPORT what it said (#355).
 *
 *  #554 — Razorpay emits `payment.refunded` for PARTIAL refunds as well as
 *  full ones, and the amounts are on the event's payment entity:
 *  `amount_refunded` is the CUMULATIVE paise returned (preferred over summing
 *  refund events — deliveries can be missed), `amount` the paise captured.
 *  The full-vs-partial decision itself lives in `apply_order_refund`, against
 *  the ORDER's own `amount_inr` — the webhook carries the figures, never the
 *  verdict. A full refund revokes as always; a partial one records the refund
 *  and leaves the entitlement and the `paid` status alone.
 *
 *  The RPC's contract is `returns text` — 'revoked' | 'recorded' |
 *  'unknown-order' | 'invalid'. `null` when the body is not a string: that
 *  means PostgREST did not answer as documented, and guessing an outcome
 *  would be inventing a fact. */
async function applyRefund(supabaseUrl, serviceKey, razorpayOrderId, refundedPaise, capturedPaise, signal) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/apply_order_refund`, {
    method: 'POST',
    headers: supabaseServiceHeaders(serviceKey, {
      'content-type': 'application/json',
    }),
    body: JSON.stringify({
      p_razorpay_order_id: razorpayOrderId,
      p_amount_refunded_paise: refundedPaise,
      p_amount_captured_paise: capturedPaise,
    }),
    signal,
  })
  if (!response.ok) throw new Error(`refund apply failed: ${response.status}`)
  const body = await response.json().catch(() => null)
  return typeof body === 'string' ? body : null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    return json(res, 405, { error: 'POST only' })
  }
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
  const missing = [
    ['SUPABASE_URL', supabaseUrl],
    ['SUPABASE_SERVICE_ROLE_KEY', serviceKey],
    ['RAZORPAY_WEBHOOK_SECRET', webhookSecret],
  ].filter(([, v]) => !v).map(([name]) => name)
  if (missing.length > 0) {
    return json(res, 503, { error: `payments are not configured yet — missing env var(s): ${missing.join(', ')}` })
  }

  let raw
  try {
    raw = await readRawBody(req)
  } catch {
    return json(res, 400, { error: 'unreadable body' })
  }
  const signature = req.headers?.['x-razorpay-signature']
  if (typeof signature !== 'string' || !signature) {
    return json(res, 400, { error: 'missing signature' })
  }
  const expected = await hmacHex(raw, webhookSecret)
  if (!timingSafeEqualHex(expected, signature)) {
    return json(res, 400, { error: 'signature did not verify' })
  }

  let event
  try {
    event = JSON.parse(raw)
  } catch {
    return json(res, 400, { error: 'invalid JSON' })
  }
  // Captured payments grant; refunds revoke (M2 — the entitlement must not
  // outlive the money). Every other event is 200-acknowledged so Razorpay
  // stops retrying it.
  if (event?.event !== 'payment.captured' && event?.event !== 'payment.refunded') {
    return json(res, 200, { ok: true, ignored: event?.event ?? null })
  }

  const payment = event.payload?.payment?.entity
  const orderId = payment?.order_id
  const paymentId = payment?.id
  if (typeof orderId !== 'string' || !orderId || typeof paymentId !== 'string' || !paymentId) {
    return json(res, 400, { error: 'event payload missing order/payment id' })
  }

  const signal = AbortSignal.timeout(8000)
  if (event.event === 'payment.refunded') {
    // #554 — the amounts decide full vs partial, so an event without them is
    // malformed rather than "probably full": 400 acks it for good (Razorpay
    // stops retrying) instead of guessing a revocation either way.
    const refundedPaise = Number(payment?.amount_refunded)
    const capturedPaise = Number(payment?.amount)
    if (!Number.isFinite(refundedPaise) || refundedPaise < 0 || !Number.isFinite(capturedPaise) || capturedPaise < 0) {
      return json(res, 400, { error: 'refund event missing amount_refunded/amount' })
    }
    try {
      const outcome = await applyRefund(supabaseUrl, serviceKey, orderId, refundedPaise, capturedPaise, signal)
      // Still a 200 for a no-op: an unknown order is a foreign or test event,
      // and a retry storm over something we will never find helps nobody.
      //
      // What changed (#355) is that the response SAYS which it was; #554
      // extends the vocabulary — 'recorded' is the partial-refund outcome,
      // where the sale survives and the refund is on the books.
      return json(res, 200, {
        ok: true,
        outcome: outcome ?? 'unreadable',
      })
    } catch {
      return json(res, 500, { error: 'could not revoke the entitlement' })
    }
  }

  try {
    const mark = await markOrderPaid(serviceKey, orderId, paymentId, signal)
    // The paid-status filter below is the real refund guard, so a refunded order
    // already falls out at the next line. Reporting the mark's own verdict just
    // keeps the note from blaming "foreign, refunded, or test event" when we in
    // fact know which one it is (#355).
    if (mark.state === 'refunded') {
      return json(res, 200, { ok: true, note: 'order was refunded — nothing to grant' })
    }
    const order = await fetchOrderRow(supabaseUrl, serviceKey, orderId, signal)
    if (!order) return json(res, 200, { ok: true, note: 'no paid local order for this gateway order (foreign, refunded, or test event)' })
    await grantEntitlement(supabaseUrl, serviceKey, order, signal)
    return json(res, 200, { ok: true })
  } catch {
    // 500 makes Razorpay retry with backoff — exactly what a transient
    // Supabase failure wants.
    return json(res, 500, { error: 'could not record the payment' })
  }
}
