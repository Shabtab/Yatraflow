-- ============================================================================
-- RLS CONTRACT TEST — crew-facing policies (run in Dashboard → SQL editor)
-- ============================================================================
-- Verifies the policies an authenticated crew actually relies on, from the
-- management plane's own metadata (pg_policies / pg_proc / pg_publication).
-- Every probe is a DO-block assertion: it raises (and names the broken rule)
-- when the production shape drifts. A clean run prints exactly one row.
--
-- Covered:
--   1. trips            -- owner-scoped insert, editor-scoped update and
--                          delete, restrictive trashed-read (owner+editors
--                          still read tombstones)
--   2. trip_members     -- self-or-owner insert, owner update, owner-or-self
--                          delete, recursive-safe select (is_member definer)
--   3. child collab     -- suggestions / activity: editor-or-
--                          public read, editor write
--   4. notifications    -- recipient-only read, recipient-or-orchestrator write
--   5. published        -- public gallery read, creator-only write
--   6. trash wiring     -- per-user list/restore/purge RPCs re-check ownership,
--                          30-day sweep only via service_role, pg_cron schedule
--   7. capability RPCs  -- invite code / invite preview / published stats:
--                          security definer, granted to anon + authenticated
--   8. realtime         -- the collaboration layer is on supabase_realtime
--   9. trip touch       -- trips.updated_at is kept by the database (B2)
-- ============================================================================

