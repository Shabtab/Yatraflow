import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20261019b_atomic_entitlement_grant.sql', 'utf8')

describe('the webhook grant and refund share the order boundary', () => {
  it('exposes only an order identifier to the service role', () => {
    expect(sql).toContain('public.grant_paid_order(p_razorpay_order_id text)')
    expect(sql).toContain('revoke all on function public.grant_paid_order(text) from public, anon, authenticated;')
    expect(sql).toContain('grant execute on function public.grant_paid_order(text) to service_role;')
    expect(sql).toContain('security definer')
    expect(sql).toContain('set search_path = public')
  })

  it('checks paid state while holding the refund order lock', () => {
    const refund = readFileSync('supabase/migrations/20261003_partial_refund_record.sql', 'utf8')
    expect(refund).toMatch(/from public\.purchase_orders[\s\S]*?for update;/)
    const lock = sql.indexOf('for update;')
    const paid = sql.indexOf("v_order.status <> 'paid'")
    const grant = sql.indexOf('insert into public.entitlements')
    expect(lock).toBeGreaterThan(0)
    expect(paid).toBeGreaterThan(lock)
    expect(grant).toBeGreaterThan(paid)
    expect(sql).toContain('v_order.refunded_paise >= (v_order.amount_inr * 100)')
    expect(sql.trim()).toMatch(/^begin;[\s\S]*commit;$/)
  })

  it('derives identity and price from the locked order and grants idempotently', () => {
    expect(sql).toContain('values (v_order.user_id, v_order.pub_id, v_order.id, v_order.price_snapshot_inr)')
    expect(sql).toContain('on conflict (user_id, pub_id) do nothing')
  })

  it('keeps the buyer claim withdrawal cutoff, including its boundary instant', () => {
    const buyerClaim = readFileSync('supabase/migrations/20261002_claim_paid_order_marker_guard.sql', 'utf8')
    const cutoff = '(extract(epoch from v_order.created_at) * 1000)::bigint > v_unpublished'
    expect(buyerClaim).toContain(cutoff)
    expect(sql).toContain(cutoff)
    expect(sql).toContain('where p.id = v_order.pub_id')
  })

  it('keeps browser verification on its buyer-scoped claim', () => {
    const verify = readFileSync('api/payments-verify.js', 'utf8')
    expect(verify).toContain('/rest/v1/rpc/claim_paid_order')
    expect(verify).toContain('authorization: `Bearer ${token}`')
    expect(verify).not.toContain('/rest/v1/entitlements')
  })
})
