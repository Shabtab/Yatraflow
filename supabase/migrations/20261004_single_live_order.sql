-- ============================================================
-- 20261004_single_live_order.sql
-- #594: ONE live order per (buyer, publication).
--
-- `api/checkout.js` read only the NEWEST order and treated it as "the order".
-- With more than one row live for a (buyer, pub), the recovery machinery was
-- blind to every row except the newest — so a captured-but-stranded OLDER
-- order was invisible, the newest pending row passed its gateway probe, and
-- the app itself opened a payable modal for a plan whose money had already
-- moved. A second capture is real money: `claim_paid_order` grants once (the
-- (user_id, pub_id) unique), so the second capture lands as an unrecorded
-- overpayment with no entitlement and no ledger line.
--
-- A partial unique index makes the second live row IMPOSSIBLE rather than
-- unlikely — and it is the only layer that can be: two read-then-write
-- handlers cannot order themselves, and a `limit=1` read is not a lock.
--
--   * `status = 'pending'` — the payable window. This is the invariant the
--     re-serve design depends on: one payable gateway order per unlock.
--   * `status = 'paid'` — a second capture of the same plan is the
--     OVERPAYMENT case, and making it impossible would refuse real money that
--     Razorpay already took while the DB says the first grant stands. The
--     checkout recovery path reports it to the operator instead of granting
--     silently (see the 20261004 code change).
--
-- `failed` rows are excluded from both: they are the terminal, non-payable
-- state, and many may accumulate honestly (each failed grant, each refund).
--
-- Applying this to a database that ALREADY holds duplicate live rows would
-- fail the index build. That is deliberate and loud: the guard below reports
-- exactly which (user, pub) pairs are affected so an operator can resolve them,
-- rather than the migration silently dropping a buyer's order. On a clean
-- database the count is zero and the guard does nothing.
--
-- Safe to re-run (create if not exists). To apply: run this whole file in the
-- Supabase SQL editor, then `npm run check:migrations` (the INDEX is not
-- probeable by the checker — it probes columns and buckets — so this file is
-- declared no-probe-surface; the guard is observable in the failure text when
-- duplicates exist).
-- ============================================================

-- The report, before the build: every (buyer, publication) with more than one
-- live row. Raised as an exception so the migration stops BEFORE attempting a
-- build that would fail with a bare "duplicate key" and no context.
do $$
declare
  v_dupes text;
begin
  select string_agg(format('%s / %s (%s live rows)', user_id, pub_id, n), E'\n  ') into v_dupes
  from (
    select user_id::text, pub_id, count(*) as n
    from public.purchase_orders
    where status in ('pending', 'paid')
    group by user_id, pub_id
    having count(*) > 1
  ) d;
  if v_dupes is not null then
    raise exception 'purchase_orders holds % (buyer, publication) pair(s) with more than one live row, so the one-live-order index cannot be built. Resolve each (an order the gateway says is not payable can be set to failed) and re-run this file:%s%s',
      (select count(*) from (select 1 from public.purchase_orders where status in ('pending','paid') group by user_id, pub_id having count(*) > 1) x), E'\n  ', v_dupes;
  end if;
end $$;

-- ONE pending (payable) order per (buyer, publication). The `paid` half is
-- deliberately NOT included — see the header: a second capture must stay
-- recordable so the overpayment can be reported, not be refused at the door.
create unique index if not exists purchase_orders_one_pending_per_buyer_pub
  on public.purchase_orders (user_id, pub_id)
  where status = 'pending';