-- ============================================================
-- YatraFlow schema for Supabase (Postgres + Auth)
-- Free-tier friendly: JSONB keeps trip internals denormalized so the
-- TS data model (src/data/types.ts) maps 1:1 without a wide schema.
-- Row Level Security is the authorization boundary — review carefully.
-- Run in the Supabase SQL editor, or via `supabase db push`.
-- ============================================================

-- ---------- profiles ----------
-- One row per Supabase auth user, created by the trigger below.
-- `is_disabled` is the masteradmin soft-ban (see 20260909_masteradmin.sql):
-- disabled accounts hit RESTRICTIVE deny policies on every table and the app
-- signs them back out with an explanation. There is deliberately NO is_admin
-- column — the admin role lives in the JWT app_metadata (Option B), so it can
-- never be self-granted through the "profiles update self" policy.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  name         text not null default 'Traveller',
  avatar_url   text,
  home_city    text,
  languages    jsonb not null default '["en"]'::jsonb,
  travel_styles jsonb not null default '["balanced"]'::jsonb,
  is_creator   boolean not null default false,
  creator_bio  text,
  social_links jsonb,
  is_disabled  boolean not null default false,
  created_at   bigint not null default extract(epoch from now()) * 1000
);
-- ---------- trips ----------
-- Trip internals (days/stops/expenses/fixedCommitments) live in JSONB to
-- preserve the exact TS shape. `members` is extracted to trip_members.
create table if not exists public.trips (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null references public.profiles (id) on delete cascade,
  name                      text not null,
  start_location            text not null default '',
  start_location_coords     jsonb,
  destinations              jsonb not null default '[]'::jsonb,
  destination_coords        jsonb,
  start_date                text not null default '',
  end_date                  text not null default '',
  travellers                integer not null default 1,
  transport_mode            text not null default 'car',
  fuel_economy_km_per_l     numeric,
  fuel_price_per_l          numeric,
  round_trip                boolean,
  budget_per_person_inr     integer not null default 0,
  travel_style              text not null default 'balanced',
  -- 20260914_trip_stay_budget.sql
  stay_style                text,
  -- 20260915_trip_party_prefs.sql — see the migration for the column-by-column semantics
  driver_count              int,
  has_vulnerable            boolean,
  drive_after_dinner_min    int,
  vehicle_profile           jsonb,
  -- 20260928_trip_vehicle_estimates.sql — see the migration for the sanitizers
  tank_l                    numeric,
  rent_per_day_inr          numeric,
  local_train               boolean,
  fixed_commitments         jsonb not null default '[]'::jsonb,
  days                      jsonb not null default '[]'::jsonb,
  expenses                  jsonb not null default '[]'::jsonb,
  cover_emoji               text not null default '🧭',
  cover_image_url           text,
  invite_code               text,
  visibility                text not null default 'private'
                              check (visibility in ('private', 'public')),
  created_at                bigint not null default extract(epoch from now()) * 1000,
  updated_at                bigint not null default extract(epoch from now()) * 1000
);

-- Pre-existing installs: add the fuel/round-trip/cover-image/invite-code
-- columns without touching data (idempotent — safe to re-run).
alter table public.trips add column if not exists fuel_economy_km_per_l numeric;
alter table public.trips add column if not exists fuel_price_per_l numeric;
alter table public.trips add column if not exists round_trip boolean;
alter table public.trips add column if not exists cover_image_url text;
alter table public.trips add column if not exists invite_code text;
alter table public.trips add column if not exists stay_style text;
alter table public.trips add column if not exists driver_count int;
alter table public.trips add column if not exists has_vulnerable boolean;
alter table public.trips add column if not exists drive_after_dinner_min int;
alter table public.trips add column if not exists vehicle_profile jsonb;
alter table public.trips add column if not exists tank_l numeric;
alter table public.trips add column if not exists rent_per_day_inr numeric;
alter table public.trips add column if not exists local_train boolean;

-- Invite codes are unique when present (app mints one per trip).
create unique index if not exists idx_trips_invite_code
  on public.trips (invite_code) where invite_code is not null;

