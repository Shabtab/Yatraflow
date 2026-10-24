-- Apply before the app update. Old two- and three-argument counter calls remain valid.
-- Re-running is safe. No historical trip origin is inferred or rewritten.
begin;

alter table public.trips add column if not exists creation_kind text;
alter table public.trips add column if not exists source_pub_id text;
alter table public.trips add column if not exists campaign_id text;
alter table public.pub_events add column if not exists campaign_id text;

create or replace function public.is_pilot_campaign(p_id text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_id in (
    'p_a7c1d9e4b206', 'p_f2b8a064cd19', 'p_9d340e7ab165',
    'p_c6812fa930bd', 'p_4be09c713af8'
  ), false);
$$;

alter table public.trips drop constraint if exists trips_creation_kind_check;
alter table public.trips add constraint trips_creation_kind_check
  check (creation_kind is null or creation_kind in ('created', 'forked', 'copied', 'imported', 'demo'));
alter table public.trips drop constraint if exists trips_campaign_id_check;
alter table public.trips add constraint trips_campaign_id_check
  check (campaign_id is null or public.is_pilot_campaign(campaign_id));
alter table public.pub_events drop constraint if exists pub_events_campaign_id_check;
alter table public.pub_events add constraint pub_events_campaign_id_check
  check (campaign_id is null or public.is_pilot_campaign(campaign_id));

-- Only public publication identifiers and fixed campaign codes enter these fields.
-- Invalid optional attribution is dropped. It must not prevent trip persistence.
create or replace function public.guard_trip_origin()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.creation_kind := old.creation_kind;
    new.source_pub_id := old.source_pub_id;
    new.campaign_id := old.campaign_id;
    return new;
  end if;
  if new.creation_kind is null or new.creation_kind not in ('created', 'forked', 'copied', 'imported', 'demo') then
    new.creation_kind := null;
  end if;
  if new.creation_kind is distinct from 'forked' then
    new.source_pub_id := null;
    new.campaign_id := null;
  else
    if new.source_pub_id is null or new.source_pub_id !~ '^[A-Za-z0-9_-]{1,64}$'
       or not exists (select 1 from public.published_itineraries p where p.id = new.source_pub_id) then
      new.source_pub_id := null;
    end if;
    if new.source_pub_id is null or not public.is_pilot_campaign(new.campaign_id) then
      new.campaign_id := null;
    end if;
  end if;
  return new;
exception when others then
  -- Optional provenance must not turn a valid product write into a failure.
  new.creation_kind := case when tg_op = 'UPDATE' then old.creation_kind else null end;
  new.source_pub_id := case when tg_op = 'UPDATE' then old.source_pub_id else null end;
  new.campaign_id := case when tg_op = 'UPDATE' then old.campaign_id else null end;
  return new;
end;
$$;

drop trigger if exists trips_guard_origin on public.trips;
create trigger trips_guard_origin before insert or update on public.trips
  for each row execute function public.guard_trip_origin();

create index if not exists pub_events_campaign_at_idx on public.pub_events (campaign_id, at);

-- Remove the old defaulted overload before creating the new defaulted signature.
drop function if exists public.bump_published_stats(text, text);
drop function if exists public.bump_published_stats(text, text, text);

create or replace function public.bump_published_stats(p_id text, p_kind text, p_source text default null, p_campaign text default null)
returns void as $$
declare
  v_kind text;
  v_campaign text := case when public.is_pilot_campaign(p_campaign) then p_campaign else null end;
begin
  if p_kind = 'views' then
    update public.published_itineraries set views = views + 1 where id = p_id;
    v_kind := 'view';
  elsif p_kind = 'copies' then
    update public.published_itineraries set copies = copies + 1 where id = p_id;
    v_kind := 'fork';
  else
    return;
  end if;
  if not found then
    return;
  end if;
  insert into public.pub_events (pub_id, kind, source, campaign_id) values (p_id, v_kind, p_source, v_campaign);
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.bump_published_stats(text, text, text, text) from public;
grant execute on function public.bump_published_stats(text, text, text, text) to anon, authenticated;
commit;