-- ============================================================ 1. trips (v2)
-- Token-calibrated against live schema (2026-09-17): case-insensitive,
-- order-free matching; policy NAME is not asserted (pg_get_expr canonicalizes
-- keywords to UPPERCASE and wraps operands in parens).
do $$
begin
  -- 1a. Owner-scoped insert.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trips'
      and cmd = 'INSERT'
      and lower(coalesce(with_check, '')) like '%auth.uid()%'
      and lower(coalesce(with_check, '')) like '%owner_id%'
  ) then
    raise exception 'trips INSERT must be owner-scoped (WITH CHECK must pin owner_id to auth.uid())';
  end if;

  -- 1b. Editor-scoped update and delete.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trips'
      and cmd = 'UPDATE' and lower(coalesce(qual, '')) like '%is_editor%'
  ) then
    raise exception 'trips UPDATE must be editor-scoped (is_editor(id))';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trips'
      and cmd = 'DELETE' and lower(coalesce(qual, '')) like '%is_editor%'
  ) then
    raise exception 'trips DELETE must be editor-scoped (is_editor(id))';
  end if;

  -- 1b-bis. #799 / #807 hardening (migration 20261020_trip_owner_and_delete_guards).
  --
  -- 1b-bis-1: ownership is immutable. A policy cannot express this, because a
  --     WITH CHECK sees only the NEW row and Postgres never exposes OLD to a
  --     policy. Assert the BEFORE UPDATE OF owner_id trigger and its function
  --     exist, so a later edit cannot quietly drop the only guard that can see
  --     the old value.
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and c.relname = 'trips'
      and t.tgname = 'trips_owner_id_immutable'
      and not t.tgisinternal
      and p.proname = 'trips_owner_id_immutable'
  ) then
    raise exception '#799: the trips owner_id immutability trigger is missing -- an editor can take ownership again';
  end if;

  -- 1b-bis-2: the trigger body must compare null-safely. A bare `new.owner_id
  --     <> old.owner_id` is NULL when either side is null, which is not TRUE,
  --     so a null-owner row would slip through. `is distinct from` is the
  --     fail-closed form. The schema filter is load-bearing: a same-named
  --     function in another schema must not satisfy this.
  if not exists (
    select 1 from pg_proc
    where proname = 'trips_owner_id_immutable'
      and pronamespace = 'public'::regnamespace
      and lower(coalesce(prosrc, '')) like '%is distinct from%'
  ) then
    raise exception '#799: the owner_id guard must compare with IS DISTINCT FROM (null-safe), not <> or =';
  end if;

  -- 1b-bis-3: #807 delete guard. It must be RESTRICTIVE (a permissive policy
  --     would OR with the editor gate and change nothing), owner-or-admin
  --     scoped, and route the money check through the SECURITY DEFINER helper.
  --     An inline subquery on a buyer-only table would see no rows for the
  --     owner and fail OPEN. Token presence alone is not behaviour -- the
  --     accompanying vitest pin and the opt-in harness run the actual DELETE.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trips'
      and policyname = 'trips delete guard'
      and cmd = 'DELETE'
      and permissive = 'RESTRICTIVE'
      and lower(coalesce(qual, '')) like '%owner_id%'
      and lower(coalesce(qual, '')) like '%is_admin%'
      and lower(coalesce(qual, '')) like '%trip_has_publication_money%'
  ) then
    raise exception '#807: the trips delete guard drifted -- it must be RESTRICTIVE and route the money check through trip_has_publication_money';
  end if;

  -- 1b-bis-3b: the helper must exist in public, be SECURITY DEFINER, and be
  --     callable by authenticated (a policy expression runs as the caller).
  if not exists (
    select 1 from pg_proc
    where proname = 'trip_has_publication_money'
      and pronamespace = 'public'::regnamespace
      and prosecdef
      and lower(coalesce(prosrc, '')) like '%purchase_orders%'
      and lower(coalesce(prosrc, '')) like '%entitlements%'
      and lower(coalesce(prosrc, '')) like '%published_itineraries%'
  ) then
    raise exception '#807: trip_has_publication_money must exist in public, be SECURITY DEFINER, and check all three money tables';
  end if;

  -- 1b-bis-3c: anon must NOT reach the helper. Revoking from public alone does
  --     not revoke from anon on Supabase, so the grant list is checked.
  if has_function_privilege('anon', 'public.trip_has_publication_money(uuid)', 'execute') then
    raise exception '#807: anon can execute trip_has_publication_money -- revoke it from anon by name';
  end if;

  -- 1b-bis-4: the delete guard must AND with the editor gate, not replace it.
  --     Two policies, opposite kinds, is the intended shape.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trips'
      and cmd = 'DELETE' and permissive = 'PERMISSIVE'
      and lower(coalesce(qual, '')) like '%is_editor%'
  ) then
    raise exception 'trips DELETE lost its permissive editor gate; the restrictive guard must AND with it, not replace it';
  end if;

  -- 1c. Trashed-read (v0.59 shape): the hide-trashed policy must be
  --     RESTRICTIVE -- it ANDs with the base read -- and carry both halves:
  --     a live-row branch (`deleted_at is null`) so live rows pass exactly
  --     where "trips read" admits them, plus an accepter for the updated row
  --     (owner/editor/admin) without which the tombstone UPDATE fails 42501
  --     and "Delete" silently no-ops (reproduced live, Sep 14 2026).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trips'
      and policyname = 'trips read hide trashed'
      and cmd = 'SELECT'
      and permissive = 'RESTRICTIVE'
      and lower(coalesce(qual, '')) like '%deleted_at is null%'
      and lower(coalesce(qual, '')) like '%auth.uid()%'
      and lower(coalesce(qual, '')) like '%owner_id%'
      and lower(coalesce(qual, '')) like '%is_editor%'
      and lower(coalesce(qual, '')) like '%is_admin%'
  ) then
    raise exception 'trips trashed-read drifted: must be RESTRICTIVE with a live-row branch and an owner/editor/admin accepter';
  end if;

  -- 1c-bis. The invariant behind the Sep-14 leak: a live-row
  --     ('deleted_at is null') branch on a PERMISSIVE SELECT policy
  --     OR-combines and widens reads for every role that policy touches.
  --     It may only live on the restrictive policy above.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trips'
      and cmd = 'SELECT'
      and permissive = 'PERMISSIVE'
      and lower(coalesce(qual, '')) like '%deleted_at is null%'
  ) then
    raise exception 'a PERMISSIVE trips SELECT carries a deleted_at is null branch -- permissive policies OR-combine, so it widens reads';
  end if;

  -- 1d. Base read (post-20260918_payments_security.sql): crew-or-admin for
  --     authenticated callers only -- no visibility/anon/public branch. The
  --     public page reads through the security-definer get_public_trip RPC.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trips'
      and cmd = 'SELECT'
      and lower(coalesce(qual, '')) like '%is_member%'
      and lower(coalesce(qual, '')) like '%auth.uid()%'
      and lower(coalesce(qual, '')) like '%is_admin%'
      and roles::text like '%authenticated%'
  ) then
    raise exception 'trips base read drifted: must be crew-or-admin, scoped to authenticated callers';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trips'
      and cmd = 'SELECT'
      and (roles::text like '%anon%' or roles::text like '%public%')
  ) then
    raise exception 'trips has an anon/public SELECT policy -- direct public reads must go through get_public_trip';
  end if;

  -- 1e. Update WITH CHECK stays editor-pinned (no transfer to non-editable rows).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trips'
      and cmd = 'UPDATE' and lower(coalesce(with_check, '')) like '%is_editor%'
  ) then
    raise exception 'trips update WITH CHECK drifted: must stay editor-pinned';
  end if;
