-- ============================================================
-- 20260909_masteradmin.sql
-- Masteradmin console (v0.45.0): full-control admin for two humans.
--
-- ROLE MODEL (Option B — JWT app_metadata, no self-promotion surface):
--   The role lives in auth.users.raw_app_meta_data as {"role":"masteradmin"}
--   and is minted into the JWT by GoTrue, so RLS can read it via auth.jwt()
--   WITHOUT any writable column. There is deliberately NO is_admin column on
--   profiles — a boolean there would be self-grantable through the
--   "profiles update self" policy.
--   Grant (run in the SQL editor as postgres / service_role holder):
--     update auth.users set raw_app_meta_data =
--       raw_app_meta_data || '{"role":"masteradmin"}'::jsonb
--     where email in ('hasnaina955@gmail.com', 'shabtab@outlook.com');
--   NOTE: Shabtab@outlook.com is stored lowercase (Auth lowercases emails on
--   signup, so match 'shabtab@outlook.com'). Revoke by setting the key back:
--     ... raw_app_meta_data - 'role' ...  (or set to '{"role":"user"}').
--   After granting, the user must SIGN OUT and back in — the JWT (and thus
--   the role) is minted at sign-in and cached until refresh.
--
-- WHAT THIS MIGRATION ADDS:
--   1. public.is_admin() — JWT role check (security definer, stable).
--   2. profiles.is_disabled + RESTRICTIVE deny policies on every table, so a
--      disabled account reads/writes nothing (but can still sign in — the app
--      signs them straight back out with an explanatory message).
--   3. Permissive admin-bypass policies: SELECT everywhere (+ write on all
--      app tables except notifications and admin_audit, so an admin opening a
--      workspace can edit through the normal UI as an escape hatch; the
--      audited RPC path in §5 is what the Admin console buttons use).
--   4. public.admin_audit — append-only log of every admin action.
--   5. Audited SECURITY DEFINER RPCs used by the Admin console buttons.
-- Run in the Supabase SQL editor (management plane). Idempotent.
-- ============================================================

-- ---------- 1. role check ----------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'masteradmin', false);
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ---------- 2. disabled flag + deny-all for disabled accounts ----------
-- RLS policies are permissive (OR-ed); only a RESTRICTIVE policy can take
-- access AWAY. One per table, all sharing the helper below.
alter table public.profiles add column if not exists is_disabled boolean not null default false;

create or replace function public.is_disabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_disabled
  );
$$;

grant execute on function public.is_disabled() to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'trips', 'trip_members', 'suggestions',
    'decisions', 'activity', 'notifications', 'published_itineraries'
  ] loop
    execute format('drop policy if exists "deny disabled" on public.%I', t);
    execute format(
      'create policy "deny disabled" on public.%I as restrictive for all to authenticated using (not public.is_disabled())',
      t
    );
  end loop;
end $$;

-- ---------- 3. admin-bypass read policies (permissive, OR-ed with the rest) --
-- Naming: "admin read <table>". Write bypass next section.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'trips', 'trip_members', 'suggestions',
    'decisions', 'activity', 'notifications', 'published_itineraries'
  ] loop
    execute format('drop policy if exists "admin read" on public.%I', t);
    execute format(
      'create policy "admin read" on public.%I for select to authenticated using (public.is_admin())',
      t
    );
  end loop;
end $$;

