// ============ POST /api/checkout — create a Razorpay order (M7) ============
import { supabaseServiceHeaders, supabaseAnonHeaders } from './_supabase-headers.js'
import { markOrderPaid } from './_order-mark.js'
// The browser sends ONLY the publication id; the price is read server-side
// from the published_itineraries row. A tampered request body cannot change
// what is charged. The buyer is the caller's own Supabase JWT `sub` — never
// a client-supplied user id.
//
// Env vars (Vercel):
//   SUPABASE_URL, SUPABASE_ANON_KEY   — read the publication row
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET — gateway credentials (test mode OK)
//
// Mirrors api/i.js conventions: plain JS, strict body validation, bounded
// upstream fetches with AbortSignal, explicit status codes, no app-shell
// fetches. 401 unauthenticated · 403 not allowed to buy · 404 unknown pub ·
// 409 already unlocked · 503 upstream/misconfigured.

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function json(res, status, body) {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.status(status)
  return res.send(JSON.stringify(body))
}

function bearerToken(req) {
  const header = req.headers?.authorization
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

/** Resolve the JWT's `sub` against Supabase auth — the token must actually
 *  belong to a live session, not merely decode. Returns the user id or null. */
async function authUserId(supabaseUrl, anonKey, token, signal) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    signal,
  })
  if (!response.ok) return null
  const user = await response.json()
  return typeof user?.id === 'string' && user.id ? user.id : null
}

async function fetchPublication(supabaseUrl, anonKey, pubId, signal) {
  // unpublished_at=is.null: the paywall is at the wire, not in React — a
  // withdrawn plan must not mint a gateway order. Rows survive #350, so a
  // withdrawn pub otherwise reads as present and sells; with the filter it
  // takes the exact "not found" refusal a missing row already gets.
  const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/published_itineraries` +
    `?id=eq.${encodeURIComponent(pubId)}&unpublished_at=is.null&select=id,trip_id,creator_id,premium_price_inr&limit=1`
  const response = await fetch(url, {
    headers: supabaseAnonHeaders(anonKey),
    signal,
  })
  if (!response.ok) throw new Error(`publications read failed: ${response.status}`)
  const rows = await response.json()
  return Array.isArray(rows) ? rows[0] ?? null : null
}

async function fetchEntitlements(supabaseUrl, serviceKey, userId, pubId, signal) {
  const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/entitlements` +
    `?user_id=eq.${encodeURIComponent(userId)}&pub_id=eq.${encodeURIComponent(pubId)}&select=id&limit=1`
  const response = await fetch(url, {
    headers: supabaseServiceHeaders(serviceKey),
    signal,
  })
  if (!response.ok) throw new Error(`entitlements read failed: ${response.status}`)
  const rows = await response.json()
  return Array.isArray(rows) && rows.length > 0
}

/** Every LIVE order this buyer opened for this publication, newest first —
 *  the state decides the branch (paid ⇒ finish the grant; pending and
 *  gateway-live ⇒ re-serve). Re-served instead of minting a twin Razorpay
 *  order per retry — the abandoned-modal path (dismiss, re-click) would
 *  otherwise pile up orphan rows and gateway orders. Filtering to
 *  pending-only was the live bug: a row stranded 'paid' by a failed grant
 *  vanished from this read, and the next click minted a FRESH order for money
 *  already taken — a double charge.
 *
 *  #594 — this reads ALL of them, not `limit=1`. Several live rows can exist
 *  for one (buyer, pub) — a concurrent mint across two tabs, or a price change
 *  that minted a fresh order while the old one stayed payable — and the
 *  recovery machinery was blind to every row except the newest, so a
 *  captured-but-stranded OLDER order was invisible while the newest pending
 *  row passed its gateway probe: the app opened a payable modal for a plan
 *  whose money had already moved. The structural half (one pending row per
 *  buyer+pub, 20261004) stops new duplicates at the database; this read is what
 *  lets rows that already exist be recovered instead of stranded.
 *
 *  `failed` rows are excluded — that is the terminal, non-payable state, and
 *  several may accumulate honestly (each failed grant, each refund). */