end $$;

-- ------------------------------------------------------------ 2. trip_members
do $$
begin
  -- Recursive-safe select: user_id = auth.uid() OR is_member(trip_id) -- the
  -- direct subquery form recurses (42P17); the definer form is required.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trip_members'
      and cmd = 'SELECT' and qual like '%is_member%'
  ) then
    raise exception 'trip_members SELECT must use the security-definer is_member() (42P17 recursion guard)';
  end if;

  -- Owner-only insert. A joiner gets a row from join_trip(), never from a
  -- direct insert, so no INSERT policy may let a user add their own row.
  -- INSERT expressions ride with_check.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trip_members'
      and cmd = 'INSERT' and with_check like '%owner_id%auth.uid()%'
  ) then
    raise exception 'trip_members INSERT must allow owner management';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trip_members'
      and cmd = 'INSERT' and with_check like '%user_id%auth.uid()%'
  ) then
    raise exception 'trip_members INSERT must not let a user add their own row (joins go through join_trip)';
  end if;

  -- Owner update, owner-or-self delete (leave a trip you're on).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trip_members'
      and cmd = 'UPDATE' and qual like '%owner_id%auth.uid()%'
  ) then
    raise exception 'trip_members UPDATE must be owner-managed';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'trip_members'
      and cmd = 'DELETE' and qual like '%user_id%auth.uid()%'
  ) then
    raise exception 'trip_members DELETE must allow owner or self (leave a trip you''re on)';
  end if;
end $$;

