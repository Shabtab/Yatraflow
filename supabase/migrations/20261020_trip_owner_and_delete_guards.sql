-- ============================================================
-- 20261020_trip_owner_and_delete_guards.sql
--
-- Closes #799 and #807. Both are RLS holes in the trips table.
--
-- #799: `trips update` checked only is_editor() for USING and WITH CHECK, so an
-- ordinary editor could set owner_id to their own id. Membership authority
-- follows trips.owner_id, so the attacker then promoted their own membership to
-- owner and deleted the original owner's row. Two updates, no admin, no RPC.
--
-- #807: `trips delete` allowed is_editor(), so an editor could delete a trip
-- directly. published_itineraries.trip_id cascades from trips, and
-- purchase_orders / entitlements / pub_events cascade from the publication, so
-- a direct DELETE destroyed a buyer's purchase and the creator's sales ledger.
-- The purge RPC refuses that trip; a direct table DELETE never runs the RPC.
--
-- This file is additive and safe to re-run. It creates no table and drops no
-- data. Every policy is dropped before it is created, and every function and
-- trigger is replaced.
--
-- When to run: BEFORE the app that relies on it, but it is written so the
-- CURRENT app keeps working. See the deploy order in the PR body and in
-- CHANGELOG. The existing client sends owner_id on every trip write, unchanged,
-- so a WITH CHECK that compared old and new would break every editor save.
-- ============================================================

-- ============================================================
-- 1. owner_id is immutable except for the current owner.
--
-- WHY A TRIGGER AND NOT ONLY A POLICY.
--
-- A policy WITH CHECK sees the NEW row only. Postgres does not expose OLD to a
-- policy, so `new.owner_id = old.owner_id` cannot be written as a policy at all.
-- The two shapes that can express "did this column change" are a trigger and a
-- column-level grant.
--
-- A column grant was rejected. The client sends the full row on every write
-- (tripToRow() always includes owner_id), so revoking UPDATE(owner_id) from
-- authenticated would fail every editor save, not only an ownership change.
--
-- A trigger is used, and it fails closed. The comparison is null-safe in both
-- directions: `is distinct from` treats null as a value, so a null on either
-- side is a change unless both are null. A row whose owner_id is somehow null
-- cannot be "kept" by a null = null test that silently passes.
--
-- The trigger is SECURITY INVOKER on purpose: it needs no privilege of its own,
-- and it must not be able to read rows the caller cannot. It runs before the
-- write, so a refused update changes nothing.
--
-- WHO MAY CHANGE OWNERSHIP:
--   * the current owner (OLD.owner_id = auth.uid())
--   * a masteradmin (is_admin()), because the console is the documented
--     maintenance path and an owner who leaves must not strand a trip.
--   * a request with NO authenticated user, which is the service-role / SQL
--     editor / migration path. auth.uid() is null there and is_admin() is
--     false, so without this branch every maintenance fix would need the
--     trigger dropped first. This branch is NOT reachable by anon or
--     authenticated: both always carry a sub claim, so auth.uid() is non-null.
--     It is the same trust boundary the SQL editor already has.
-- An ordinary editor matches none of these and is refused.
-- ============================================================
create or replace function public.trips_owner_id_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Unchanged owner: every ordinary content update takes this branch, including
  -- the tombstone UPDATE that sets deleted_at, which is how trash works.
  if new.owner_id is not distinct from old.owner_id then
    return new;
  end if;

  -- No authenticated caller: the service role, the SQL editor, or a migration.
  if auth.uid() is null then
    return new;
  end if;

  -- The current owner may hand the trip over.
  if old.owner_id = auth.uid() then
    return new;
  end if;

  -- The admin console may correct ownership.
  if public.is_admin() then
    return new;
  end if;

  -- Fail closed: an editor, a viewer, an outsider, or any shape not named above.
  raise exception
    'trip ownership cannot be changed by this caller (trip %, caller %)',
    old.id, auth.uid()
    using errcode = '42501';
end;
$$;

drop trigger if exists trips_owner_id_immutable on public.trips;
create trigger trips_owner_id_immutable
  before update of owner_id on public.trips
  for each row execute function public.trips_owner_id_immutable();