-- Admin write bypass: every app table EXCEPT notifications (recipient-scoped
-- inbox — admins neither read others' inboxes to act nor write into them) and
-- admin_audit (append-only via the RPCs in §5, never direct writes). An admin
-- opening another user's workspace can edit through the normal UI as an
-- escape hatch; the console buttons use the audited RPC path instead.
do $$
declare t text;
begin
  foreach t in array array[
    'trips', 'trip_members', 'suggestions',
    'decisions', 'activity', 'published_itineraries', 'profiles'
  ] loop
    execute format('drop policy if exists "admin write" on public.%I', t);
    execute format(
      'create policy "admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t
    );
  end loop;
end $$;

-- ---------- 4. audit log ----------
-- Append-only: admins may SELECT (to render the Audit tab), INSERT happens
-- only inside the SECURITY DEFINER RPCs below (which run as the table owner
-- and bypass RLS entirely). No UPDATE/DELETE policy at all — history can
-- only be rewritten from the SQL editor by the project owner.
create table if not exists public.admin_audit (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references public.profiles (id) on delete cascade,
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  at          bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table public.admin_audit enable row level security;

drop policy if exists "admin audit read" on public.admin_audit;
create policy "admin audit read" on public.admin_audit
  for select to authenticated using (public.is_admin());

-- ---------- 5. audited admin RPCs ----------
-- Every destructive console action funnels through one of these. Each:
--   (a) re-checks public.is_admin() INSIDE the function (the grant is only
--       reachability — the check is the guard);
--   (b) refuses self-harm (disable self) and last-admin removal;
--   (c) writes the admin_audit row in the SAME transaction, BEFORE the effect,
--       so a failed effect leaves an "attempted" row but a successful effect
--       is never unlogged.
-- SECURITY DEFINER so they work even where the widened table policies
-- deliberately stop (notifications scope, admin_audit itself).

-- 5a. Disable / re-enable an account (v1's "delete user" — reversible).
-- Disabled accounts hit the RESTRICTIVE "deny disabled" policies: they can
-- still sign in, but every table reads/writes as denied, and the app signs
-- them straight back out with an explanatory message.
create or replace function public.admin_set_disabled(p_user_id uuid, p_disabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_count int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_user_id = auth.uid() and p_disabled then
    raise exception 'cannot disable your own admin account';
  end if;
  -- Never strand the app with zero admins.
  if p_disabled then
    select count(*) into v_admin_count from auth.users
      where raw_app_meta_data ->> 'role' = 'masteradmin'
        and id <> p_user_id;
    if v_admin_count = 0 then
      raise exception 'cannot disable the last admin account';
    end if;
  end if;
  insert into public.admin_audit (actor_id, action, target_type, target_id, detail)
    values (auth.uid(), case when p_disabled then 'user.disable' else 'user.enable' end,
      'user', p_user_id::text, jsonb_build_object('disabled', p_disabled));
  update public.profiles set is_disabled = p_disabled where id = p_user_id;
end;
$$;
grant execute on function public.admin_set_disabled(uuid, boolean) to authenticated;

-- 5b. Toggle the creator badge on any profile.
create or replace function public.admin_set_creator(p_user_id uuid, p_is_creator boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  insert into public.admin_audit (actor_id, action, target_type, target_id, detail)
    values (auth.uid(), 'user.set_creator', 'user', p_user_id::text,
      jsonb_build_object('is_creator', p_is_creator));
  update public.profiles set is_creator = p_is_creator where id = p_user_id;
end;
$$;
grant execute on function public.admin_set_creator(uuid, boolean) to authenticated;

-- 5c. Flip any trip's visibility (private <-> public).
create or replace function public.admin_set_trip_visibility(p_trip_id uuid, p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if p_visibility not in ('private', 'public') then
    raise exception 'visibility must be private or public';
  end if;
  insert into public.admin_audit (actor_id, action, target_type, target_id, detail)
    values (auth.uid(), 'trip.set_visibility', 'trip', p_trip_id::text,
      jsonb_build_object('visibility', p_visibility));
  update public.trips
    set visibility = p_visibility,
        updated_at = (extract(epoch from now()) * 1000)::bigint
    where id = p_trip_id;
end;
$$;
grant execute on function public.admin_set_trip_visibility(uuid, text) to authenticated;

-- 5d. Remove a member from any trip (revokes an invite / kicks a collaborator).
-- Refuses to remove the trip's LAST owner — an ownerless trip would be
-- unmanageable by its members.
create or replace function public.admin_remove_member(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_owners int;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  select role into v_role from public.trip_members
    where trip_id = p_trip_id and user_id = p_user_id;
  if v_role is null then
    raise exception 'user is not a member of this trip';
  end if;
  if v_role = 'owner' then
    select count(*) into v_owners from public.trip_members
      where trip_id = p_trip_id and role = 'owner' and user_id <> p_user_id;
    if v_owners = 0 then
      raise exception 'cannot remove the last owner — transfer ownership first';
    end if;
  end if;
  insert into public.admin_audit (actor_id, action, target_type, target_id, detail)
    values (auth.uid(), 'trip.remove_member', 'trip', p_trip_id::text,
      jsonb_build_object('removed_user_id', p_user_id, 'role', v_role));
  delete from public.trip_members where trip_id = p_trip_id and user_id = p_user_id;
end;
$$;
grant execute on function public.admin_remove_member(uuid, uuid) to authenticated;

-- 5e. Unpublish any itinerary (admin variant of the owner-scoped unpublish:
-- the published_itineraries write policy is creator-only, so admins need this
-- bypass; the trip flips back to private like the owner path).
create or replace function public.admin_unpublish(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pub_id text;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  select id into v_pub_id from public.published_itineraries where trip_id = p_trip_id;
  if v_pub_id is null then
    raise exception 'trip has no publication';
  end if;
  insert into public.admin_audit (actor_id, action, target_type, target_id, detail)
    values (auth.uid(), 'publication.unpublish', 'trip', p_trip_id::text,
      jsonb_build_object('pub_id', v_pub_id));
  delete from public.published_itineraries where trip_id = p_trip_id;
  update public.trips
    set visibility = 'private',
        updated_at = (extract(epoch from now()) * 1000)::bigint
    where id = p_trip_id;
end;
$$;
grant execute on function public.admin_unpublish(uuid) to authenticated;

-- 5f. Delete any trip. The audit row carries a snapshot of the trip row's
-- identity (name, owner, visibility, route, dates — NOT the heavy JSONB
-- days/expenses) because cascades take the collab layer with it. No undo:
-- the console confirms by typing the trip name.
create or replace function public.admin_delete_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.trips%rowtype;
  v_owner uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  select * into v_row from public.trips where id = p_trip_id;
  if not found then
    raise exception 'trip not found';
  end if;
  select user_id into v_owner from public.trip_members
    where trip_id = p_trip_id and role = 'owner' limit 1;
  insert into public.admin_audit (actor_id, action, target_type, target_id, detail)
    values (auth.uid(), 'trip.delete', 'trip', p_trip_id::text,
      jsonb_build_object(
        'name', v_row.name, 'owner_id', v_owner,
        'visibility', v_row.visibility,
        'destinations', v_row.destinations,
        'start_date', v_row.start_date, 'end_date', v_row.end_date));
  delete from public.trips where id = p_trip_id;
end;
$$;
grant execute on function public.admin_delete_trip(uuid) to authenticated;

-- Close the loop for realtime: the console's Audit tab reads live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'admin_audit'
  ) then
    alter publication supabase_realtime add table public.admin_audit;
  end if;
end $$;





