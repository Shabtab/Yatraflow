-- Group input phase 2 data layer (#972): decision closing time, decision day,
-- add-an-option, and crew preferences.
-- Apply after 20261026a_resolved_vote_order.sql and BEFORE the client that uses it.
-- The client subscribes to public.crew_preferences on the shared realtime
-- channel; a client deployed before this file runs would ask for a table that
-- does not exist yet.
--
-- What changes:
--   1. decisions.closes_at (epoch ms) and decisions.day_id (stable day id).
--   2. The decision write guard freezes both columns against direct updates.
--   3. restore_trip_contributions keeps both columns.
--   4. submit_collab_command: decision.create takes closesAt and dayId;
--      decision.ballot refuses every ballot after the closing time;
--      decision.option.add adds one option while the decision is open and
--      before its closing time. Nothing auto-resolves a decision.
--   5. public.crew_preferences (one row per trip member) and the
--      set_my_crew_preferences RPC, the only write path.
begin;

do $$
begin
  if to_regclass('public.decisions') is null
    or to_regclass('public.collab_commands') is null
    or to_regclass('public.trip_contribution_restore_events') is null
    or to_regprocedure('public.collab_valid_decision_place(jsonb)') is null
    or to_regprocedure('public.collab_same_visit_place(jsonb,jsonb)') is null
    or not exists(select 1 from pg_trigger
      where tgname='decisions_guard_contributions'
        and tgrelid='public.decisions'::regclass and not tgisinternal) then
    raise exception 'collab transition migrations are missing; apply 20261026a_resolved_vote_order.sql and its predecessors first' using errcode='55000';
  end if;
end;
$$;

-- ------------------------------------------------------------------ 1. columns
-- Epoch milliseconds, like created_at and resolved_at. Null means no closing
-- time, and the decision behaves as before.
alter table public.decisions add column if not exists closes_at bigint;
alter table public.decisions add column if not exists day_id text;
alter table public.decisions drop constraint if exists decisions_closes_at_check;
alter table public.decisions add constraint decisions_closes_at_check
  check (closes_at is null or (closes_at > 0 and closes_at <= 4102444800000));
alter table public.decisions drop constraint if exists decisions_day_id_check;
alter table public.decisions add constraint decisions_day_id_check
  check (day_id is null or char_length(btrim(day_id)) between 1 and 100);

-- ---------------------------------------------------------------- 2. write guard
-- Direct editor updates cannot move the closing time or the day. Only the
-- trusted RPCs (owner role) change them.
create or replace function public.guard_collab_contribution_columns()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Trusted security-definer RPCs own these changes. Direct authenticated
  -- updates remain editor-scoped but cannot split a transition across writes.
  if current_user in ('postgres','service_role') then return new; end if;
  if tg_table_name='suggestions' and (
    (to_jsonb(new)->>'id') is distinct from (to_jsonb(old)->>'id')
    or (to_jsonb(new)->>'trip_id') is distinct from (to_jsonb(old)->>'trip_id')
    or (to_jsonb(new)->>'proposed_by') is distinct from (to_jsonb(old)->>'proposed_by')
    or to_jsonb(new)->'day_id' is distinct from to_jsonb(old)->'day_id'
    or to_jsonb(new)->'place' is distinct from to_jsonb(old)->'place'
    or to_jsonb(new)->'votes' is distinct from to_jsonb(old)->'votes'
    or to_jsonb(new)->'comments' is distinct from to_jsonb(old)->'comments'
    or to_jsonb(new)->'status' is distinct from to_jsonb(old)->'status'
    or to_jsonb(new)->'accepted_stop_id' is distinct from to_jsonb(old)->'accepted_stop_id'
  ) then raise exception 'use submit_collab_command for suggestion transitions and contributions' using errcode='42501'; end if;
  if tg_table_name='decisions' and (
    (to_jsonb(new)->>'id') is distinct from (to_jsonb(old)->>'id')
    or (to_jsonb(new)->>'trip_id') is distinct from (to_jsonb(old)->>'trip_id')
    or (to_jsonb(new)->>'raised_by') is distinct from (to_jsonb(old)->>'raised_by')
    or to_jsonb(new)->'options' is distinct from to_jsonb(old)->'options'
    or to_jsonb(new)->'votes_by_user_id' is distinct from to_jsonb(old)->'votes_by_user_id'
    or to_jsonb(new)->'comments' is distinct from to_jsonb(old)->'comments'
    or to_jsonb(new)->'status' is distinct from to_jsonb(old)->'status'
    or to_jsonb(new)->'resolved_option_id' is distinct from to_jsonb(old)->'resolved_option_id'
    or to_jsonb(new)->'resolved_at' is distinct from to_jsonb(old)->'resolved_at'
    or to_jsonb(new)->'resolved_stop_id' is distinct from to_jsonb(old)->'resolved_stop_id'
    or to_jsonb(new)->'closes_at' is distinct from to_jsonb(old)->'closes_at'
    or to_jsonb(new)->'day_id' is distinct from to_jsonb(old)->'day_id'
  ) then raise exception 'use submit_collab_command for decision transitions and contributions' using errcode='42501'; end if;
  return new;
end;
$$;

revoke all on function public.guard_collab_contribution_columns() from public, anon, authenticated;

-- ------------------------------------------------ 3. trash restore keeps the new columns
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
    insert into public.suggestions(id,trip_id,day_index,day_id,place,proposed_by,title,category,location_name,lat,lng,description,visit_minutes,estimated_entry_fee_inr,estimated_transport_inr,votes,comments,status,created_at)
    values((v_row->>'id')::uuid,v_trip,(v_row->>'day_index')::integer,nullif(v_row->>'day_id',''),nullif(v_row->'place','null'::jsonb),(v_row->>'proposed_by')::uuid,v_row->>'title',v_row->>'category',v_row->>'location_name',nullif(v_row->>'lat','')::double precision,nullif(v_row->>'lng','')::double precision,v_row->>'description',(v_row->>'visit_minutes')::integer,(v_row->>'estimated_entry_fee_inr')::integer,(v_row->>'estimated_transport_inr')::integer,v_row->'votes',v_row->'comments',v_row->>'status',(v_row->>'created_at')::bigint)
    on conflict(id) do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_event.decisions) loop
    insert into public.decisions(id,trip_id,question,context,options,votes_by_user_id,comments,status,resolved_option_id,raised_by,created_at,resolved_at,closes_at,day_id)
    values((v_row->>'id')::uuid,v_trip,v_row->>'question',v_row->>'context',v_row->'options',v_row->'votes_by_user_id',v_row->'comments',v_row->>'status',v_row->>'resolved_option_id',(v_row->>'raised_by')::uuid,(v_row->>'created_at')::bigint,nullif(v_row->>'resolved_at','')::bigint,nullif(v_row->>'closes_at','')::bigint,nullif(v_row->>'day_id',''))
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

