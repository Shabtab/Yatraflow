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
-- When to run: AFTER the new app is live. Run 20261012a_join_trip_function.sql
-- first. Until this file runs, the old app still writes membership rows itself.
--
-- Safe to re-run. The policy is dropped before it is created, because Postgres
-- has no create-policy-if-not-exists form.
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
