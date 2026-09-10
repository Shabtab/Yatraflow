-- ============ Trip trash RPCs (client wiring for the Trash view) ============
-- The 20260910_trip_trash.sql DDL hides trashed trips from every normal read via
-- the restrictive "trips read hide trashed" policy, so the owner can't discover
-- their own trashed trips through a plain select. These SECURITY DEFINER RPCs
-- provide the per-user list/restore/purge the Trash view needs, each re-checking
-- ownership (`owner_id = auth.uid()` + the tombstone) so a caller can never touch
-- another account's trip. Apply after 20260910_trip_trash.sql (uses`deleted_at`).

create or replace function public.get_trashed_trips()
returns setof public.trips
language sql
security definer
stable
set search_path = public
as $$
  select * from public.trips
  where owner_id = auth.uid() and deleted_at is not null
  order by deleted_at desc;
$$;
revoke all on function public.get_trashed_trips() from public, anon;
grant execute on function public.get_trashed_trips() to authenticated;

create or replace function public.restore_trashed_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.trips set deleted_at = null
  where id = p_trip_id and owner_id = auth.uid() and deleted_at is not null;
end;
$$;
revoke all on function public.restore_trashed_trip(uuid) from public, anon;
grant execute on function public.restore_trashed_trip(uuid) to authenticated;

create or replace function public.purge_trashed_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.trips
  where id = p_trip_id and owner_id = auth.uid() and deleted_at is not null;
end;
$$;
revoke all on function public.purge_trashed_trip(uuid) from public, anon;
grant execute on function public.purge_trashed_trip(uuid) to authenticated;
