-- ============================================================
-- YatraFlow schema for Supabase (Postgres + Auth)
-- Free-tier friendly: JSONB keeps trip internals denormalized so the
-- TS data model (src/data/types.ts) maps 1:1 without a wide schema.
-- Row Level Security is the authorization boundary — review carefully.
-- Run in the Supabase SQL editor, or via `supabase db push`.
-- ============================================================

-- ---------- profiles ----------
-- One row per Supabase auth user, created by the trigger below.
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
  budget_per_person_inr     integer not null default 0,
  travel_style              text not null default 'balanced',
  fixed_commitments         jsonb not null default '[]'::jsonb,
  days                      jsonb not null default '[]'::jsonb,
  expenses                  jsonb not null default '[]'::jsonb,
  cover_emoji               text not null default '🧭',
  visibility                text not null default 'private'
                              check (visibility in ('private', 'public')),
  created_at                bigint not null default extract(epoch from now()) * 1000,
  updated_at                bigint not null default extract(epoch from now()) * 1000
);

-- Pre-existing installs: add the fuel-economy column without touching data
-- (idempotent — safe to re-run).
alter table public.trips add column if not exists fuel_economy_km_per_l numeric;

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
  status             text not null default 'open'
                       check (status in ('open', 'resolved')),
  resolved_option_id uuid,
  raised_by          uuid not null references public.profiles (id) on delete cascade,
  created_at         bigint not null default extract(epoch from now()) * 1000,
  resolved_at        bigint
);

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
  views                       integer not null default 0,
  copies                      integer not null default 0
);

-- ============================================================
-- Indexes (cheap, help the membership lookups in RLS)
-- ============================================================
create index if not exists idx_trip_members_user on public.trip_members (user_id);
create index if not exists idx_suggestions_trip on public.suggestions (trip_id);
create index if not exists idx_decisions_trip on public.decisions (trip_id);
create index if not exists idx_activity_trip on public.activity (trip_id);
create index if not exists idx_notifications_user on public.notifications (user_id);
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

-- ---------- profiles ----------
create policy "profiles read" on public.profiles
  for select using (true);  -- names/avatars are visible app-wide (social features)

create policy "profiles update self" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- trips ----------
create policy "trips read" on public.trips
  for select using (
    auth.uid() = owner_id
    or visibility = 'public'
    or public.is_member(trips.id)
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
