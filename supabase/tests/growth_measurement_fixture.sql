-- Minimal local dependencies. The runner also loads real policies and migrations.
-- This fixture is not a Supabase deployment or a substitute for the full RLS integration suite.
do $$ begin
  if current_database() <> 'yatraflow_growth_test' then raise exception 'local test database required'; end if;
end $$;
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create function public.is_disabled() returns boolean language sql stable as $$
  select coalesce(auth.uid() = '00000000-0000-0000-0000-000000000005'::uuid, false);
$$;
create function public.is_admin() returns boolean language sql stable as $$ select false; $$;
create table public.profiles (id uuid primary key);
insert into public.profiles select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid from generate_series(1, 5) i;
create table public.trips (
  id uuid primary key, owner_id uuid not null references public.profiles(id), name text not null,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  visibility text not null default 'private', invite_code text unique, deleted_at timestamptz
);
create table public.trip_members (
  trip_id uuid references public.trips(id), user_id uuid references public.profiles(id),
  role text not null default 'editor', joined_at bigint not null,
  primary key (trip_id, user_id)
);
create function public.is_member(trip uuid) returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = trip and user_id = auth.uid());
$$;
create function public.is_editor(trip uuid) returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = trip and user_id = auth.uid() and role in ('owner', 'editor'));
$$;
create table public.published_itineraries (
  id text primary key, trip_id uuid references public.trips(id), creator_id uuid references public.profiles(id),
  views bigint not null default 0, copies bigint not null default 0
);
create table public.pub_events (
  id bigint generated always as identity primary key,
  pub_id text references public.published_itineraries(id), kind text not null check (kind in ('view', 'fork')),
  at timestamptz not null default now()
);
create table public.suggestions (id uuid primary key, trip_id uuid references public.trips(id), proposed_by uuid, created_at bigint, title text);
create table public.decisions (id uuid primary key, trip_id uuid references public.trips(id), raised_by uuid, created_at bigint, question text);
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.pub_events enable row level security;
create policy fixture_trip_read on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.is_member(id));
grant usage on schema public, auth to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
create function public.test_assert(value boolean, label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %', label; end if; end;
$$;
