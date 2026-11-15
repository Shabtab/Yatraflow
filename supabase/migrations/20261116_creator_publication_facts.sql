-- G3 draft. Apply by hand after review. This SQL is not applied yet.
begin;

-- Existing owner paths: "published write" and "profiles update self".
-- These facts are creator claims, not independent verification. Scope has a 140-character cap.
alter table public.published_itineraries add column if not exists planned_km numeric;
alter table public.published_itineraries add column if not exists best_months smallint;
alter table public.published_itineraries add column if not exists reviewed_at timestamptz;
alter table public.published_itineraries add column if not exists reviewed_scope text;
alter table public.published_itineraries drop constraint if exists published_planned_km_check;
alter table public.published_itineraries add constraint published_planned_km_check
  check (planned_km is null or (planned_km >= 0 and planned_km < 20000));
alter table public.published_itineraries drop constraint if exists published_best_months_check;
alter table public.published_itineraries add constraint published_best_months_check
  check (best_months is null or best_months between 0 and 4095);
alter table public.published_itineraries drop constraint if exists published_reviewed_scope_check;
alter table public.published_itineraries add constraint published_reviewed_scope_check
  check (reviewed_scope is null or char_length(reviewed_scope) <= 140);

-- The client must omit reviewed_at from the publish upsert.
-- Send it only in a separate "mark reviewed" update. The server supplies the timestamp.
drop trigger if exists publications_stamp_reviewed_at on public.published_itineraries;
drop function if exists public.stamp_publication_reviewed_at();
create or replace function public.stamp_publication_reviewed_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.reviewed_at is not null
    and (tg_op = 'INSERT' or new.reviewed_at is distinct from old.reviewed_at) then
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_publication_reviewed_at() from public, anon, authenticated;
create trigger publications_stamp_reviewed_at before insert or update on public.published_itineraries
  for each row execute function public.stamp_publication_reviewed_at();