-- ---------------------------------------------------- 4. the collab command RPC
-- Copy of 20261026a with three changes: decision.create accepts closesAt and
-- dayId, decision.ballot refuses a vote after the closing time, and the new
-- decision.option.add command.
drop function if exists public.submit_collab_command(text,text,jsonb);
create function public.submit_collab_command(p_command_id text, p_trip_id text, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_command_id uuid;
  v_trip_id uuid;
  v_revision bigint;
  v_old public.collab_commands%rowtype;
  v_kind text;
  v_id uuid;
  v_notification_id uuid;
  v_comment_id text;
  v_activity_id uuid;
  v_payload jsonb;
  v_row jsonb;
  v_trip_row public.trips%rowtype;
  v_days jsonb;
  v_day jsonb;
  v_available jsonb := '[]'::jsonb;
  v_stop jsonb;
  v_stop_id text;
  v_expected_revision bigint;
  v_target_day_id text;
  v_target_day_index integer;
  v_day_matches integer;
  v_option jsonb;
  v_placement_status text;
  v_has_place boolean;
  v_place_identity_valid boolean;
  v_was_open boolean;
  v_votes jsonb;
  v_comments jsonb;
  v_choice text;
  v_recipient uuid;
  v_notifications jsonb := '[]'::jsonb;
  v_result jsonb;
  v_keys text[];
  v_ordered jsonb;
  v_offer_place jsonb;
  v_before_stop_id text;
  v_insert_at integer;
  v_ordered_stops jsonb;
begin
  if v_actor is null or coalesce(public.is_disabled(), true) then
    return jsonb_build_object('status','forbidden','tripRevision',null);
  end if;
  begin
    v_command_id := p_command_id::uuid;
    v_trip_id := p_trip_id::uuid;
  exception when others then
    return jsonb_build_object('status','invalid','tripRevision',null);
  end;
  if v_command_id is null or v_trip_id is null or jsonb_typeof(p_command) is distinct from 'object' then
    return jsonb_build_object('status','invalid','tripRevision',null);
  end if;
  if not public.is_editor(v_trip_id) then
    return jsonb_build_object('status','forbidden','tripRevision',null);
  end if;
  v_kind:=p_command->>'type';
  if v_kind in ('suggestion.accept','suggestion.decline','decision.resolve') then
    select t.* into v_trip_row from public.trips t where t.id=v_trip_id and t.deleted_at is null for update;
    v_revision:=v_trip_row.write_version;
  else
    select t.write_version into v_revision from public.trips t
      where t.id=v_trip_id and t.deleted_at is null for share;
  end if;
  if not found then return jsonb_build_object('status','forbidden','tripRevision',null); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_command_id::text,0));
  select * into v_old from public.collab_commands where command_id=v_command_id;
  if found then
    if v_old.trip_id<>v_trip_id or v_old.actor_id<>v_actor or v_old.command_hash<>encode(sha256(convert_to(p_command::text,'UTF8')),'hex') then
      return jsonb_build_object('status','conflict','tripRevision',v_revision);
    end if;
    v_result := v_old.receipt || jsonb_build_object('status','alreadyApplied','tripRevision',v_revision);
    if p_command ? 'suggestionId' then
      select to_jsonb(s) into v_row from public.suggestions s where s.id=(p_command->>'suggestionId')::uuid and s.trip_id=v_trip_id;
      v_result:=v_result||jsonb_build_object('suggestion',v_row);
    elsif p_command ? 'decisionId' then
      select to_jsonb(d) into v_row from public.decisions d where d.id=(p_command->>'decisionId')::uuid and d.trip_id=v_trip_id;
      v_result:=v_result||jsonb_build_object('decision',v_row);
    end if;
    return v_result;
  end if;

  v_keys:=case v_kind
    when 'suggestion.create' then array['type','suggestionId','suggestion']
    when 'suggestion.comment' then array['type','suggestionId','commentId','text']
    when 'suggestion.ballot' then array['type','suggestionId','value']
    when 'suggestion.accept' then array['type','suggestionId','expectedRevision','dayId','dayIndex','allowDuplicate']
    when 'suggestion.decline' then array['type','suggestionId']
    when 'decision.create' then array['type','decisionId','decision']
    when 'decision.comment' then array['type','decisionId','commentId','text']
    when 'decision.ballot' then array['type','decisionId','optionId']
    when 'decision.option.add' then array['type','decisionId','option']
    when 'decision.resolve' then array['type','decisionId','optionId','expectedRevision','dayId','dayIndex','orderedPlacement']
    when 'activity.append' then array['type','activityId','verb','target']
    else null end;
  if v_keys is null or exists(select 1 from jsonb_object_keys(p_command) as x(key) where key<>all(v_keys)) then
    return jsonb_build_object('status','invalid','tripRevision',null);
  end if;

  begin
    if v_kind='suggestion.create' then
      v_id:=(p_command->>'suggestionId')::uuid; v_payload:=p_command->'suggestion';
      if v_id is null or jsonb_typeof(v_payload) is distinct from 'object'
        or jsonb_typeof(v_payload->'dayIndex') is distinct from 'number'
        or jsonb_typeof(v_payload->'title') is distinct from 'string'
        or length(btrim(v_payload->>'title')) not between 1 and 200
        or jsonb_typeof(v_payload->'visitMinutes') is distinct from 'number'
        or jsonb_typeof(v_payload->'estimatedEntryFeeInr') is distinct from 'number'
        or jsonb_typeof(v_payload->'estimatedTransportInr') is distinct from 'number'
        or (v_payload ? 'dayId' and (jsonb_typeof(v_payload->'dayId') is distinct from 'string' or length(btrim(v_payload->>'dayId')) not between 1 and 100))
        or (v_payload ? 'place' and (
          case when jsonb_typeof(v_payload->'place') = 'object' then (
            (v_payload->'place' ? 'exposure' and (
              jsonb_typeof(v_payload->'place'->'exposure') is distinct from 'string'
              or v_payload->'place'->>'exposure' not in ('indoor','outdoor','unknown')
            ))
            or (v_payload->'place' ? 'source' and (jsonb_typeof(v_payload->'place'->'source') is distinct from 'string' or v_payload->'place'->>'source' not in ('google','mappls','open-meteo','wikipedia','osm')))
            or (v_payload->'place' ? 'placeId' and (jsonb_typeof(v_payload->'place'->'placeId') is distinct from 'string' or length(btrim(v_payload->'place'->>'placeId')) not between 1 and 300))
            or (v_payload->'place' ? 'eLoc' and (jsonb_typeof(v_payload->'place'->'eLoc') is distinct from 'string' or length(btrim(v_payload->'place'->>'eLoc')) not between 1 and 300))
            or exists(select 1 from jsonb_object_keys(v_payload->'place') as x(key) where key<>all(array['source','placeId','eLoc','exposure']))
          ) else true end
        ))
        or exists(select 1 from jsonb_object_keys(v_payload) as x(key) where key<>all(array['dayIndex','dayId','place','title','category','locationName','lat','lng','description','visitMinutes','estimatedEntryFeeInr','estimatedTransportInr'])) then
        return jsonb_build_object('status','invalid','tripRevision',null);
      end if;
      if (v_payload->>'dayIndex')::numeric<0 or (v_payload->>'dayIndex')::numeric<>trunc((v_payload->>'dayIndex')::numeric)
        or (v_payload->>'visitMinutes')::numeric not between 1 and 1440
        or (v_payload->>'estimatedEntryFeeInr')::numeric<0 or (v_payload->>'estimatedTransportInr')::numeric<0 then
        return jsonb_build_object('status','invalid','tripRevision',null);
      end if;
      if jsonb_typeof(v_payload->'place')='object' and not (v_payload->'place' ? 'exposure') then
        v_payload:=jsonb_set(v_payload,'{place,exposure}','"unknown"'::jsonb,true);
      end if;
      insert into public.suggestions(id,trip_id,day_index,day_id,place,proposed_by,title,category,location_name,lat,lng,description,visit_minutes,estimated_entry_fee_inr,estimated_transport_inr,votes,comments,status)
      values(v_id,v_trip_id,(v_payload->>'dayIndex')::integer,nullif(btrim(v_payload->>'dayId'),''),v_payload->'place',v_actor,btrim(v_payload->>'title'),v_payload->>'category',v_payload->>'locationName',nullif(v_payload->>'lat','')::double precision,nullif(v_payload->>'lng','')::double precision,v_payload->>'description',(v_payload->>'visitMinutes')::integer,(v_payload->>'estimatedEntryFeeInr')::integer,(v_payload->>'estimatedTransportInr')::integer,'[]','[]','open');
      v_activity_id:=gen_random_uuid();
      insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,'suggested '||btrim(v_payload->>'title'),'Day '||((v_payload->>'dayIndex')::integer+1));
      for v_recipient in select user_id from public.trip_members where trip_id=v_trip_id and user_id<>v_actor loop
        insert into public.notifications(id,user_id,trip_id,text) values(gen_random_uuid(),v_recipient,v_trip_id,'A crew member suggested “'||btrim(v_payload->>'title')||'”.') returning id into v_notification_id;
        v_notifications:=v_notifications||jsonb_build_array(v_notification_id);
      end loop;
      select to_jsonb(s) into v_row from public.suggestions s where s.id=(p_command->>'suggestionId')::uuid and s.trip_id=v_trip_id;
      v_result:=jsonb_build_object('status','applied','tripRevision',v_revision,'suggestion',v_row);

    elsif v_kind in ('suggestion.comment','suggestion.ballot') then
      v_id:=(p_command->>'suggestionId')::uuid;
      select to_jsonb(s) into v_row from public.suggestions s where s.id=v_id and s.trip_id=v_trip_id for update;
      if v_row is null then return jsonb_build_object('status','invalid','tripRevision',null); end if;
      if jsonb_typeof(v_row->'comments') is distinct from 'array' or jsonb_typeof(v_row->'votes') is distinct from 'array'
        or exists(select 1 from jsonb_array_elements(v_row->'votes') x where jsonb_typeof(x) is distinct from 'object' or coalesce(x->>'userId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(x->'value') is distinct from 'number' or x->>'value' not in ('1','-1'))
        or exists(select 1 from jsonb_array_elements(v_row->'comments') x where jsonb_typeof(x) is distinct from 'object' or coalesce(x->>'id','')='' or coalesce(x->>'authorId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(x->'text') is distinct from 'string') then
        return jsonb_build_object('status','invalid','tripRevision',v_revision);
      end if;
      if v_kind='suggestion.ballot' and v_row->>'status'<>'open' then
        return jsonb_build_object('status','invalid','tripRevision',v_revision,'reason','suggestion is closed');
      end if;
      if v_kind='suggestion.comment' then
        v_comment_id:=p_command->>'commentId';
        if not (p_command?'commentId') or not (p_command?'text') or jsonb_typeof(p_command->'commentId') is distinct from 'string' or jsonb_typeof(p_command->'text') is distinct from 'string' or v_comment_id !~ '^[A-Za-z0-9:_-]{1,80}$' or length(btrim(p_command->>'text')) not between 1 and 2000 then return jsonb_build_object('status','invalid','tripRevision',null); end if;
        v_comments:=v_row->'comments';
        if exists(select 1 from jsonb_array_elements(v_comments) x where x->>'id'=v_comment_id) then return jsonb_build_object('status','conflict','tripRevision',v_revision); end if;
        v_comments:=v_comments||jsonb_build_array(jsonb_build_object('id',v_comment_id,'authorId',v_actor,'text',btrim(p_command->>'text'),'createdAt',floor(extract(epoch from clock_timestamp())*1000)::bigint));
        update public.suggestions set comments=v_comments where id=v_id and trip_id=v_trip_id returning to_jsonb(suggestions.*) into v_row;
        v_activity_id:=gen_random_uuid();
        insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,'commented on a suggestion',v_row->>'title');
        for v_recipient in select m.user_id from public.trip_members m where m.trip_id=v_trip_id and m.user_id<>v_actor and (m.user_id=(v_row->>'proposed_by')::uuid or exists(select 1 from jsonb_array_elements(v_row->'votes') x where (x->>'userId')::uuid=m.user_id)) loop
          insert into public.notifications(id,user_id,trip_id,text) values(gen_random_uuid(),v_recipient,v_trip_id,'A crew member commented on “'||(v_row->>'title')||'”.') returning id into v_notification_id;
          v_notifications:=v_notifications||jsonb_build_array(v_notification_id);
        end loop;
      else
        if not (p_command?'value') or (p_command->'value'<>'null'::jsonb and (jsonb_typeof(p_command->'value') is distinct from 'number' or p_command->>'value' not in ('1','-1'))) then return jsonb_build_object('status','invalid','tripRevision',null); end if;
        select coalesce(jsonb_agg(x),'[]'::jsonb) into v_votes from jsonb_array_elements(v_row->'votes') x where x->>'userId'<>v_actor::text;
        if p_command->'value'<>'null'::jsonb then v_votes:=v_votes||jsonb_build_array(jsonb_build_object('userId',v_actor,'value',(p_command->>'value')::integer,'createdAt',floor(extract(epoch from clock_timestamp())*1000)::bigint)); end if;
        update public.suggestions set votes=v_votes where id=v_id and trip_id=v_trip_id returning to_jsonb(suggestions.*) into v_row;
        v_activity_id:=gen_random_uuid();
        insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,case when p_command->'value'='null'::jsonb then 'removed their vote on a suggestion' when p_command->>'value'='1' then 'upvoted a suggestion' else 'downvoted a suggestion' end,v_row->>'title');
      end if;
      v_result:=jsonb_build_object('status','applied','tripRevision',v_revision,'suggestion',v_row);

    elsif v_kind in ('suggestion.accept','suggestion.decline') then
      begin
        v_id:=(p_command->>'suggestionId')::uuid;
      exception when others then
        return jsonb_build_object('status','invalid','tripRevision',null);
      end;
      if v_id is null then return jsonb_build_object('status','invalid','tripRevision',null); end if;
      if v_kind='suggestion.accept' then
        if jsonb_typeof(p_command->'expectedRevision') is distinct from 'number'
          or (p_command->>'expectedRevision') !~ '^[0-9]+$'
          or (p_command ? 'dayId' and (jsonb_typeof(p_command->'dayId') is distinct from 'string' or length(btrim(p_command->>'dayId')) not between 1 and 100))
          or (p_command ? 'dayIndex' and (jsonb_typeof(p_command->'dayIndex') is distinct from 'number' or (p_command->>'dayIndex') !~ '^[0-9]+$'))
          or (p_command ? 'allowDuplicate' and jsonb_typeof(p_command->'allowDuplicate') is distinct from 'boolean') then
          return jsonb_build_object('status','invalid','tripRevision',v_revision);
        end if;
        v_expected_revision:=(p_command->>'expectedRevision')::bigint;
      end if;
      select to_jsonb(s) into v_row from public.suggestions s
        where s.id=v_id and s.trip_id=v_trip_id for update;
      if v_row is null then return jsonb_build_object('status','invalid','tripRevision',v_revision); end if;

      if v_kind='suggestion.decline' then
        if v_row->>'status'='declined' then
          v_result:=jsonb_build_object('status','alreadyApplied','tripRevision',v_revision,'suggestion',v_row);
        elsif v_row->>'status'='accepted' then
          return jsonb_build_object('status','conflict','tripRevision',v_revision);
        else
          v_activity_id:=gen_random_uuid();
          update public.suggestions set status='declined' where id=v_id and trip_id=v_trip_id returning to_jsonb(suggestions.*) into v_row;
          insert into public.activity(id,trip_id,actor_id,verb,target)
            values(v_activity_id,v_trip_id,v_actor,'declined a suggestion',v_row->>'title');
          v_result:=jsonb_build_object('status','applied','tripRevision',v_revision,'suggestion',v_row);
        end if;
      else
        if v_row->>'status'='accepted' then
          v_stop_id:=coalesce(nullif(v_row->>'accepted_stop_id',''),null);
          if v_stop_id is null then
            select stop->>'id' into v_stop_id
              from jsonb_array_elements(v_trip_row.days) day
              cross join lateral jsonb_array_elements(coalesce(day->'stops','[]'::jsonb)) stop
              where public.collab_same_visit_place(v_row,stop) and stop->>'status' is distinct from 'rejected'
              limit 1;
          end if;
          if v_stop_id is not null and jsonb_typeof(v_trip_row.days)='array' and not exists(
            select 1 from jsonb_array_elements(v_trip_row.days) day
            cross join lateral jsonb_array_elements(coalesce(day->'stops','[]'::jsonb)) stop
            where stop->>'id'=v_stop_id and stop->>'status' is distinct from 'rejected'
          ) then
            v_stop_id:=null;
          end if;
          if v_stop_id is null then
            -- The suggestion stays accepted; its stop was removed from the
            -- timeline afterwards, so there is no placement to point at.
            v_result:=jsonb_build_object('status','alreadyApplied','tripRevision',v_revision,'suggestion',v_row);
          else
            v_result:=jsonb_build_object('status','alreadyApplied','tripRevision',v_revision,'suggestion',v_row,'stopId',v_stop_id);
          end if;
        elsif v_row->>'status'<>'open' then
          return jsonb_build_object('status','conflict','tripRevision',v_revision);
        elsif (v_row->>'lat') is null or (v_row->>'lng') is null
          or (v_row->>'lat')::double precision not between -90 and 90
          or (v_row->>'lng')::double precision not between -180 and 180
          or ((v_row->>'lat')::double precision=0 and (v_row->>'lng')::double precision=0)
          or length(btrim(coalesce(v_row->>'title','')))=0
          or length(btrim(coalesce(v_row->>'location_name','')))=0 then
          return jsonb_build_object('status','needsPlace','tripRevision',v_revision);
        elsif jsonb_typeof(v_trip_row.days) is distinct from 'array' then
          return jsonb_build_object('status','unavailable','tripRevision',v_revision);
        else
          v_target_day_id:=coalesce(nullif(p_command->>'dayId',''),nullif(v_row->>'day_id',''));
          v_target_day_index:=coalesce(nullif(p_command->>'dayIndex','')::integer,(v_row->>'day_index')::integer);
          select count(*) into v_day_matches
            from jsonb_array_elements(v_trip_row.days) day
            where case when v_target_day_id is not null then day->>'id'=v_target_day_id
              else (day->>'index') ~ '^[0-9]+$' and (day->>'index')::integer=v_target_day_index end;
          if v_day_matches<>1 then
            select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id',day->>'id','index',nullif(day->>'index','')::integer,'title',day->>'title'
            ))),'[]'::jsonb) into v_available from jsonb_array_elements(v_trip_row.days) day;
            return jsonb_build_object('status','needsDay','tripRevision',v_revision,'availableDays',v_available);
          end if;
          if v_expected_revision<>v_revision then
            return jsonb_build_object('status','conflict','tripRevision',v_revision);
          end if;
          select day into v_day from jsonb_array_elements(v_trip_row.days) day
            where case when v_target_day_id is not null then day->>'id'=v_target_day_id
              else (day->>'index')::integer=v_target_day_index end;
          v_stop_id:=null;
          if coalesce(p_command->>'allowDuplicate','false')<>'true' then
            select stop->>'id' into v_stop_id
              from jsonb_array_elements(coalesce(v_day->'stops','[]'::jsonb)) stop
              where stop->>'status' is distinct from 'rejected'
                and public.collab_same_visit_place(v_row,stop)
              limit 1;
          end if;
          if v_stop_id is not null then
            -- The promised repeat-confirmation contract: a same-place same-day
            -- visit is refused, not absorbed into the existing stop. The day
            -- identity is echoed from the resolved day, so the client can ask
            -- "Add another visit?" for the day the write actually targeted.
            -- Like needsDay, this returns before the receipt insert, so a
            -- refusal is never replayed as alreadyApplied.
            return jsonb_build_object('status','needsDuplicate','tripRevision',v_revision,
              'dayId',coalesce(v_day->>'id',''),
              'dayIndex',coalesce(nullif(v_day->>'index','')::integer,v_target_day_index));
          end if;
          if v_stop_id is null then
            v_stop_id:='st_'||gen_random_uuid()::text;
            select jsonb_build_object(
              'id',v_stop_id,
              'orderInDay',coalesce(max(case when (stop->>'orderInDay') ~ '^[0-9]+$' then (stop->>'orderInDay')::integer end),-1)+1,
              'title',v_row->>'title','category',v_row->>'category','locationName',v_row->>'location_name',
              'lat',(v_row->>'lat')::double precision,'lng',(v_row->>'lng')::double precision,
              'description',v_row->>'description','visitMinutes',coalesce((v_row->>'visit_minutes')::integer,60),
              'entryFeeInrPerPerson',coalesce((v_row->>'estimated_entry_fee_inr')::integer,0),
              'transportCostInrTotal',coalesce((v_row->>'estimated_transport_inr')::integer,0),
              'priority','nice-to-have','status','confirmed'
            ) into v_stop from jsonb_array_elements(coalesce(v_day->'stops','[]'::jsonb)) stop;
            if jsonb_typeof(v_row->'place')='object' then
              v_stop:=v_stop||jsonb_strip_nulls(jsonb_build_object(
                'placeId',v_row->'place'->>'placeId','eLoc',v_row->'place'->>'eLoc',
                'placeSource',v_row->'place'->>'source','exposure',v_row->'place'->>'exposure'
              ));
            end if;
            select jsonb_agg(case when case when v_target_day_id is not null then day->>'id'=v_target_day_id
              else (day->>'index')::integer=v_target_day_index end
              then jsonb_set(day,'{stops}',coalesce(day->'stops','[]'::jsonb)||jsonb_build_array(v_stop),true)
              else day end order by ordinality)
              into v_days from jsonb_array_elements(v_trip_row.days) with ordinality as days(day,ordinality);
            update public.trips set days=v_days where id=v_trip_id returning write_version into v_revision;
          end if;
          v_activity_id:=gen_random_uuid();
          update public.suggestions set status='accepted',accepted_stop_id=v_stop_id
            where id=v_id and trip_id=v_trip_id returning to_jsonb(suggestions.*) into v_row;
          insert into public.activity(id,trip_id,actor_id,verb,target)
            values(v_activity_id,v_trip_id,v_actor,'accepted suggestion into timeline',v_row->>'title');
          v_result:=jsonb_build_object('status','applied','tripRevision',v_revision,'suggestion',v_row,'stopId',v_stop_id);
        end if;
      end if;

    elsif v_kind='decision.create' then
      v_id:=(p_command->>'decisionId')::uuid; v_payload:=p_command->'decision'; v_row:=v_payload->'options';
      if v_id is null or jsonb_typeof(v_payload) is distinct from 'object' or jsonb_typeof(v_payload->'question') is distinct from 'string'
        or length(btrim(v_payload->>'question')) not between 1 and 300 or jsonb_typeof(v_row) is distinct from 'array'
        or jsonb_array_length(v_row) not between 2 and 20
        or (v_payload ? 'closesAt' and not coalesce(case when jsonb_typeof(v_payload->'closesAt')='number' and (v_payload->>'closesAt') ~ '^[0-9]{1,13}$'
          then (v_payload->>'closesAt')::bigint > floor(extract(epoch from clock_timestamp())*1000)::bigint
            and (v_payload->>'closesAt')::bigint <= 4102444800000
          else false end,false))
        or (v_payload ? 'dayId' and (jsonb_typeof(v_payload->'dayId') is distinct from 'string' or length(btrim(v_payload->>'dayId')) not between 1 and 100))
        or exists(select 1 from jsonb_object_keys(v_payload) as x(key) where key<>all(array['question','context','options','closesAt','dayId']))
        or exists(select 1 from jsonb_array_elements(v_row) o where jsonb_typeof(o) is distinct from 'object' or jsonb_typeof(o->'id') is distinct from 'string' or length(o->>'id') not between 1 and 200 or jsonb_typeof(o->'label') is distinct from 'string' or length(btrim(o->>'label')) not between 1 and 200 or exists(select 1 from jsonb_object_keys(o) as x(key) where key<>all(array['id','label','costImpactInr','timeImpactMin','place'])))
        or (select count(distinct o->>'id') from jsonb_array_elements(v_row) o)<>jsonb_array_length(v_row)
        or exists(select 1 from jsonb_array_elements(v_row) o
          where o ? 'place' and not public.collab_valid_decision_place(o->'place')) then return jsonb_build_object('status','invalid','tripRevision',null); end if;
      select coalesce(jsonb_agg(
        case when (o->'place') ? 'place'
          and jsonb_typeof(o->'place'->'place')='object'
          and not ((o->'place'->'place') ? 'exposure')
          then jsonb_set(o,'{place,place,exposure}','"unknown"'::jsonb,true)
          else o end order by ordinality
      ),'[]'::jsonb) into v_row
      from jsonb_array_elements(v_row) with ordinality as option_rows(o,ordinality);
      insert into public.decisions(id,trip_id,question,context,options,votes_by_user_id,comments,status,raised_by,closes_at,day_id)
      values(v_id,v_trip_id,btrim(v_payload->>'question'),v_payload->>'context',v_row,'{}','[]','open',v_actor,
        case when v_payload ? 'closesAt' then (v_payload->>'closesAt')::bigint end,nullif(btrim(v_payload->>'dayId'),''));
      v_activity_id:=gen_random_uuid();
      insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,'raised decision “'||btrim(v_payload->>'question')||'”','Decisions');
      for v_recipient in select user_id from public.trip_members where trip_id=v_trip_id and user_id<>v_actor loop
        insert into public.notifications(id,user_id,trip_id,text) values(gen_random_uuid(),v_recipient,v_trip_id,'A crew member raised a decision: “'||btrim(v_payload->>'question')||'”.') returning id into v_notification_id;
        v_notifications:=v_notifications||jsonb_build_array(v_notification_id);
      end loop;
      select to_jsonb(d) into v_row from public.decisions d where d.id=(p_command->>'decisionId')::uuid and d.trip_id=v_trip_id;
      v_result:=jsonb_build_object('status','applied','tripRevision',v_revision,'decision',v_row);

    elsif v_kind in ('decision.comment','decision.ballot') then
      v_id:=(p_command->>'decisionId')::uuid;
      select to_jsonb(d) into v_row from public.decisions d where d.id=v_id and d.trip_id=v_trip_id for update;
      if v_row is null then return jsonb_build_object('status','invalid','tripRevision',null); end if;
      if jsonb_typeof(v_row->'comments') is distinct from 'array' or jsonb_typeof(v_row->'votes_by_user_id') is distinct from 'object'
        or jsonb_typeof(v_row->'options') is distinct from 'array'
        or exists(select 1 from jsonb_array_elements(v_row->'options') o where jsonb_typeof(o) is distinct from 'object' or jsonb_typeof(o->'id') is distinct from 'string' or jsonb_typeof(o->'label') is distinct from 'string')
        or (select count(distinct o->>'id') from jsonb_array_elements(v_row->'options') o)<>jsonb_array_length(v_row->'options')
        or exists(select 1 from jsonb_each(v_row->'votes_by_user_id') x where coalesce(x.key,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(x.value) is distinct from 'string' or not exists(select 1 from jsonb_array_elements(v_row->'options') o where o->>'id'=x.value#>>'{}'))
        or exists(select 1 from jsonb_array_elements(v_row->'comments') x where jsonb_typeof(x) is distinct from 'object' or coalesce(x->>'id','')='' or coalesce(x->>'authorId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(x->'text') is distinct from 'string') then return jsonb_build_object('status','invalid','tripRevision',v_revision); end if;
      if v_kind='decision.comment' then
        v_comment_id:=p_command->>'commentId';
        if not (p_command?'commentId') or not (p_command?'text') or jsonb_typeof(p_command->'commentId') is distinct from 'string' or jsonb_typeof(p_command->'text') is distinct from 'string' or v_comment_id !~ '^[A-Za-z0-9:_-]{1,80}$' or length(btrim(p_command->>'text')) not between 1 and 2000 then return jsonb_build_object('status','invalid','tripRevision',null); end if;
        if exists(select 1 from jsonb_array_elements(v_row->'comments') x where x->>'id'=v_comment_id) then return jsonb_build_object('status','conflict','tripRevision',v_revision); end if;
        v_comments:=(v_row->'comments')||jsonb_build_array(jsonb_build_object('id',v_comment_id,'authorId',v_actor,'text',btrim(p_command->>'text'),'createdAt',floor(extract(epoch from clock_timestamp())*1000)::bigint));
        update public.decisions set comments=v_comments where id=v_id and trip_id=v_trip_id returning to_jsonb(decisions.*) into v_row;
        v_activity_id:=gen_random_uuid();
        insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,'commented on a decision',v_row->>'question');
        for v_recipient in select m.user_id from public.trip_members m where m.trip_id=v_trip_id and m.user_id<>v_actor and (m.user_id=(v_row->>'raised_by')::uuid or (v_row->'votes_by_user_id') ? m.user_id::text) loop
          insert into public.notifications(id,user_id,trip_id,text) values(gen_random_uuid(),v_recipient,v_trip_id,'A crew member commented on “'||(v_row->>'question')||'”.') returning id into v_notification_id;
          v_notifications:=v_notifications||jsonb_build_array(v_notification_id);
        end loop;
      else
        if not (p_command?'optionId') then return jsonb_build_object('status','invalid','tripRevision',null); end if;
        v_choice:=nullif(p_command->>'optionId','');
        if p_command->'optionId'<>'null'::jsonb and (jsonb_typeof(p_command->'optionId') is distinct from 'string' or v_choice is null or length(v_choice) not between 1 and 200) then return jsonb_build_object('status','invalid','tripRevision',null); end if;
        if v_row->>'status'<>'open' or (v_choice is not null and not exists(select 1 from jsonb_array_elements(v_row->'options') o where o->>'id'=v_choice)) then return jsonb_build_object('status','invalid','tripRevision',null); end if;
        -- The closing time locks the vote for new ballots, changes and removals.
        -- A stored closing time that is not a number refuses the vote (fail closed).
        if coalesce(jsonb_typeof(v_row->'closes_at'),'null')<>'null' then
          if jsonb_typeof(v_row->'closes_at')<>'number' then
            return jsonb_build_object('status','invalid','tripRevision',v_revision,'reason','closing time is unreadable');
          end if;
          if (v_row->>'closes_at')::numeric <= floor(extract(epoch from clock_timestamp())*1000) then
            return jsonb_build_object('status','invalid','tripRevision',v_revision,'reason','voting is closed');
          end if;
        end if;
        v_votes:=(v_row->'votes_by_user_id')-v_actor::text;
        if v_choice is not null then v_votes:=v_votes||jsonb_build_object(v_actor::text,v_choice); end if;
        update public.decisions set votes_by_user_id=v_votes where id=v_id and trip_id=v_trip_id returning to_jsonb(decisions.*) into v_row;
        v_activity_id:=gen_random_uuid();
        insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,case when v_choice is null then 'removed their vote on a decision' else 'voted on a decision' end,v_row->>'question');
      end if;
      v_result:=jsonb_build_object('status','applied','tripRevision',v_revision,'decision',v_row);

    elsif v_kind='decision.option.add' then
      v_id:=(p_command->>'decisionId')::uuid;
      v_option:=p_command->'option';
      if v_id is null or jsonb_typeof(v_option) is distinct from 'object'
        or exists(select 1 from jsonb_object_keys(v_option) as x(key) where key<>all(array['id','label','costImpactInr','timeImpactMin']))
        or jsonb_typeof(v_option->'id') is distinct from 'string'
        or coalesce(v_option->>'id','') !~ '^[A-Za-z0-9_-]{1,100}$'
        or jsonb_typeof(v_option->'label') is distinct from 'string'
        or length(btrim(v_option->>'label')) not between 1 and 200
        or (v_option ? 'costImpactInr' and jsonb_typeof(v_option->'costImpactInr') is distinct from 'number')
        or (v_option ? 'timeImpactMin' and jsonb_typeof(v_option->'timeImpactMin') is distinct from 'number') then
        return jsonb_build_object('status','invalid','tripRevision',null);
      end if;
      select to_jsonb(d) into v_row from public.decisions d where d.id=v_id and d.trip_id=v_trip_id for update;
      if v_row is null then return jsonb_build_object('status','invalid','tripRevision',null); end if;
      if jsonb_typeof(v_row->'options') is distinct from 'array'
        or exists(select 1 from jsonb_array_elements(v_row->'options') o where jsonb_typeof(o) is distinct from 'object' or jsonb_typeof(o->'id') is distinct from 'string' or jsonb_typeof(o->'label') is distinct from 'string')
        or (select count(distinct o->>'id') from jsonb_array_elements(v_row->'options') o)<>jsonb_array_length(v_row->'options') then
        return jsonb_build_object('status','invalid','tripRevision',v_revision);
      end if;
      if v_row->>'status'<>'open' then
        return jsonb_build_object('status','invalid','tripRevision',v_revision,'reason','decision is not open');
      end if;
      if coalesce(jsonb_typeof(v_row->'closes_at'),'null')<>'null' then
        if jsonb_typeof(v_row->'closes_at')<>'number' then
          return jsonb_build_object('status','invalid','tripRevision',v_revision,'reason','closing time is unreadable');
        end if;
        if (v_row->>'closes_at')::numeric <= floor(extract(epoch from clock_timestamp())*1000) then
          return jsonb_build_object('status','invalid','tripRevision',v_revision,'reason','voting is closed');
        end if;
      end if;
      if jsonb_array_length(v_row->'options')>=20 then
        return jsonb_build_object('status','invalid','tripRevision',v_revision,'reason','too many options');
      end if;
      if exists(select 1 from jsonb_array_elements(v_row->'options') o where o->>'id'=v_option->>'id') then
        return jsonb_build_object('status','invalid','tripRevision',v_revision,'reason','duplicate option id');
      end if;
      if exists(select 1 from jsonb_array_elements(v_row->'options') o where lower(btrim(o->>'label'))=lower(btrim(v_option->>'label'))) then
        return jsonb_build_object('status','invalid','tripRevision',v_revision,'reason','duplicate option');
      end if;
      v_option:=jsonb_build_object('id',v_option->>'id','label',btrim(v_option->>'label'))
        ||case when v_option ? 'costImpactInr' then jsonb_build_object('costImpactInr',v_option->'costImpactInr') else '{}'::jsonb end
        ||case when v_option ? 'timeImpactMin' then jsonb_build_object('timeImpactMin',v_option->'timeImpactMin') else '{}'::jsonb end
        ||jsonb_build_object('addedBy',v_actor);
      update public.decisions set options=(v_row->'options')||jsonb_build_array(v_option)
        where id=v_id and trip_id=v_trip_id returning to_jsonb(decisions.*) into v_row;
      v_activity_id:=gen_random_uuid();
      insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,'added an option to a decision',v_row->>'question');
      v_result:=jsonb_build_object('status','applied','tripRevision',v_revision,'decision',v_row);

    elsif v_kind='decision.resolve' then
      v_id:=(p_command->>'decisionId')::uuid;
      v_choice:=p_command->>'optionId';
      if v_id is null or jsonb_typeof(p_command->'optionId') is distinct from 'string'
        or length(v_choice) not between 1 and 200
        or jsonb_typeof(p_command->'expectedRevision') is distinct from 'number'
        or (p_command->>'expectedRevision') !~ '^[0-9]+$'
        or (p_command ? 'dayId' and (jsonb_typeof(p_command->'dayId') is distinct from 'string' or length(btrim(p_command->>'dayId')) not between 1 and 100))
        or (p_command ? 'dayIndex' and (jsonb_typeof(p_command->'dayIndex') is distinct from 'number' or (p_command->>'dayIndex') !~ '^[0-9]+$'))
        or (p_command ? 'orderedPlacement' and (
          jsonb_typeof(p_command->'orderedPlacement') is distinct from 'object'
          or (p_command->'orderedPlacement') - array['dayId','beforeStopId'] <> '{}'::jsonb
          or jsonb_typeof(p_command->'orderedPlacement'->'dayId') is distinct from 'string'
          or length(btrim(p_command->'orderedPlacement'->>'dayId')) not between 1 and 100
          or not (p_command->'orderedPlacement' ? 'beforeStopId')
          or (jsonb_typeof(p_command->'orderedPlacement'->'beforeStopId') not in ('string','null'))
          or (jsonb_typeof(p_command->'orderedPlacement'->'beforeStopId')='string'
            and length(btrim(p_command->'orderedPlacement'->>'beforeStopId')) not between 1 and 100)
        )) then
        return jsonb_build_object('status','invalid','tripRevision',v_revision);
      end if;
      v_expected_revision:=(p_command->>'expectedRevision')::bigint;
      select to_jsonb(d) into v_row from public.decisions d
        where d.id=v_id and d.trip_id=v_trip_id for update;
      if v_row is null or jsonb_typeof(v_row->'options') is distinct from 'array'
        or not exists(select 1 from jsonb_array_elements(v_row->'options') o where o->>'id'=v_choice) then
        return jsonb_build_object('status','invalid','tripRevision',v_revision);
      end if;
      if v_row->>'status'='resolved' and v_row->>'resolved_option_id'<>v_choice then
        return jsonb_build_object('status','conflict','tripRevision',v_revision);
      end if;
      v_was_open:=v_row->>'status'='open';
      select o into v_option from jsonb_array_elements(v_row->'options') o where o->>'id'=v_choice;
      v_ordered:=p_command->'orderedPlacement';
      if v_ordered is not null then
        v_offer_place:=v_option->'place';
        if (p_command ? 'dayId' and p_command->>'dayId' is distinct from v_ordered->>'dayId')
          or (p_command ? 'dayIndex' and (v_offer_place->>'dayIndex') !~ '^[0-9]+$'
            or (v_offer_place->>'dayIndex')::integer<>(p_command->>'dayIndex')::integer)
          or (v_offer_place ? 'dayId' and v_offer_place->>'dayId' is distinct from v_ordered->>'dayId')
          or (v_offer_place ? 'dayIndex' and (v_offer_place->>'dayIndex') !~ '^[0-9]+$') then
          return jsonb_build_object('status','invalid','tripRevision',v_revision); end if;
        v_target_day_id:=v_ordered->>'dayId';
        v_before_stop_id:=nullif(v_ordered->>'beforeStopId','');
      end if;
      v_stop_id:=nullif(v_row->>'resolved_stop_id','');
      if v_stop_id is not null then
        v_result:=jsonb_build_object('status','alreadyApplied','tripRevision',v_revision,
          'decision',v_row,'winnerId',v_choice,'placementStatus','alreadyApplied','stopId',v_stop_id);
      else
        v_has_place:=v_option ? 'place';
        v_place_identity_valid:=not v_has_place or public.collab_valid_decision_place(v_option->'place');
        v_placement_status:=case when v_has_place then 'needsDay' else 'notRequired' end;
        v_target_day_id:=coalesce(v_ordered->>'dayId',nullif(p_command->>'dayId',''),nullif(v_option->'place'->>'dayId',''));
        v_target_day_index:=case when v_ordered is not null then null
          else coalesce(nullif(p_command->>'dayIndex','')::integer,nullif(v_option->'place'->>'dayIndex','')::integer) end;
        if v_has_place and v_place_identity_valid
          and jsonb_typeof(v_option->'place'->'lat')='number'
          and jsonb_typeof(v_option->'place'->'lng')='number'
          and (v_option->'place'->>'lat')::double precision between -90 and 90
          and (v_option->'place'->>'lng')::double precision between -180 and 180
          and not ((v_option->'place'->>'lat')::double precision=0 and (v_option->'place'->>'lng')::double precision=0)
          and length(btrim(coalesce(v_option->'place'->>'title','')))>0
          and length(btrim(coalesce(v_option->'place'->>'locationName','')))>0 then
          select count(*) into v_day_matches from jsonb_array_elements(v_trip_row.days) day
            where case when v_target_day_id is not null then day->>'id'=v_target_day_id
              else v_target_day_index is not null and (day->>'index') ~ '^[0-9]+$'
                and (day->>'index')::integer=v_target_day_index end;
          if v_ordered is not null and v_expected_revision<>v_revision then
            return jsonb_build_object('status','conflict','tripRevision',v_revision); end if;
          if v_day_matches=1 and v_expected_revision=v_revision then
            select day into v_day from jsonb_array_elements(v_trip_row.days) day
              where case when v_target_day_id is not null then day->>'id'=v_target_day_id
                else (day->>'index')::integer=v_target_day_index end;
            if v_ordered is not null and v_before_stop_id is not null then
              select count(*) into v_day_matches from jsonb_array_elements(coalesce(v_day->'stops','[]'::jsonb)) stop
                where stop->>'id'=v_before_stop_id and stop->>'status' is distinct from 'rejected';
              if v_day_matches<>1 then
                return jsonb_build_object('status','invalid','tripRevision',v_revision); end if;
              select count(*) into v_day_matches from jsonb_array_elements(v_trip_row.days) day
                cross join lateral jsonb_array_elements(coalesce(day->'stops','[]'::jsonb)) stop
                where stop->>'id'=v_before_stop_id and day->>'id' is distinct from v_ordered->>'dayId';
              if v_day_matches>0 then
                return jsonb_build_object('status','invalid','tripRevision',v_revision); end if;
            end if;
            select stop->>'id' into v_stop_id
              from jsonb_array_elements(coalesce(v_day->'stops','[]'::jsonb)) stop
              where stop->>'status' is distinct from 'rejected'
                and public.collab_same_visit_place(v_option->'place',stop)
              limit 1;
            if v_stop_id is not null then
              -- Intentional asymmetry with suggestion.accept: a vote answers
              -- "the plan already has it" (alreadyApplied), while an accept
              -- expresses "add this" and must ask before repeating.
              v_placement_status:='alreadyApplied';
            else
              v_stop_id:='st_'||gen_random_uuid()::text;
              v_insert_at:=coalesce(jsonb_array_length(coalesce(v_day->'stops','[]'::jsonb)),0)+1;
              if v_ordered is null then
                select coalesce(max(case when (stop->>'orderInDay') ~ '^[0-9]+$' then (stop->>'orderInDay')::integer end),-1)+1
                  into v_insert_at
                  from jsonb_array_elements(coalesce(v_day->'stops','[]'::jsonb)) stop;
              elsif v_ordered is not null and v_before_stop_id is not null then
                select min(ordinality)::integer into v_insert_at
                  from jsonb_array_elements(coalesce(v_day->'stops','[]'::jsonb)) with ordinality as stops(stop,ordinality)
                  where stop->>'id'=v_before_stop_id;
              end if;
              select jsonb_build_object(
                'id',v_stop_id,
                'orderInDay',v_insert_at,
                'title',v_option->'place'->>'title','category',coalesce(v_option->'place'->>'category','sightseeing'),
                'locationName',v_option->'place'->>'locationName','lat',(v_option->'place'->>'lat')::double precision,
                'lng',(v_option->'place'->>'lng')::double precision,'description',v_option->'place'->>'description',
                'visitMinutes',coalesce(nullif(v_option->'place'->>'visitMinutes','')::integer,60),
                'openTime',v_option->'place'->>'openTime','closeTime',v_option->'place'->>'closeTime',
                'entryFeeInrPerPerson',0,'transportCostInrTotal',0,'priority','nice-to-have',
                'notes','Chosen by group vote — “'||(v_row->>'question')||'”','status','confirmed'
              ) into v_stop;
              if jsonb_typeof(v_option->'place'->'place')='object' then
                v_stop:=v_stop||jsonb_strip_nulls(jsonb_build_object(
                  'placeId',v_option->'place'->'place'->>'placeId','eLoc',v_option->'place'->'place'->>'eLoc',
                  'placeSource',v_option->'place'->'place'->>'source','exposure',coalesce(v_option->'place'->'place'->>'exposure','unknown')
                ));
              end if;
              v_target_day_index:=coalesce(nullif(v_day->>'index','')::integer,v_target_day_index);
              if v_target_day_index is null then
                v_placement_status:='needsDay'; v_stop_id:=null;
                select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'id',day->>'id','index',nullif(day->>'index','')::integer,'title',day->>'title'
                ))),'[]'::jsonb) into v_available from jsonb_array_elements(v_trip_row.days) day;
              else
                v_stop:=v_stop||jsonb_build_object('slotKey',nullif(substring(v_choice from '^slot:([a-z]+):'),'') );
                v_stop:=v_stop- case when substring(v_choice from '^slot:([a-z]+):') is null then 'slotKey' else '__none__' end;
                if v_ordered is null then
                  v_ordered_stops:=coalesce(v_day->'stops','[]'::jsonb)||jsonb_build_array(v_stop);
                else
                  select coalesce(jsonb_agg(case when ordinality=v_insert_at then jsonb_build_array(v_stop,stop)
                    else jsonb_build_array(stop) end order by ordinality),'[]'::jsonb) into v_ordered_stops
                    from jsonb_array_elements(coalesce(v_day->'stops','[]'::jsonb)) with ordinality as stops(stop,ordinality);
                  if v_before_stop_id is null then
                    v_ordered_stops:=v_ordered_stops||jsonb_build_array(jsonb_build_array(v_stop));
                  end if;
                  select coalesce(jsonb_agg(jsonb_set(stop,'{orderInDay}',to_jsonb(ordinality),true) order by ordinality),'[]'::jsonb)
                    into v_ordered_stops
                    from (select element as stop, row_number() over (order by nested_ordinality, position)::integer as ordinality
                      from jsonb_array_elements(v_ordered_stops) with ordinality as nested(row,nested_ordinality)
                      cross join lateral jsonb_array_elements(row) with ordinality as elements(element,position)) expanded;
                end if;
                select jsonb_agg(case when case when v_target_day_id is not null then day->>'id'=v_target_day_id
                  else (day->>'index')::integer=v_target_day_index end
                  then jsonb_set(day,'{stops}',v_ordered_stops,true)
                  else day end order by ordinality)
                  into v_days from jsonb_array_elements(v_trip_row.days) with ordinality as days(day,ordinality);
                update public.trips set days=v_days where id=v_trip_id returning write_version into v_revision;
                v_placement_status:='applied';
              end if;
            end if;
          elsif v_day_matches=1 then
            return jsonb_build_object('status','conflict','tripRevision',v_revision);
          else
            select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id',day->>'id','index',nullif(day->>'index','')::integer,'title',day->>'title'
            ))),'[]'::jsonb) into v_available from jsonb_array_elements(v_trip_row.days) day;
            v_placement_status:='needsDay';
          end if;
        elsif v_has_place then
          v_placement_status:='needsPlace';
        end if;

        v_activity_id:=null;
        if v_was_open then
          v_activity_id:=gen_random_uuid();
          insert into public.activity(id,trip_id,actor_id,verb,target)
            values(v_activity_id,v_trip_id,v_actor,'resolved a decision',v_row->>'question');
          for v_recipient in select user_id from public.trip_members where trip_id=v_trip_id and user_id<>v_actor loop
            insert into public.notifications(id,user_id,trip_id,text)
              values(gen_random_uuid(),v_recipient,v_trip_id,'A crew member resolved “'||(v_row->>'question')||'”.') returning id into v_notification_id;
            v_notifications:=v_notifications||jsonb_build_array(v_notification_id);
          end loop;
        end if;
        update public.decisions set status='resolved',resolved_option_id=v_choice,
          resolved_at=coalesce(resolved_at,floor(extract(epoch from clock_timestamp())*1000)::bigint),
          resolved_stop_id=coalesce(resolved_stop_id,v_stop_id)
          where id=v_id and trip_id=v_trip_id returning to_jsonb(decisions.*) into v_row;
        v_result:=jsonb_build_object('status',case when v_was_open then 'applied' else 'alreadyApplied' end,
          'tripRevision',v_revision,'decision',v_row,'winnerId',v_choice,'placementStatus',v_placement_status);
        if v_stop_id is not null then v_result:=v_result||jsonb_build_object('stopId',v_stop_id); end if;
        if v_placement_status='needsDay' then v_result:=v_result||jsonb_build_object('availableDays',coalesce(v_available,'[]'::jsonb)); end if;
      end if;

    else
      v_activity_id:=(p_command->>'activityId')::uuid;
      if v_activity_id is null or jsonb_typeof(p_command->'verb') is distinct from 'string' or length(btrim(p_command->>'verb')) not between 1 and 300 or (p_command ? 'target' and jsonb_typeof(p_command->'target') is distinct from 'string') then return jsonb_build_object('status','invalid','tripRevision',null); end if;
      insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,btrim(p_command->>'verb'),p_command->>'target');
      v_result:=jsonb_build_object('status','applied','tripRevision',v_revision);
    end if;
    v_result:=v_result||jsonb_build_object('activityId',v_activity_id,'notificationIds',v_notifications);
    insert into public.collab_commands(command_id,trip_id,actor_id,command_hash,receipt) values(v_command_id,v_trip_id,v_actor,encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),v_result-'suggestion'-'decision');
    return v_result;
  exception
    when unique_violation then return jsonb_build_object('status','conflict','tripRevision',v_revision);
    when sqlstate '22P02' or sqlstate '22003' or sqlstate '22023' then return jsonb_build_object('status','invalid','tripRevision',null);
    when others then return jsonb_build_object('status','unavailable','tripRevision',v_revision);
  end;
