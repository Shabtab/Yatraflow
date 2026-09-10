-- ============ Trip trash + 30-day purge (P4: soft-delete layer) ============
-- Backlog-pool item "trash + 30-day purge". A soft-delete layer: `deleteTrip`
-- (client) becomes an UPDATE that stamps `deleted_at` instead of a hard DELETE,
-- so a trip is restorable within 30 days and only then physically removed by the
-- purge function below. The six child tables (trip_members, suggestions,
-- decisions, activity, notifications, published_itineraries) keep their
-- `on delete cascade`, so the purge — a real DELETE — sweeps the collaboration
-- layer exactly as a hard delete always did.
--
-- This file ships the DDL ONLY. It must be applied live (Dashboard → SQL editor,
-- or `supabase db push`) before the client-side soft-delete wiring lands; the
-- store's `deleteTrip` still hard-deletes until then (see ROADMAP "trash + 30-day
-- purge" for the follow-up). Apply order: after 20260909_masteradmin.sql (it
-- depends on the public.is_admin() helper that migration introduced).

-- 1. The tombstone column. Null = live (the app's normal state).
alter table public.trips add column if not exists deleted_at timestamptz;

-- Index so the purge (and any future trash view) doesn't scan the whole table.
create index if not exists trips_deleted_at_idx
  on public.trips (deleted_at) where deleted_at is not null;

-- 2. Hide soft-deleted trips from every normal read. Postgres ANDs restrictive
--    policies with the permissive "trips read" one, so this alone hides trashed
--    trips from owners/members/public alike — while explicitly exempting admins
--    so the masteradmin console can still see and restore them (its admin
--    read/write bypass policies stay unfiltered).
create policy "trips read hide trashed" on public.trips
  as restrictive for select to authenticated
  using (deleted_at is null or public.is_admin());

-- 3. Purge: hard-delete trips trashed more than 30 days ago. SECURITY DEFINER so
--    a scheduled caller can sweep across owners; `on delete cascade` carries the
--    child tables. Returns the number of trips physically removed.
create or replace function public.purge_trashed_trips()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  with deleted as (
    delete from public.trips
    where deleted_at is not null and deleted_at < now() - interval '30 days'
    returning id
  )
  select count(*) into removed from deleted;
  return removed;
end;
$$;

-- The function should never be callable by the anon/authenticated roles — it
-- bypasses RLS. service_role (and any pg_cron owner) can run it.
revoke all on function public.purge_trashed_trips() from public, anon, authenticated;
grant execute on function public.purge_trashed_trips() to service_role;