-- ---------- trip_members ----------
create table if not exists public.trip_members (
  trip_id   uuid not null references public.trips (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'editor'
              check (role in ('owner', 'editor', 'commenter', 'viewer')),
  joined_at bigint not null default extract(epoch from now()) * 1000,
  primary key (trip_id, user_id)
);

-- ---------- suggestions ----------
create table if not exists public.suggestions (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  day_index   integer not null default 0,
  proposed_by uuid not null references public.profiles (id) on delete cascade,
  title       text not null default '',
  category    text,
  location_name text,
  lat         double precision,
  lng         double precision,
  description text,
  visit_minutes integer not null default 60,
  estimated_entry_fee_inr integer not null default 0,
  estimated_transport_inr integer not null default 0,
  votes       jsonb not null default '[]'::jsonb,
  comments    jsonb not null default '[]'::jsonb,
  status      text not null default 'open'
                check (status in ('open', 'accepted', 'declined')),
  created_at  bigint not null default extract(epoch from now()) * 1000
);

-- ---------- decisions ----------
create table if not exists public.decisions (
  id                 uuid primary key default gen_random_uuid(),
  trip_id            uuid not null references public.trips (id) on delete cascade,
  question           text not null default '',
  context            text,
  options            jsonb not null default '[]'::jsonb,
  votes_by_user_id   jsonb not null default '{}'::jsonb,
  -- 20260920_decision_comments.sql — same shape as suggestions.comments
  comments           jsonb not null default '[]'::jsonb,
  status             text not null default 'open'
                       check (status in ('open', 'resolved')),
  -- #432: TEXT, not uuid — option ids are `o_<uid()>` (store.addDecision) and
  -- `slot:<key>:<placeId>` (the Map rail's slot votes, parsed back by
  -- resolveDecision). As uuid every resolve failed with 22P02 and the
  -- resolution never persisted. 20260925_decision_resolved_option_text.sql.
  resolved_option_id text,
  raised_by          uuid not null references public.profiles (id) on delete cascade,
  created_at         bigint not null default extract(epoch from now()) * 1000,
  resolved_at        bigint
);

-- Pre-existing installs: add the comments column without touching data
-- (idempotent — safe to re-run).
alter table public.decisions add column if not exists comments jsonb not null default '[]'::jsonb;

-- ---------- activity ----------
create table if not exists public.activity (
  id        uuid primary key default gen_random_uuid(),
  trip_id   uuid not null references public.trips (id) on delete cascade,
  actor_id  uuid not null references public.profiles (id) on delete cascade,
  verb      text not null default '',
  target    text,
  at        bigint not null default extract(epoch from now()) * 1000
);

-- ---------- notifications ----------
create table if not exists public.notifications (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles (id) on delete cascade,
  trip_id   uuid references public.trips (id) on delete cascade,
  text      text not null default '',
  read      boolean not null default false,
  at        bigint not null default extract(epoch from now()) * 1000
);

-- ---------- user_dna ----------
-- I-16 — the account half of Trip DNA. One row per user; the PK IS the owner.
-- Client-side cap of 500 events, mirroring the localStorage log. Vocabulary
-- lives in src/data/types.ts, never in a CHECK here. Migration of record:
-- 20260921_user_dna.sql.
create table if not exists public.user_dna (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  log        jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- published_itineraries ----------
create table if not exists public.published_itineraries (
  id                          text primary key,                       -- slug
  trip_id                     uuid not null references public.trips (id) on delete cascade,
  creator_id                  uuid not null references public.profiles (id) on delete cascade,
  title                       text not null default '',
  tagline                     text,
  cover_image_url             text,
  route_summary               jsonb not null default '[]'::jsonb,
  duration_days               integer not null default 1,
  estimated_budget_per_person_inr integer not null default 0,
  travel_style                text,
  best_season                 text,
  travel_tips                 jsonb not null default '[]'::jsonb,
  warnings_and_assumptions    jsonb not null default '[]'::jsonb,
  free_day_indexes            jsonb not null default '[]'::jsonb,
  premium_price_inr           integer,
  subscriber_cta              text,
  published_at                bigint not null default extract(epoch from now()) * 1000,
  -- v0.37: when the page was last synced with its itinerary (staleness nudge);
  -- see migrations/20260906_published_refreshed_at.sql
  refreshed_at                bigint,
  views                       integer not null default 0,
  copies                      integer not null default 0
);

-- ---------- pub_events (dated funnel steps: see migrations/20260921_pub_funnel_events.sql)
-- One row per view/fork. Written ONLY by bump_published_stats below (the same
-- statement that moves the counter), so the lifetime counters and this log
-- cannot drift. No user id, no IP — a step happened, never who took it.
create table if not exists public.pub_events (
  id     bigint generated always as identity primary key,
  pub_id text not null references public.published_itineraries (id) on delete cascade,
  kind   text not null,
  at     timestamptz not null default now(),
  constraint pub_events_kind_check check (kind in ('view', 'fork'))
);

create index if not exists pub_events_pub_at_idx on public.pub_events (pub_id, at desc);

-- ---------- admin_audit (append-only log of every admin action) ----------
create table if not exists public.admin_audit (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid not null references public.profiles (id) on delete cascade,
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  at          bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- ============================================================
-- Indexes (cheap, help the membership lookups in RLS)
-- ============================================================
create index if not exists idx_trip_members_user on public.trip_members (user_id);
create index if not exists idx_suggestions_trip on public.suggestions (trip_id);
create index if not exists idx_decisions_trip on public.decisions (trip_id);
create index if not exists idx_activity_trip on public.activity (trip_id);
create index if not exists idx_notifications_user on public.notifications (user_id);

-- ---------------------------------------------------------------- B2: touch trigger
-- Keep trips.updated_at on the DATABASE clock. The realtime stale-update guard
-- orders remote rows by this column; a client-set timestamp can be stale,
-- skewed, or simply absent, so the row itself maintains it. Fire BEFORE UPDATE
-- (BEFORE INSERT keeps creation time, not a fake "modified"), unconditionally,
-- for every writer. Mirrored for existing installs by
-- supabase/migrations/20260919_trip_touch_updated_at.sql.
create or replace function public.touch_trip_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := (extract(epoch from now()) * 1000)::bigint;
  return new;
end;
$$;

drop trigger if exists trips_touch_updated_at on public.trips;
create trigger trips_touch_updated_at
  before update on public.trips
  for each row
  execute function public.touch_trip_updated_at();
create index if not exists idx_published_creator on public.published_itineraries (creator_id);

-- ============================================================
-- Helper: is the current user a member (any role) of a trip?
-- SECURITY DEFINER runs as the table owner, bypassing RLS during its own
-- execution — this is what prevents the classic policy self-recursion
-- (42P17) that happens when a policy queries its own table directly.
-- ============================================================
create or replace function public.is_member(trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = trip and m.user_id = auth.uid()
  )
$$;

-- Helper: is the current user an editor/owner of a trip?
-- Used by RLS so collaborators can update shared trips.
-- ============================================================
create or replace function public.is_editor(trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = trip and m.user_id = auth.uid()
      and m.role in ('owner', 'editor')
  )
$$;

-- ============================================================
-- New-user trigger: every auth signup gets a profiles row.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, avatar_url, home_city, languages, travel_styles)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), 'Traveller'),
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'home_city',
    coalesce(new.raw_user_meta_data -> 'languages', '["en"]'::jsonb),
    coalesce(new.raw_user_meta_data -> 'travel_styles', '["balanced"]'::jsonb)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Masteradmin (v0.45.0) — full-control console for two humans.