end;
$$;
revoke all on function public.submit_collab_command(text,text,jsonb) from public, anon;
grant execute on function public.submit_collab_command(text,text,jsonb) to authenticated;

-- ------------------------------------------------------- 5. crew preferences
-- One row per (trip, member): the interests that member wants on this trip.
-- The interest set is the app's STOP_CATEGORIES list (src/data/types.ts).
-- tests/crew-preferences-sql-pin.test.ts keeps the two lists equal.
-- A row with an empty list is an answer ("none of these"). No row means the
-- member has not answered.
create table if not exists public.crew_preferences (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  interests text[] not null default '{}',
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (trip_id, user_id)
);

alter table public.crew_preferences drop constraint if exists crew_preferences_interests_check;
alter table public.crew_preferences add constraint crew_preferences_interests_check
  check (
    interests <@ array['sightseeing','food','nature','beach','temple','adventure','shopping','museum','travel','hotel','rest','event','transport-hub']::text[]
    and cardinality(interests) <= 13
  );

alter table public.crew_preferences enable row level security;

-- Members of a trip read every row of that trip. No client policy or grant
-- writes the table: set_my_crew_preferences below writes the caller's own row.
-- (A client upsert needs UPDATE on the key columns, which would let a client
-- rewrite trip_id or user_id.)
drop policy if exists "crew preferences member read" on public.crew_preferences;
create policy "crew preferences member read" on public.crew_preferences
  for select to authenticated using (public.is_member(trip_id));