async function fetchLiveOrders(supabaseUrl, serviceKey, userId, pubId, signal) {
  const url = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/purchase_orders` +
    `?user_id=eq.${encodeURIComponent(userId)}&pub_id=eq.${encodeURIComponent(pubId)}` +
    `&select=razorpay_order_id,amount_inr,status&status=in.(pending,paid)&order=created_at.desc`
  const response = await fetch(url, {
    headers: supabaseServiceHeaders(serviceKey),
    signal,
  })
  if (!response.ok) throw new Error(`live order read failed: ${response.status}`)
  const rows = await response.json()
  return Array.isArray(rows) ? rows : []
}

async function createRazorpayOrder(keyId, keySecret, amountPaise, receipt, signal) {
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes: {} }),
    signal,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || typeof body?.id !== 'string' || !body.id) {
    throw new Error(`razorpay order failed: ${response.status}`)
  }
  return body.id
}

/** The gateway's own view of the order — the truth our local row can only
 *  mirror. 'created' = still payable; 'paid'/'captured' = money moved;
 *  'attempted' = a payment started but did not complete. */
async function fetchGatewayOrderStatus(keyId, keySecret, razorpayOrderId, signal) {
  const response = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}`, {
    headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` },
    signal,
  })
  if (!response.ok) return 'unknown'
  const order = await response.json()
  return typeof order?.status === 'string' ? order.status : 'unknown'
}

/** #595 — the real payment id behind a captured order, read from the gateway's
 *  payments list for that order. The recovery path marks a stranded row paid,
 *  and `razorpay_payment_id` is a Razorpay PAYMENT id by schema contract — a
 *  future refund tool calls Razorpay's refund API keyed by payment id, so a
 *  sentinel string there turns a refund into a 404 at exactly the wrong
 *  moment. Returns null when the list answers but holds no captured payment:
 *  the mark still proceeds (the money moved — blocking the grant over a missing
 *  id would strand the buyer worse), and the column stays honest. */
async function fetchCapturedPaymentId(keyId, keySecret, razorpayOrderId, signal) {
  try {
    const response = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}/payments`, {
      headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` },
      signal,
    })
    if (!response.ok) return null
    const body = await response.json().catch(() => null)
    const items = Array.isArray(body?.items) ? body.items : []
    const captured = items.find(p => p?.status === 'captured' && typeof p.id === 'string')
    return captured?.id ?? null
  } catch (err) {
    // The probe is best-effort by design: the grant must not hinge on it. The
    // error is NAMED here rather than swallowed silently — the operator learns
    // why the row's payment id will be null.
    console.warn(`[yatraflow] checkout: could not read the payments list for order ${razorpayOrderId}`, err)
    return null
  }
}

/** Grant via the buyer-scoped RPC — the same tail the verify function runs. The
 *  mark itself lives in `_order-mark.js` (#355) because all three payment
 *  functions perform it and it is subtle enough that three copies is three
 *  chances to get the zero-row case wrong. */
async function claimEntitlement(supabaseUrl, anonKey, token, razorpayOrderId, signal) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/claim_paid_order`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_razorpay_order_id: razorpayOrderId }),
    signal,
  })
  return response.ok
}