-- Role lives in the JWT app_metadata (Option B): no is_admin column exists
-- on purpose (it would be self-grantable via "profiles update self").
-- Grant: update auth.users set raw_app_meta_data =
--   raw_app_meta_data || '{"role":"masteradmin"}'::jsonb
--   where email in ('hasnaina955@gmail.com', 'shabtab@outlook.com');
-- (Auth lowercases emails: match 'shabtab@outlook.com'. Sign out/in after.)
-- Full migration (policies + RPCs + audit): migrations/20260909_masteradmin.sql
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'masteradmin', false);
$$;

create or replace function public.is_disabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_disabled
  );
$$;

-- ============================================================
-- Row Level Security — the real authorization boundary.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.suggestions enable row level security;
alter table public.decisions enable row level security;
alter table public.activity enable row level security;
alter table public.notifications enable row level security;
alter table public.published_itineraries enable row level security;
alter table public.pub_events enable row level security;
alter table public.user_dna enable row level security;
alter table public.admin_audit enable row level security;

-- ---------- admin deny (RESTRICTIVE — the only policies that take access
-- AWAY; disabled accounts read/write nothing until re-enabled) ----------
create policy "deny disabled" on public.profiles as restrictive for all to authenticated using (not public.is_disabled());
create policy "deny disabled" on public.trips as restrictive for all to authenticated using (not public.is_disabled());
create policy "deny disabled" on public.trip_members as restrictive for all to authenticated using (not public.is_disabled());
create policy "deny disabled" on public.suggestions as restrictive for all to authenticated using (not public.is_disabled());
create policy "deny disabled" on public.decisions as restrictive for all to authenticated using (not public.is_disabled());
create policy "deny disabled" on public.activity as restrictive for all to authenticated using (not public.is_disabled());
create policy "deny disabled" on public.notifications as restrictive for all to authenticated using (not public.is_disabled());
create policy "deny disabled" on public.user_dna as restrictive for all to authenticated using (not public.is_disabled());
create policy "deny disabled" on public.published_itineraries as restrictive for all to authenticated using (not public.is_disabled());
create policy "deny disabled" on public.pub_events as restrictive for all to authenticated using (not public.is_disabled());

