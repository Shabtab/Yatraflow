-- 20261124b_invite_role_and_reset.sql
-- Adds the invite link role and the reset link command (#1012, gaps 15 and 16).
--
-- Invite role: the trip owner chooses whether the link admits editors or viewers.
--   The choice is stored in trip_invite_role. The table is private: row level
--   security is on, it has no policies, and no client role has a privilege on
--   it. Only the security definer commands read or write it. A missing row
--   means editor, which is the behaviour before this file.
-- Rule: a link never gains power without a new code. Raising the link role
--   replaces the code, so the old link admits nobody. Lowering the link role
--   keeps the code.
-- Reset link: change_trip_access gets two actions, invite_role and invite_reset.
--   Both need the owner or an admin. A reset always replaces the code.
-- Join: join_trip reads the link role after its row lock. A returning member
--   gets the lower of the last role and the link role. A new member gets the
--   link role.
-- State: trip_access_state returns inviteRole for every member.
-- The change_trip_access body is the body from 20261124a, plus the invite
--   branch only. Its signature does not change.
-- Safe to run twice.

begin;

-- Item 1. The private role table. Only the definer commands use it.
create table if not exists public.trip_invite_role (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  changed_at bigint not null
);
alter table public.trip_invite_role enable row level security;
revoke all on public.trip_invite_role from public, anon, authenticated, service_role;

-- Item 2. change_trip_access. The body is file 20261124a, plus the invite branch.
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
  elsif p_action in ('invite_role','invite_reset') then
    if not v_manager then
      raise exception 'Only the owner or an admin can change the invite link.' using errcode='42501';
    end if;
    if p_user_id is not null or p_expected_revision is not null then
      raise exception 'Invite change refused.' using errcode='22023';
    end if;
    if p_action='invite_reset' then
      if p_role is not null then
        raise exception 'Invite change refused.' using errcode='22023';
      end if;
      v_rotate := true;
    else
      if p_role is null or p_role not in ('editor','viewer') then
        raise exception 'Invite change refused.' using errcode='22023';
      end if;
      if p_role=coalesce((select r.role from public.trip_invite_role r where r.trip_id=p_trip_id),'editor') then
        return jsonb_build_object('status','applied','state',public.trip_access_state(p_trip_id));
      end if;
      v_rotate := array_position(array['viewer','commenter','editor','owner'],p_role)
        > array_position(array['viewer','commenter','editor','owner'],
            coalesce((select r.role from public.trip_invite_role r where r.trip_id=p_trip_id),'editor'))
        and v_trip.invite_code is not null;
      insert into public.trip_invite_role(trip_id,role,changed_at)
        values(p_trip_id,p_role,floor(extract(epoch from clock_timestamp())*1000))
        on conflict(trip_id) do update set role=excluded.role, changed_at=excluded.changed_at;
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
revoke all on function public.change_trip_access(uuid,text,uuid,text,bigint) from public, anon, authenticated, service_role;
grant execute on function public.change_trip_access(uuid,text,uuid,text,bigint) to authenticated;

-- Item 3. join_trip. The same signature. The role comes from the link role,
-- read after the row lock. The upsert now sets the role.
create or replace function public.join_trip(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_trip public.trips;
  v_access public.trip_member_access;
  v_actor uuid := auth.uid();
  v_code text := upper(trim(p_code));
  v_link text;
  v_role text;
begin
  if v_actor is null or public.is_disabled() then
    raise exception 'Sign in with an enabled account.' using errcode='42501';
  end if;
  select id into v_id from public.trips where invite_code=v_code;
  select t.* into v_trip from public.trips t where id=v_id for update;
  if v_trip.id is null or v_trip.deleted_at is not null or v_trip.invite_code is distinct from v_code then
    raise exception 'Invite is unavailable.' using errcode='42501';
  end if;
  -- Read after the row lock, so a join never pairs an old role with a new code.
  v_link := coalesce((select r.role from public.trip_invite_role r where r.trip_id=v_id),'editor');
  select * into v_access from public.trip_member_access where trip_id=v_id and user_id=v_actor for update;
  if v_access.state='removed' or (v_access.owner_id is not null and v_access.owner_id<>v_trip.owner_id) then
    raise exception 'Ask the owner to restore your access.' using errcode='42501';
  end if;
  if exists(select 1 from public.trip_members where trip_id=v_id and user_id=v_actor) then return v_id; end if;
  -- The owner stays owner. A new member gets the link role. A repaired active
  -- row keeps its last role. A returning member gets the lower of the last
  -- role and the link role.
  v_role := case
    when v_actor=v_trip.owner_id then 'owner'
    when v_access.user_id is null then v_link
    when v_access.state='active' then v_access.role
    when array_position(array['viewer','commenter','editor','owner'],v_access.role)
      <= array_position(array['viewer','commenter','editor','owner'],v_link) then v_access.role
    else v_link
  end;
  insert into public.trip_member_access(trip_id,user_id,owner_id,state,role,joined_at)
    values(v_id,v_actor,v_trip.owner_id,'active',v_role,
      floor(extract(epoch from clock_timestamp())*1000))
    on conflict(trip_id,user_id) do update set state='active', role=excluded.role,
      revision=public.trip_member_access.revision+1;
  insert into public.trip_members(trip_id,user_id,role,joined_at)
    select trip_id,user_id,role,joined_at from public.trip_member_access where trip_id=v_id and user_id=v_actor
    on conflict(trip_id,user_id) do nothing;
  update public.trips set access_version=access_version+1 where id=v_id;
  return v_id;
end;
$$;
revoke all on function public.join_trip(text) from public, anon, authenticated, service_role;
grant execute on function public.join_trip(text) to authenticated;

-- Item 4. trip_access_state. It adds inviteRole for every member.
create or replace function public.trip_access_state(p_trip_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_trip public.trips;
  v_manager boolean;
begin
  if auth.uid() is null or public.is_disabled() then
    raise exception 'Sign in with an enabled account.' using errcode='42501';
  end if;
  select t.* into v_trip from public.trips t where id=p_trip_id for update;
  v_manager := v_trip.owner_id=auth.uid() or public.is_admin();
  if v_trip.id is null or (not v_manager and not public.is_member(p_trip_id)) then
    raise exception 'Trip access refused.' using errcode='42501';
  end if;
  return jsonb_build_object(
    'version',v_trip.access_version,'inviteCode',v_trip.invite_code,
    'inviteRole',coalesce((select r.role from public.trip_invite_role r where r.trip_id=p_trip_id),'editor'),
    'planVersion',to_jsonb(v_trip)->'write_version',
    'members',coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'role',m.role,
      'joinedAt',m.joined_at,'revision',a.revision) order by m.user_id)
      from public.trip_members m join public.trip_member_access a using(trip_id,user_id)
      where m.trip_id=p_trip_id),'[]'::jsonb),
    'removed',case when v_manager then coalesce((select jsonb_agg(jsonb_build_object(
      'userId',a.user_id,'role',a.role,'joinedAt',a.joined_at,'revision',a.revision) order by a.user_id)
      from public.trip_member_access a where a.trip_id=p_trip_id and a.state='removed'),'[]'::jsonb)
      else '[]'::jsonb end);
end;
$$;
revoke all on function public.trip_access_state(uuid) from public, anon, authenticated, service_role;
grant execute on function public.trip_access_state(uuid) to authenticated;

commit;
