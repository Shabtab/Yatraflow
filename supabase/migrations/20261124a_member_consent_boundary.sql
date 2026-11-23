-- 20261124a_member_consent_boundary.sql
-- Closes #936: a trip membership change needs the member's consent.
--
-- Gap A: the trip owner could set trips.owner_id to any profile. The new owner
--   then held the trip without consent. A hand-over now needs an active member.
-- Gap B: the owner could remove a member who had already left, then restore
--   that member. A remove now needs an active member. Any other remove returns
--   stale and changes nothing.
-- Gap C: trip_member_access had no foreign key to trips. Its history rows
--   outlived a hard-deleted trip. A new trip with the same ID then took over the
--   old crew. The orphan rows are deleted, and the foreign key cascades.
-- Dormant writes: four write policies on trip_members could match if a write
--   grant came back. They are dropped. The privileges stay revoked, so this
--   file adds a second lock.
-- Owner guard: an anon request has a role but no subject, so auth.uid() is
--   null for anon. The owner guard now refuses that caller.
--
-- Operator path: with no JWT (SQL editor, service role, migration), a hand-over
--   still refuses a removed member. It does not need an active member.
-- Safe to run twice.

begin;

-- Item 1. Row level security on trip_members. The hosted project already has it
-- on. This line makes a fresh install and the test fixture match.
alter table public.trip_members enable row level security;

-- Item 2. Drop the four write policies. Their privileges were revoked in
-- 20261115, so none of them can match. Dropping them is the second lock.
drop policy if exists "members insert" on public.trip_members;
drop policy if exists "members update" on public.trip_members;
drop policy if exists "members delete" on public.trip_members;
drop policy if exists "admin write" on public.trip_members;

-- Item 3. Restate the revoke from 20261115. It is safe to run again.
revoke insert, update, delete, truncate, references, trigger on public.trip_members from public, anon, authenticated, service_role;