-- ---------- admin read bypass (SELECT everywhere) ----------
create policy "admin read" on public.profiles for select to authenticated using (public.is_admin());
create policy "admin read" on public.trips for select to authenticated using (public.is_admin());
create policy "admin read" on public.trip_members for select to authenticated using (public.is_admin());
create policy "admin read" on public.suggestions for select to authenticated using (public.is_admin());
create policy "admin read" on public.decisions for select to authenticated using (public.is_admin());
create policy "admin read" on public.activity for select to authenticated using (public.is_admin());
create policy "admin read" on public.notifications for select to authenticated using (public.is_admin());
create policy "admin read" on public.published_itineraries for select to authenticated using (public.is_admin());
create policy "admin read" on public.user_dna for select to authenticated using (public.is_admin());
create policy "admin audit read" on public.admin_audit for select to authenticated using (public.is_admin());

-- ---------- admin write bypass (escape hatch for the workspace UI; the
-- console buttons use the audited RPCs in migrations/20260909_masteradmin.sql
-- §5 instead). Covers every app table EXCEPT notifications (recipient-scoped
-- inbox) and admin_audit (append-only via RPCs, no direct writes at all).
create policy "admin write" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.trips for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.trip_members for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.suggestions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.decisions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.activity for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin write" on public.published_itineraries for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- profiles ----------
create policy "profiles read" on public.profiles
  for select using (true);  -- names/avatars are visible app-wide (social features)

create policy "profiles update self" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- trips ----------
-- v0.59 (Sep 18 2026): direct reads are crew-or-admin, authenticated only.
-- The public page reads through the security-definer get_public_trip RPC
-- (paywall + premium day stubbing), so no anon/public branch remains.
-- Migration of record: 20260918_payments_security.sql.
create policy "trips read" on public.trips
  for select to authenticated using (
    auth.uid() = owner_id
    or public.is_member(trips.id)
    or public.is_admin()
  );

-- v0.47 trip trash: tombstoned trips vanish from normal reads, but the
-- tombstone WRITE must stay permitted — the trash UPDATE supplies a new row
-- whose deleted_at is set, so any SELECT policy evaluated against it must
-- accept it, or the UPDATE fails with 42501 and delete silently no-ops
-- (reproduced on the live project, Sep 14 2026: the production policy
-- lacked the added-row clause).
--
-- v0.59 (Sep 18 2026): RESTRICTIVE is load-bearing. The Sep-14 repair had
-- dropped the flag and left `deleted_at is null` as a bare OR-clause —
-- permissive policies OR-combine, so every authenticated user could read
-- every live trip (found live by the integration harness). Restored:
-- restrictive (ANDs with "trips read") with the added-row clauses the
-- tombstone UPDATE needs, so live rows pass as before while tombstones
-- reach only the owner team plus the admin console.
-- Migration of record: 20260917_pin_trashed_read.sql.
create policy "trips read hide trashed" on public.trips
  as restrictive for select to authenticated using (
    deleted_at is null
    or auth.uid() = owner_id
    or public.is_editor(trips.id)
    or public.is_admin()
  );

create policy "trips insert" on public.trips
  for insert with check (auth.uid() = owner_id);

create policy "trips update" on public.trips
  for update using (public.is_editor(trips.id)) with check (public.is_editor(trips.id));

create policy "trips delete" on public.trips
  for delete using (public.is_editor(trips.id));

-- ---------- trip_members ----------
-- NOTE: use the security-definer is_member() here — a direct subquery on
-- trip_members inside its own policy causes infinite recursion (42P17).
create policy "members read" on public.trip_members
  for select using (
    user_id = auth.uid()
    or public.is_member(trip_members.trip_id)
  );

