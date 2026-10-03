-- ============================================================
-- 20261003_partial_refund_record.sql
-- #554: a PARTIAL refund must not revoke the entitlement.
--
-- Razorpay emits `payment.refunded` for partial refunds too, and the webhook
-- could not tell them apart: every refund event deleted the entitlement and
-- flipped the order `paid → failed`, so a goodwill ₹50 back on a ₹500 sale
-- confiscated the buyer's whole plan and erased 90% of the sale from the
-- books.
--
-- The product rule (recorded in docs/commercial/REFUNDS.md):
--   * cumulative refund >= the ORDER's own captured amount  → full refund:
--     revoke exactly as before (status → failed, entitlement deleted). The
--     existing revoke_refunded_entitlement does this and stays the executor.
--   * anything less → the entitlement and the `paid` status SURVIVE, and the
--     cumulative refunded paise is recorded on the order (`refunded_paise`)
--     so the surfaces that spend money can say "₹50 of this ₹500 came back"
--     instead of inventing either a total erasure or a total sale.
--
-- The cumulative figure comes from Razorpay's `payment.amount_refunded` —
-- the payment entity's own running total, preferred over summing refund
-- events because webhook deliveries can be missed. The full/partial
-- threshold compares against the ORDER's `amount_inr * 100`, the figure we
-- hold, never the event's own captured amount: the same discipline
-- api/checkout.js applies to prices.
--
-- One decision point, one place: apply_order_refund is the ONLY new
-- authority; the webhook cannot revoke or record directly.
--
-- Safe to re-run (idempotent column add + create or replace). To apply: run
-- this whole file in the Supabase SQL editor, then `npm run check:migrations`
-- (the COLUMN is probed by the checker — it reports MISSING until this file
-- is applied, which is the loud failure wanted here; the new function is not
-- probed, existence answers nothing).
-- ============================================================

alter table public.purchase_orders
  add column if not exists refunded_paise bigint not null default 0;

create or replace function public.apply_order_refund(
  p_razorpay_order_id text,
  p_amount_refunded_paise bigint,
  p_amount_captured_paise bigint
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.purchase_orders;
begin
  -- Junk guard: a refund event without sane amounts is malformed, and the
  -- caller must hear that rather than have a negative "refund" ADD money.
  if p_amount_refunded_paise is null or p_amount_refunded_paise < 0
    or p_amount_captured_paise is null or p_amount_captured_paise < 0 then
    return 'invalid';
  end if;

  select * into v_order from public.purchase_orders
    where razorpay_order_id = p_razorpay_order_id limit 1
    for update;
  if not found then
    return 'unknown-order';
  end if;

  -- Record the cumulative refund FIRST (idempotent: the same event
  -- redelivered writes the same total), then decide the consequence against
  -- the order's OWN captured amount — never the event's.
  update public.purchase_orders
    set refunded_paise = p_amount_refunded_paise
    where id = v_order.id;

  if p_amount_refunded_paise >= (v_order.amount_inr * 100) then
    perform public.revoke_refunded_entitlement(p_razorpay_order_id);
    return 'revoked';
  end if;

  return 'recorded';
end;
$$;

revoke all on function public.apply_order_refund(text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.apply_order_refund(text, bigint, bigint) to service_role;
