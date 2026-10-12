-- ============================================================
-- 20261012b_member_insert_owner_only.sql
--
-- Closes the self-join hole. A signed-in user could add a membership row for
-- ANY trip, with ANY role, by writing the row from the app. This file keeps
-- only the owner branch of the "members insert" policy.
--
-- It also stops get_invite_trip(uuid) from returning the invite code, so a
-- trip id alone cannot reach the code.
--
-- It also issues new invite codes for trips that back a published itinerary.
-- Anyone holding a trip id could read the old codes. Members keep their
-- membership.
--
-- When to run: AFTER the new app is live. Run 20261012a_join_trip_function.sql
-- first. Until this file runs, the old app still writes membership rows itself.
--
-- Run this file once. The policy and the function are safe to re-run, because
-- the policy is dropped before it is created. The code re-issue is not safe to
-- re-run: a second run issues new codes again.
-- ============================================================

-- ============================================================
-- "members insert": the trip owner adds member rows. A joiner never writes
-- a row for itself. join_trip() is the only self-join path.
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

-- ============================================================
-- Re-issue the invite codes of trips that back a published itinerary.
-- The old code is replaced. Membership rows are not touched.
-- A new code has the shape of makeInviteCode in src/lib/inviteCode.ts: a head
-- from the trip name or start city, one dash, then eight tail characters.
-- ============================================================
do $$
declare
  v_trip     record;
  v_head     text;
  v_tail     text;
  v_byte     int;
  v_issued   boolean;
  v_alphabet text := 'ABCDEFGHJKLMNPQRTUVWXY346789';
  -- 256 / 28 gives 9 whole alphabets. A byte at or above 252 is redrawn.
  v_limit    int := 252;
begin
  for v_trip in
    select t.id, t.name, t.start_location
    from public.trips t
    where t.invite_code is not null
      and t.id in (select p.trip_id from public.published_itineraries p)
  loop
    -- Head: capital letters and digits only, at most 10 characters.
    v_head := coalesce(
      nullif(left(regexp_replace(upper(v_trip.name), '[^A-Z0-9]+', '', 'g'), 10), ''),
      nullif(left(regexp_replace(upper(v_trip.start_location), '[^A-Z0-9]+', '', 'g'), 10), ''),
      'YATRA'
    );
    v_issued := false;
    for v_attempt in 1..10 loop
      v_tail := '';
      while length(v_tail) < 8 loop
        v_byte := get_byte(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 0);
        if v_byte < v_limit then
          v_tail := v_tail || substr(v_alphabet, 1 + v_byte % 28, 1);
        end if;
      end loop;
      begin
        update public.trips set invite_code = v_head || '-' || v_tail where id = v_trip.id;
        v_issued := true;
        exit;
      exception when unique_violation then
        -- Another trip holds this code. Draw another.
        null;
      end;
    end loop;
    if not v_issued then
      raise exception 'no free invite code for trip %', v_trip.id;
    end if;
  end loop;
end
$$;
