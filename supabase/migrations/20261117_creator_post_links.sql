-- G8. The operator applied this file on 2026-11-16. Hosted access probes passed.
begin;

-- Post links: a creator links one public post to one of their own live routes.
-- Links only. The database stores the address and a short caption. Nothing here
-- fetches a post, a thumbnail or a view count from any third party.
-- The table holds exactly the eight public columns. A new column must be
-- reviewed, because the public read grant below covers every column.
-- The post id is the attribution tag: a tagged link carries `p=<post id>`.
create table if not exists public.creator_posts (
  id uuid primary key default gen_random_uuid(),
  creator uuid not null references public.profiles(id) on delete cascade,
  url text not null,
  kind text not null,
  pub_id text not null references public.published_itineraries(id)
    on update cascade on delete cascade,
  day_index integer,
  caption text,
  created_at timestamptz not null default now()
);

-- Regex notes. This file assumes standard_conforming_strings = on, the Supabase
-- default, so a backslash reaches the regex engine as written.
-- The path class [!-~] is printable ASCII: it excludes spaces, control
-- characters and anything outside ASCII, so the check does not depend on the
-- database locale. After the host the next character must be "/" or the end,
-- so "instagram.com.example.com", "instagram.com@example.com", a port and a
-- fragment-only address all fail.
alter table public.creator_posts drop constraint if exists creator_posts_url_check;
alter table public.creator_posts add constraint creator_posts_url_check
  check (
    char_length(url) <= 300
    and url ~ '^https://(instagram\.com|www\.instagram\.com|youtube\.com|www\.youtube\.com|m\.youtube\.com|youtu\.be|threads\.net|www\.threads\.net)(/[!-~]*)?$'
  );
alter table public.creator_posts drop constraint if exists creator_posts_kind_check;
alter table public.creator_posts add constraint creator_posts_kind_check
  check (
    (kind = 'instagram' and url ~ '^https://(www\.)?instagram\.com(/|$)')
    or (kind = 'youtube' and url ~ '^https://((www\.|m\.)?youtube\.com|youtu\.be)(/|$)')
    or (kind = 'threads' and url ~ '^https://(www\.)?threads\.net(/|$)')
  );
alter table public.creator_posts drop constraint if exists creator_posts_day_index_check;
alter table public.creator_posts add constraint creator_posts_day_index_check
  check (day_index is null or day_index >= 0);
-- Same length rule as planning notes: 140 Unicode code points. The blank test
-- trims ASCII whitespace only, like the client. btrim with an explicit set does
-- not depend on locale, and E'' has no \v escape, so vertical tab is \x0b.
alter table public.creator_posts drop constraint if exists creator_posts_caption_check;
alter table public.creator_posts add constraint creator_posts_caption_check
  check (
    caption is null
    or (char_length(caption) <= 140 and btrim(caption, E' \t\n\x0b\f\r') <> '')
  );
alter table public.creator_posts drop constraint if exists creator_posts_creator_url_key;
alter table public.creator_posts add constraint creator_posts_creator_url_key unique (creator, url);
create index if not exists creator_posts_creator_idx on public.creator_posts (creator, created_at desc);
create index if not exists creator_posts_pub_idx on public.creator_posts (pub_id);

alter table public.creator_posts enable row level security;

-- Public read: a post is public only while its route is live and its creator
-- is active. Anonymous callers cannot read profiles, so the creator test uses
-- the public card. This hides every post of a disabled creator (#800).
drop policy if exists "creator posts public read" on public.creator_posts;
create policy "creator posts public read" on public.creator_posts
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.published_itineraries p
      where p.id = creator_posts.pub_id
        and p.creator_id = creator_posts.creator
        and p.unpublished_at is null
    )
    and exists (
      select 1 from public.profile_cards c
      where c.id = creator_posts.creator and c.is_creator and c.creator_available
    )
  );
-- The owner also reads posts on routes that are not live, so the editor can
-- show and remove them.
drop policy if exists "creator posts own read" on public.creator_posts;
create policy "creator posts own read" on public.creator_posts
  for select to authenticated using (creator = auth.uid());
drop policy if exists "creator posts own insert" on public.creator_posts;
create policy "creator posts own insert" on public.creator_posts
  for insert to authenticated with check (creator = auth.uid());
drop policy if exists "creator posts own update" on public.creator_posts;
create policy "creator posts own update" on public.creator_posts
  for update to authenticated using (creator = auth.uid()) with check (creator = auth.uid());
drop policy if exists "creator posts own delete" on public.creator_posts;
create policy "creator posts own delete" on public.creator_posts
  for delete to authenticated using (creator = auth.uid());
drop policy if exists "deny disabled" on public.creator_posts;
create policy "deny disabled" on public.creator_posts
  as restrictive for all to authenticated
  using (not public.is_disabled()) with check (not public.is_disabled());

-- Explicit grants. A client may insert six columns, change only the caption,
-- and delete. It cannot set id or created_at, or move a post to another route
-- or creator. To change the route or the address, remove the post and add it again.
revoke all on table public.creator_posts from public, anon, authenticated;
grant select on public.creator_posts to anon, authenticated;
grant insert (creator, url, kind, pub_id, day_index, caption) on public.creator_posts to authenticated;
grant update (caption) on public.creator_posts to authenticated;
grant delete on public.creator_posts to authenticated;

