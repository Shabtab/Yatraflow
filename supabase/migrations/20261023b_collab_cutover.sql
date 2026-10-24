-- Stage A cutover for #801/#802. Apply only after every active client uses RPCs.
begin;

-- Keep server-owned rows for Undo. The client never supplies authors or ballots.
create table if not exists public.trip_contribution_restore_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  suggestions jsonb not null,
  decisions jsonb not null,
  activity jsonb not null,
  notifications jsonb not null,
  deleted_at bigint not null default floor(extract(epoch from clock_timestamp()) * 1000),
  restore_until timestamptz not null default clock_timestamp() + interval '10 minutes',
  restored_at bigint
);
alter table public.trip_contribution_restore_events enable row level security;
revoke all on public.trip_contribution_restore_events from public, anon, authenticated;
create index if not exists idx_trip_contribution_restore_expiry
  on public.trip_contribution_restore_events(restore_until);

drop function if exists public.prune_trip_contribution_restore_events();
create function public.prune_trip_contribution_restore_events() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_deleted integer;
begin
  delete from public.trip_contribution_restore_events where restore_until<clock_timestamp();
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;
revoke all on function public.prune_trip_contribution_restore_events() from public, anon, authenticated;
grant execute on function public.prune_trip_contribution_restore_events() to service_role;

drop trigger if exists profiles_prune_collab_restore on public.profiles;
drop function if exists public.prune_collab_restore_for_profile();
create function public.prune_collab_restore_for_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.trip_contribution_restore_events e where e.owner_id=old.id
    or position(old.id::text in e.suggestions::text)>0
    or position(old.id::text in e.decisions::text)>0
    or position(old.id::text in e.activity::text)>0
    or position(old.id::text in e.notifications::text)>0;
  return old;
end;
$$;
revoke all on function public.prune_collab_restore_for_profile() from public, anon, authenticated;
create trigger profiles_prune_collab_restore before delete on public.profiles
  for each row execute function public.prune_collab_restore_for_profile();

do $$
declare v_job record;
begin
  if to_regnamespace('cron') is not null then
    for v_job in execute 'select jobid from cron.job where jobname = ''yatraflow-prune-collab-restore''' loop
      execute 'select cron.unschedule($1)' using v_job.jobid;
    end loop;
    execute $schedule$select cron.schedule('yatraflow-prune-collab-restore','*/10 * * * *','select public.prune_trip_contribution_restore_events()')$schedule$;
  end if;
end;
$$;

drop trigger if exists trips_record_contribution_delete on public.trips;
drop function if exists public.record_trip_contribution_delete();
create function public.record_trip_contribution_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cleanup_scheduled boolean := false;
begin
  delete from public.trip_contribution_restore_events where restore_until < clock_timestamp();
  delete from public.trip_contribution_restore_events where trip_id=old.id;
  if to_regnamespace('cron') is not null then
    execute 'select exists(select 1 from cron.job where jobname=$1 and active and database=current_database() and schedule=$2 and command=$3)'
      into v_cleanup_scheduled using 'yatraflow-prune-collab-restore','*/10 * * * *','select public.prune_trip_contribution_restore_events()';
  end if;
  if old.deleted_at is null and auth.uid()=old.owner_id and not coalesce(public.is_disabled(),true)
    and pg_catalog.pg_trigger_depth()=1 then
    if not v_cleanup_scheduled then
      raise exception 'Enable pg_cron before hard delete, or move the trip to Trash.' using errcode='55000';
    end if;
    insert into public.trip_contribution_restore_events(trip_id,owner_id,suggestions,decisions,activity,notifications)
    values(old.id,old.owner_id,
      coalesce((select jsonb_agg(to_jsonb(s)) from public.suggestions s where s.trip_id=old.id),'[]'::jsonb),
      coalesce((select jsonb_agg(to_jsonb(d)) from public.decisions d where d.trip_id=old.id),'[]'::jsonb),
      coalesce((select jsonb_agg(to_jsonb(a)) from public.activity a where a.trip_id=old.id),'[]'::jsonb),
      coalesce((select jsonb_agg(to_jsonb(n)) from public.notifications n where n.trip_id=old.id),'[]'::jsonb));
  end if;
  return old;
end;
$$;
revoke all on function public.record_trip_contribution_delete() from public, anon, authenticated;
create trigger trips_record_contribution_delete before delete on public.trips
for each row execute function public.record_trip_contribution_delete();