-- A user may add themselves (join via invite) or the trip owner can manage.
create policy "members insert" on public.trip_members
  for insert with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.trips t
      where t.id = trip_members.trip_id and t.owner_id = auth.uid()
    )
  );

create policy "members update" on public.trip_members
  for update using (
    exists (
      select 1 from public.trips t
      where t.id = trip_members.trip_id and t.owner_id = auth.uid()
    )
  );

create policy "members delete" on public.trip_members
  for delete using (
    exists (
      select 1 from public.trips t
      where t.id = trip_members.trip_id and t.owner_id = auth.uid()
    )
    or user_id = auth.uid()  -- leave a trip you're on
  );

-- ---------- suggestions ----------
create policy "suggestions read" on public.suggestions
  for select using (public.is_editor(trip_id) or exists (
    select 1 from public.trips t where t.id = trip_id and t.visibility = 'public'
  ));

create policy "suggestions write" on public.suggestions
  for all using (public.is_editor(trip_id)) with check (public.is_editor(trip_id));

-- ---------- decisions ----------
create policy "decisions read" on public.decisions
  for select using (public.is_editor(trip_id) or exists (
    select 1 from public.trips t where t.id = trip_id and t.visibility = 'public'
  ));

create policy "decisions write" on public.decisions
  for all using (public.is_editor(trip_id)) with check (public.is_editor(trip_id));

-- ---------- activity ----------
create policy "activity read" on public.activity
  for select using (public.is_editor(trip_id) or exists (
    select 1 from public.trips t where t.id = trip_id and t.visibility = 'public'
  ));

create policy "activity write" on public.activity
  for all using (public.is_editor(trip_id)) with check (public.is_editor(trip_id));

-- ---------- notifications ----------
-- Recipients + actors on the same trip may write (pushNotification targets
-- other members); only the recipient reads their own inbox.
create policy "notifications read" on public.notifications
  for select using (auth.uid() = user_id);

create policy "notifications write" on public.notifications
  for all using (auth.uid() = user_id or public.is_editor(trip_id))
  with check (auth.uid() = user_id or public.is_editor(trip_id));

-- ---------- published_itineraries ----------
create policy "published read" on public.published_itineraries
  for select using (true);  -- public gallery

create policy "published write" on public.published_itineraries
  for all using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

-- ---------- pub_events ----------
-- Read your own publications' funnel. NO write policy for anon/authenticated:
-- rows are written only by bump_published_stats below (the definer function),
-- exactly like the counters it maintains.
create policy "pub_events read own publications" on public.pub_events
  for select to authenticated
  using (exists (
    select 1 from public.published_itineraries p
    where p.id = pub_id and p.creator_id = auth.uid()
  ));
-- ---------- user_dna ----------
-- Owner-only on all four verbs: the DNA log is behavioural (what this person
-- accepted and declined), never crew-visible, so there is no member/editor
-- branch to reason about the way trips has one.
create policy "user_dna read" on public.user_dna
  for select using (auth.uid() = user_id);

create policy "user_dna insert" on public.user_dna
  for insert with check (auth.uid() = user_id);

create policy "user_dna update" on public.user_dna
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "user_dna delete" on public.user_dna
  for delete using (auth.uid() = user_id);

-- ============================================================
-- Realtime (Phase 4): broadcast row changes for live multi-editor sync.
-- ============================================================
alter publication supabase_realtime add table public.trips;
alter publication supabase_realtime add table public.trip_members;
alter publication supabase_realtime add table public.suggestions;
alter publication supabase_realtime add table public.decisions;
alter publication supabase_realtime add table public.activity;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.published_itineraries;
alter publication supabase_realtime add table public.profiles;  -- profile cards live-update (names/avatars are public app-wide)
alter publication supabase_realtime add table public.admin_audit;  -- masteradmin console Audit tab reads live

-- ============================================================
-- RPC for published itinerary stats (bypasses RLS)
-- ============================================================
-- p_id is TEXT: published ids are client-minted slugs ("pub_xxx"), and the
-- original uuid typing made every call fail the cast (see
-- migrations/20260906_bump_published_stats_text.sql).
--
-- This is the ONE write path for views/forks: each bump also records a dated
-- row in pub_events (migrations/20260921_pub_funnel_events.sql), so the
-- lifetime counter and the funnel log cannot drift. The `not found` guard
-- keeps an event from describing a step whose counter did not move, and keeps
-- the anon-callable RPC from stuffing the log with arbitrary ids.
create or replace function public.bump_published_stats(p_id text, p_kind text)
returns void as $$
declare
  v_kind text;