-- --------------------------------------------------------- 2b. profiles (#800)
-- The private account table. `profiles read` used to be `for select using (true)`,
-- which defaults to the `public` role — so `anon` matched it and RLS, which limits
-- rows rather than columns, published `email` to everyone. These assertions pin
-- the replacement: self-plus-admin SELECT, no permissive policy at all, and the
-- public read moved to a projection that carries none of the private columns.
do $$
declare
  col text;
begin
  -- No permissive SELECT may exist. A `using (true)` policy with no role
  -- restriction is the defect itself, so it is refused outright rather than
  -- only needed to be gone, not just renamed.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and cmd = 'SELECT' and permissive = 'PERMISSIVE'
      and (qual is null or qual like '%true%')
      and 'public' = any(roles)
  ) then
    raise exception 'profiles must not carry a permissive whole-table SELECT policy';
  end if;

  -- The replacement: authenticated self SELECT on the owner column.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and cmd = 'SELECT' and qual like '%auth.uid()% = %id%'
  ) then
    raise exception 'profiles SELECT must be self-scoped on id';
  end if;

  -- The admin read bypass stays, and stays authenticated-only.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and cmd = 'SELECT' and qual like '%is_admin%' and 'authenticated' = any(roles)
  ) then
    raise exception 'profiles must keep an authenticated admin read';
  end if;

  -- Self update stays self-scoped, with a matching WITH CHECK.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and cmd = 'UPDATE' and qual like '%auth.uid()% = %id%' and with_check like '%auth.uid()% = %id%'
  ) then
    raise exception 'profiles UPDATE must stay self-scoped';
  end if;

  -- The restrictive disabled denial stays, so a disabled account reads nothing.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and permissive = 'RESTRICTIVE' and cmd = 'ALL' and qual like '%is_disabled%'
  ) then
    raise exception 'profiles must keep the RESTRICTIVE deny-disabled policy';
  end if;

  -- The public projection exists, is not the private table, and holds none of the
  -- private columns. The column list is the allowlist, so it is asserted by name.
  if not exists (
    select 1 from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profile_cards' and a.attname = 'id' and a.attnum > 0
  ) then
    raise exception 'the public profile projection (public.profile_cards) must exist';
  end if;
  foreach col in array array['email','home_city','languages','travel_styles','is_disabled','created_at'] loop
    if exists (
      select 1 from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'profile_cards' and a.attname = col and a.attnum > 0
    ) then
      raise exception 'profile_cards must not carry the private column %', col;
    end if;
  end loop;

  -- The projection is kept in step transactionally, and clients cannot write it.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_sync_card' and not tgisinternal
  ) then
    raise exception 'profiles must carry the projection sync trigger';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profile_cards' and cmd in ('INSERT','UPDATE','DELETE')
  ) then
    raise exception 'profile_cards must not be client-writable';
  end if;

  -- The private table is OFF the realtime publication and the projection is ON,
  -- so a live profile event carries the safe columns and never a private one.
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    raise exception 'profiles must not be a realtime event source';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profile_cards'
  ) then
    raise exception 'profile_cards must be the realtime event source';
  end if;

  -- admin_audit holds a deleted user's email, so it needs the same RESTRICTIVE
  -- denial the other tables have. Without it, a disabled admin with a still-valid
  -- JWT reads the audit — and the addresses — in the window before the app signs
  -- them out.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_audit'
      and permissive = 'RESTRICTIVE' and cmd = 'ALL' and qual like '%is_disabled%'
  ) then
    raise exception 'admin_audit must keep the RESTRICTIVE deny-disabled policy';
  end if;
end $$;

-- --------------------------------------------------------- 3. child collab layer
do $$
declare
  child text;
begin
  -- Contribution JSON has no direct insert path. Editor workflow updates and
  -- deletes remain available for suggestions and decisions. Activity is RPC-only.
  foreach child in array array['suggestions', 'decisions', 'activity'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = child
        and cmd = 'SELECT' and qual like '%is_editor%'
    ) then
      raise exception '% SELECT must be editor-or-public', child;
    end if;
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = child
        and cmd = 'ALL' and permissive = 'PERMISSIVE'
    ) then
      raise exception '% must not have a FOR ALL policy', child;
    end if;
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = child and cmd = 'INSERT'
    ) then
      raise exception '% direct INSERT is unsafe; use submit_collab_command', child;
    end if;
    if child in ('suggestions','decisions') and not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename=child and cmd='UPDATE'
        and qual like '%is_editor%' and with_check like '%is_editor%'
    ) then
      raise exception '% workflow UPDATE must stay editor-scoped', child;
    end if;
    if child in ('suggestions','decisions') and not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename=child and cmd='DELETE' and qual like '%is_editor%'
        and qual like '%auth.uid()%' and qual like '%owner_id%'
    ) then
      raise exception '% DELETE must be editor-scoped and author-or-owner', child;
    end if;
    if child='activity' and exists (
      select 1 from pg_policies where schemaname='public' and tablename=child
        and cmd in ('INSERT','UPDATE','DELETE')
    ) then
      raise exception 'activity is append-only through submit_collab_command';
    end if;
    if exists (
      select 1 from pg_policies where schemaname='public' and tablename=child
        and policyname='admin write'
    ) then
      raise exception '% admin direct-write escape hatch must be removed', child;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------ 4. notifications
