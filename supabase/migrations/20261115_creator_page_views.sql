-- G2 draft. Apply by hand after review. This file has not run on the hosted database.
begin;

-- The creator identifies the page, never its visitor. Keep no visitor identifier.
create table if not exists public.creator_page_events (
  creator_id uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now(),
  source text
);
alter table public.creator_page_events drop constraint if exists creator_page_events_source_check;
alter table public.creator_page_events add constraint creator_page_events_source_check
  check (source is null or source in (
    'copy', 'buyer', 'explore', 'creator', 'purchases', 'wa', 'community',
    'ig', 'yt', 'threads', 'post'
  ));
create index if not exists creator_page_events_creator_at_idx
  on public.creator_page_events (creator_id, at desc);

alter table public.creator_page_events enable row level security;
drop policy if exists "creator page events deny clients" on public.creator_page_events;
create policy "creator page events deny clients" on public.creator_page_events
  as restrictive for all to anon, authenticated
  using (false) with check (false);
revoke all on table public.creator_page_events from public, anon, authenticated;

drop function if exists public.bump_creator_page_view(uuid);
drop function if exists public.bump_creator_page_view(uuid, text);
create or replace function public.bump_creator_page_view(p_creator uuid, p_source text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_disabled() then
    return;
  end if;
  if p_source is not null and p_source not in (
    'copy', 'buyer', 'explore', 'creator', 'purchases', 'wa', 'community',
    'ig', 'yt', 'threads', 'post'
  ) then
    return;
  end if;
  -- Match bump_published_stats: one event per valid call, with no server rate limit.
  insert into public.creator_page_events (creator_id, source)
  select p.id, p_source from public.profiles p
  where p.id = p_creator and p.is_creator and not p.is_disabled;
end;
$$;
revoke all on function public.bump_creator_page_view(uuid, text) from public, anon;
grant execute on function public.bump_creator_page_view(uuid, text) to anon, authenticated;

drop function if exists public.get_creator_page_views();
drop function if exists public.get_creator_page_views(integer);
create or replace function public.get_creator_page_views(p_days integer default 30)
returns table (day date, source text, visits bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if public.is_disabled() then
    return;
  end if;
  return query
  select (e.at at time zone 'utc')::date as day, e.source, count(*) as visits
  from public.creator_page_events e
  where e.creator_id = auth.uid()
    and e.at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 730)))
  group by (e.at at time zone 'utc')::date, e.source
  order by 1 desc, e.source nulls first;
end;
$$;
revoke all on function public.get_creator_page_views(integer) from public, anon;
grant execute on function public.get_creator_page_views(integer) to authenticated;

-- Mirror prune_pub_events, including its default, clamp and service-only grant.
-- Optional operator schedule: select public.prune_creator_page_events();
-- This draft creates no hosted schedule.
drop function if exists public.prune_creator_page_events();
drop function if exists public.prune_creator_page_events(integer);
create or replace function public.prune_creator_page_events(p_keep_days integer default 730)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.creator_page_events
  where at < now() - make_interval(days => greatest(1, least(coalesce(p_keep_days, 730), 730)));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.prune_creator_page_events(integer) from public, anon, authenticated;
grant execute on function public.prune_creator_page_events(integer) to service_role;
commit;