async function insertOrderRow(supabaseUrl, serviceKey, row, signal) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/rest/v1/purchase_orders`, {
    method: 'POST',
    headers: supabaseServiceHeaders(serviceKey, {
      'content-type': 'application/json',
      prefer: 'return=minimal',
    }),
    body: JSON.stringify(row),
    signal,
  })
  // #594 — 409 here is the one-live-order index (20261004) refusing a second
  // pending row for this (buyer, pub): the racer lost the mint race, exactly as
  // the guard intends. It is NOT an error to surface — the caller answers 409
  // "try again", and the retry's own read now finds the winner's row and
  // re-serves it. Any other non-2xx is a real failure and still throws.
  if (response.status === 409) return { minted: false }
  if (!response.ok) throw new Error(`order row insert failed: ${response.status}`)
  return { minted: true }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    return json(res, 405, { error: 'POST only' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  // Name the missing variable — "not configured yet" alone sent an operator
  // in circles when a Vercel var silently didn't reach the deployment.
  const missing = [
    ['SUPABASE_URL', supabaseUrl],
    ['SUPABASE_ANON_KEY', anonKey],
    ['RAZORPAY_KEY_ID', keyId],
    ['RAZORPAY_KEY_SECRET', keySecret],
    ['SUPABASE_SERVICE_ROLE_KEY', serviceKey],
  ].filter(([, v]) => !v).map(([name]) => name)
  if (missing.length > 0) {
    return json(res, 503, { error: `payments are not configured yet — missing env var(s): ${missing.join(', ')}` })
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body
  const pubId = body?.pubId
  if (typeof pubId !== 'string' || !ID_RE.test(pubId)) {
    return json(res, 400, { error: 'invalid publication id' })
  }

  const token = bearerToken(req)
  if (!token) return json(res, 401, { error: 'log in to buy' })

  const signal = AbortSignal.timeout(8000)
  let userId
  let pub
  try {
    userId = await authUserId(supabaseUrl, anonKey, token, signal)
    if (!userId) return json(res, 401, { error: 'session expired — log in again' })
    pub = await fetchPublication(supabaseUrl, anonKey, pubId, signal)
  } catch {
    return json(res, 503, { error: 'could not reach the trip store' })
  }
  if (!pub) return json(res, 404, { error: 'no such publication' })

  // The price comes from the row, never the request. Unpriced ⇒ nothing to buy.
  const price = pub.premium_price_inr
  if (!Number.isInteger(price) || price < 1) {
    return json(res, 403, { error: 'this itinerary is free — fork it instead' })
  }
  // The creator does not buy their own publication.
  if (pub.creator_id === userId) {
    return json(res, 403, { error: 'this is your own publication' })
  }

  let recovering = false
  try {
    if (await fetchEntitlements(supabaseUrl, serviceKey, userId, pubId, signal)) {
      return json(res, 409, { error: 'already unlocked' })
    }
    // Every LIVE order for this buyer+publication decides the branch — not just
    // the newest one (#594). A price change after an order was opened
    // invalidates THAT order — the stored snapshot must equal the row price or a
    // new order is created at the current price.
    //
    // The gateway is the truth on whether an order is still payable: a local row
    // can stay 'pending' when verify failed after a CAPTURED payment, and
    // Razorpay's modal refuses an already-paid order_id with an opaque "Uh! oh!"
    // screen. If the money already moved, FINISH THE GRANT here — and MEAN it:
    // reporting success without the entitlement landing leaves the buyer
    // stranded AND lets the next click mint a fresh order (charging twice for
    // one payment). A failed grant is a 503 that says exactly what happened and
    // what will NOT happen.
    //
    // The scan runs OLDEST-first (#594): when several orders are live, the one
    // most likely to hold a captured payment is the longest-standing one, and a
    // stranded capture is exactly what must be found before anything is
    // re-served. Recovering the newest and ignoring an older captured row would
    // open a payable modal for money that already moved.
    const liveOrders = await fetchLiveOrders(supabaseUrl, serviceKey, userId, pubId, signal)
    const scan = liveOrders.filter(o => o.amount_inr === price).slice().reverse()
    // #594 — several orders at the CURRENT price, all still payable, means the
    // structural guard has not landed yet (or predates these rows). Re-serving
    // either one risks a second capture on a plan whose money may already have
    // moved, and minting adds a third. Probe them all first — a captured one
    // still gets recovered — then refuse if more than one remains payable, with
    // the ids for the operator. This is the overpayment case the issue asks to
    // be surfaced rather than silently resolved.
    const pendingAtPrice = scan.filter(o => o.status === 'pending')
    const ambiguous = pendingAtPrice.length > 1
    for (const order of scan) {
      const gatewayStatus = order.status === 'paid'
        ? 'paid' // the row already knows — no gateway probe needed
        : await fetchGatewayOrderStatus(keyId, keySecret, order.razorpay_order_id, signal)
      if (gatewayStatus === 'paid') {
        recovering = true // from here, any throw means money moved and we failed to finish
        if (order.status === 'pending') {
          // A captured payment this flow never confirmed: read its REAL payment
          // id from the gateway and mark the row with that (#595). The column is
          // a Razorpay payment id by schema contract — a refund tool keys on it,
          // so a sentinel there would 404 a refund at the worst moment. Null is
          // the honest fallback when the payments list answers without one: the
          // mark still proceeds (the money moved), the column stays a payment id
          // or nothing.
          const recoveredPaymentId = await fetchCapturedPaymentId(keyId, keySecret, order.razorpay_order_id, signal)
          if (!recoveredPaymentId) {
            console.error(`[yatraflow] checkout recovery: no captured payment id on the gateway for order ${order.razorpay_order_id} — marking paid with a null payment id`)
          }
          const mark = await markOrderPaid(serviceKey, order.razorpay_order_id, recoveredPaymentId, signal)
          // The gateway says paid but the row came back refunded: the two
          // disagree, and the ROW is the one the entitlement was revoked against
          // (#355). Granting here would resurrect access a refund deleted —
          // refuse, and name the disagreement rather than assume either side.
          if (mark.state === 'refunded') {
            return json(res, 409, {
              error: `your earlier payment on order ${order.razorpay_order_id} was refunded — the plan is not unlocked; nothing further will be charged`,
            })
          }
        }
        const granted = await claimEntitlement(supabaseUrl, anonKey, token, order.razorpay_order_id, signal)
        if (!granted) {
          return json(res, 503, {
            error: `your earlier payment is confirmed, but the unlock could not be saved just now — no second payment will be taken; try again in a moment or contact support with order ${order.razorpay_order_id}`,
          })
        }
        return json(res, 409, { error: 'already unlocked — your earlier payment was confirmed just now; reload to see the full plan' })
      }
      if (gatewayStatus === 'created' || gatewayStatus === 'attempted') {
        // RE-SERVE this same order. `created` is still payable; `attempted` means
        // an attempt started and did not complete, and Razorpay keeps such an
        // order payable — which is exactly why 'attempted' is not a terminal
        // status. Re-serving therefore cannot double-charge (one order, one
        // payment, however many attempts), whereas minting a second order creates
        // a second thing to be paid, and a buyer who completes both has paid
        // twice for one unlock the claim grants once (#355).
        //
        // It also stops the orphan pile: every abandoned attempt used to leave a
        // permanent pending row behind, because the retry minted a fresh order
        // instead of reusing the one already sitting there.
        //
        // #594 — but only when this is the ONE payable order. With several, the
        // ambiguity check below speaks instead: the oldest-first scan is what
        // guarantees no captured payment is stranded behind a newer payable row,
        // and re-serving blindly would hand back the second of two.
        if (ambiguous) break
        return json(res, 200, { orderId: order.razorpay_order_id, keyId, amountPaise: price * 100, currency: 'INR' })
      }
      if (gatewayStatus === 'unknown') {
        // The probe itself failed (gateway 5xx/auth/network) — we do NOT know
        // whether this pending order was paid. Minting a fresh order here is
        // the double-charge window: if money had moved on the old one, the
        // buyer would pay twice. Refuse instead; Razorpay being down also
        // means order CREATION would fail right after, so nothing is lost.
        recovering = true
        return json(res, 503, {
          error: 'could not verify your earlier attempt — to make sure you are never charged twice, we stopped here; try again in a moment',
        })
      }
      // A status the gateway named but this flow does not know (its set is not
      // ours to assume). Re-serving it could hand the buyer an order the modal
      // will not accept, and minting could double-charge, so the same rule as
      // 'unknown' applies: stop, say why, and never guess (#355).
      recovering = true
      return json(res, 503, {
        error: 'your earlier attempt is in a state we do not recognise — to make sure you are never charged twice, we stopped here; try again in a moment',
      })
    }
    // #594 — more than one live pending order at this price, none of them
    // captured: refuse rather than mint or re-serve. The buyer is told plainly
    // and the operator gets the order ids to reconcile.
    if (ambiguous) {
      console.error(`[yatraflow] checkout: ${pendingAtPrice.length} live pending orders for user ${userId} pub ${pubId}: ${pendingAtPrice.map(o => o.razorpay_order_id).join(', ')}`)
      return json(res, 409, {
        error: 'more than one unfinished payment exists for this plan — nothing further will be charged. If you were charged twice, contact support and quote your receipts.',
      })
    }
    const receipt = `r${stable(pubId, 8)}${stable(userId, 4)}`
    const razorpayOrderId = await createRazorpayOrder(keyId, keySecret, price * 100, receipt, signal)
    const minted = await insertOrderRow(supabaseUrl, serviceKey, {
      user_id: userId,
      pub_id: pubId,
      razorpay_order_id: razorpayOrderId,
      amount_inr: price,
      currency: 'INR',
      status: 'pending',
      price_snapshot_inr: price,
    }, signal)
    // #594 — lost the mint race: the index refused a second pending row. The
    // gateway order exists but is unreachable from this buyer (the row is what
    // checkout and verify both resolve by), so it can never be paid through the
    // app. Say so instead of handing back an order_id whose row does not exist —
    // that modal would open, and Razorpay would take the money for nothing.
    if (!minted.minted) {
      return json(res, 409, {
        error: 'another attempt at this payment just started — nothing was charged. Open the plan again to continue.',
      })
    }
    return json(res, 200, { orderId: razorpayOrderId, keyId, amountPaise: price * 100, currency: 'INR' })
  } catch {
    // A throw inside the recovery branch means money moved and we failed to
    // finish — say that, not "could not start the payment".
    return json(res, 503, recovering
      ? { error: 'your payment is confirmed but recovery failed just now — no second payment will be taken; try again in a moment' }
      : { error: 'could not start the payment' })
  }
}

function safeParse(s) {
  try { return JSON.parse(s) } catch { return undefined }
}

/** FNV-1a base-36 — mirrors lib/payments.ts receiptFor (kept inline because
 *  api functions must not import client code, which pulls in Capacitor). */
function stable(s, chars) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36).padStart(chars, '0').slice(0, chars)
}