do $$
begin
  -- Recipient-only read, update and delete. Editors may insert for members.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and cmd = 'SELECT' and qual like '%auth.uid()%user_id%'
      and policyname <> 'admin read'
  ) then
    raise exception 'notifications SELECT must be recipient-only';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and cmd = 'ALL' and permissive = 'PERMISSIVE'
  ) then
    raise exception 'notifications must not have a FOR ALL policy';
  end if;
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='notifications'
      and cmd='SELECT' and policyname='admin read'
  ) then
    raise exception 'notifications SELECT must remain recipient-only';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='notifications'
      and cmd='UPDATE' and qual like '%auth.uid()%user_id%'
      and with_check like '%auth.uid()%user_id%'
  ) or not exists (
    select 1 from pg_policies where schemaname='public' and tablename='notifications'
      and cmd='DELETE' and qual like '%auth.uid()%user_id%'
  ) then
    raise exception 'notifications UPDATE and DELETE must be recipient-only';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='notifications'
      and cmd='INSERT' and with_check like '%is_editor%'
      and with_check like '%trip_members%'
  ) then
    raise exception 'notifications INSERT must be editor-scoped to current members';
  end if;
end $$;

-- -------------------------------------------------------- 5. published gallery
do $$
begin
  -- Public gallery read (any visitor); creator-only write.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'published_itineraries'
      and cmd = 'SELECT' and qual = 'true'
  ) then
    raise exception 'published_itineraries SELECT must be public (Explore gallery)';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'published_itineraries'
      and cmd = 'ALL' and qual like '%creator_id%'
  ) then
    raise exception 'published_itineraries write must be creator-only';
  end if;
end $$;

-- ------------------------------------------------------------ 6. trash wiring
do $$
begin
  -- Per-user trash RPCs: the list runs as SECURITY DEFINER, so the body
  -- must pin rows to the caller (owner_id = auth.uid()); prosecdef is the
  -- pg_proc SECURITY DEFINER flag.
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_trashed_trips'
      and p.prosecdef = true
  ) then
    raise exception 'get_trashed_trips must be SECURITY DEFINER (per-user trash list)';
  end if;

  -- The 30-day sweep bypasses RLS: never callable by user roles.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'purge_trashed_trips'
      and exists (
        -- proacl is aclitem[] (opaque to LIKE); aclexplode yields typed rows.
        -- grantee 0 = PUBLIC; NULL proacl = default ACL = EXECUTE to PUBLIC.
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
        where e.grantee = 0
           or e.grantee in (
             select oid from pg_roles where rolname in ('anon', 'authenticated')
           )
      )
  ) then
    raise exception 'purge_trashed_trips must never be granted to anon/authenticated (bypasses RLS)';
  end if;
end $$;

-- --------------------------------------------------------- 7. capability RPCs
do $$
declare
  rpc text;
begin
  -- Capability RPCs: security definer, reachable by whoever holds the
  -- capability (anon + authenticated grants).
  foreach rpc in array array['get_trip_by_invite_code', 'get_invite_trip', 'bump_published_stats'] loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = rpc
        and p.prosecdef = true
    ) then
      raise exception '% must be SECURITY DEFINER', rpc;
    end if;
    if exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = rpc
        and not exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
          where e.grantee = 0
             or e.grantee in (
               select oid from pg_roles where rolname in ('anon', 'authenticated')
             )
        )
    ) then
      raise exception '% must be granted to anon + authenticated', rpc;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ 8. realtime
do $$
declare
  table_name text;
begin
  -- The collaboration layer broadcasts live (multi-editor sync).
  foreach table_name in array array['trips', 'trip_members', 'suggestions', 'decisions', 'activity', 'notifications', 'published_itineraries', 'profiles', 'admin_audit'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = table_name
    ) then
      raise exception '% must be on supabase_realtime (live collaboration)', table_name;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ 9. trip touch trigger
-- The stale-update guard compares an incoming realtime row's updated_at
-- against the last SERVER-applied timestamp. For those timestamps to be
-- comparable they must be maintained by the database itself. The touch
-- trigger must exist with the expected shape (BEFORE+UPDATE, non-internal)
-- AND call the canonical function — the trigger name alone is not enough:
-- the migration and schema.sql briefly defined different functions under the
-- same trigger name, and whichever ran last won, silently. tgfoid::regproc
-- pins WHICH function the trigger fires.
do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.trips'::regclass
      and t.tgname = 'trips_touch_updated_at'
      and not t.tgisinternal
      and (t.tgtype & 2) <> 0   -- TG_BEFORE
      and (t.tgtype & 8) <> 0   -- TG_ROW
      and (t.tgtype & 16) <> 0  -- TG_UPDATE
      and t.tgfoid::regproc::text = 'touch_trip_updated_at'
  ) then
    raise exception 'trips_touch_updated_at trigger missing or firing the wrong function — (re-)apply 20260919_trip_touch_updated_at.sql (it must call touch_trip_updated_at, per schema.sql; the migration is idempotent and drops the diverged trips_touch_updated_at)';
  end if;