-- Remove direct whole-row write paths, including the authenticated admin escape
-- hatch. SELECT remains available to admins. Service-role recovery remains an
-- explicit trusted backend operation.
drop policy if exists "suggestions write" on public.suggestions;
drop policy if exists "suggestions insert" on public.suggestions;
drop policy if exists "suggestions update" on public.suggestions;
drop policy if exists "suggestions delete" on public.suggestions;
drop policy if exists "admin write" on public.suggestions;
drop policy if exists "decisions write" on public.decisions;
drop policy if exists "decisions insert" on public.decisions;
drop policy if exists "decisions update" on public.decisions;
drop policy if exists "decisions delete" on public.decisions;
drop policy if exists "admin write" on public.decisions;
drop policy if exists "activity write" on public.activity;
drop policy if exists "activity insert" on public.activity;
drop policy if exists "activity update" on public.activity;
drop policy if exists "activity delete" on public.activity;
drop policy if exists "admin write" on public.activity;

-- Editors may still change suggestion/decision workflow fields. The trigger
-- blocks direct replacement of ballots, comments, identities, options or scope.
create policy "suggestions update" on public.suggestions for update
  using (public.is_editor(trip_id)) with check (public.is_editor(trip_id));
create policy "suggestions delete" on public.suggestions for delete using (public.is_editor(trip_id) and (proposed_by = auth.uid() or exists (select 1 from public.trips t where t.id = suggestions.trip_id and t.owner_id = auth.uid())));
create policy "decisions update" on public.decisions for update
  using (public.is_editor(trip_id)) with check (public.is_editor(trip_id));
create policy "decisions delete" on public.decisions for delete using (public.is_editor(trip_id) and (raised_by = auth.uid() or exists (select 1 from public.trips t where t.id = decisions.trip_id and t.owner_id = auth.uid())));

drop trigger if exists suggestions_guard_contributions on public.suggestions;
drop trigger if exists decisions_guard_contributions on public.decisions;
drop function if exists public.guard_collab_contribution_columns();
create function public.guard_collab_contribution_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- The RPC and the dedicated restore function run as the trusted owner.
  if current_user in ('postgres','service_role') then return new; end if;
  if tg_table_name='suggestions' and (
    (to_jsonb(new)->>'id') is distinct from (to_jsonb(old)->>'id')
    or (to_jsonb(new)->>'trip_id') is distinct from (to_jsonb(old)->>'trip_id')
    or (to_jsonb(new)->>'proposed_by') is distinct from (to_jsonb(old)->>'proposed_by')
    or to_jsonb(new)->'votes' is distinct from to_jsonb(old)->'votes'
    or to_jsonb(new)->'comments' is distinct from to_jsonb(old)->'comments'
  ) then raise exception 'use submit_collab_command for suggestion contributions' using errcode='42501'; end if;
  if tg_table_name='decisions' and (
    (to_jsonb(new)->>'id') is distinct from (to_jsonb(old)->>'id')
    or (to_jsonb(new)->>'trip_id') is distinct from (to_jsonb(old)->>'trip_id')
    or (to_jsonb(new)->>'raised_by') is distinct from (to_jsonb(old)->>'raised_by')
    or to_jsonb(new)->'options' is distinct from to_jsonb(old)->'options'
    or to_jsonb(new)->'votes_by_user_id' is distinct from to_jsonb(old)->'votes_by_user_id'
    or to_jsonb(new)->'comments' is distinct from to_jsonb(old)->'comments'
  ) then raise exception 'use submit_collab_command for decision contributions' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function public.guard_collab_contribution_columns() from public, anon, authenticated;
create trigger suggestions_guard_contributions before update on public.suggestions
  for each row execute function public.guard_collab_contribution_columns();
create trigger decisions_guard_contributions before update on public.decisions
  for each row execute function public.guard_collab_contribution_columns();

-- Recipients alone can read, update and delete their notifications. Editors
-- may insert only for a current trip member, for legacy non-command notices.
drop policy if exists "notifications write" on public.notifications;
drop policy if exists "admin read" on public.notifications;
drop policy if exists "notifications insert" on public.notifications;
drop policy if exists "notifications update" on public.notifications;
drop policy if exists "notifications delete" on public.notifications;
create policy "notifications insert" on public.notifications for insert with check (
  user_id = auth.uid() or (public.is_editor(trip_id) and exists (
    select 1 from public.trip_members m where m.trip_id=notifications.trip_id and m.user_id=notifications.user_id
  ))
);
create policy "notifications update" on public.notifications for update
  using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "notifications delete" on public.notifications for delete using (auth.uid()=user_id);

