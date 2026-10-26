-- ============================================================================
-- #800 — the public/private profile read boundary.
--
-- The defect: `profiles read` was `for select using (true)` with no role
-- restriction, so it defaulted to the `public` role — which on Supabase includes
-- `anon`. RLS limits rows, never columns, so the policy plus the client's
-- `select('*')` published every column of every row to everyone, including
-- `email`, `travel_styles`, `is_disabled` and `created_at`.
--
-- The repair, in one rerunnable transaction:
--   1. a safe projection table (`public.profile_cards`) holding ONLY the
--      reviewed public fields, maintained transactionally by a trigger on
--      `public.profiles`, so a public read and a public event share one
--      allowlist and neither can drift;
--   2. a typed security-definer RPC that reads the projection — the one public
--      read path, with a fixed search path, an explicit disabled-caller check
--      and explicit role grants;
--   3. `public.profiles` becomes private: self SELECT plus the existing admin
--      paths, with the anonymous grant revoked;
--   4. the projection carries RLS with the same RESTRICTIVE deny-disabled policy
--      the private tables carry, and an `all` revoke so a default-privileges
--      deployment cannot hand a client TRUNCATE;
--   5. Realtime moves from `profiles` to `profile_cards`, so a live profile
--      event carries the safe columns and never a private one;
--   6. `admin_audit` gains the RESTRICTIVE disabled-account denial it was
--      missing, closing a disabled admin's read of deleted-user emails.
--
-- Re-run safety: every statement is idempotent (`create table if not exists`,
-- `drop ... if exists`, `create or replace`, `on conflict do update`). Re-running
-- re-derives the projection from `public.profiles`, so a row that drifted is
-- corrected rather than duplicated. The backfill is a no-op on a second run.
-- ============================================================================
begin;

-- ---------------------------------------------------------------- 1. the signal
-- A definer helper that rebuilds `social_links` from ONLY the reviewed string
-- keys. A direct return of the stored JSONB object would publish whatever keys a
-- future writer put in it, so the allowlist is enforced here, at the boundary,
-- rather than trusted from the column.
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

-- ------------------------------------------------------- 2. the safe projection
-- One row per profile, for EVERY account — a disabled account keeps its name and
-- avatar so past crews still render, which is the confirmed product decision.
-- `creator_available` is the reviewed derived signal that separates retained crew
-- identity from public creator availability: it is `not is_disabled`, and it is
-- what the public surfaces filter on, so `is_disabled` itself never leaves the
-- private table. It deliberately does NOT need `is_creator`, because a plan
-- published by an account that later dropped the creator badge must not vanish
-- from Explore.
create table if not exists public.profile_cards (
  id                uuid primary key references public.profiles (id) on delete cascade,
  name              text not null default 'Traveller',
  avatar_url        text,
  is_creator        boolean not null default false,
  creator_bio       text,
  social_links      jsonb not null default '{}'::jsonb,
  creator_available boolean not null default true
);

-- ------------------------------------------------- 3. keep it in step, always
-- An AFTER trigger, so the projection is written in the SAME transaction as the
-- profile row that produced it: a public read can never observe a card that is
-- older than its profile, and a rolled-back profile edit rolls its card back too.
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

-- Backfill: every existing profile gets its card. `on conflict do nothing` keeps
-- a re-run from touching rows the trigger already maintains.
insert into public.profile_cards
  (id, name, avatar_url, is_creator, creator_bio, social_links, creator_available)
select
  p.id, p.name, p.avatar_url, p.is_creator, p.creator_bio,
  public.safe_social_links(p.social_links), not p.is_disabled
from public.profiles p
on conflict (id) do nothing;

-- --------------------------------------------------------- 4. the public read
-- The ONE public read path. Typed as `setof public.profile_cards`, so the return
-- shape IS the allowlist and a caller cannot ask for a column that is not in it.
-- Security definer so an anonymous caller can read a public card without any
-- grant on the private table; `auth.uid()` is not consulted for WHO is read, only
-- for WHETHER this caller may read at all.
--
-- A null argument means "every card", which is what the app's public hydration
-- needs — the catalogue is public by design, because clients hold SELECT on the
-- projection for Realtime. A named list narrows it. Both shapes return the same
-- columns, so no read path returns more than another.
--
-- The disabled check comes FIRST, and it is not optional. A security-definer
-- function bypasses the table's RLS, so the RESTRICTIVE deny-disabled policy that
-- protects `profiles` does NOT protect this function: without this guard a
-- disabled account calls the RPC and reads the whole directory. It answers an
-- empty set rather than raising, because a disabled caller is not an error — it
-- is a caller who must see nothing.
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

