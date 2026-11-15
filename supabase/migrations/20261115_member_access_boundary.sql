begin;

-- History survives same-ID trip recovery. Only profile deletion cascades it.
create table if not exists public.trip_member_access (
  trip_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  state text not null check (state in ('active', 'left', 'removed')),
  role text not null check (role in ('owner', 'editor', 'commenter', 'viewer')),
  joined_at bigint not null,
  revision bigint not null default 1,
  primary key (trip_id, user_id)
);
alter table public.trip_member_access enable row level security;
revoke all on public.trip_member_access from public, anon, authenticated, service_role;

alter table public.trips add column if not exists access_version bigint not null default 0;
create table if not exists public.member_access_cutover (id boolean primary key default true check (id));
revoke all on public.member_access_cutover from public, anon, authenticated, service_role;
alter table public.member_access_cutover enable row level security;

create or replace function public.new_trip_invite()
returns text language plpgsql volatile set search_path = public as $$
declare
  v_bytes bytea;
  v_code text := 'YATRA-';
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRTUVWXY346789';
  v_byte integer;
begin
  while length(v_code) < 14 loop
    v_bytes := uuid_send(gen_random_uuid());
    for i in 0..15 loop
      v_byte := get_byte(v_bytes, i);
      if v_byte < (256 / length(v_alphabet)) * length(v_alphabet) then
        v_code := v_code || substr(v_alphabet, (v_byte % length(v_alphabet)) + 1, 1);
      end if;
      exit when length(v_code) = 14;
    end loop;
  end loop;
  return v_code;
end;
$$;
revoke all on function public.new_trip_invite() from public, anon, authenticated, service_role;

lock table public.trips in share row exclusive mode;
lock table public.trip_members in share row exclusive mode;
insert into public.trip_member_access(trip_id,user_id,owner_id,state,role,joined_at)
select m.trip_id,m.user_id,t.owner_id,'active',m.role,m.joined_at
from public.trip_members m join public.trips t on t.id=m.trip_id
on conflict (trip_id,user_id) do nothing;

do $$
begin
  if not exists (select 1 from public.member_access_cutover where id) then
    update public.trips set invite_code=null, access_version=access_version+1;
    insert into public.member_access_cutover(id) values(true);
  end if;
end;
$$;

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
    'version',v_trip.access_version,'inviteCode',v_trip.invite_code,'planVersion',to_jsonb(v_trip)->'write_version',
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
    if p_expected_revision is distinct from (to_jsonb(v_trip)->>'write_version')::bigint then
      return jsonb_build_object('status','stale','state',public.trip_access_state(p_trip_id));
    end if;
  elsif p_action in ('role','remove','restore','leave') then
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
      v_rotate := array_position(array['viewer','commenter','editor','owner'],p_role)
        < array_position(array['viewer','commenter','editor','owner'],v_access.role);
      update public.trip_member_access set role=p_role,revision=revision+1 where trip_id=p_trip_id and user_id=v_target;
      update public.trip_members set role=p_role where trip_id=p_trip_id and user_id=v_target;
    elsif p_action in ('remove','leave') then
      if p_action='leave' and v_access.state<>'active' then
        raise exception 'Not an active member.' using errcode='42501';
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
  return jsonb_build_object('status','applied','state',public.trip_access_state(p_trip_id)
    || case when p_action='invite' and v_rotate then jsonb_build_object('mintBaseVersion',(to_jsonb(v_trip)->>'write_version')::bigint)
      else '{}'::jsonb end);
end;
$$;
revoke all on function public.change_trip_access(uuid,text,uuid,text,bigint) from public, anon, authenticated, service_role;
grant execute on function public.change_trip_access(uuid,text,uuid,text,bigint) to authenticated;

