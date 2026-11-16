-- Provider quota: one account-wide monthly counter for Google Routes.
--
-- The browser counts Routes calls per device in localStorage (src/lib/providers/quota.ts).
-- That count stops one runaway tab. It caps nothing for the account, because every
-- browser counts alone. This file adds the shared counter that caps the bill.
--
-- Additive and re-runnable. Apply it before the app that calls consume_provider_quota
-- is deployed. Until it is applied, the RPC call fails and every Routes request goes to OSRM.
begin;

-- ---------- provider_quota_caps ----------
-- The monthly cap per provider SKU. A cap of 0 turns the SKU off.
create table if not exists public.provider_quota_caps (
  sku          text primary key,
  monthly_cap  integer not null check (monthly_cap >= 0)
);

-- routes: 60,000 calls a month, account-wide. Change the cap with an UPDATE. No release is needed.
insert into public.provider_quota_caps (sku, monthly_cap)
values ('routes', 60000)
on conflict (sku) do nothing;

-- ---------- provider_quota_usage ----------
-- One row per SKU and UTC month. `used` counts the units that were granted.
create table if not exists public.provider_quota_usage (
  sku    text not null,
  month  date not null,
  used   integer not null default 0,
  primary key (sku, month)
);

-- RLS is on and no policy is written. Only consume_provider_quota touches these tables.
-- The revoke also keeps anon and signed-in users out, if a policy is added by mistake later.
alter table public.provider_quota_caps enable row level security;
alter table public.provider_quota_usage enable row level security;
revoke all on public.provider_quota_caps from public, anon, authenticated;
revoke all on public.provider_quota_usage from public, anon, authenticated;

-- ---------- consume_provider_quota ----------
-- Takes one unit of a SKU's monthly quota. Returns true when the unit is granted.
-- Returns false when the SKU has no cap row, its cap is 0, or the month is used up.
--
-- Race safety: the insert and the conditional update are one statement. Two calls
-- for the same SKU and month wait on the usage row. The second call re-checks
-- `used < cap` on the committed row, so `used` never passes the cap.
-- security definer: the body runs as the table owner, who bypasses RLS.
-- set search_path: stops a caller from steering the names this body resolves.
create or replace function public.consume_provider_quota(p_sku text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with granted as (
    insert into public.provider_quota_usage as u (sku, month, used)
    select c.sku, date_trunc('month', now() at time zone 'utc')::date, 1
    from public.provider_quota_caps as c
    where c.sku = p_sku and c.monthly_cap > 0
    on conflict (sku, month) do update
      set used = u.used + 1
      where u.used < (select c2.monthly_cap from public.provider_quota_caps as c2 where c2.sku = p_sku)
    returning true as ok
  )
  select coalesce((select ok from granted), false);
$$;

-- Name the roles. A revoke from public alone leaves anon and authenticated with EXECUTE.
revoke all on function public.consume_provider_quota(text) from public, anon, authenticated;
grant execute on function public.consume_provider_quota(text) to anon, authenticated;

commit;