-- Item 4. Gap B. The body is the 20261115 body. The only change is the stale
-- branch for a remove that is not on an active member.
create or replace function public.change_trip_access(
  p_trip_id uuid, p_action text, p_user_id uuid default null,
  p_role text default null, p_expected_revision bigint default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips;
  v_access public.trip_member_access;
  v_actor uuid := auth.uid();
  v_target uuid := coalesce(p_user_id,auth.uid());
  v_manager boolean;
  v_rotate boolean := false;
begin
  if v_actor is null or public.is_disabled() then
    raise exception 'Sign in with an enabled account.' using errcode='42501';
  end if;
  select t.* into v_trip from public.trips t where id=p_trip_id for update;
  if v_trip.id is null or v_trip.deleted_at is not null then
    raise exception 'Trip is unavailable.' using errcode='42501';
  end if;
  v_manager := v_trip.owner_id=v_actor or public.is_admin();
  if exists(select 1 from public.trip_member_access where trip_id=p_trip_id and owner_id<>v_trip.owner_id) then
    raise exception 'Trip history belongs to another owner.' using errcode='42501';
  end if;
  if p_action='bootstrap' then
    if v_actor<>v_trip.owner_id then raise exception 'Owner only.' using errcode='42501'; end if;
    insert into public.trip_member_access(trip_id,user_id,owner_id,state,role,joined_at)
      values(p_trip_id,v_actor,v_actor,'active','owner',floor(extract(epoch from clock_timestamp())*1000))
      on conflict(trip_id,user_id) do nothing;
    insert into public.trip_members(trip_id,user_id,role,joined_at)
      select trip_id,user_id,role,joined_at from public.trip_member_access
      where trip_id=p_trip_id and state='active' order by user_id
      on conflict(trip_id,user_id) do nothing;
  elsif p_action='invite' then
    if not v_manager and not public.is_member(p_trip_id) then
      raise exception 'Member only.' using errcode='42501';
    end if;
    v_rotate := v_trip.invite_code is null;
    if not v_rotate then
      return jsonb_build_object('status','applied','state',public.trip_access_state(p_trip_id));
    end if;
  elsif p_action in ('role','remove','restore','leave') then
    if p_action='restore' and v_trip.owner_id<>v_actor then
      raise exception 'Only the owner can restore access.' using errcode='42501';
    end if;
    if (p_action='leave' and v_target<>v_actor) or (p_action<>'leave' and not v_manager) then
      raise exception 'Member change refused.' using errcode='42501';
    end if;
    if v_target=v_trip.owner_id then raise exception 'The trip owner must stay.' using errcode='42501'; end if;
    select * into v_access from public.trip_member_access
      where trip_id=p_trip_id and user_id=v_target for update;
    if v_access.user_id is null or p_expected_revision is distinct from v_access.revision then
      return jsonb_build_object('status','stale','state',public.trip_access_state(p_trip_id));
    end if;
    if p_action='role' then
      if p_role is null or p_role not in ('editor','commenter','viewer') or v_access.state<>'active' then
        raise exception 'Invalid role change.' using errcode='22023';
      end if;
      if p_role=v_access.role then
        return jsonb_build_object('status','applied','state',public.trip_access_state(p_trip_id));
      end if;
      v_rotate := array_position(array['viewer','commenter','editor','owner'],p_role)
        < array_position(array['viewer','commenter','editor','owner'],v_access.role);
      update public.trip_member_access set role=p_role,revision=revision+1 where trip_id=p_trip_id and user_id=v_target;
      update public.trip_members set role=p_role where trip_id=p_trip_id and user_id=v_target;
    elsif p_action in ('remove','leave') then
      if p_action='leave' and v_access.state<>'active' then
        raise exception 'Not an active member.' using errcode='42501';
      end if;
      if p_action='remove' and v_access.state<>'active' then
        return jsonb_build_object('status','stale','state',public.trip_access_state(p_trip_id));
      end if;
      v_rotate := p_action='remove';
      update public.trip_member_access set state=case when p_action='remove' then 'removed' else 'left' end,
        revision=revision+1 where trip_id=p_trip_id and user_id=v_target;
      delete from public.trip_members where trip_id=p_trip_id and user_id=v_target;
    else
      if v_access.state<>'removed' then
        return jsonb_build_object('status','stale','state',public.trip_access_state(p_trip_id));
      end if;
      update public.trip_member_access set state='active',revision=revision+1 where trip_id=p_trip_id and user_id=v_target;
      insert into public.trip_members(trip_id,user_id,role,joined_at)
        values(p_trip_id,v_target,v_access.role,v_access.joined_at);
    end if;
  else
    raise exception 'Unknown member action.' using errcode='22023';
  end if;
  if v_rotate then
    loop
      begin
        update public.trips set invite_code=public.new_trip_invite() where id=p_trip_id;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
  end if;
  update public.trips set access_version=access_version+1 where id=p_trip_id;
  if p_action='leave' then return jsonb_build_object('status','applied'); end if;
  return jsonb_build_object('status','applied','state',public.trip_access_state(p_trip_id));
end;
$$;

-- Item 5. Gap A. The 20261115 body, plus one check. A caller with a JWT must
-- hand the trip to an active member. The operator path keeps the removed check.
create or replace function public.move_trip_access_owner()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.trip_member_access where trip_id=new.id and user_id=new.owner_id and state='removed') then
    raise exception 'Restore access before transferring ownership.' using errcode='42501';
  end if;
  if auth.uid() is not null and not exists(
    select 1 from public.trip_member_access where trip_id=new.id and user_id=new.owner_id and state='active') then
    raise exception 'The new owner must be a current member.' using errcode='42501';
  end if;
  update public.trip_member_access set owner_id=new.owner_id,
    role=case when user_id=old.owner_id and role='owner' then 'editor' else role end,
    revision=revision+1 where trip_id=new.id;
  update public.trip_members set role='editor' where trip_id=new.id and user_id=old.owner_id and role='owner';
  insert into public.trip_member_access(trip_id,user_id,owner_id,state,role,joined_at)
    values(new.id,new.owner_id,new.owner_id,'active','owner',floor(extract(epoch from clock_timestamp())*1000))
    on conflict(trip_id,user_id) do update set role='owner',state='active',revision=public.trip_member_access.revision+1;
  insert into public.trip_members(trip_id,user_id,role,joined_at)
    select trip_id,user_id,'owner',joined_at from public.trip_member_access where trip_id=new.id and user_id=new.owner_id
    on conflict(trip_id,user_id) do update set role='owner';
  loop
    begin
      update public.trips set invite_code=public.new_trip_invite(),access_version=access_version+1 where id=new.id;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return new;
end;
$$;

-- Item 6. Owner guard, hardened. An anon request has no subject, so
-- auth.uid() is null for anon too. The null-subject exemption now skips anon
-- and authenticated callers. The rest of the body is unchanged.
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

  -- No JWT subject, and not the anon or authenticated role: the service role,
  -- the SQL editor, or a migration. An anon or authenticated caller falls
  -- through to the checks below.
  if auth.uid() is null and current_user not in ('anon','authenticated') then
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

-- Item 7. Gap C. Read-only probe, run before this file: count the history rows
-- whose trip is gone. The count on 2026-11-23 was 7. The trash purge can change it.
delete from public.trip_member_access a
  where not exists (select 1 from public.trips t where t.id = a.trip_id);

-- The foreign key cascades, so a hard delete of a trip removes its history.
-- The guard makes a second run a no-op.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.trip_member_access'::regclass
      and conname = 'trip_member_access_trip_id_fkey'
  ) then
    alter table public.trip_member_access
      add constraint trip_member_access_trip_id_fkey
      foreign key (trip_id) references public.trips(id) on delete cascade;
  end if;
end;
$$;

-- Item 8. Restate the grants. The two trigger functions are revoked from all
-- four roles by name. change_trip_access keeps its single grant to authenticated.
revoke all on function public.change_trip_access(uuid,text,uuid,text,bigint) from public, anon, authenticated, service_role;
grant execute on function public.change_trip_access(uuid,text,uuid,text,bigint) to authenticated;
revoke all on function public.move_trip_access_owner() from public, anon, authenticated, service_role;
revoke all on function public.trips_owner_id_immutable() from public, anon, authenticated, service_role;

commit;