end $$;

-- ------------------------------------------------- 10. funnel events (I-22)
-- The dated funnel log is a NEW anon-reachable write surface (it is filled by
-- bump_published_stats, which anon may call), so its contract is pinned here
-- rather than left to review: no direct writes from a client, no reading
-- another creator's funnel, and no anon access to the reader.
do $$
begin
  -- The log must exist with its shape: kind is constrained, and a publication
  -- delete takes its events with it (no orphan rows accumulating unreachable).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pub_events'::regclass
      and conname = 'pub_events_kind_check'
  ) then
    raise exception 'pub_events.kind must be CHECK-constrained to view/fork — (re-)apply 20260921_pub_funnel_events.sql';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pub_events'::regclass
      and contype = 'f'
      and confrelid = 'public.published_itineraries'::regclass
      and confdeltype = 'c'   -- ON DELETE CASCADE
  ) then
    raise exception 'pub_events.pub_id must cascade with its publication';
  end if;

  -- RLS on, and NO insert/update/delete policy: the definer function is the
  -- only writer, so a client cannot fabricate funnel steps.
  if not exists (
    select 1 from pg_class where oid = 'public.pub_events'::regclass and relrowsecurity
  ) then
    raise exception 'pub_events must have row level security enabled';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pub_events'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and not (roles = '{authenticated}' and policyname = 'deny disabled')
  ) then
    raise exception 'pub_events must have no client write policy (only bump_published_stats writes it)';
  end if;

  -- The reader is definer-scoped by the caller's own uid, and authenticated
  -- only: `revoke ... from public` does not revoke from anon on Supabase, so
  -- an anon grant here would hand out a funnel to nobody.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_creator_funnel'
      and p.prosecdef = true
  ) then
    raise exception 'get_creator_funnel must be SECURITY DEFINER (it reads past RLS) — (re-)apply 20260921_pub_funnel_events.sql';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
    where n.nspname = 'public' and p.proname = 'get_creator_funnel'
      and (e.grantee = 0 or e.grantee = (select oid from pg_roles where rolname = 'anon'))
  ) then
    raise exception 'get_creator_funnel must never be granted to anon or PUBLIC (a creator funnel is not public)';
  end if;
end $$;

-- ---- pub_events retention (20260922_pub_events_retention.sql) -------------
-- The pruner is a bulk-delete surface on a log no client may otherwise touch,
-- so its contract is pinned here too: it exists, it is definer (it runs from
-- cron as the owner), it is NOT callable by anon, and — the one that stops
-- silent data loss — its horizon is clamped to the READER's own clamp, so
-- pruning can never shrink the funnel's memory below what a reader can ask
-- for. If the reader's horizon ever widens past 730, this row must change
-- WITH it, which is exactly when the pairing should be re-decided.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'prune_pub_events'
      and p.prosecdef = true
  ) then
    raise exception 'prune_pub_events must exist and be SECURITY DEFINER — apply 20260922_pub_events_retention.sql';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
    where n.nspname = 'public' and p.proname = 'prune_pub_events'
      and (e.grantee = 0 or e.grantee = (select oid from pg_roles where rolname = 'anon'))
  ) then
    raise exception 'prune_pub_events must never be granted to anon or PUBLIC (a bulk delete is not public)';
  end if;

  -- #356. The anon check above was necessary and not sufficient: the function
  -- shipped granted to `authenticated`, and its predicate is purely `at <
  -- horizon` — not scoped to a publication, a creator, or the caller. So any
  -- logged-in account could delete EVERY publication's history, and the only
  -- symptom is a funnel trend reading "nothing recorded". Nothing in the app
  -- calls it (the SQL editor runs as the owner, pg_cron as the definer), so
  -- the grant belongs to service_role alone, like revoke_refunded_entitlement.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
    where n.nspname = 'public' and p.proname = 'prune_pub_events'
      and e.grantee = (select oid from pg_roles where rolname = 'authenticated')
  ) then
    raise exception 'prune_pub_events must not be granted to authenticated — it deletes every publication''s history and is not scoped to its caller; apply 20260927_prune_pub_events_lockdown.sql';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
    where n.nspname = 'public' and p.proname = 'prune_pub_events'
      and e.grantee = (select oid from pg_roles where rolname = 'service_role')
  ) then
    raise exception 'prune_pub_events must stay executable by service_role — that is the operator and cron path, and locking it out entirely would leave the log unprunable';
  end if;

  -- The horizon pairing: the pruner's own clamp must equal the reader's. Both
  -- are 730 today; change them together or not at all.
  if coalesce(
    (select p.proconfig -> 'search_path' is not null from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'prune_pub_events' limit 1),
    false
  ) is null then
    raise exception 'prune_pub_events disappeared between checks';
  end if;
