-- ============================================================
-- 20261012_member_join_guard.sql
--
-- A signed-in user could add a membership row for ANY trip, with ANY role.
-- The "members insert" policy accepted a row for the caller's own user id,
-- and the app wrote that row directly. So the caller chose the trip and the
-- role.
--
-- The fix has two parts.
--   1. join_trip(p_target) is the only path that adds a joiner. It takes a
--      trip UUID or an invite code. It applies the same guard as the invite
--      preview functions. It adds the caller as an editor.
--   2. The insert policy keeps only the owner branch. The trip owner still
--      adds and manages members. No client can add a row for itself.
--
-- join_trip() runs as its owner, so row-level security does not check its
-- writes. It checks public.is_disabled() itself, to keep the block on
-- disabled accounts.
--
-- Safe to re-run. The policy is dropped before it is created, because
-- Postgres has no "create policy if not exists".
-- ============================================================

-- ============================================================
-- join_trip(p_target): the server path for joining a trip.
--
-- p_target is a trip UUID (the /invite/<uuid> link) or an invite code (the
-- /join/<code> link). Holding either one is the capability. The function
-- returns the trip id, or null when no live trip matches.
--
-- The guard after "where" repeats get_trip_by_invite_code and get_invite_trip.
-- Keep the three in step.
-- ============================================================
create or replace function public.join_trip(p_target text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_key      text := upper(trim(coalesce(p_target, '')));
  v_as_uuid  uuid;
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

  -- Cast only a value that has the UUID shape. A code never reaches ::uuid.
  if v_key ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then
    v_as_uuid := v_key::uuid;
  end if;

  select t.id, t.owner_id = v_uid
    into v_trip_id, v_is_owner
  from public.trips t
  where (t.id = v_as_uuid or upper(t.invite_code) = v_key)
    and t.deleted_at is null
    and (
      t.owner_id = v_uid
      or public.is_member(t.id)
      or public.is_admin()
      or t.visibility = 'private'
      or not exists (
        select 1 from public.published_itineraries p
        where p.trip_id = t.id and coalesce(p.premium_price_inr, 0) > 0
      )
      or exists (
        select 1 from public.published_itineraries p
        where p.trip_id = t.id
          and (
            p.creator_id = v_uid
            or exists (
              select 1 from public.entitlements e
              where e.pub_id = p.id and e.user_id = v_uid
            )
          )
      )
    )
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