create or replace function public.join_trip(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_trip public.trips;
  v_access public.trip_member_access;
  v_actor uuid := auth.uid();
  v_code text := upper(trim(p_code));
begin
  if v_actor is null or public.is_disabled() then
    raise exception 'Sign in with an enabled account.' using errcode='42501';
  end if;
  select id into v_id from public.trips where invite_code=v_code;
  select t.* into v_trip from public.trips t where id=v_id for update;
  if v_trip.id is null or v_trip.deleted_at is not null or v_trip.invite_code is distinct from v_code then
    raise exception 'Invite is unavailable.' using errcode='42501';
  end if;
  select * into v_access from public.trip_member_access where trip_id=v_id and user_id=v_actor for update;
  if v_access.state='removed' or (v_access.owner_id is not null and v_access.owner_id<>v_trip.owner_id) then
    raise exception 'Ask the owner to restore your access.' using errcode='42501';
  end if;
  if exists(select 1 from public.trip_members where trip_id=v_id and user_id=v_actor) then return v_id; end if;
  insert into public.trip_member_access(trip_id,user_id,owner_id,state,role,joined_at)
    values(v_id,v_actor,v_trip.owner_id,'active',case when v_actor=v_trip.owner_id then 'owner' else 'editor' end,
      floor(extract(epoch from clock_timestamp())*1000))
    on conflict(trip_id,user_id) do update set state='active',revision=public.trip_member_access.revision+1;
  insert into public.trip_members(trip_id,user_id,role,joined_at)
    select trip_id,user_id,role,joined_at from public.trip_member_access where trip_id=v_id and user_id=v_actor
    on conflict(trip_id,user_id) do nothing;
  update public.trips set access_version=access_version+1 where id=v_id;
  return v_id;
end;
$$;
revoke all on function public.join_trip(text) from public, anon, authenticated, service_role;
grant execute on function public.join_trip(text) to authenticated;

create or replace function public.admin_remove_member(p_trip_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_revision bigint;
  v_result jsonb;
begin
  if auth.uid() is null or public.is_disabled() or not public.is_admin() then
    raise exception 'Admin only.' using errcode='42501';
  end if;
  perform 1 from public.trips where id=p_trip_id for update;
  select revision into v_revision from public.trip_member_access where trip_id=p_trip_id and user_id=p_user_id;
  v_result := public.change_trip_access(p_trip_id,'remove',p_user_id,null,v_revision);
  if v_result->>'status'<>'applied' then raise exception 'Member change refused.' using errcode='42501'; end if;
  insert into public.admin_audit(actor_id,action,target_type,target_id,detail)
    values(auth.uid(),'trip.remove_member','trip',p_trip_id::text,jsonb_build_object('removed_user_id',p_user_id));
end;
$$;
revoke all on function public.admin_remove_member(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_remove_member(uuid,uuid) to authenticated;

-- Direct trip updates must not restore an expired credential.
create or replace function public.guard_trip_invite()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' then
    if exists(select 1 from public.trip_member_access where trip_id=new.id) then
      new.invite_code := null;
    end if;
    new.access_version := 0;
    return new;
  end if;
  if (new.invite_code is distinct from old.invite_code or new.access_version is distinct from old.access_version)
    and current_user<>pg_get_userbyid((select proowner from pg_proc where oid='public.change_trip_access(uuid,text,uuid,text,bigint)'::regprocedure)) then
    raise exception 'Use the trip access command.' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_trip_invite() from public, anon, authenticated, service_role;
drop trigger if exists trips_invite_boundary on public.trips;
create trigger trips_invite_boundary before insert or update of invite_code,access_version on public.trips
  for each row execute function public.guard_trip_invite();

create or replace function public.move_trip_access_owner()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.trip_member_access set owner_id=new.owner_id where trip_id=new.id;
  return new;
end;
$$;
revoke all on function public.move_trip_access_owner() from public,anon,authenticated,service_role;
drop trigger if exists trips_access_owner on public.trips;
create trigger trips_access_owner after update of owner_id on public.trips
  for each row when (old.owner_id is distinct from new.owner_id) execute function public.move_trip_access_owner();

revoke insert,update,delete,truncate,references,trigger on public.trip_members from public,anon,authenticated,service_role;
commit;
