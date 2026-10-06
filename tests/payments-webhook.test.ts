// #554 — the webhook's refund branch carries the amounts, never the verdict.
// These tests drive the real handler with signed payloads: a PARTIAL refund
// must reach apply_order_refund with the cumulative figures (the RPC decides
// full-vs-partial against the order's own amount), a malformed event without
// amounts must be 400-acked rather than guessed, and the outcome string maps
// through to the response verbatim.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'

const { fetchCalls } = vi.hoisted(() => ({
  fetchCalls: [] as Array<{ url: string; body: Record<string, unknown> }>,
}))

const SECRET = 'whsec_test_554'
const SUPABASE_URL = 'https://sup-backend.test'

process.env.SUPABASE_URL = SUPABASE_URL
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-554'
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET

vi.stubGlobal('fetch', async (url: string | URL, init?: { body?: string }) => {
  const body = JSON.parse(init?.body ?? '{}') as Record<string, number | string>
  // The mock mirrors the RPC's CONTRACT (not its logic): the outcome string by
  // the full-vs-partial boundary, so both mappings are exercisable.
  const outcome = (body.p_amount_refunded_paise as number) >= (body.p_amount_captured_paise as number)
    ? 'revoked'
    : 'recorded'
  fetchCalls.push({ url: String(url), body })
  return new Response(JSON.stringify(outcome), { status: 200 })
})

// The webhook is plain JS outside src/ — import after the env vars are set.
const handler = (await import('../api/payments-webhook.js')).default as
  (req: unknown, res: unknown) => Promise<unknown>

function signedBody(event: unknown): { raw: string; signature: string } {
  const raw = JSON.stringify(event)
  const signature = crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  return { raw, signature }
}

function fakeReq(raw: string, signature: string): EventEmitter {
  const req = new EventEmitter() as EventEmitter & { method: string; headers: Record<string, string>; destroy: () => void }
  req.method = 'POST'
  req.headers = { 'x-razorpay-signature': signature }
  req.destroy = () => {}
  process.nextTick(() => {
    req.emit('data', Buffer.from(raw))
    req.emit('end')
  })
  return req
}

function fakeRes(): { statusCode: number; body: string; setHeader: () => void; status: (c: number) => unknown; send: (b: string) => unknown } {
  const res = {
    statusCode: 0,
    body: '',
    setHeader: () => {},
    status(c: number) { res.statusCode = c; return res },
    send(b: string) { res.body = b; return res },
  }
  return res
}

function refundEvent(amount: number, amountRefunded: number): Record<string, unknown> {
  // #593 — the REAL event name and shape (razorpay.com/docs/webhooks/refunds):
  // a `refund.processed` delivery carries both the refund entity and the
  // payment entity's cumulative `amount_refunded`. The old test drove an
  // invented `payment.refunded` name, which is why the dead gate stayed green.
  return {
    event: 'refund.processed',
    payload: {
      refund: { entity: { id: 'rfnd_1', amount: amountRefunded, currency: 'INR', status: 'processed' } },
      payment: { entity: { id: 'pay_1', order_id: 'order_1', amount, amount_refunded: amountRefunded } },
    },
  }
}

async function post(event: unknown): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const { raw, signature } = signedBody(event)
  fetchCalls.length = 0
  const res = fakeRes()
  await handler(fakeReq(raw, signature), res)
  return { statusCode: res.statusCode, body: JSON.parse(res.body) }
}

beforeAll(async () => {
  // Warm the dynamic import so the env vars above are read before first use.
  expect(handler).toBeTypeOf('function')
})

describe('#554 — the refund webhook carries the amounts, never the verdict', () => {
  it('a PARTIAL refund reaches apply_order_refund with the cumulative figures', async () => {
    const r = await post(refundEvent(50000, 5000))
    expect(r.statusCode).toBe(200)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]!.url).toContain('/rpc/apply_order_refund')
    expect(fetchCalls[0]!.body).toEqual({
      p_razorpay_order_id: 'order_1',
      p_amount_refunded_paise: 5000,
      p_amount_captured_paise: 50000,
    })
    expect(r.body).toEqual({ ok: true, outcome: 'recorded' })
  })

  it('a FULL refund reaches the same RPC and reports the revoke', async () => {
    const r = await post(refundEvent(50000, 50000))
    expect(r.statusCode).toBe(200)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]!.url).toContain('/rpc/apply_order_refund')
    expect(fetchCalls[0]!.body.p_amount_refunded_paise).toBe(50000)
    expect(r.body).toEqual({ ok: true, outcome: 'revoked' })
  })

  it('a refund event without readable amounts is 400-acked, never guessed', async () => {
    const event = {
      event: 'refund.processed',
      payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } },
    }
    const r = await post(event)
    expect(r.statusCode).toBe(400)
    expect(fetchCalls).toHaveLength(0)
  })
})
