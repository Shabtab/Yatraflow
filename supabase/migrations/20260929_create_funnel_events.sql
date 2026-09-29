-- ============ The create funnel's dated event log (#428) ====================
-- The v0.65.0 create flow shipped with zero step instrumentation: we know a
-- trip got created (a row) but never where users stall. This adds ONE dated
-- log for the funnel + a read surface, mirroring the `pub_events` pattern
-- (20260921_pub_funnel_events.sql) so the codebase keeps one analytics shape.
--
-- PII RULE (load-bearing): `meta` carries counts, slugs, enums and booleans
-- ONLY. Crew names and phone numbers, trip names, destination strings and
-- budget figures must never enter this log. The CHECK constrains the EVENT
-- vocabulary; the shape of `meta` is enforced in code
-- (src/lib/createEvents.ts `sanitizeCreateMeta`) and teeth-tested — there is
-- deliberately NO free-text column anywhere in this table.
--
-- ABUSE BOUND FOR THE ANON INSERT (the review flashpoint — read this first):
-- the funnel starts pre-signup, so anonymous rows are the point. The surface
-- a hostile client gets is trivially small:
--   * the event column accepts ONLY the nine-word closed vocabulary below;
--   * `meta` accepts any jsonb from the wire BUT the read derivations ignore
--     shapes they do not expect, and the client sanitizer is the only writer
--     in the app — there is no code path that renders raw anon meta;
--   * one session_id can be reused, but rows are retention-pruned at 90 days
--     and the table holds no PII to exfiltrate (anon SELECT is denied);
--   * anon rows carry user_id = null by constraint, so the backfill on
--     sign-in is the only escalation a row ever gets.
-- Rate-limit-by-session is deliberately NOT in this migration: the value is
-- directional product analytics, the cost of a flooded row is one jsonb, and
-- Supabase has no per-session throttle without a request path we do not have.
-- Revisit only if the table ever grows faster than traffic explains.
--
-- COUNTERS DECISION (explicit, per the issue): NO lifetime counter columns on
-- trips for these. The #363 lessons (unlike-units, optimistic drift) apply —
-- the dated log is the only source; aggregates derive at read. Log-only.

create table if not exists public.create_funnel_events (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  -- App-generated per browser session (sessionStorage) — never the Supabase
  -- user id pre-auth, never stable across browsers/devices.
  session_id text not null,
  -- Null until auth; backfilled on signup/login by a single keyed UPDATE.
  user_id    uuid references public.profiles (id) on delete set null,
  event      text not null,
  phase      text,
  trip_id    uuid references public.trips (id) on delete set null,
  meta       jsonb,
  constraint create_funnel_events_event_check check (event in (
    'started',
    'template_picked',
    'readiness_complete',
    'draft_resumed',
    'draft_discarded',
    'crew_added',
    'submitted',
    'moment_invite_sent',
    'abandoned'
  ))
);

create index if not exists create_funnel_events_at_idx on public.create_funnel_events (at desc);
create index if not exists create_funnel_events_event_at_idx on public.create_funnel_events (event, at);
create index if not exists create_funnel_events_session_idx on public.create_funnel_events (session_id);

alter table public.create_funnel_events enable row level security;

-- The deny-disabled restrictive policy, same as every user-reachable table.
create policy "deny disabled" on public.create_funnel_events as restrictive for all to authenticated
  using (not public.is_disabled());

-- Authenticated: insert your own rows (and correct nothing else).
create policy "create_funnel_events insert own" on public.create_funnel_events
  for insert to authenticated
  with check (user_id = auth.uid());

-- Anonymous: insert with NO user attachment — this is the pre-signup half of
-- the funnel. See the abuse-bound note in the header.
create policy "create_funnel_events insert anon" on public.create_funnel_events
  for insert to anon
  with check (user_id is null);

-- Reads are admin-only through the ONE admin read policy (the read surface is
-- the admin Analytics tab). No user-facing read: rows carry session ids, and
-- no feature needs a user's own funnel history.
create policy "create_funnel_events admin read" on public.create_funnel_events
  for select to authenticated
  using (public.is_admin());

-- No UPDATE/DELETE policies for anon/authenticated beyond the restrictive
-- deny: rows are append-only to everyone except the retention pruner below.

-- ---------- retention (90 days — funnels age fast) ----------
-- service_role by default: the #356 lesson — a definer function granted to
-- authenticated at large made every signup able to erase funnel history. The
-- default grant for a caller-independent delete is service_role; the operator
-- invokes it from a credentialed session, same as `prune_pub_events`.
create or replace function public.prune_create_funnel_events(p_keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from public.create_funnel_events
  where at < now() - make_interval(days => least(greatest(p_keep_days, 1), 365));
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.prune_create_funnel_events(integer) from public, anon, authenticated;