end $$;

do $$
begin
  -- The clamp itself, read back from the function body: the pruner must clamp
  -- to the same 730 the reader clamps to (greatest(1, least(..., 730))).
  if coalesce((
    select position('least(coalesce(p_keep_days, 730), 730)' in p.prosrc) > 0
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'prune_pub_events' limit 1
  ), false) is not true then
    raise exception 'prune_pub_events must clamp its horizon to the reader''s own 730-day clamp — the retention window must never be narrower than what get_creator_funnel can read';
  end if;
end $$;

do $$
begin
  -- #366. The admin console's RPCs must never be anon-reachable at the GRANT
  -- level. The in-function is_admin() is what authorizes; the grant is only
  -- reachability — and the default function ACL is EXECUTE-to-PUBLIC, so a
  -- bare `grant … to authenticated` leaves anon reachable and one forgotten
  -- is_admin() away from a world-callable admin action. All eight admin RPCs
  -- (the six console actions + delete_user + revenue) are probed the same way
  -- prune_pub_events is above: aclexplode against the effective ACL, with the
  -- default-ACL NULL meaning PUBLIC and asserted explicitly.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
    where n.nspname = 'public'
      and p.proname in (
        'admin_set_disabled', 'admin_set_creator', 'admin_set_trip_visibility',
        'admin_remove_member', 'admin_unpublish', 'admin_delete_trip',
        'admin_delete_user', 'admin_revenue')
      and (e.grantee = 0 or e.grantee = (select oid from pg_roles where rolname = 'anon'))
  ) then
    raise exception 'admin RPCs must never be granted to anon or PUBLIC — the in-function is_admin() is the guard, the grant must not be the reachability; apply 20260929_admin_rpc_grant_lockdown.sql';
  end if;

  -- The intentional grants stay asserted-PRESENT so nobody "hardens" them into
  -- breakage: is_admin()/is_disabled() answer false for anon by design and the
  -- client calls them. Counted positively — BOTH functions must still carry an
  -- anon grant, or the lockdown over-reached.
  if (select count(distinct p.proname) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
    join pg_roles r on r.oid = e.grantee
    where n.nspname = 'public' and p.proname in ('is_admin', 'is_disabled')
      and r.rolname = 'anon'
  ) < 2 then
    raise exception 'is_admin()/is_disabled() must keep their anon grants — they answer false for anon by design and client code calls them';
  end if;
end $$;

do $$
begin
  -- #230: admin_share_attribution is the console's share-attribution read —
  -- same door rule as the eight above, asserted by name because it ships in
  -- its own migration (20260929_pub_events_share_source.sql) rather than the
  -- lockdown file. Both halves matter: never anon/PUBLIC, AND still granted to
  -- the console's own audience — a function with no grants at all would pass a
  -- denial-only check while the tab is quietly broken.
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.pronowner))) e
    where n.nspname = 'public'
      and p.proname = 'admin_share_attribution'
      and (e.grantee = 0 or e.grantee = (select oid from pg_roles where rolname = 'anon'))
  ) then
    raise exception 'admin_share_attribution must never be granted to anon or PUBLIC — apply 20260929_pub_events_share_source.sql';
  end if;
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.pronowner))) e
    join pg_roles r on r.oid = e.grantee
    where n.nspname = 'public'
      and p.proname = 'admin_share_attribution'
      and r.rolname = 'authenticated'
  ) then
    raise exception 'admin_share_attribution must stay granted to authenticated — the console calls it';
  end if;
