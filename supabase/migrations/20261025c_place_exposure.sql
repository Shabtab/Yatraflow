-- Widen place exposure without changing the Stage C transition boundary (#843).
-- Keep the Stage C command ledger, identity/role guards, locks, receipts, and
-- transactional trip JSON writes while extending the place identity contract.
-- Apply after 20261025a and before any client can write indoor/outdoor; apply
-- 20261025b only after the transition-aware client is deployed.
begin;

create or replace function public.collab_valid_place_identity(p_identity jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_identity)='object'
    and (not (p_identity ? 'exposure') or (
      jsonb_typeof(p_identity->'exposure')='string'
      and p_identity->>'exposure' in ('indoor','outdoor','unknown')
    ))
    and (not (p_identity ? 'source') or (
      jsonb_typeof(p_identity->'source')='string'
      and p_identity->>'source' in ('google','mappls','open-meteo','wikipedia','osm')
    ))
    and (not (p_identity ? 'placeId') or (
      jsonb_typeof(p_identity->'placeId')='string'
      and length(btrim(p_identity->>'placeId')) between 1 and 300
    ))
    and (not (p_identity ? 'eLoc') or (
      jsonb_typeof(p_identity->'eLoc')='string'
      and length(btrim(p_identity->>'eLoc')) between 1 and 300
    ))
    and case when jsonb_typeof(p_identity)='object'
      then p_identity - array['source','placeId','eLoc','exposure']='{}'::jsonb
      else false end,
    false
  );
$$;
revoke all on function public.collab_valid_place_identity(jsonb) from public, anon, authenticated;

create or replace function public.collab_valid_decision_place(p_place jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_place)='object'
    and p_place - array['title','category','locationName','lat','lng','description','visitMinutes','openTime','closeTime','dayId','dayIndex','place','slotKey']='{}'::jsonb
    and (not (p_place ? 'place') or public.collab_valid_place_identity(p_place->'place')),
    false
  );
$$;
revoke all on function public.collab_valid_decision_place(jsonb) from public, anon, authenticated;

alter table public.suggestions drop constraint if exists suggestions_place_identity_shape;
alter table public.suggestions add constraint suggestions_place_identity_shape
check (
  place is null or (
    jsonb_typeof(place)='object'
    and place ? 'exposure'
    and jsonb_typeof(place->'exposure')='string'
    and place->>'exposure' in ('indoor','outdoor','unknown')
    and (not (place ? 'source') or (jsonb_typeof(place->'source')='string' and place->>'source' in ('google','mappls','open-meteo','wikipedia','osm')))
    and (not (place ? 'placeId') or (jsonb_typeof(place->'placeId')='string' and length(btrim(place->>'placeId')) between 1 and 300))
    and (not (place ? 'eLoc') or (jsonb_typeof(place->'eLoc')='string' and length(btrim(place->>'eLoc')) between 1 and 300))
    and case when jsonb_typeof(place)='object' then place - array['source','placeId','eLoc','exposure']='{}'::jsonb else false end
  )
) not valid;
alter table public.suggestions validate constraint suggestions_place_identity_shape;

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
    when 'decision.resolve' then array['type','decisionId','optionId','expectedRevision','dayId','dayIndex']
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
        or exists(select 1 from jsonb_object_keys(v_payload) as x(key) where key<>all(array['question','context','options']))
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
      insert into public.decisions(id,trip_id,question,context,options,votes_by_user_id,comments,status,raised_by)
      values(v_id,v_trip_id,btrim(v_payload->>'question'),v_payload->>'context',v_row,'{}','[]','open',v_actor);
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
        v_votes:=(v_row->'votes_by_user_id')-v_actor::text;
        if v_choice is not null then v_votes:=v_votes||jsonb_build_object(v_actor::text,v_choice); end if;
        update public.decisions set votes_by_user_id=v_votes where id=v_id and trip_id=v_trip_id returning to_jsonb(decisions.*) into v_row;
        v_activity_id:=gen_random_uuid();
        insert into public.activity(id,trip_id,actor_id,verb,target) values(v_activity_id,v_trip_id,v_actor,case when v_choice is null then 'removed their vote on a decision' else 'voted on a decision' end,v_row->>'question');
      end if;
      v_result:=jsonb_build_object('status','applied','tripRevision',v_revision,'decision',v_row);

    elsif v_kind='decision.resolve' then
      v_id:=(p_command->>'decisionId')::uuid;
      v_choice:=p_command->>'optionId';
      if v_id is null or jsonb_typeof(p_command->'optionId') is distinct from 'string'
        or length(v_choice) not between 1 and 200
        or jsonb_typeof(p_command->'expectedRevision') is distinct from 'number'
        or (p_command->>'expectedRevision') !~ '^[0-9]+$'
        or (p_command ? 'dayId' and (jsonb_typeof(p_command->'dayId') is distinct from 'string' or length(btrim(p_command->>'dayId')) not between 1 and 100))
        or (p_command ? 'dayIndex' and (jsonb_typeof(p_command->'dayIndex') is distinct from 'number' or (p_command->>'dayIndex') !~ '^[0-9]+$')) then
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
      v_stop_id:=nullif(v_row->>'resolved_stop_id','');
      if v_stop_id is not null then
        v_result:=jsonb_build_object('status','alreadyApplied','tripRevision',v_revision,
          'decision',v_row,'winnerId',v_choice,'placementStatus','alreadyApplied','stopId',v_stop_id);
      else
        v_has_place:=v_option ? 'place';
        v_place_identity_valid:=not v_has_place or public.collab_valid_decision_place(v_option->'place');
        v_placement_status:=case when v_has_place then 'needsDay' else 'notRequired' end;
        v_target_day_id:=coalesce(nullif(p_command->>'dayId',''),nullif(v_option->'place'->>'dayId',''));
        v_target_day_index:=coalesce(nullif(p_command->>'dayIndex','')::integer,nullif(v_option->'place'->>'dayIndex','')::integer);
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
          if v_day_matches=1 and v_expected_revision=v_revision then
            select day into v_day from jsonb_array_elements(v_trip_row.days) day
              where case when v_target_day_id is not null then day->>'id'=v_target_day_id
                else (day->>'index')::integer=v_target_day_index end;
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
              select jsonb_build_object(
                'id',v_stop_id,
                'orderInDay',coalesce(max(case when (stop->>'orderInDay') ~ '^[0-9]+$' then (stop->>'orderInDay')::integer end),-1)+1,
                'title',v_option->'place'->>'title','category',coalesce(v_option->'place'->>'category','sightseeing'),
                'locationName',v_option->'place'->>'locationName','lat',(v_option->'place'->>'lat')::double precision,
                'lng',(v_option->'place'->>'lng')::double precision,'description',v_option->'place'->>'description',
                'visitMinutes',coalesce(nullif(v_option->'place'->>'visitMinutes','')::integer,60),
                'openTime',v_option->'place'->>'openTime','closeTime',v_option->'place'->>'closeTime',
                'entryFeeInrPerPerson',0,'transportCostInrTotal',0,'priority','nice-to-have',
                'notes','Chosen by group vote — “'||(v_row->>'question')||'”','status','confirmed'
              ) into v_stop from jsonb_array_elements(coalesce(v_day->'stops','[]'::jsonb)) stop;
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
                select jsonb_agg(case when case when v_target_day_id is not null then day->>'id'=v_target_day_id
                  else (day->>'index')::integer=v_target_day_index end
                  then jsonb_set(day,'{stops}',coalesce(day->'stops','[]'::jsonb)||jsonb_build_array(v_stop),true)
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

commit;