-- Private source fields use the existing self-update policy. Cards remain read-only.
alter table public.profiles add column if not exists featured_pub_id text;
alter table public.profiles add column if not exists planning_notes jsonb;
alter table public.profile_cards add column if not exists featured_pub_id text;
alter table public.profile_cards add column if not exists planning_notes jsonb;
alter table public.profiles drop constraint if exists profiles_planning_notes_check;
alter table public.profile_cards drop constraint if exists cards_planning_notes_check;
drop function if exists public.valid_planning_notes(jsonb);
create or replace function public.valid_planning_notes(p_notes jsonb)
returns boolean language sql immutable set search_path = public
as $$
  select case
    when p_notes is null then true
    when jsonb_typeof(p_notes) = 'array' then
      jsonb_array_length(p_notes) <= 3 and not exists (
        select 1 from jsonb_array_elements(p_notes) item
        where jsonb_typeof(item) <> 'string' or char_length(item #>> '{}') > 140
          or btrim(item #>> '{}') = ''
      )
    else false
  end
$$;
revoke all on function public.valid_planning_notes(jsonb) from public, anon, authenticated;
grant execute on function public.valid_planning_notes(jsonb) to authenticated;
alter table public.profiles add constraint profiles_planning_notes_check
  check (public.valid_planning_notes(planning_notes) is true);
alter table public.profile_cards add constraint cards_planning_notes_check
  check (public.valid_planning_notes(planning_notes) is true);
alter table public.profiles drop constraint if exists profiles_featured_pub_fkey;
alter table public.profiles add constraint profiles_featured_pub_fkey
  foreign key (featured_pub_id) references public.published_itineraries(id) on update cascade on delete set null;

drop trigger if exists profiles_guard_creator_picks on public.profiles;
drop function if exists public.guard_creator_picks();
create or replace function public.guard_creator_picks()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.featured_pub_id is not null
    and (tg_op = 'INSERT' or new.featured_pub_id is distinct from old.featured_pub_id) then
    if not new.is_creator or new.is_disabled then
      raise exception 'Creator picks need an active creator' using errcode = '23514';
    end if;
    -- Serialize selection with unpublish and delete, so concurrent edits cannot leave stale picks.
    perform 1 from public.published_itineraries p
      where p.id = new.featured_pub_id and p.creator_id = new.id and p.unpublished_at is null
      for share;
    if not found then
      raise exception 'Featured publication must be live and owned' using errcode = '23514';
    end if;
  end if;
  if new.planning_notes is not null and (not new.is_creator or new.is_disabled) then
    if tg_op = 'INSERT' then
      raise exception 'Planning notes need an active creator' using errcode = '23514';
    elsif new.planning_notes is distinct from old.planning_notes then
      raise exception 'Planning notes need an active creator' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_creator_picks() from public, anon, authenticated;
create trigger profiles_guard_creator_picks
  before insert or update of featured_pub_id, planning_notes on public.profiles
  for each row execute function public.guard_creator_picks();

-- Extend the existing projection allowlist by name. No private field becomes public.
drop trigger if exists profiles_sync_card on public.profiles;
drop function if exists public.sync_profile_card();
create or replace function public.sync_profile_card()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.profile_cards where id = old.id;
    return old;
  end if;
  insert into public.profile_cards
    (id, name, avatar_url, is_creator, creator_bio, social_links, creator_available,
     featured_pub_id, planning_notes)
  values
    (new.id, new.name, new.avatar_url, new.is_creator, new.creator_bio,
     public.safe_social_links(new.social_links), not new.is_disabled,
     (select p.id from public.published_itineraries p where p.id = new.featured_pub_id
       and p.creator_id = new.id and p.unpublished_at is null and new.is_creator and not new.is_disabled),
     case when new.is_creator and not new.is_disabled then new.planning_notes end)
  on conflict (id) do update set
    name = excluded.name, avatar_url = excluded.avatar_url, is_creator = excluded.is_creator,
    creator_bio = excluded.creator_bio, social_links = excluded.social_links,
    creator_available = excluded.creator_available,
    featured_pub_id = excluded.featured_pub_id, planning_notes = excluded.planning_notes;
  return new;
end;
$$;
revoke all on function public.sync_profile_card() from public, anon, authenticated;
create trigger profiles_sync_card after insert or update or delete on public.profiles
  for each row execute function public.sync_profile_card();

drop trigger if exists publications_clear_creator_pick on public.published_itineraries;
drop function if exists public.clear_unavailable_creator_pick();
create or replace function public.clear_unavailable_creator_pick()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles set featured_pub_id = null
    where featured_pub_id in (old.id, new.id)
      and (new.creator_id <> id or new.unpublished_at is not null);
  return new;
end;
$$;
revoke all on function public.clear_unavailable_creator_pick() from public, anon, authenticated;
create trigger publications_clear_creator_pick
  after update of id, creator_id, unpublished_at on public.published_itineraries
  for each row execute function public.clear_unavailable_creator_pick();

-- Refresh existing cards through the same named projection. The BEFORE guard does not run here.
update public.profiles set name = name;

drop function if exists public.get_public_profile_cards();
drop function if exists public.get_public_profile_cards(uuid[]);
create or replace function public.get_public_profile_cards(p_ids uuid[] default null)
returns setof public.profile_cards language plpgsql security definer set search_path = public stable
as $$
begin
  if coalesce(public.is_disabled(), false) then return; end if;
  return query select c.id, c.name, c.avatar_url, c.is_creator, c.creator_bio, c.social_links,
    c.creator_available, c.featured_pub_id, c.planning_notes
    from public.profile_cards c where p_ids is null or c.id = any(p_ids);
end;
$$;
revoke all on function public.get_public_profile_cards(uuid[]) from public, anon, authenticated;
grant execute on function public.get_public_profile_cards(uuid[]) to anon, authenticated;
revoke all on public.profile_cards from public, anon, authenticated;
grant select on public.profile_cards to anon, authenticated;
commit;
