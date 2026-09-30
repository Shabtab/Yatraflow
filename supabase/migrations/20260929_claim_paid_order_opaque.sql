-- ============ #355 — the claim refuses without telling you why ============
-- `claim_paid_order` is the one authenticated write path on the payment rail:
-- the browser verify call reaches it with the buyer's own JWT, and it re-checks
-- that the order is genuinely marked paid before granting.
--
-- It used to refuse in THREE different ways:
--
--   P0002: order not found: <the id the caller sent>
--   P0003: order belongs to another user
--   P0004: order is not paid (status <the real status>)
--
-- Every one of those distinctions was handed back to an AUTHENTICATED caller.
-- Order ids are Razorpay's (`order_…`, ~14 chars of base-62) so guessing one is
-- not a realistic attack — which is why this was filed P3 rather than as a
-- vulnerability. But an oracle is an oracle: any signed-in account could probe
-- ids and learn, per id, whether it exists at all, whether it belongs to
-- somebody, and whether it has been paid. Nothing about another user's order is
-- any of their business, and "does this id exist and is it paid" is exactly the
-- question a prober wants answered.
--
-- So the refusal becomes ONE indistinguishable error for all three cases. The
-- reasons are still recorded — as a server-side LOG line, in the Postgres log
-- the operator can read and a HTTP caller cannot. Losing the distinction in the
-- client costs nothing: no caller ever acted on it (the browser only checks
-- `response.ok`), and the three cases need the same user-facing outcome — the
-- unlock did not happen, and the money state is unchanged.
--
-- The grant itself is untouched: still `security definer`, still owner-only,
-- still paid-only, still `on conflict do nothing` so a duplicate delivery (a
-- retry, or the webhook racing the browser) is a no-op that returns NULL.
--
-- Re-runnable: `create or replace` leaves the existing body's privileges as they
-- are, and the revoke/grant below is restated anyway so a fresh apply and a
-- re-apply leave the identical role list.
--
-- No `drop policy if exists` guard is needed here because this migration creates
-- no policy — it replaces one function body. (The 20260921_user_dna lesson
-- applies to `create policy`, which has no IF NOT EXISTS form; nothing in this
-- file creates one.) There is likewise no DELETE of any kind in this migration,
-- so the #356 rule — a caller-independent delete defaults to service_role with
-- the other roles revoked by name — has nothing to apply to.

create or replace function public.claim_paid_order(p_razorpay_order_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.purchase_orders;
  v_ent entitlements.id%type;
  -- Why the claim was refused, for the LOG only. It is deliberately never
  -- returned: the point of this migration is that the caller cannot read it.
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
  end if;

  if v_refused is not null then
    -- `raise log` writes to the server log and returns NOTHING to the caller —
    -- which is the whole design: the operator keeps the diagnosis, the prober
    -- gets the same sentence as every other refusal. The order id is safe here
    -- (it is already server-side) and is what makes the line useful.
    raise log 'claim_paid_order refused (%, order %): %',
      v_refused, p_razorpay_order_id, coalesce(auth.uid()::text, 'anonymous');
    -- ONE code and ONE message for all three refusals above. The message is
    -- deliberately not a sentence about the order — "not found", "belongs to
    -- someone else" and "not paid" must be indistinguishable, so it says only
    -- that this claim did not succeed.
    raise exception 'claim refused';
  end if;

  insert into public.entitlements (user_id, pub_id, order_id, amount_paid_inr)
  values (v_order.user_id, v_order.pub_id, v_order.id, v_order.price_snapshot_inr)
  on conflict (user_id, pub_id) do nothing
  returning id into v_ent;

  return v_ent;
end;
$$;

-- Unchanged from the rail migration, and restated so the role list is a fact
-- about THIS file rather than something inherited from an earlier one:
-- authenticated may call it, nobody else may even reach it.
revoke all on function public.claim_paid_order(text) from public, anon;
grant execute on function public.claim_paid_order(text) to authenticated;
