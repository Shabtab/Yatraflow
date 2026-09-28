-- ============================================================
-- 20260929_trash_purge_audit.sql
-- #387: the user-triggered "Delete forever" wrote no audit row.
--
-- The Trash view's purge (`purge_trashed_trip`, owner-scoped, granted to
-- `authenticated`) hard-deletes the trip and its cascaded collab layer with
-- zero trace, while every console destruction writes `admin_audit`. Permanent
-- destruction with no actor, no name and no counts is the thing being fixed.
--
-- This redefines ONLY the user-triggered singular purge. The scheduled sweep
-- (`purge_trashed_trips()`, service_role + cron) is untouched on purpose: a
-- nightly janitor row per expired trip would bury the deliberate human action
-- this log exists to record. Grants are unchanged (revoke public/anon, grant
-- authenticated) — the INSERT rides the function's SECURITY DEFINER bypass,
-- exactly like the admin RPCs, so no new grant is API surface.
--
-- Safe to re-run (`create or replace`). To apply: run this whole file in the
-- Supabase SQL editor, then `npm run check:migrations` (this file is declared
-- no-probe-surface: a redefined function exists before and after, so presence
-- answers nothing; the body is pinned by tests/trips-trash-honest-failure).
-- ============================================================

create or replace function public.purge_trashed_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.trips%rowtype;
  v_members integer;
  v_suggestions integer;
  v_decisions integer;
  v_activity integer;
begin
  -- Owner-only + tombstoned-only, exactly like the previous body: a caller can
  -- never touch another account's trip, and a live trip can never be purged.
  -- A miss is a no-op with no audit row — nothing was destroyed, so there is
  -- nothing to record.
  select * into v_row from public.trips
    where id = p_trip_id and owner_id = auth.uid() and deleted_at is not null;
  if not found then
    return;
  end if;
  -- Child counts BEFORE the cascade takes them (the audit row outlives the rows
  -- it counts, which is the point: the log says what the purge destroyed).
  select count(*) into v_members from public.trip_members where trip_id = p_trip_id;
  select count(*) into v_suggestions from public.suggestions where trip_id = p_trip_id;
  select count(*) into v_decisions from public.decisions where trip_id = p_trip_id;
  select count(*) into v_activity from public.activity where trip_id = p_trip_id;
  -- Audit BEFORE the effect (the admin-RPC contract): a failed delete leaves
  -- an "attempted" row, but a successful delete is never unlogged.
  insert into public.admin_audit (actor_id, action, target_type, target_id, detail)
    values (auth.uid(), 'trip.purge', 'trip', p_trip_id::text,
      jsonb_build_object(
        'name', v_row.name,
        'deleted_at', v_row.deleted_at,
        'destinations', v_row.destinations,
        'start_date', v_row.start_date, 'end_date', v_row.end_date,
        'members', v_members,
        'suggestions', v_suggestions,
        'decisions', v_decisions,
        'activity', v_activity));
  delete from public.trips
    where id = p_trip_id and owner_id = auth.uid() and deleted_at is not null;
end;
$$;

-- Grants unchanged from 20260910_trip_trash_rpc.sql: reachable by the owner,
-- by nobody else, and never by anon.
revoke all on function public.purge_trashed_trip(uuid) from public, anon;
grant execute on function public.purge_trashed_trip(uuid) to authenticated;
