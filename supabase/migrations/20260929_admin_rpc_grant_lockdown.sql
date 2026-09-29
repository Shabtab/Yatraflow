-- ============================================================
-- 20260929_admin_rpc_grant_lockdown.sql
-- #366 — the admin RPCs stop being anon-reachable at the grant level.
--
-- WHY: every admin RPC shipped `grant execute … to authenticated` with NO
-- explicit revoke, and Postgres' default function ACL is EXECUTE-to-PUBLIC —
-- so anonymous callers stayed grant-level-reachable, with only the in-function
-- `is_admin()` refusing them. That is defence-in-depth done backwards: the
-- guard is one forgotten `is_admin()` away from a world-callable admin action,
-- and no test would have caught it. The hardened shape already exists —
-- `admin_revenue` (20260921_admin_revenue.sql) — this file applies it to the
-- rest of the console.
--
-- WHAT THIS FILE IS: grants only. It creates no function, changes no body,
-- deletes nothing — so it cannot silently disturb any guard the function bodies
-- pin (the #356 rule). It sorts AFTER every file that grants on these functions
-- (20260909_masteradmin.sql, 20260916_admin_delete_user.sql,
-- 20260925_publication_soft_unpublish.sql), because name order decides which
-- grant a fresh in-order apply leaves behind.
--
-- DELIBERATELY UNTOUCHED (asserted by the contract suite so nobody "hardens"
-- them into breakage): `is_admin()` / `is_disabled()` keep their anon grants —
-- they answer false for anon by design, and client code calls them.
--
-- Run in the Supabase SQL editor (management plane). Idempotent: revoke/grant
-- are idempotent statements; re-running changes nothing.
-- ============================================================

-- 1. The five console RPCs from 20260909_masteradmin.sql --------------------
revoke all on function public.admin_set_disabled(uuid, boolean) from public, anon;
grant execute on function public.admin_set_disabled(uuid, boolean) to authenticated;

revoke all on function public.admin_set_creator(uuid, boolean) from public, anon;
grant execute on function public.admin_set_creator(uuid, boolean) to authenticated;

revoke all on function public.admin_set_trip_visibility(uuid, text) from public, anon;
grant execute on function public.admin_set_trip_visibility(uuid, text) to authenticated;

revoke all on function public.admin_remove_member(uuid, uuid) from public, anon;
grant execute on function public.admin_remove_member(uuid, uuid) to authenticated;

revoke all on function public.admin_delete_trip(uuid) from public, anon;
grant execute on function public.admin_delete_trip(uuid) to authenticated;

-- 2. The soft-unpublish redefinition (20260925) is the body a fresh apply
--    leaves; its grant gets the same lockdown here, AFTER it in name order. --
revoke all on function public.admin_unpublish(uuid) from public, anon;
grant execute on function public.admin_unpublish(uuid) to authenticated;

-- 3. True user deletion (20260916). -----------------------------------------
revoke all on function public.admin_delete_user(uuid, boolean) from public, anon;
grant execute on function public.admin_delete_user(uuid, boolean) to authenticated;

-- admin_revenue already carries this exact shape (revoke public, anon +
-- grant authenticated, 20260921_admin_revenue.sql); re-stating it here keeps
-- this file the one place that answers "what can reach an admin RPC", and the
-- contract suite asserts all eight against the live role list.
revoke all on function public.admin_revenue(integer, timestamptz) from public, anon;
grant execute on function public.admin_revenue(integer, timestamptz) to authenticated;