drop function if exists public.restore_trip_contributions(text,jsonb,jsonb,jsonb,jsonb);
drop function if exists public.restore_trip_contributions(text);
create function public.restore_trip_contributions(p_trip_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_trip uuid;
  v_revision bigint;
  v_event public.trip_contribution_restore_events%rowtype;
  v_row jsonb;
  v_count integer := 0;
begin
  begin v_trip := p_trip_id::uuid; exception when others then return jsonb_build_object('status','invalid'); end;
  if auth.uid() is null or coalesce(public.is_disabled(),true) then return jsonb_build_object('status','forbidden','tripRevision',null); end if;
  select t.write_version into v_revision from public.trips t where t.id=v_trip and t.deleted_at is null for update;
  if not found then return jsonb_build_object('status','forbidden','tripRevision',null); end if;
  perform public.prune_trip_contribution_restore_events();
  select * into v_event from public.trip_contribution_restore_events e where e.trip_id=v_trip
    order by e.deleted_at desc limit 1 for update;
  if not found then return jsonb_build_object('status','forbidden','tripRevision',v_revision); end if;
  if not exists(select 1 from public.trips t where t.id=v_trip and t.owner_id=v_event.owner_id
    and (auth.uid()=v_event.owner_id or public.is_admin())) then return jsonb_build_object('status','forbidden','tripRevision',v_revision); end if;
  if v_event.restore_until<clock_timestamp() then
    delete from public.trip_contribution_restore_events where id=v_event.id;
    return jsonb_build_object('status','forbidden','tripRevision',v_revision);
  end if;
  if v_event.restored_at is not null then return jsonb_build_object('status','alreadyApplied','tripRevision',v_revision); end if;

  for v_row in select value from jsonb_array_elements(v_event.suggestions) loop
    insert into public.suggestions(id,trip_id,day_index,proposed_by,title,category,location_name,lat,lng,description,visit_minutes,estimated_entry_fee_inr,estimated_transport_inr,votes,comments,status,created_at)
    values((v_row->>'id')::uuid,v_trip,(v_row->>'day_index')::integer,(v_row->>'proposed_by')::uuid,v_row->>'title',v_row->>'category',v_row->>'location_name',nullif(v_row->>'lat','')::double precision,nullif(v_row->>'lng','')::double precision,v_row->>'description',(v_row->>'visit_minutes')::integer,(v_row->>'estimated_entry_fee_inr')::integer,(v_row->>'estimated_transport_inr')::integer,v_row->'votes',v_row->'comments',v_row->>'status',(v_row->>'created_at')::bigint)
    on conflict(id) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_event.decisions) loop
    insert into public.decisions(id,trip_id,question,context,options,votes_by_user_id,comments,status,resolved_option_id,raised_by,created_at,resolved_at)
    values((v_row->>'id')::uuid,v_trip,v_row->>'question',v_row->>'context',v_row->'options',v_row->'votes_by_user_id',v_row->'comments',v_row->>'status',v_row->>'resolved_option_id',(v_row->>'raised_by')::uuid,(v_row->>'created_at')::bigint,nullif(v_row->>'resolved_at','')::bigint)
    on conflict(id) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_event.activity) loop
    insert into public.activity(id,trip_id,actor_id,verb,target,at) values((v_row->>'id')::uuid,v_trip,(v_row->>'actor_id')::uuid,v_row->>'verb',v_row->>'target',(v_row->>'at')::bigint) on conflict(id) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_event.notifications) loop
    insert into public.notifications(id,user_id,trip_id,text,read,at) values((v_row->>'id')::uuid,(v_row->>'user_id')::uuid,v_trip,v_row->>'text',coalesce((v_row->>'read')::boolean,false),(v_row->>'at')::bigint) on conflict(id) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  update public.trip_contribution_restore_events set restored_at=floor(extract(epoch from clock_timestamp())*1000)::bigint,
    suggestions='[]',decisions='[]',activity='[]',notifications='[]' where id=v_event.id;
  return jsonb_build_object('status','applied','restoredRows',v_count,'tripRevision',v_revision);
exception when others then
  return jsonb_build_object('status','unavailable','tripRevision',v_revision);
end;
$$;
revoke all on function public.restore_trip_contributions(text) from public, anon;
grant execute on function public.restore_trip_contributions(text) to authenticated;

commit;