-- One guard for the rules RLS cannot state, on insert: an active creator, a
-- live route that the creator owns, a day inside that route, and the 12-post cap.
-- The FOR NO KEY UPDATE lock on the creator's profile row conflicts with
-- itself, so two concurrent inserts count one after the other and cannot both
-- take the twelfth place. FOR SHARE on the route row serializes the insert
-- with an unpublish, like the G3 featured-route guard.
drop trigger if exists creator_posts_guard on public.creator_posts;
drop function if exists public.guard_creator_post();
create or replace function public.guard_creator_post()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_days integer;
  v_count integer;
begin
  -- Insert only. Clients can update only the caption, so nothing else moves.
  -- An update check would also fire for the cascade when a route id changes,
  -- and it would fail a route update for a route that is not live. The
  -- stale-day trigger below covers a route that a republish makes shorter.
  perform 1 from public.profiles p
    where p.id = new.creator and p.is_creator and not p.is_disabled
    for no key update;
  if not found then
    raise exception 'Post links need an active creator' using errcode = '23514';
  end if;
  select count(*) into v_count from public.creator_posts where creator = new.creator;
  if v_count >= 12 then
    raise exception 'A creator can keep at most 12 post links' using errcode = '23514';
  end if;
  select p.duration_days into v_days from public.published_itineraries p
    where p.id = new.pub_id and p.creator_id = new.creator and p.unpublished_at is null
    for share;
  if not found then
    raise exception 'A post must link to one of your live routes' using errcode = '23514';
  end if;
  if new.day_index is not null and new.day_index >= v_days then
    raise exception 'The day is outside the route' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_creator_post() from public, anon, authenticated;
create trigger creator_posts_guard before insert on public.creator_posts
  for each row execute function public.guard_creator_post();

-- A republish can shorten a route. A day that no longer exists becomes "whole
-- route" instead of an address that points past the end.
drop trigger if exists publications_clear_stale_post_day on public.published_itineraries;
drop function if exists public.clear_stale_creator_post_day();
create or replace function public.clear_stale_creator_post_day()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.creator_posts set day_index = null
    where pub_id = new.id and day_index is not null and day_index >= new.duration_days;
  return new;
end;
$$;
revoke all on function public.clear_stale_creator_post_day() from public, anon, authenticated;
create trigger publications_clear_stale_post_day
  after update of duration_days on public.published_itineraries
  for each row when (new.duration_days is distinct from old.duration_days)
  execute function public.clear_stale_creator_post_day();

-- G2 extension. A visit may name the post that brought it. The event keeps no
-- visitor identity: only the post id, and only when it is a real post of that
-- creator. A removed post leaves the visit in the page count (set null).
alter table public.creator_page_events
  add column if not exists post_id uuid references public.creator_posts(id) on delete set null;
create index if not exists creator_page_events_post_idx
  on public.creator_page_events (creator_id, post_id, at desc) where post_id is not null;

-- Drop both older overloads. Two overloads with defaults make a named call
-- ambiguous. The new signature keeps both older calls working through defaults.
drop function if exists public.bump_creator_page_view(uuid);
drop function if exists public.bump_creator_page_view(uuid, text);
drop function if exists public.bump_creator_page_view(uuid, text, uuid);
create or replace function public.bump_creator_page_view(
  p_creator uuid, p_source text default null, p_post uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_disabled() then
    return;
  end if;
  if p_source is not null and p_source not in (
    'copy', 'buyer', 'explore', 'creator', 'purchases', 'wa', 'community',
    'ig', 'yt', 'threads', 'post'
  ) then
    return;
  end if;
  -- Match bump_published_stats: one event per valid call, with no server rate limit.
  insert into public.creator_page_events (creator_id, source, post_id)
  select p.id, p_source,
    (select cp.id from public.creator_posts cp where cp.id = p_post and cp.creator = p.id)
  from public.profiles p
  where p.id = p_creator and p.is_creator and not p.is_disabled;
end;
$$;
revoke all on function public.bump_creator_page_view(uuid, text, uuid) from public, anon;
grant execute on function public.bump_creator_page_view(uuid, text, uuid) to anon, authenticated;

-- Owner read: visits per post. Counts only, scoped to the caller.
drop function if exists public.get_creator_post_visits();
drop function if exists public.get_creator_post_visits(integer);
create or replace function public.get_creator_post_visits(p_days integer default 30)
returns table (post_id uuid, visits bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if public.is_disabled() then
    return;
  end if;
  return query
  select e.post_id, count(*) as visits
  from public.creator_page_events e
  where e.creator_id = auth.uid()
    and e.post_id is not null
    and e.at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 730)))
  group by e.post_id
  order by 2 desc, 1;
end;
$$;
revoke all on function public.get_creator_post_visits(integer) from public, anon;
grant execute on function public.get_creator_post_visits(integer) to authenticated;
commit;