-- ============================================================
-- 2. trips update: keep editor write access, keep ownership guarded.
--
-- The policy is unchanged in substance: an editor may still update the trip.
-- The ownership guard lives in the trigger above, because only the trigger can
-- see OLD. A WITH CHECK here that compared owner_id with auth.uid()
-- would break the owner's own writes when the client echoes an unchanged
-- owner_id under a stale cache. It would also miss an editor who swaps owner_id
-- to a THIRD party's id.
--
-- It is re-created only to keep the drop/create pair in one place, and so a
-- later reader does not have to guess which file owns this policy.
-- ============================================================
drop policy if exists "trips update" on public.trips;
create policy "trips update" on public.trips
  for update using (public.is_editor(trips.id)) with check (public.is_editor(trips.id));

-- ============================================================
-- 3. trips delete: a restrictive guard.
--
-- The permissive "trips delete" policy stays as the editor gate. This new
-- RESTRICTIVE policy ANDs with it and adds the money and ownership conditions.
-- Restrictive is load-bearing: a permissive policy would OR with the existing
-- one and change nothing (the Sep-14 regression in this repo, see the
-- "trips read hide trashed" comment in schema.sql).
--
-- A restrictive policy on a table with only a DELETE command is evaluated
-- against the row being deleted, so USING is the only clause available and the
-- "added row" concern that applies to UPDATE does not apply here.
--
-- WHAT THE OWNER MAY DELETE:
--   * the owner, or a masteradmin, may delete a trip that carries NO
--     publication, NO paid order and NO entitlement -- the same condition
--     purge_trashed_trip applies, so the direct path and the RPC path agree;
--   * a non-owner editor may NOT delete at all. The product has no
--     "editor deletes the trip" flow: the store's deleteTrip and the trash both
--     belong to the owner, and crew removal goes through trip_members.
--
-- WHY THE MONEY CHECK IS A HELPER AND NOT AN INLINE SUBQUERY.
--
-- purchase_orders and entitlements are buyer-only under RLS: a buyer sees their
-- own rows, and the owner sees none of them. A policy expression runs as the
-- CALLER, so an inline `not exists (select 1 from public.purchase_orders ...)`
-- would see zero rows for the owner and pass -- the guard would fail OPEN
-- exactly where it matters most. A SECURITY DEFINER helper reads the tables
-- without RLS, so the check is the same for every caller.
-- ============================================================
create or replace function public.trip_has_publication_money(p_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Fail closed on an unknown shape: a null trip id has no money attached, but
  -- it also cannot be deleted safely, so it reports "has money" and the policy
  -- refuses it. Only a real trip with no publication, order or entitlement
  -- returns false.
  select
    p_trip is null
    or exists (
      select 1 from public.published_itineraries p where p.trip_id = p_trip
    )
    or exists (
      select 1 from public.purchase_orders o
      where o.pub_id in (select p.id from public.published_itineraries p where p.trip_id = p_trip)
    )
    or exists (
      select 1 from public.entitlements e
      where e.pub_id in (select p.id from public.published_itineraries p where p.trip_id = p_trip)
    )
$$;

-- A policy expression runs as the caller, so the caller needs EXECUTE. The
-- function itself leaks nothing: it returns one boolean for a trip id the
-- caller can already reach. Revoked from the API roles by name, then granted to
-- authenticated, because `revoke ... from public` does not revoke from anon.
revoke all on function public.trip_has_publication_money(uuid) from public, anon, authenticated;
grant execute on function public.trip_has_publication_money(uuid) to authenticated;

drop policy if exists "trips delete guard" on public.trips;
create policy "trips delete guard" on public.trips
  as restrictive for delete to authenticated using (
    (
      auth.uid() = owner_id
      or public.is_admin()
    )
    and not public.trip_has_publication_money(trips.id)
  );

-- The permissive editor gate is kept so the RESTRICTIVE policy is the only
-- change in behaviour. Re-created for the same reason as "trips update".
drop policy if exists "trips delete" on public.trips;
create policy "trips delete" on public.trips
  for delete using (public.is_editor(trips.id));

-- ============================================================
-- 4. Grants, named roles.
--
-- These policies and the trigger are reachable only through the table. No new
-- function is granted to a client role: the trigger function is invoked by the
-- table, and execute on it is not needed by anon or authenticated. Revoke it
-- from the API roles so it cannot be called directly, and name every role,
-- because `revoke ... from public` does not revoke from anon or authenticated
-- on Supabase.
-- ============================================================
revoke all on function public.trips_owner_id_immutable() from public, anon, authenticated;
