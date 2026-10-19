begin;

create or replace function public.grant_paid_order(p_razorpay_order_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.purchase_orders;
  v_unpublished bigint;
  v_ent uuid;
begin
  select * into v_order from public.purchase_orders
    where razorpay_order_id = p_razorpay_order_id
    for update;

  if not found then
    return 'unknown-order';
  end if;

  if v_order.status <> 'paid'
    or v_order.refunded_paise >= (v_order.amount_inr * 100) then
    return 'not-paid';
  end if;

  if v_order.user_id is null then
    return 'buyer-missing';
  end if;

  select p.unpublished_at into v_unpublished
    from public.published_itineraries p
    where p.id = v_order.pub_id;
  if v_unpublished is not null
    and (extract(epoch from v_order.created_at) * 1000)::bigint > v_unpublished then
    return 'withdrawn';
  end if;

  insert into public.entitlements (user_id, pub_id, order_id, amount_paid_inr)
  values (v_order.user_id, v_order.pub_id, v_order.id, v_order.price_snapshot_inr)
  on conflict (user_id, pub_id) do nothing
  returning id into v_ent;

  if v_ent is null then
    return 'already-granted';
  end if;
  return 'granted';
end;
$$;

revoke all on function public.grant_paid_order(text) from public, anon, authenticated;
grant execute on function public.grant_paid_order(text) to service_role;

commit;
