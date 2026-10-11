-- ============================================================
-- 20261012_member_join_guard.sql
--
-- A signed-in user could add a membership row for ANY trip, with ANY role.
-- The "members insert" policy accepted a row for the caller's own user id,
-- and the app wrote that row directly. So the caller chose the trip and the
-- role.
--
-- The trip-id preview also returned the whole trip row, invite code included.
-- So a trip id could reach the code that joins the trip.
--
-- The fix has three parts.
--   1. join_trip(p_code) is the only path that adds a member. It takes an
--      invite code. It never takes a trip id. A new joiner becomes an editor.
--      The trip owner keeps the owner role.
--   2. get_invite_trip(uuid) returns the trip without its invite code.
--   3. The insert policy keeps only the owner branch. The trip owner still
--      adds and manages members. No client can add a row for itself.
--
-- join_trip() runs as its owner, so row-level security does not check its
-- writes. It checks public.is_disabled() itself, to keep the block on
-- disabled accounts.
--
-- Safe to re-run. The old join_trip signature is dropped first, because
-- create or replace cannot rename a parameter. The policy is dropped before
-- it is created, because Postgres has no create-policy-if-not-exists form.
-- ============================================================

-- ============================================================
-- join_trip(p_code): the server path for joining a trip.
--
-- p_code is the invite code from a /join/<code> link. Holding the code is the
-- capability. A trip id joins nobody. The function returns the trip id, or
-- null when no live trip has that code.
-- ============================================================
drop function if exists public.join_trip(text);

create or replace function public.join_trip(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_key      text := upper(trim(coalesce(p_code, '')));
  v_trip_id  uuid;
  v_is_owner boolean;
begin
  if v_uid is null then
    raise exception 'sign in to join a trip' using errcode = '42501';
  end if;

  -- The "deny disabled" policy does not run for this definer function.
  if public.is_disabled() then
    raise exception 'this account is disabled' using errcode = '42501';
  end if;

  if v_key = '' then
    return null;
  end if;

  select t.id, t.owner_id = v_uid
    into v_trip_id, v_is_owner
  from public.trips t
  where upper(t.invite_code) = v_key
    and t.deleted_at is null
  limit 1;

  if v_trip_id is null then
    return null;
  end if;

  -- An existing member keeps their role. The trip owner gets the owner role.
  -- Any other new joiner becomes an editor.
  insert into public.trip_members (trip_id, user_id, role, joined_at)
  values (
    v_trip_id,
    v_uid,
    case when v_is_owner then 'owner' else 'editor' end,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (trip_id, user_id) do nothing;

  return v_trip_id;
end;
$$;

revoke all on function public.join_trip(text) from public, anon, authenticated;
grant execute on function public.join_trip(text) to authenticated;

-- ============================================================
-- "members insert": the trip owner adds member rows. A joiner never writes
-- a row for itself. join_trip() above is the only self-join path.
-- ============================================================
drop policy if exists "members insert" on public.trip_members;
create policy "members insert" on public.trip_members
  for insert with check (
    exists (
      select 1 from public.trips t
      where t.id = trip_members.trip_id and t.owner_id = auth.uid()
    )
  );

-- ============================================================
-- get_invite_trip(uuid): the trip-id preview. It withholds the invite code.
--
-- The visibility and paywall guard is unchanged from 20260918. Only the
-- returned row changes: the code is cleared before the row leaves the function.
-- The loop keeps select t.* so the row type never drifts from the table.
-- ============================================================
create or replace function public.get_invite_trip(p_trip_id uuid)
returns setof public.trips
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_trip public.trips;
begin
  for v_trip in
    select t.* from public.trips t
    where t.id = p_trip_id
      and t.deleted_at is null
      and (
        t.owner_id = auth.uid()
        or public.is_member(t.id)
        or public.is_admin()
        -- Private trip: a preview by trip id, with no invite code.
        or t.visibility = 'private'
        -- Public trip: fine unless a live premium publication backs it.
        or not exists (
          select 1 from public.published_itineraries p
          where p.trip_id = t.id and coalesce(p.premium_price_inr, 0) > 0
        )
        -- Premium-backed: the creator or an entitled buyer may still preview
        -- (they see real days on the pub page anyway).
        or exists (
          select 1 from public.published_itineraries p
          where p.trip_id = t.id
            and (
              p.creator_id = auth.uid()
              or exists (
                select 1 from public.entitlements e
                where e.pub_id = p.id and e.user_id = auth.uid()
              )
            )
        )
      )
  loop
    -- The code joins the trip. A caller with only the trip id never gets it.
    v_trip.invite_code := null;
    return next v_trip;
  end loop;
  return;
end;
$$;

revoke all on function public.get_invite_trip(uuid) from public;
grant execute on function public.get_invite_trip(uuid) to anon, authenticated;