begin
  if p_kind = 'views' then
    update public.published_itineraries set views = views + 1 where id = p_id;
    v_kind := 'view';
  elsif p_kind = 'copies' then
    update public.published_itineraries set copies = copies + 1 where id = p_id;
    v_kind := 'fork';
  else
    return;  -- unknown kind: no counter, no event
  end if;

  -- FOUND is the UPDATE's own result: publication row missing (unpublished or
  -- never issued) means nothing to count and nothing to record.
  if not found then
    return;
  end if;

  insert into public.pub_events (pub_id, kind) values (p_id, v_kind);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.bump_published_stats(text, text) to anon, authenticated;

-- ============================================================
-- Creator funnel read (see migrations/20260921_pub_funnel_events.sql)
-- ============================================================
-- Daily buckets for the logged-in creator's OWN publications: the client owns
-- the window control, so switching it costs no round trip. Scoped by
-- auth.uid() inside a definer function (the get_creator_sales precedent) so a
-- caller cannot read another creator's funnel, and a half-applied migration
-- surfaces as an error rather than a silent zero. Authenticated only:
-- revoking from `public` does not revoke from anon on Supabase, so the roles
-- are named.
create or replace function public.get_creator_funnel(p_days integer default 180)
returns table (pub_id text, day date, views bigint, forks bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    e.pub_id,
    (e.at at time zone 'utc')::date as day,
    count(*) filter (where e.kind = 'view') as views,
    count(*) filter (where e.kind = 'fork') as forks
  from public.pub_events e
  where e.pub_id in (
      select p.id from public.published_itineraries p
      where p.creator_id = auth.uid()
    )
    and e.at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 180), 730)))
  group by e.pub_id, day
  order by day desc;
$$;

revoke all on function public.get_creator_funnel(integer) from public, anon;
grant execute on function public.get_creator_funnel(integer) to authenticated;

-- ---------- pub_events retention (see migrations/20260922_pub_events_retention.sql)
-- The log prunes itself: nothing reads a step older than the reader's own
-- 730-day horizon (`get_creator_funnel` clamps there), so a row past it is
-- pure storage cost. The horizon lives in ONE place — the reader's clamp —
-- and the pruner clamps its own argument to the same number, so pruning can
-- never manufacture a "recording began" date the log never had.
create or replace function public.prune_pub_events(p_keep_days integer default 730)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_horizon timestamptz;
  v_deleted integer;
begin
  -- Same clamp the reader uses: a caller cannot prune beyond the reader's
  -- own horizon, and a smaller call prunes less, never more.
  v_keep_days := greatest(1, least(coalesce(p_keep_days, 730), 730));
  v_horizon := now() - make_interval(days => v_keep_days);

  delete from public.pub_events
  where at < v_horizon;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_pub_events(integer) from public, anon, authenticated;
grant execute on function public.prune_pub_events(integer) to service_role;
-- Operator-only (#356, migrations/20260927_prune_pub_events_lockdown.sql): the
-- predicate is purely `at < horizon`, so an `authenticated` grant was a
-- whole-tenant bulk delete available to any signup. Nothing in the app calls
-- it — the SQL editor runs as the owner and pg_cron as the definer, so both
-- documented paths still work.
-- Scheduling is optional and plan-gated (pg_cron): the same stance as
-- migrations/20260910_schedule_purge.sql. Apply manually if pg_cron is off:
--   select public.prune_pub_events();

-- ============================================================
-- Invite-code lookup (see migrations/20260909_invite_codes.sql)
-- ============================================================
-- The code is the capability — same trust model as get_invite_trip: a
-- private trip must be previewable by whoever holds its invite code, and RLS
-- cannot know the request came from a #/join/<code> link. SECURITY DEFINER
-- bypasses the trips read policy; case-insensitive because users type codes
-- casually.
create or replace function public.get_trip_by_invite_code(p_code text)
returns setof public.trips
language sql
security definer
set search_path = public
stable
as $$
  select t.* from public.trips t
  where upper(t.invite_code) = upper(trim(p_code));
$$;

grant execute on function public.get_trip_by_invite_code(text) to anon, authenticated;