drop policy if exists "deny disabled" on public.crew_preferences;
create policy "deny disabled" on public.crew_preferences
  as restrictive for all to authenticated
  using (not public.is_disabled()) with check (not public.is_disabled());

revoke all on table public.crew_preferences from public, anon, authenticated;
grant select on public.crew_preferences to authenticated;

drop function if exists public.set_my_crew_preferences(text,jsonb);
create function public.set_my_crew_preferences(p_trip_id text, p_interests jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_trip uuid;
  v_allowed text[] := array['sightseeing','food','nature','beach','temple','adventure','shopping','museum','travel','hotel','rest','event','transport-hub'];
  v_interests text[];
  v_row jsonb;
begin
  if v_actor is null or coalesce(public.is_disabled(), true) then
    return jsonb_build_object('status','forbidden');
  end if;
  begin
    v_trip := p_trip_id::uuid;
  exception when others then
    return jsonb_build_object('status','invalid');
  end;
  -- Fail closed on every shape that is not a short array of known, distinct strings.
  if v_trip is null or jsonb_typeof(p_interests) is distinct from 'array'
    or jsonb_array_length(p_interests) > 13
    or exists(select 1 from jsonb_array_elements(p_interests) x
      where jsonb_typeof(x) is distinct from 'string' or (x#>>'{}') <> all(v_allowed))
    or (select count(distinct x#>>'{}') from jsonb_array_elements(p_interests) x) <> jsonb_array_length(p_interests) then
    return jsonb_build_object('status','invalid');
  end if;
  -- A live trip, and the caller is one of its members (any role).
  perform 1 from public.trips t where t.id=v_trip and t.deleted_at is null for share;
  if not found or not public.is_member(v_trip) then
    return jsonb_build_object('status','forbidden');
  end if;
  select coalesce(array_agg(x#>>'{}' order by x#>>'{}'), '{}'::text[]) into v_interests
    from jsonb_array_elements(p_interests) x;
  insert into public.crew_preferences(trip_id,user_id,interests,updated_at)
    values(v_trip,v_actor,v_interests,floor(extract(epoch from clock_timestamp())*1000)::bigint)
    on conflict(trip_id,user_id) do update
      set interests=excluded.interests, updated_at=excluded.updated_at
    returning to_jsonb(crew_preferences.*) into v_row;
  return jsonb_build_object('status','applied','preference',v_row);
exception
  when sqlstate '22P02' or sqlstate '22003' or sqlstate '22023' then return jsonb_build_object('status','invalid');
  when others then return jsonb_build_object('status','unavailable');
end;
$$;
revoke all on function public.set_my_crew_preferences(text,jsonb) from public, anon;
grant execute on function public.set_my_crew_preferences(text,jsonb) to authenticated;

-- ---------------------------------------------------------------- 6. realtime
-- Realtime DDL can fail on a read-only role, so it is guarded like the rest of
-- the schema. If it fails, add public.crew_preferences to supabase_realtime in
-- the Dashboard.
do $$
begin
  begin
    alter publication supabase_realtime add table public.crew_preferences;
  exception when duplicate_object then null;
            when others then raise notice 'crew_preferences is not on supabase_realtime: %', sqlerrm;
  end;
end;
$$;

commit;
