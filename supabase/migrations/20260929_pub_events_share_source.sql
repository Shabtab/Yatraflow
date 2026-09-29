-- ============================================================
-- #230 · Share attribution (Stage 0 instrumentation) — how a reader ARRIVED
-- ============================================================
--
-- The launch signal "shares → views" was unmeasurable: a shared link carried no
-- reference, so every view and fork recorded a step with no route in. Three
-- changes, one vocabulary:
--
--   1. pub_events.source — the ref the event arrived with (NULL = direct).
--   2. trips.ref        — the fork's own acquisition stamp, so a later
--                         conversion on that trip can still name the surface.
--   3. bump_published_stats gains p_source, forwarded to the event row (the
--      counter itself is deliberately unchanged — attribution is a property of
--      the LOG, not of the lifetime count).
--
-- Vocabulary (mirrors SHARE_SOURCES in src/lib/shareUrl.ts and the list in
-- api/i.js — tests/share-attribution.test.ts pins all three together):
--
--   copy       — a Copy-link button (the creator's share box, the public page's)
--   buyer      — the buyer's purchase card (share sheet or clipboard fallback)
--   explore    — forked in-app from Explore
--   creator    — forked in-app from a creator page
--   purchases  — re-forked in-app from the My purchases shelf
--   NULL       — direct: typed/copied address, an old link, shared by hand
--
-- Log-only, per Stage 0's shape: aggregates derive at read
-- (admin_share_attribution below), never stored. No user id rides the column —
-- the same rule as the rest of pub_events: a step happened, never who took it.
-- The persistence decision this settles (the issue's second half): the readings
-- are transcribed by hand into the weekly release-log comment, NOT snapshotted
-- into a table — recorded in docs/commercial/PLAN-COMMERCIAL-EXECUTION.md.
--
-- Re-running is safe: every statement is idempotent (if-not-exists columns,
-- drop-if-exists constraints and the old overload, create-or-replace bodies).

-- 1. The event's route in ----------------------------------------------------
alter table public.pub_events add column if not exists source text;
alter table public.pub_events drop constraint if exists pub_events_source_check;
alter table public.pub_events add constraint pub_events_source_check
  check (source is null or source in ('copy', 'buyer', 'explore', 'creator', 'purchases'));

-- 2. The fork's own stamp ----------------------------------------------------
-- The client writes this through its optional-column probe (trips.ref), so a
-- database that has not run this file yet degrades to "no stamp" instead of
-- failing every trip save.
alter table public.trips add column if not exists ref text;
alter table public.trips drop constraint if exists trips_ref_check;
alter table public.trips add constraint trips_ref_check
  check (ref is null or ref in ('copy', 'buyer', 'explore', 'creator', 'purchases'));

-- 3. The counter's write gains the route in ----------------------------------
-- The old two-argument overload MUST drop first: with a defaulted third
-- parameter, a two-argument call matches both overloads and Postgres answers
-- "function is not unique" — the drop is what keeps cached (older) clients
-- working against this database.
drop function if exists public.bump_published_stats(text, text);

-- Body carried forward VERBATIM from 20260921_pub_funnel_events.sql (the
-- guards are load-bearing: the kind normalization, the unknown-kind no-op, and
-- the FOUND check that keeps the counter and the log from drifting), plus the
-- p_source column on the event insert.
create or replace function public.bump_published_stats(p_id text, p_kind text, p_source text default null)
returns void as $$
declare
  v_kind text;
begin
  if p_kind = 'views' then
    update public.published_itineraries set views = views + 1 where id = p_id;
    v_kind := 'view';
  elsif p_kind = 'copies' then
    update public.published_itineraries set copies = copies + 1 where id = p_id;
    v_kind := 'fork';
  else
    return;  -- unknown kind: no counter, no event
  end if;

  -- FOUND is the UPDATE's own result: publication row missing (unpublished or
  -- never issued) means nothing to count and nothing to record.
  if not found then
    return;
  end if;

  insert into public.pub_events (pub_id, kind, source) values (p_id, v_kind, p_source);
end;
$$ language plpgsql security definer set search_path = public;

-- Same audience as before: this is the anon-callable counter. Attribution does
-- not widen it — p_source is vocabulary-checked by the column's constraint, and
-- a garbage value refuses the insert (and the counter with it) rather than
-- filling the log with free text someone else's URL chose.
grant execute on function public.bump_published_stats(text, text, text) to anon, authenticated;

-- 4. The admin reader --------------------------------------------------------
-- Derive at read (Stage 0's shape): the log is the data, the readings are
-- computed from it. One row per source + 'direct' for the nulls. The 730-day
-- clamp matches the reader's own horizon (the get_creator_funnel /
-- prune_pub_events pair), so no argument can turn this read into a wider scan
-- than the log keeps.
create or replace function public.admin_share_attribution(p_days integer default 90)
returns table (source text, views bigint, forks bigint, last_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  return query
  select
    coalesce(e.source, 'direct') as source,
    count(*) filter (where e.kind = 'view') as views,
    count(*) filter (where e.kind = 'fork') as forks,
    max(e.at) as last_at
  from public.pub_events e
  where e.at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 730)))
  group by coalesce(e.source, 'direct')
  order by 2 desc;
end;
$$;

-- The #366 rule, applied to the new door the moment it is made: revoking from
-- `public` does not revoke from anon on Supabase, so both roles are named, and
-- only the console's own audience keeps the grant.
revoke all on function public.admin_share_attribution(integer) from public, anon;
grant execute on function public.admin_share_attribution(integer) to authenticated;