-- ------------------------------------------------- 5. the private table closes
-- Replace the permissive read. A second permissive policy cannot override
-- `using (true)` — permissive policies combine with OR — so the old one is dropped
-- and replaced, not supplemented. The replacement is guarded the same way, so a
-- re-run does not fail on a policy that is already there.
drop policy if exists "profiles read" on public.profiles;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles read self'
  ) then
    create policy "profiles read self" on public.profiles
      for select to authenticated using (auth.uid() = id);
  end if;
end;
$$;

-- Defence in depth, and it makes the intent readable in `\dp`: the anonymous
-- role loses direct SELECT on the private table entirely. `authenticated` keeps
-- it, because RLS now restricts its rows to self and admin.
revoke select on public.profiles from anon;

-- ------------------------------------------------- 5b. the projection's own ACL
-- Two things were wrong here, and both were found by an independent probe.
--
-- (a) The table had RLS DISABLED. A table with RLS off and a SELECT grant is
--     readable by every grantee with no row filtering at all, so the RESTRICTIVE
--     deny-disabled policy that protects `profiles` did not protect this table:
--     a disabled authenticated caller read the whole directory straight from it.
--     RLS goes on, with a permissive public read plus the same RESTRICTIVE
--     deny-disabled policy the other tables carry.
--
-- (b) The revoke named only INSERT, UPDATE and DELETE. A deployment may run
--     `alter default privileges ... grant all on tables to anon, authenticated`
--     — Supabase does — which grants TRUNCATE, REFERENCES and TRIGGER too. An
--     authenticated caller could then TRUNCATE the public directory and erase
--     every identity. So the revoke is `all`, and SELECT is re-granted after it.
revoke all on public.profile_cards from public;
revoke all on public.profile_cards from anon, authenticated;
grant select on public.profile_cards to anon, authenticated;

alter table public.profile_cards enable row level security;

-- The public read: everyone, including `anon`. Without a permissive policy RLS
-- would answer zero rows to everyone, which is not the intent.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profile_cards' and policyname = 'profile_cards read'
  ) then
    create policy "profile_cards read" on public.profile_cards
      for select using (true);
  end if;
end;
$$;

-- The RESTRICTIVE denial, which is the one that takes access AWAY. It is scoped
-- to `authenticated` on purpose: `anon` has no session and no disabled account,
-- and the anonymous public read must keep working.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profile_cards' and policyname = 'deny disabled'
  ) then
    create policy "deny disabled" on public.profile_cards
      as restrictive for all to authenticated using (not public.is_disabled());
  end if;
end;
$$;

-- --------------------------------------------------------- 6. Realtime moves
-- The whole `profiles` row sent every column, including email, to
-- every subscriber. The projection replaces it, so a live event carries the safe
-- columns and nothing else. Realtime DDL can fail on a read-only role, so this is
-- guarded the way the rest of the schema guards optional DDL.
do $$
begin
  begin
    alter publication supabase_realtime drop table public.profiles;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.profile_cards;
  exception when duplicate_object then null;
             when others then raise;
  end;
end;
$$;

-- ------------------------------------------- 7. admin audit: the disabled bypass
-- `admin_audit.detail` carries a deleted user's email, and its read policy
-- checked only `is_admin()`. A masteradmin whose account was later disabled keeps
-- a valid JWT until the app signs them out, so a direct request could read the
-- audit — and the deleted users' addresses — in that window. The RESTRICTIVE
-- denial is what the other eight tables already have; `admin_audit` was the one
-- missing it. The audit rows themselves are untouched.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'admin_audit' and policyname = 'deny disabled'
  ) then
    create policy "deny disabled" on public.admin_audit
      as restrictive for all to authenticated using (not public.is_disabled());
  end if;
end;
$$;

commit;
