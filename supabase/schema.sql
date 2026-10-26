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
  drives_part               boolean,
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
  -- 20260929_pub_events_share_source.sql — how the owner ARRIVED
  ref                       text,
  visibility                text not null default 'private'
                              check (visibility in ('private', 'public')),
  created_at                bigint not null default extract(epoch from now()) * 1000,
  updated_at                bigint not null default extract(epoch from now()) * 1000,
  -- 20260910_trip_trash.sql — the trash flow (server RPC, undo window, hard
  -- delete guards) keys off this stamp; without it a fresh install cannot
  -- join by code or trash a trip.
  deleted_at                timestamptz
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
alter table public.trips add column if not exists drives_part boolean;
alter table public.trips add column if not exists ref text;

-- Share attribution: one vocabulary across pub_events.source and trips.ref
-- (mirrors 20260929_pub_events_share_source.sql — idempotent, safe to re-run).
alter table public.trips drop constraint if exists trips_ref_check;
alter table public.trips add constraint trips_ref_check
  check (ref is null or ref in ('copy', 'buyer', 'explore', 'creator', 'purchases', 'wa', 'community'));

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
  day_id      text,
  place       jsonb,
  accepted_stop_id text,
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
  created_at  bigint not null default extract(epoch from now()) * 1000,
  constraint suggestions_day_id_shape
    check (day_id is null or length(btrim(day_id)) between 1 and 100),
  constraint suggestions_place_identity_shape
    check (
      place is null or (
        jsonb_typeof(place)='object'
        and place ? 'exposure'
        and jsonb_typeof(place->'exposure')='string'
        and place->>'exposure' in ('indoor','outdoor','unknown')
        and (not (place ? 'source') or (jsonb_typeof(place->'source')='string' and place->>'source' in ('google','mappls','open-meteo','wikipedia','osm')))
        and (not (place ? 'placeId') or (jsonb_typeof(place->'placeId')='string' and length(btrim(place->>'placeId')) between 1 and 300))
        and (not (place ? 'eLoc') or (jsonb_typeof(place->'eLoc')='string' and length(btrim(place->>'eLoc')) between 1 and 300))
        and case when jsonb_typeof(place) = 'object' then place - array['source','placeId','eLoc','exposure'] = '{}'::jsonb else false end
      )
    )
);
alter table public.suggestions add column if not exists accepted_stop_id text;

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
  resolved_stop_id text,
  raised_by          uuid not null references public.profiles (id) on delete cascade,
  created_at         bigint not null default extract(epoch from now()) * 1000,
  resolved_at        bigint
);

-- Pre-existing installs: add the comments column without touching data
-- (idempotent — safe to re-run).
alter table public.decisions add column if not exists comments jsonb not null default '[]'::jsonb;
alter table public.decisions add column if not exists resolved_stop_id text;

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
  copies                      integer not null default 0,
  -- #354: the publish rules, as a DATABASE backstop. The client enforces the
  -- same six in `lib/publishRules.publishValidation` (and `publishItinerary`
  -- calls it), but a rule enforced only by the process that would break is a
  -- suggestion. Each mirrors the migration of the same name
  -- (20260929_published_itineraries_publish_rules.sql), which adds them NOT
  -- VALID so legacy rows are grandfathered — a fresh instance has no legacy, so
  -- here they are plain: every row written is a new one and must satisfy them.
  -- The null cover branch is the same rule's grandfathering, kept so a fresh
  -- schema and a migrated one accept the SAME set of rows.
  constraint published_itineraries_cover_https
    check (cover_image_url is null or (cover_image_url ~ '^https://\S+$')),
  constraint published_itineraries_price_in_range
    check (premium_price_inr is null or (premium_price_inr >= 0 and premium_price_inr <= 100000)),
  -- A priced plan must withhold at least one day, or the Unlock CTA reveals
  -- nothing. `jsonb_typeof` guards the poisoned-scalar column (#352) instead of
  -- trusting the shape.
  constraint published_itineraries_priced_withholds_a_day
    check (
      premium_price_inr is null
      or premium_price_inr = 0
      or (
        free_day_indexes is null
        or jsonb_typeof(free_day_indexes) <> 'array'
        or jsonb_array_length(free_day_indexes) >= 1
      )
    )
);

