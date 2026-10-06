-- ============================================================
-- 20261002_claim_paid_order_marker_guard.sql
-- Marker family · the money face of #350's vocabulary: "stops selling" must
-- mean stops SELLING. `claim_paid_order` is the grant — everything upstream of
-- it can be raced (a stale client with the Buy CTA open, a checkout read that
-- happened a moment before the creator unpublished), and until now nothing on
-- the rail itself knew `unpublished_at` existed. The checkout handler is gated
-- separately (api/checkout.js refuses to mint the order); this body is the
-- backstop for the orders that were minted anyway.
--
-- The rule, deliberately narrow: refuse only when the publication is withdrawn
-- AND the order postdates the marker. An order created while the plan was live
-- — a buyer mid-payment at the moment of the unpublish — MUST still claim:
-- stranding a charge is worse than the bug being fixed here. `unpublished_at`
-- is a ms-epoch bigint (20260925_publication_soft_unpublish.sql) while
-- `purchase_orders.created_at` is timestamptz, so the comparison converts.
-- Claims remain idempotent: everything already granted is untouched.
--
-- §6k two-files-one-function trap: `claim_paid_order` is redefined by
-- 20260918_payments_rail.sql and 20260929_claim_paid_order_opaque.sql. NAME
-- ORDER decides which body a fresh database ends up running, so THIS file must
-- sort after both (it does — 20261002) and carry every earlier guard forward
-- verbatim: the buyer check, the paid-status check, the #355 opaque-refusal
-- behaviour (ONE `raise exception` sentence for every refusal, the distinct
-- reasons ONLY as `raise log`), and the `on conflict (user_id, pub_id) do
-- nothing` duplicate-grant path. The marker refusal joins the SAME opaque
-- class — a caller learns "this claim did not succeed", never which gate
-- stopped it (a withdrawn-publication oracle is the same oracle #355 closed).
-- Pinned by tests/claim-opaque.test.ts against the NEWEST body.
--
-- Safe to re-run (`create or replace`). To apply: run this whole file in the
-- Supabase SQL editor, then `npm run check:migrations` (this file is declared
-- no-probe-surface: a redefined function exists before and after).
-- ============================================================

create or replace function public.claim_paid_order(p_razorpay_order_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.purchase_orders;
  v_ent entitlements.id%type;
  -- Unpublished marker (ms epoch) of the order's publication, if any. Read
  -- through the order's pub_id — the order is the fact being claimed, and it
  -- is the order's own timestamp that the carve-out compares against.
  v_unpublished bigint;
  -- Why the claim was refused, for the LOG only. It is deliberately never
  -- returned: the caller cannot read it (#355).
  v_refused text;
begin
  select * into v_order from public.purchase_orders
    where razorpay_order_id = p_razorpay_order_id
    for update;

  if not found then
    v_refused := 'no such order';
  elsif v_order.user_id <> auth.uid() then
    v_refused := 'order belongs to another user';
  elsif v_order.status <> 'paid' then
    v_refused := 'order is not paid (status ' || v_order.status || ')';
  else
    -- The marker gate + the in-flight carve-out. A withdrawn publication
    -- refuses an order created AFTER the stamp; an order created before it
    -- (the buyer was already paying) claims exactly as before. `>`, not `>=`:
    -- the boundary instant belongs to the buyer.
    select p.unpublished_at into v_unpublished
      from public.published_itineraries p
      where p.id = v_order.pub_id;
    if v_unpublished is not null
      and (extract(epoch from v_order.created_at) * 1000)::bigint > v_unpublished then
      v_refused := 'publication withdrawn before this order was created';
    end if;
  end if;

  if v_refused is not null then
    -- `raise log` writes to the server log and returns NOTHING to the caller —
    -- the operator keeps the diagnosis, the prober gets the same sentence as
    -- every other refusal.
    raise log 'claim_paid_order refused (%, order %): %',
      v_refused, p_razorpay_order_id, coalesce(auth.uid()::text, 'anonymous');
    -- ONE code and ONE message for all refusals. "not found", "belongs to
    -- someone else", "not paid" and "withdrawn" must be indistinguishable.
    raise exception 'claim refused';
  end if;

  insert into public.entitlements (user_id, pub_id, order_id, amount_paid_inr)
  values (v_order.user_id, v_order.pub_id, v_order.id, v_order.price_snapshot_inr)
  on conflict (user_id, pub_id) do nothing
  returning id into v_ent;

  return v_ent;
end;
$$;

-- Restated so the role list is a fact about THIS file: authenticated may call
-- it, nobody else may even reach it.
revoke all on function public.claim_paid_order(text) from public, anon;
grant execute on function public.claim_paid_order(text) to authenticated;
