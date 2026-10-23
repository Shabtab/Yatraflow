-- Stage A additive RPC contract for #801/#802. Install before the new client.
begin;

create table if not exists public.collab_commands (
  command_id uuid primary key,
  trip_id uuid not null,
  actor_id uuid not null,
  command_hash text not null,
  receipt jsonb not null default '{}'::jsonb,
  applied_at bigint not null default floor(extract(epoch from clock_timestamp()) * 1000)
);
alter table public.collab_commands enable row level security;
revoke all on public.collab_commands from public, anon, authenticated;

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
  v_comment_id text;
  v_activity_id uuid;
  v_payload jsonb;
  v_row jsonb;
  v_votes jsonb;
  v_comments jsonb;
  v_choice text;
  v_recipient uuid;
  v_notifications jsonb := '[]'::jsonb;
  v_result jsonb;
  v_keys text[];
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
  select t.write_version into v_revision from public.trips t
    where t.id=v_trip_id and t.deleted_at is null for share;
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

  v_kind:=p_command->>'type';
  v_keys:=case v_kind
    when 'suggestion.create' then array['type','suggestionId','suggestion']
    when 'suggestion.comment' then array['type','suggestionId','commentId','text']
    when 'suggestion.ballot' then array['type','suggestionId','value']
    when 'decision.create' then array['type','decisionId','decision']
    when 'decision.comment' then array['type','decisionId','commentId','text']
    when 'decision.ballot' then array['type','decisionId','optionId']
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
        or exists(select 1 from jsonb_object_keys(v_payload) as x(key) where key<>all(array['dayIndex','title','category','locationName','lat','lng','description','visitMinutes','estimatedEntryFeeInr','estimatedTransportInr'])) then
        return jsonb_build_object('status','invalid','tripRevision',null);
      end if;
      if (v_payload->>'dayIndex')::numeric<0 or (v_payload->>'dayIndex')::numeric<>trunc((v_payload->>'dayIndex')::numeric)
        or (v_payload->>'visitMinutes')::numeric not between 1 and 1440
        or (v_payload->>'estimatedEntryFeeInr')::numeric<0 or (v_payload->>'estimatedTransportInr')::numeric<0 then
        return jsonb_build_object('status','invalid','tripRevision',null);
      end if;
      insert into public.suggestions(id,trip_id,day_index,proposed_by,title,category,location_name,lat,lng,description,visit_minutes,estimated_entry_fee_inr,estimated_transport_inr,votes,comments,status)
      values(v_id,v_trip_id,(v_payload->>'dayIndex')::integer,v_actor,btrim(v_payload->>'title'),v_payload->>'category',v_payload->>'locationName',nullif(v_payload->>'lat','')::double precision,nullif(v_payload->>'lng','')::double precision,v_payload->>'description',(v_payload->>'visitMinutes')::integer,(v_payload->>'estimatedEntryFeeInr')::integer,(v_payload->>'estimatedTransportInr')::integer,'[]','[]','open');
      v_activity_id:=gen_random_uuid();
      insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,'suggested '||btrim(v_payload->>'title'),'Day '||((v_payload->>'dayIndex')::integer+1));
      for v_recipient in select user_id from public.trip_members where trip_id=v_trip_id and user_id<>v_actor loop
        insert into public.notifications(id,user_id,trip_id,text) values(gen_random_uuid(),v_recipient,v_trip_id,'A crew member suggested “'||btrim(v_payload->>'title')||'”.') returning id into v_id;
        v_notifications:=v_notifications||jsonb_build_array(v_id);
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
          insert into public.notifications(id,user_id,trip_id,text) values(gen_random_uuid(),v_recipient,v_trip_id,'A crew member commented on “'||(v_row->>'title')||'”.') returning id into v_id;
          v_notifications:=v_notifications||jsonb_build_array(v_id);
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

    elsif v_kind='decision.create' then
      v_id:=(p_command->>'decisionId')::uuid; v_payload:=p_command->'decision'; v_row:=v_payload->'options';
      if v_id is null or jsonb_typeof(v_payload) is distinct from 'object' or jsonb_typeof(v_payload->'question') is distinct from 'string'
        or length(btrim(v_payload->>'question')) not between 1 and 300 or jsonb_typeof(v_row) is distinct from 'array'
        or jsonb_array_length(v_row) not between 2 and 20
        or exists(select 1 from jsonb_object_keys(v_payload) as x(key) where key<>all(array['question','context','options']))
        or exists(select 1 from jsonb_array_elements(v_row) o where jsonb_typeof(o) is distinct from 'object' or jsonb_typeof(o->'id') is distinct from 'string' or length(o->>'id') not between 1 and 200 or jsonb_typeof(o->'label') is distinct from 'string' or length(btrim(o->>'label')) not between 1 and 200 or exists(select 1 from jsonb_object_keys(o) as x(key) where key<>all(array['id','label','costImpactInr','timeImpactMin','place'])))
        or (select count(distinct o->>'id') from jsonb_array_elements(v_row) o)<>jsonb_array_length(v_row) then return jsonb_build_object('status','invalid','tripRevision',null); end if;
      insert into public.decisions(id,trip_id,question,context,options,votes_by_user_id,comments,status,raised_by)
      values(v_id,v_trip_id,btrim(v_payload->>'question'),v_payload->>'context',v_row,'{}','[]','open',v_actor);
      v_activity_id:=gen_random_uuid();
      insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,'raised decision “'||btrim(v_payload->>'question')||'”','Decisions');
      for v_recipient in select user_id from public.trip_members where trip_id=v_trip_id and user_id<>v_actor loop
        insert into public.notifications(id,user_id,trip_id,text) values(gen_random_uuid(),v_recipient,v_trip_id,'A crew member raised a decision: “'||btrim(v_payload->>'question')||'”.') returning id into v_id;
        v_notifications:=v_notifications||jsonb_build_array(v_id);
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
          insert into public.notifications(id,user_id,trip_id,text) values(gen_random_uuid(),v_recipient,v_trip_id,'A crew member commented on “'||(v_row->>'question')||'”.') returning id into v_id;
          v_notifications:=v_notifications||jsonb_build_array(v_id);
        end loop;
      else
        if not (p_command?'optionId') then return jsonb_build_object('status','invalid','tripRevision',null); end if;
        v_choice:=nullif(p_command->>'optionId','');
        if p_command->'optionId'<>'null'::jsonb and (jsonb_typeof(p_command->'optionId') is distinct from 'string' or v_choice is null or length(v_choice) not between 1 and 200) then return jsonb_build_object('status','invalid','tripRevision',null); end if;
        if v_row->>'status'<>'open' or (v_choice is not null and not exists(select 1 from jsonb_array_elements(v_row->'options') o where o->>'id'=v_choice)) then return jsonb_build_object('status','invalid','tripRevision',null); end if;
        v_votes:=(v_row->'votes_by_user_id')-v_actor::text;
        if v_choice is not null then v_votes:=v_votes||jsonb_build_object(v_actor::text,v_choice); end if;
        update public.decisions set votes_by_user_id=v_votes where id=v_id and trip_id=v_trip_id returning to_jsonb(decisions.*) into v_row;
        v_activity_id:=gen_random_uuid();
        insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,case when v_choice is null then 'removed their vote on a decision' else 'voted on a decision' end,v_row->>'question');
      end if;
      v_result:=jsonb_build_object('status','applied','tripRevision',v_revision,'decision',v_row);

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
commit;