-- ---------- pub_events (dated funnel steps: see migrations/20260921_pub_funnel_events.sql)
-- One row per view/fork. Written ONLY by bump_published_stats below (the same
-- statement that moves the counter), so the lifetime counters and this log
-- cannot drift. No user id, no IP — a step happened, never who took it.
-- `source` (#230) is the step's route in — the shared link's ref or the in-app
-- surface — vocabulary-checked below; NULL = direct.
create table if not exists public.pub_events (
  id     bigint generated always as identity primary key,
  pub_id text not null references public.published_itineraries (id) on delete cascade,
  kind   text not null,
  at     timestamptz not null default now(),
  source text,
  constraint pub_events_kind_check check (kind in ('view', 'fork'))
);
alter table public.pub_events add column if not exists source text;
alter table public.pub_events drop constraint if exists pub_events_source_check;
alter table public.pub_events add constraint pub_events_source_check
  check (source is null or source in ('copy', 'buyer', 'explore', 'creator', 'purchases', 'wa', 'community'));

create index if not exists pub_events_pub_at_idx on public.pub_events (pub_id, at desc);

-- ---------- create_funnel_events (dated create-funnel steps: see migrations/20260929_create_funnel_events.sql)
-- One row per create-flow step. The dated log is the ONLY source — no lifetime
-- counter columns (the #363 drift lesson); aggregates derive at read. `meta`
-- carries counts, slugs and enums ONLY (PII rule — no free-text column exists
-- in this table). Anonymous inserts carry user_id = null by policy; reads are
-- admin-only; retention prunes at 90 days through a service_role-only function.
create table if not exists public.create_funnel_events (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  session_id text not null,
  user_id    uuid references public.profiles (id) on delete set null,
  event      text not null,
  phase      text,
  trip_id    uuid references public.trips (id) on delete set null,
  meta       jsonb,
  constraint create_funnel_events_event_check check (event in (
    'started', 'template_picked', 'readiness_complete', 'draft_resumed',
    'draft_discarded', 'crew_added', 'submitted', 'moment_invite_sent', 'abandoned'
  ))
);

create index if not exists create_funnel_events_at_idx on public.create_funnel_events (at desc);
create index if not exists create_funnel_events_event_at_idx on public.create_funnel_events (event, at);
create index if not exists create_funnel_events_session_idx on public.create_funnel_events (session_id);

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

-- ------------------------------------------------- #799: owner_id is immutable
-- A policy cannot express this: WITH CHECK sees only the NEW row, and Postgres
-- never exposes OLD to a policy. A column-level grant was rejected because the
-- client sends the whole row on every write (tripToRow always includes
-- owner_id), so revoking UPDATE(owner_id) would fail every editor save rather
-- than only an ownership change. So a BEFORE UPDATE OF owner_id trigger.
--
-- Fails closed. The comparison is `is distinct from`, so a null on either side
-- counts as a change instead of slipping past a null = null test. Allowed: the
-- current owner, a masteradmin, and a caller with no authenticated user
-- (service role / SQL editor / migration). An editor matches none of them and
-- is refused with 42501. Mirrored for existing installs by
-- supabase/migrations/20261020_trip_owner_and_delete_guards.sql.
create or replace function public.trips_owner_id_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.owner_id is not distinct from old.owner_id then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if old.owner_id = auth.uid() then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  raise exception
    'trip ownership cannot be changed by this caller (trip %, caller %)',
    old.id, auth.uid()
    using errcode = '42501';
end;
$$;

drop trigger if exists trips_owner_id_immutable on public.trips;
create trigger trips_owner_id_immutable
  before update of owner_id on public.trips
  for each row
  execute function public.trips_owner_id_immutable();

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
alter table public.create_funnel_events enable row level security;
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
create policy "deny disabled" on public.create_funnel_events as restrictive for all to authenticated using (not public.is_disabled());

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
-- #800: `profiles read` was `for select using (true)`, which defaults to the
-- `public` role — so `anon` matched it, and RLS limits rows rather than columns.
-- Every column of every row, `email` included, was readable by anyone. The
-- private table is now self-plus-admin, and the public read moves to
-- `get_public_profile_cards` over `public.profile_cards` further down.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read self" on public.profiles
  for select to authenticated using (auth.uid() = id);

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

-- #807: a direct DELETE must not erase a publication and the purchases behind
-- it. RESTRICTIVE is load-bearing here for the same reason as the trashed-read
-- policy above: a permissive policy would OR with the editor gate below and
-- change nothing. A restrictive policy on a DELETE is evaluated against the row
-- being deleted, so USING is the only clause available and the added-row
-- concern that applies to UPDATE does not apply here.
--
-- The owner (or a masteradmin) may delete a trip with no publication, no order
-- and no entitlement -- the same condition purge_trashed_trip applies, so the
-- direct path and the RPC path now agree. A non-owner editor may not delete a
-- trip at all: the product has no such flow, and crew removal goes through
-- trip_members. Mirrored by
-- supabase/migrations/20261020_trip_owner_and_delete_guards.sql.
--
-- The money check is a SECURITY DEFINER helper because purchase_orders and
-- entitlements are buyer-only under RLS: a policy expression runs as the caller,
-- so an inline subquery would see no rows for the owner and fail OPEN.
--
-- This copy is plpgsql, and it guards the payments tables with to_regclass.
-- Reason: a `language sql` body is validated at CREATE time, and this file
-- creates neither purchase_orders nor entitlements (the payments rail lives in
-- migrations/20260918_payments_rail.sql). A sql copy would fail the whole
-- schema.sql build with "relation does not exist". plpgsql resolves relations
-- when the statement is reached, so the guard keeps a schema-only build valid.
--
-- What it answers when the payments tables are ABSENT: still TRUE for a trip
-- that has a publication row, because the publication check runs first and is
-- independent of them. That is the fail-closed answer. With no publication row
-- the answer is FALSE, and that is safe rather than optimistic: purchase_orders
-- and entitlements both reference published_itineraries(id), so a trip with no
-- publication row cannot own an order or an entitlement. The guard can only
-- skip a check that the foreign keys already make impossible.
create or replace function public.trip_has_publication_money(p_trip uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Fail closed on an unknown shape: a null id cannot be deleted safely.
  if p_trip is null then
    return true;
  end if;

  -- A publication row alone blocks the delete, and it keeps buyers whole.
  if exists (
    select 1 from public.published_itineraries p where p.trip_id = p_trip
  ) then
    return true;
  end if;

  -- The payments tables exist only after the payments-rail migration. Each
  -- statement below is planned when it is reached, so the guard is what keeps
  -- a schema-only database valid.
  if to_regclass('public.purchase_orders') is not null then
    if exists (
      select 1 from public.purchase_orders o
      where o.pub_id in (select p.id from public.published_itineraries p where p.trip_id = p_trip)
    ) then
      return true;
    end if;
  end if;

  if to_regclass('public.entitlements') is not null then
    if exists (
      select 1 from public.entitlements e
      where e.pub_id in (select p.id from public.published_itineraries p where p.trip_id = p_trip)
    ) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

revoke all on function public.trip_has_publication_money(uuid) from public, anon, authenticated;
grant execute on function public.trip_has_publication_money(uuid) to authenticated;

create policy "trips delete guard" on public.trips
  as restrictive for delete to authenticated using (
    (
      auth.uid() = owner_id
      or public.is_admin()
    )
    and not public.trip_has_publication_money(trips.id)
  );

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

-- The trip owner adds member rows here. A joiner gets a row from join_trip()
-- instead, so no client writes a row for itself.
create policy "members insert" on public.trip_members
  for insert with check (
    exists (
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
-- ---------- create_funnel_events ----------
-- Insert own (authenticated) / anon-insert with no user attachment / admin-only
-- read — see the migration for the abuse-bound reasoning. Append-only to every
-- client role: the retention pruner (service_role) is the only deleter.
create policy "create_funnel_events insert own" on public.create_funnel_events
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "create_funnel_events insert anon" on public.create_funnel_events
  for insert to anon
  with check (user_id is null);

create policy "create_funnel_events admin read" on public.create_funnel_events
  for select to authenticated
  using (public.is_admin());

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
-- `public.profile_cards` is added to the publication in the #800 section at the
-- end of this file, AFTER the table is created. Publishing it here — ahead of its
-- own definition — raises 42P01 when these statements run in source order.
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
-- #230: p_source is the step's route in (see migrations/20260929_pub_events_
-- share_source.sql). The two-argument overload drops first, or a two-argument
-- call matches both and Postgres answers "function is not unique".
drop function if exists public.bump_published_stats(text, text);

-- The current counter definition is in the growth-attribution section below.

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
  v_keep_days integer;
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

-- ============================================================
-- join_trip(p_code): the server path for joining a trip.
--
-- p_code is the invite code from a /join/<code> link. Holding the code is the
-- capability. A trip id joins nobody. The function returns the trip id, or
-- null when no live trip has that code.
-- ============================================================
drop function if exists public.join_trip(text);

create or replace function public.join_trip(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_key      text := upper(trim(coalesce(p_code, '')));
  v_trip_id  uuid;
  v_is_owner boolean;
begin
  if v_uid is null then
    raise exception 'sign in to join a trip' using errcode = '42501';
  end if;

  -- The "deny disabled" policy does not run for this definer function.
  if public.is_disabled() then
    raise exception 'this account is disabled' using errcode = '42501';
  end if;

  if v_key = '' then
    return null;
  end if;

  select t.id, t.owner_id = v_uid
    into v_trip_id, v_is_owner
  from public.trips t
  where upper(t.invite_code) = v_key
    and t.deleted_at is null
  limit 1;

  if v_trip_id is null then
    return null;
  end if;

  -- An existing member keeps their role. The trip owner gets the owner role.
  -- Any other new joiner becomes an editor.
  insert into public.trip_members (trip_id, user_id, role, joined_at)
  values (
    v_trip_id,
    v_uid,
    case when v_is_owner then 'owner' else 'editor' end,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  )
  on conflict (trip_id, user_id) do nothing;

  return v_trip_id;
end;
$$;

revoke all on function public.join_trip(text) from public, anon, authenticated;
grant execute on function public.join_trip(text) to authenticated;

-- Apply before the app update. Re-running preserves existing version values.
begin;

alter table public.trips add column if not exists write_version bigint not null default 0;

create sequence if not exists public.trip_write_version_seq as bigint minvalue 1 start with 1;
revoke all on sequence public.trip_write_version_seq from public, anon, authenticated, service_role;

-- Block writes while the sequence catches up with restored or existing revisions.
lock table public.trips in share row exclusive mode;
select pg_catalog.setval(
  'public.trip_write_version_seq'::regclass,
  greatest(
    (select last_value from public.trip_write_version_seq),
    coalesce((select max(write_version) from public.trips), 0),
    1
  ),
  true
);

create or replace function public.advance_trip_write_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.write_version := pg_catalog.nextval('public.trip_write_version_seq'::regclass);
  return new;
end;
$$;

revoke all on function public.advance_trip_write_version() from public, anon, authenticated, service_role;

drop trigger if exists trips_advance_write_version on public.trips;
create trigger trips_advance_write_version
  before insert or update on public.trips
  for each row execute function public.advance_trip_write_version();

commit;

-- #799: the owner_id guard is invoked by the table, so no client role needs
-- execute on it. Revoked from the API roles by name, because `revoke ... from
-- public` does not revoke from anon or authenticated on Supabase.
revoke all on function public.trips_owner_id_immutable() from public, anon, authenticated;

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

create or replace function public.collab_same_visit_place(p_suggestion jsonb, p_stop jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_suggestion_place jsonb := coalesce(p_suggestion->'place','{}'::jsonb);
  v_suggestion_name text := lower(regexp_replace(btrim(coalesce(p_suggestion->>'location_name',p_suggestion->>'title','')), '\s+', ' ', 'g'));
  v_stop_name text := lower(regexp_replace(btrim(coalesce(p_stop->>'locationName',p_stop->>'title','')), '\s+', ' ', 'g'));
  v_suggestion_source text := coalesce(v_suggestion_place->>'source','');
  v_stop_source text := coalesce(p_stop->>'placeSource','');
  v_suggestion_has_key boolean := coalesce(v_suggestion_place->>'placeId','')<>'' or coalesce(v_suggestion_place->>'eLoc','')<>'';
  v_stop_has_key boolean := coalesce(p_stop->>'placeId','')<>'' or coalesce(p_stop->>'eLoc','')<>'';
  v_same_key boolean := false;
  v_suggestion_lat double precision;
  v_suggestion_lng double precision;
  v_stop_lat double precision;
  v_stop_lng double precision;
  v_distance double precision;
begin
  v_same_key :=
    (coalesce(v_suggestion_place->>'placeId','')<>'' and v_suggestion_place->>'placeId'=p_stop->>'placeId'
      and (v_suggestion_source='' or v_stop_source='' or v_suggestion_source=v_stop_source))
    or (coalesce(v_suggestion_place->>'eLoc','')<>'' and v_suggestion_place->>'eLoc'=p_stop->>'eLoc'
      and (v_suggestion_source='' or v_stop_source='' or v_suggestion_source=v_stop_source));
  if v_same_key then return true; end if;
  if v_suggestion_has_key and v_stop_has_key then return false; end if;
  if v_suggestion_name='' or v_suggestion_name<>v_stop_name then return false; end if;
  begin
    v_suggestion_lat := nullif(p_suggestion->>'lat','')::double precision;
    v_suggestion_lng := nullif(p_suggestion->>'lng','')::double precision;
    v_stop_lat := nullif(p_stop->>'lat','')::double precision;
    v_stop_lng := nullif(p_stop->>'lng','')::double precision;
  exception
    when invalid_text_representation or numeric_value_out_of_range then return false;
    when others then return false;
  end;
  if v_suggestion_lat is null or v_suggestion_lng is null or v_stop_lat is null or v_stop_lng is null
    or (v_suggestion_lat=0 and v_suggestion_lng=0) or (v_stop_lat=0 and v_stop_lng=0) then return false; end if;
  v_distance := 6371 * 2 * asin(sqrt(
    sin(radians(v_stop_lat-v_suggestion_lat)/2)^2
    + cos(radians(v_suggestion_lat))*cos(radians(v_stop_lat))*sin(radians(v_stop_lng-v_suggestion_lng)/2)^2
  ));
  return v_distance<=0.5;
end;
$$;
revoke all on function public.collab_same_visit_place(jsonb,jsonb) from public, anon, authenticated;

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

-- Stage A cutover for #801/#802. Apply only after every active client uses RPCs.

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
  ) then raise exception 'use submit_collab_command for decision transitions and contributions' using errcode='42501'; end if;
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
    insert into public.suggestions(id,trip_id,day_index,day_id,place,proposed_by,title,category,location_name,lat,lng,description,visit_minutes,estimated_entry_fee_inr,estimated_transport_inr,votes,comments,status,created_at)
    values((v_row->>'id')::uuid,v_trip,(v_row->>'day_index')::integer,nullif(v_row->>'day_id',''),nullif(v_row->'place','null'::jsonb),(v_row->>'proposed_by')::uuid,v_row->>'title',v_row->>'category',v_row->>'location_name',nullif(v_row->>'lat','')::double precision,nullif(v_row->>'lng','')::double precision,v_row->>'description',(v_row->>'visit_minutes')::integer,(v_row->>'estimated_entry_fee_inr')::integer,(v_row->>'estimated_transport_inr')::integer,v_row->'votes',v_row->'comments',v_row->>'status',(v_row->>'created_at')::bigint)
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

-- ============================================================
-- #800 — the public/private profile boundary.
--
-- `public.profiles` holds the private account fields and is now self-plus-admin
-- only (see the profiles policies above). This section is the PUBLIC half: a
-- projection that carries nothing but the reviewed fields, a trigger that keeps
-- it in step in the same transaction as its profile row, and the one typed RPC
-- that reads it. A public read and a public Realtime event share one
-- allowlist, and neither can drift from the other.
--
-- The full contract, its reasoning and its re-run safety live in
-- supabase/migrations/20261025_profile_public_boundary.sql.
-- ============================================================
create table if not exists public.profile_cards (
  id                uuid primary key references public.profiles (id) on delete cascade,
  name              text not null default 'Traveller',
  avatar_url        text,
  is_creator        boolean not null default false,
  creator_bio       text,
  social_links      jsonb not null default '{}'::jsonb,
  -- The reviewed derived signal that separates retained crew identity from
  -- public creator availability. It is `not is_disabled`, so `is_disabled`
  -- itself never leaves the private table. It deliberately does NOT need
  -- `is_creator`: a plan published by an account that later dropped the creator
  -- badge must not vanish from Explore.
  creator_available boolean not null default true
);

-- Rebuilds `social_links` from ONLY the reviewed string keys. A return of the
-- stored JSONB object would publish whatever keys a future writer put in it.
create or replace function public.safe_social_links(p_links jsonb)
returns jsonb
language sql
immutable
security definer
set search_path = public
as $$
  select case
    when jsonb_typeof(p_links) <> 'object' then '{}'::jsonb
    else jsonb_strip_nulls(jsonb_build_object(
      'youtube', case when jsonb_typeof(p_links -> 'youtube') = 'string'
        then nullif(btrim(p_links ->> 'youtube'), '') end,
      'instagram', case when jsonb_typeof(p_links -> 'instagram') = 'string'
        then nullif(btrim(p_links ->> 'instagram'), '') end
    ))
  end
$$;

-- AFTER, so the card is written in the SAME transaction as the profile row that
-- produced it: a public read can never see a card older than its profile, and a
-- rolled-back profile edit rolls its card back with it.
create or replace function public.sync_profile_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.profile_cards where id = old.id;
    return old;
  end if;
  insert into public.profile_cards
    (id, name, avatar_url, is_creator, creator_bio, social_links, creator_available)
  values
    (new.id, new.name, new.avatar_url, new.is_creator, new.creator_bio,
     public.safe_social_links(new.social_links), not new.is_disabled)
  on conflict (id) do update set
    name = excluded.name,
    avatar_url = excluded.avatar_url,
    is_creator = excluded.is_creator,
    creator_bio = excluded.creator_bio,
    social_links = excluded.social_links,
    creator_available = excluded.creator_available;
  return new;
end;
$$;

drop trigger if exists profiles_sync_card on public.profiles;
create trigger profiles_sync_card
  after insert or update or delete on public.profiles
  for each row execute function public.sync_profile_card();

insert into public.profile_cards
  (id, name, avatar_url, is_creator, creator_bio, social_links, creator_available)
select
  p.id, p.name, p.avatar_url, p.is_creator, p.creator_bio,
  public.safe_social_links(p.social_links), not p.is_disabled
from public.profiles p
on conflict (id) do nothing;

-- The ONE public read path. Typed as `setof public.profile_cards`, so the return
-- shape IS the allowlist and a caller cannot ask for a column that is not in it.
-- Security definer so an anonymous caller reads a public card with no grant on
-- the private table; `auth.uid()` decides WHO may read, never WHAT is read.
--
-- The disabled check comes first, and it is not optional: a security-definer
-- function bypasses the table's RLS, so the RESTRICTIVE deny-disabled policy does
-- not protect this function. Without the guard a disabled account reads the whole
-- directory. It answers an empty set rather than raising.
--
-- A null argument means "every card" — the catalogue is public by design, because
-- clients hold SELECT on the projection for Realtime — and a named list narrows
-- it. Both shapes return the same columns.
create or replace function public.get_public_profile_cards(p_ids uuid[] default null)
returns setof public.profile_cards
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if coalesce(public.is_disabled(), false) then
    return;
  end if;
  if p_ids is null then
    return query
      select c.id, c.name, c.avatar_url, c.is_creator, c.creator_bio, c.social_links, c.creator_available
      from public.profile_cards c;
  end if;
  return query
    select c.id, c.name, c.avatar_url, c.is_creator, c.creator_bio, c.social_links, c.creator_available
    from public.profile_cards c
    where c.id = any(p_ids);
end;
$$;

revoke all on function public.get_public_profile_cards(uuid[]) from public;
grant execute on function public.get_public_profile_cards(uuid[]) to anon, authenticated;
revoke all on function public.safe_social_links(jsonb) from public, anon, authenticated;
revoke all on function public.sync_profile_card() from public, anon, authenticated;

-- The projection's own ACL. Two independent defects were found here.
--
-- (a) The table had RLS DISABLED, so a SELECT grant was an unfiltered read for
--     every grantee and the RESTRICTIVE deny-disabled policy did not reach it.
--     RLS goes on, with a permissive public read plus the RESTRICTIVE denial.
-- (b) The revoke named only INSERT, UPDATE and DELETE. A deployment may run
--     `alter default privileges ... grant all on tables to anon, authenticated`
--     — Supabase does — which grants TRUNCATE, REFERENCES and TRIGGER too, and an
--     authenticated caller could then truncate the whole public directory. So the
--     revoke is `all`, and SELECT is re-granted after it.
revoke all on public.profile_cards from public;
revoke all on public.profile_cards from anon, authenticated;
grant select on public.profile_cards to anon, authenticated;

alter table public.profile_cards enable row level security;

-- The public read: everyone, including `anon`. Without a permissive policy RLS
-- would answer zero rows to everyone, which is not the intent.
drop policy if exists "profile_cards read" on public.profile_cards;
create policy "profile_cards read" on public.profile_cards
  for select using (true);

-- The RESTRICTIVE denial, which is the one that takes access AWAY. Scoped to
-- `authenticated` on purpose: `anon` has no session and no disabled account, and
-- the anonymous public read must keep working.
drop policy if exists "deny disabled" on public.profile_cards;
create policy "deny disabled" on public.profile_cards
  as restrictive for all to authenticated using (not public.is_disabled());

-- The publication statement for this table lives here, after its definition.
-- Putting it with the other publications near the top of the file raised 42P01,
-- because it ran before the table existed.
alter publication supabase_realtime add table public.profile_cards;  -- public identity live-updates; the private table is NOT published (#800)

-- The anonymous role loses direct SELECT on the private table. `authenticated`
-- keeps it, because RLS now restricts its rows to self and admin.
revoke select on public.profiles from anon;

-- `admin_audit.detail` carries a deleted user's email, and its read policy
-- checked only `is_admin()`. A masteradmin whose account was later disabled
-- keeps a valid JWT until the app signs them out, so a direct request could read
-- the audit — and the deleted users' addresses — in that window. This is the
-- RESTRICTIVE denial the other eight tables already had; `admin_audit` was the
-- one missing it. The audit rows themselves are untouched.
drop policy if exists "deny disabled" on public.admin_audit;
create policy "deny disabled" on public.admin_audit
  as restrictive for all to authenticated using (not public.is_disabled());

commit;
