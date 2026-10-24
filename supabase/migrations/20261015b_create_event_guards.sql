-- Apply after the app update, before pilot traffic. Re-running is safe.
-- Existing INSERT/SELECT policies stay intact. No UPDATE policy or identity backfill is added.
begin;
create or replace function public.guard_create_funnel_event()
returns trigger language plpgsql set search_path = public as $$
declare
  m jsonb := case when jsonb_typeof(new.meta) = 'object' then new.meta else '{}'::jsonb end;
  v_days integer;
  v_travellers integer;
  v_count integer;
begin
  new.user_id := auth.uid();
  new.at := now();
  new.phase := null;
  if new.session_id is null or new.session_id !~ '^[0-9a-f]{32}$' then
    new.session_id := replace(gen_random_uuid()::text, '-', '');
  end if;

  if new.trip_id is not null and not exists (
    select 1 from public.trips t join public.trip_members tm on tm.trip_id = t.id
    where t.id = new.trip_id and t.owner_id = auth.uid()
      and tm.user_id = t.owner_id and tm.role = 'owner'
  ) then
    new.trip_id := null;
  end if;
  -- A submit acknowledgement cannot describe a failed or unusable trip.
  if new.event = 'submitted' and new.trip_id is null then return null; end if;

  new.meta := null;
  case new.event
    when 'template_picked' then
      if m->>'source' in ('template', 'last', 'demo') then
        new.meta := jsonb_build_object('source', m->>'source');
        if m->>'templateId' in ('kerala-backwaters', 'rajasthan-forts', 'himalayan-loop', 'goa-weekend') then
          new.meta := new.meta || jsonb_build_object('templateId', m->>'templateId');
        end if;
      end if;
    when 'crew_added' then
      if jsonb_typeof(m->'count') = 'number' then
        if (m->>'count')::numeric between 0 and 100 then v_count := floor((m->>'count')::numeric)::integer; end if;
      end if;
      if v_count is not null then new.meta := jsonb_build_object('count', v_count); end if;
    when 'submitted' then
      if jsonb_typeof(m->'days') = 'number' then
        if (m->>'days')::numeric between 1 and 366 then v_days := floor((m->>'days')::numeric)::integer; end if;
      end if;
      if jsonb_typeof(m->'travellers') = 'number' then
        if (m->>'travellers')::numeric between 1 and 100 then v_travellers := floor((m->>'travellers')::numeric)::integer; end if;
      end if;
      if v_days is not null and v_travellers is not null
         and m->>'mode' in ('car', 'rental', 'motorcycle', 'train', 'bus', 'flight', 'taxi', 'mixed') then
        new.meta := jsonb_build_object('days', v_days, 'travellers', v_travellers, 'mode', m->>'mode');
      end if;
    when 'moment_invite_sent' then
      if m->>'channel' in ('whatsapp', 'telegram', 'sms', 'insta', 'share') then
        new.meta := jsonb_build_object('channel', m->>'channel');
      end if;
    when 'abandoned' then
      if m->>'lastStage' in ('where', 'when', 'crew', 'name', 'route', 'dates', 'party', 'budget', 'cover', 'commitments') then
        new.meta := jsonb_build_object('lastStage', m->>'lastStage');
      end if;
    else null;
  end case;
  return new;
end;
$$;

drop trigger if exists create_funnel_guard on public.create_funnel_events;
create trigger create_funnel_guard before insert on public.create_funnel_events
  for each row execute function public.guard_create_funnel_event();
commit;
