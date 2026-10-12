-- ============================================================
-- 20261012a_join_trip_function.sql
--
-- Adds join_trip(p_code): the server path for joining a trip by invite code.
-- This file only adds a function. It is safe to run before the new app.
-- The current app keeps working.
--
-- When to run: BEFORE the app deploy that calls join_trip().
-- Run 20261012b_member_insert_owner_only.sql after the new app is live.
--
-- Safe to re-run. The old join_trip signature is dropped first, because
-- create or replace cannot rename a parameter.
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