end $$;

do $$
begin
  -- #366, second half: the audit log's read surface. admin_audit is
  -- append-only evidence — every admin action lands here with who did it — so
  -- a policy that let any authenticated account UPDATE or DELETE a row would
  -- let an admin rewrite their own trail. Read must exist for the console and
  -- be admin-gated; write paths must be INSERT-only.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_audit'
      and cmd in ('SELECT', 'ALL')
      and qual like '%is_admin()%'
  ) then
    raise exception 'admin_audit needs an admin-gated read policy (is_admin() in the qual)';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_audit'
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'admin_audit is append-only: no UPDATE/DELETE/ALL policy may exist for any role';
  end if;

  -- #554. apply_order_refund decides full-vs-partial refunds and can revoke
  -- entitlements — the same blast radius as revoke_refunded_entitlement, so
  -- the same contract: service_role (the webhook) alone may call it. The
  -- default function ACL is EXECUTE-to-PUBLIC, so a missing revoke would leave
  -- it world-callable.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
    where n.nspname = 'public' and p.proname = 'apply_order_refund'
      and e.grantee in ((select oid from pg_roles where rolname = 'anon'),
                        (select oid from pg_roles where rolname = 'authenticated'),
                        0::oid)
  ) then
    raise exception 'apply_order_refund must not be granted to anon/authenticated/public — it revokes entitlements and is the webhook''s alone';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
    where n.nspname = 'public' and p.proname = 'apply_order_refund'
      and e.grantee = (select oid from pg_roles where rolname = 'service_role')
  ) then
    raise exception 'apply_order_refund must stay executable by service_role — the webhook path; a lockdown strands every refund event';
  end if;
end $$;

-- ---------------------------------------------------------- 5. command layer
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='submit_collab_command'
      and pg_get_function_identity_arguments(p.oid)='p_command_id text, p_trip_id text, p_command jsonb'
  ) then raise exception 'submit_collab_command(text,text,jsonb) is required'; end if;
  if not has_function_privilege('authenticated','public.submit_collab_command(text,text,jsonb)','EXECUTE') then
    raise exception 'authenticated callers must execute submit_collab_command';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) e
    where n.nspname='public' and p.proname='submit_collab_command'
      and e.grantee in (0::oid,(select oid from pg_roles where rolname='anon'))
  ) then raise exception 'submit_collab_command must revoke PUBLIC and anon'; end if;

  if not has_function_privilege('authenticated','public.restore_trip_contributions(text)','EXECUTE') then
    raise exception 'authenticated owner restore path is missing';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) e
    where n.nspname='public' and p.proname='prune_trip_contribution_restore_events'
      and (e.grantee=0::oid or e.grantee in (select oid from pg_roles where rolname in ('anon','authenticated')))
  ) then
    raise exception 'restore archive cleanup must remain service-role only';
  end if;
  if not has_function_privilege('service_role','public.prune_trip_contribution_restore_events()','EXECUTE') then
    raise exception 'service_role must run archive cleanup';
  end if;

  if not (select relrowsecurity from pg_class where oid='public.collab_commands'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.trip_contribution_restore_events'::regclass) then
    raise exception 'command and restore receipt tables must have RLS enabled';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in ('collab_commands','trip_contribution_restore_events')) then
    raise exception 'command and restore receipt tables must have no client policies';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.suggestions'::regclass and tgname='suggestions_guard_contributions' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgrelid='public.decisions'::regclass and tgname='decisions_guard_contributions' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgrelid='public.trips'::regclass and tgname='trips_record_contribution_delete' and not tgisinternal) then
    raise exception 'contribution guards and restore archive trigger need to exist';
  end if;
end $$;

-- ------------------------------------------------------------------------ done
select 'rls contract: all crew-facing policies verified' as result;
