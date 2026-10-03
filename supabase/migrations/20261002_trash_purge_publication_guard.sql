-- ============================================================
-- 20261002_trash_purge_publication_guard.sql
-- #566: trash is a WITHDRAW; only the purge is destructive — and the purge
-- must refuse a trip whose money hangs off a publication row.
--
-- Three redefinitions, one vocabulary pass over the same `unpublished_at`
-- marker family the rest of this wave speaks (see 20260925 and the claim
-- guard in 20261002_claim_paid_order_marker_guard.sql):
--
--   1. get_public_trip — a TRASHED trip keeps serving the creator and every
--      entitled buyer. The trip fetch's `deleted_at is null` filter is what
--      darkened buyers' links the moment the creator hit Trash: the tombstone
--      is about the trip's place in the owner's lists, not about what buyers
--      paid for. The filter is dropped and a trash gate is added in its place
--      — creator and entitled buyers pass, everyone else gets the empty set.
--      This keys on the trip's tombstone rather than the publication marker
--      so it also covers rows trashed before the client began stamping
--      `unpublished_at` on the publication.
--
--   2. purge_trashed_trip ("Delete forever") — refuses when the trip ever
--      carried a publication. `published_itineraries.trip_id` cascades from
--      the trip, and `entitlements`, `purchase_orders` and `pub_events` all
--      cascade from `pub_id` — so this DELETE would confiscate what buyers
--      paid for and erase the creator's own sales ledger and funnel history.
--      The publication row survives; the refusal names its counts, like
--      admin_delete_user's published-itinerary protection.
--
--   3. purge_trashed_trips() (the 30-day sweep) — SKIPS an expired trip that
--      ever carried a publication instead of purging it. The returned count
--      is trips actually removed. No audit row per skip: a nightly janitor
--      row per expired trip would bury the deliberate human action the log
--      exists to record (20260929's reasoning, kept).
--
-- Carried forward VERBATIM into the new get_public_trip body, and NOT to be
-- dropped in any future redefinition: the soft-unpublish gate (#350), the
-- explicit 31-column list with `invite_code` withheld (#351), the money strip
-- for unentitled viewers of priced publications (#352), and the free-day
-- jsonb_typeof guard (#353). Plus the new trash gate (#566).
--
-- Safe to re-run (`create or replace`). To apply: run this whole file in the
-- Supabase SQL editor, then `npm run check:migrations` (all three functions
-- are redefined — presence answers nothing, so this file is declared
-- no-probe-surface; the bodies are pinned by tests/public-trip-fail-closed,
-- tests/trips-trash-honest-failure and tests/purge-publication-guard).
-- ============================================================

create or replace function public.get_public_trip(p_pub_id text)
returns setof public.trips
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_pub public.published_itineraries;
  v_trip public.trips;
  v_free int[];
  v_days jsonb;
  v_day jsonb;
  v_stops jsonb;
  v_stop jsonb;
  v_day_idx int;
  i int;
  j int;
begin
  select * into v_pub from public.published_itineraries
    where id = p_pub_id limit 1;
  if not found then
    return;  -- empty set: unknown publication
  end if;

  -- Soft-unpublish (#350): the row survives so buyers keep their entitlement, but
  -- a viewer with no claim on it must not reach the trip at all — not the real
  -- days, and not even a stubbed preview. Creator and entitled buyers fall
  -- through and are served exactly as when the publication was live.
  if v_pub.unpublished_at is not null then
    if not (
      auth.uid() is not null and (
        v_pub.creator_id = auth.uid()
        or exists (
          select 1 from public.entitlements e
          where e.pub_id = v_pub.id and e.user_id = auth.uid()
        )
      )
    ) then
      return;  -- no longer published: empty set for everyone else
    end if;
  end if;

  -- #351 — the trip row, one column at a time. `invite_code` is deliberately
  -- NOT read: it is a capability for get_trip_by_invite_code, and this function
  -- is readable by anyone on the internet. Keep this list in step with the
  -- table when a column is added (the public page reads these through
  -- rowToTrip); a column that is missed here is withheld, which is the failure
  -- direction to prefer.
  select
    t.id, t.owner_id, t.name, t.start_location, t.destinations,
    t.start_date, t.end_date, t.travellers, t.transport_mode,
    t.budget_per_person_inr, t.travel_style, t.fixed_commitments, t.days,
    t.expenses, t.cover_emoji, t.visibility, t.created_at, t.updated_at,
    t.start_location_coords, t.destination_coords, t.fuel_economy_km_per_l,
    t.fuel_price_per_l, t.round_trip,
    null::text as invite_code,
    t.deleted_at, t.driver_count, t.has_vulnerable, t.drive_after_dinner_min,
    t.vehicle_profile, t.cover_image_url, t.stay_style
  into v_trip
  from public.trips t
  where t.id = v_pub.trip_id
    and t.visibility = 'public'
  limit 1;
  if not found then
    return;  -- missing or non-public trip: empty set, like the old RLS miss
  end if;

  -- #566 — trash is a withdraw, not a revoke. The fetch above no longer
  -- filters on `deleted_at`: a tombstoned trip keeps serving the creator and
  -- every entitled buyer, because the buyers paid for what it holds and this
  -- function is what their link resolves to. A viewer with no claim on it is
  -- turned away here instead. Keyed on the trip's tombstone rather than the
  -- publication's `unpublished_at` so it also covers rows trashed before the
  -- client began stamping the marker (belt and braces).
  if v_trip.deleted_at is not null and not (
    auth.uid() is not null and (
      v_pub.creator_id = auth.uid()
      or exists (
        select 1 from public.entitlements e
        where e.pub_id = v_pub.id and e.user_id = auth.uid()
      )
    )
  ) then
    return;  -- trashed trip: creator and entitled buyers only
  end if;

  -- #353 — the free-day list is adversarial input like every other field in
  -- this body. Only a real JSON array is iterated, and only its numeric
  -- elements are read: anything else (null, a scalar, an object, a non-numeric
  -- element) leaves `v_free` as it stands, so the affected days are LOCKED.
  -- Never throws, never widens.
  v_free := '{}';
  if jsonb_typeof(v_pub.free_day_indexes) = 'array' then
    select coalesce(array_agg(value::int), '{}') into v_free
      from jsonb_array_elements_text(v_pub.free_day_indexes) as value
      where value ~ '^[0-9]+$';
  end if;

  -- Creator and entitled buyers read the REAL trip — decided here, from
  -- auth.uid(), never from a client flag. (auth.uid() is null for anon.)
  if auth.uid() is not null and (
    v_pub.creator_id = auth.uid()
    or exists (
      select 1 from public.entitlements e
      where e.pub_id = v_pub.id and e.user_id = auth.uid()
    )
  ) then
    return next v_trip;
    return;
  end if;

  if v_pub.premium_price_inr is null then
    return next v_trip;  -- unpriced: the whole trip is the preview
    return;
  end if;
  -- A priced publication with an EMPTY free-day list stubs every day in the
  -- loop below — a fully locked preview is valid (the page still renders the
  -- publication's own metadata), not an empty response.

  -- #352 — priced, and this viewer is not entitled: the money is withheld too.
  -- This runs BEFORE the days handling so the corrupt-days branch below cannot
  -- return early with the money still attached.
  v_trip.expenses := '[]'::jsonb;
  v_trip.fixed_commitments := '[]'::jsonb;

  -- Stub locked days in place. Field names here are the Trip JSONB's keys
  -- (camelCase — the client stores days as parsed TypeScript objects).
  v_days := to_jsonb(v_trip.days);
  -- Fail closed on a corrupt days column: it must not 500 the RPC (breaking
  -- the whole public page) and must not skip stubbing (leaking the row).
  if v_days is null or jsonb_typeof(v_days) <> 'array' then
    v_trip.days := '[]'::jsonb;
    return next v_trip;
    return;
  end if;
  i := 0;
  while i < jsonb_array_length(v_days) loop
    v_day := v_days -> i;
    v_day_idx := case jsonb_typeof(v_day -> 'index')
                   when 'number' then (v_day ->> 'index')::int
                   else null end;
    -- Fail closed: a day whose index is missing/corrupt is treated as
    -- LOCKED — a poisoned row must never widen what the wire exposes.
    if v_day_idx is null or not (v_day_idx = any (v_free)) then
      v_stops := v_day -> 'stops';
      if v_stops is null or jsonb_typeof(v_stops) <> 'array' then
        -- Absent or corrupt stops: drop whatever is there rather than
        -- iterate blindly (the loop below must never 500 on a poisoned row).
        v_day := jsonb_set(v_day, '{stops}', '[]'::jsonb);
      else
      j := 0;
      while j < jsonb_array_length(v_stops) loop
        v_stop := v_stops -> j;
        v_stop := jsonb_set(v_stop, '{description}',
          to_jsonb('Locked — the full plan is on the original itinerary.'::text));
        v_stop := jsonb_set(v_stop, '{notes}', '""'::jsonb);
        v_stop := v_stop #- '{openTime}' #- '{closeTime}' #- '{departTime}' #- '{arrivalTime}' #- '{sourceUrl}' #- '{placeId}';
        v_stop := jsonb_set(v_stop, '{entryFeeInrPerPerson}', '0'::jsonb);
        v_stop := jsonb_set(v_stop, '{transportCostInrTotal}', '0'::jsonb);
        v_stops := jsonb_set(v_stops, array[j::text], v_stop);
        j := j + 1;
      end loop;
      v_day := jsonb_set(v_day, '{stops}', v_stops);
      end if;
      -- The day title and stop titles stay — the locked overlay's teaser
      -- renders up to three of them blurred. Notes/contacts/costs do not.
      v_days := jsonb_set(v_days, array[i::text], v_day);
    end if;
    i := i + 1;
  end loop;

  v_trip.days := v_days;
  return next v_trip;
end;
$$;

-- Unchanged from 20260928: the public page reads this as anon, and a signed-in
-- non-buyer reads it as authenticated. Note that `revoke ... from public` does
-- not revoke from either role, which is why they are named.
revoke all on function public.get_public_trip(text) from public;
grant execute on function public.get_public_trip(text) to anon, authenticated;

create or replace function public.purge_trashed_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.trips%rowtype;
  v_members integer;
  v_suggestions integer;
  v_decisions integer;
  v_activity integer;
  v_pubs integer;
  v_entitlements integer;
  v_orders integer;
begin
  -- Owner-only + tombstoned-only, exactly as the previous bodies: a caller can
  -- never touch another account's trip, and a live trip can never be purged.
  -- A miss is a no-op with no audit row — nothing was destroyed, so there is
  -- nothing to record.
  select * into v_row from public.trips
    where id = p_trip_id and owner_id = auth.uid() and deleted_at is not null;
  if not found then
    return;
  end if;
  -- PUBLICATION-ROW GUARD (#566) — counted BEFORE anything else, and the
  -- refusal is total: a trip that ever carried a publication is never purged,
  -- marker or no marker. The publication row is what keeps buyers whole (the
  -- entitlement), what keeps the creator's sales ledger and funnel history,
  -- and all three money/funnel tables cascade from it — so the DELETE below
  -- would be a confiscation and an erasure, not a cleanup. The trip itself is
  -- safe in the trash: get_public_trip keeps serving its creator and buyers.
  select count(*) into v_pubs from public.published_itineraries
    where trip_id = p_trip_id;
  select count(*) into v_entitlements from public.entitlements e
    where e.pub_id in (select id from public.published_itineraries
                       where trip_id = p_trip_id);
  select count(*) into v_orders from public.purchase_orders o
    where o.pub_id in (select id from public.published_itineraries
                       where trip_id = p_trip_id);
  if v_pubs > 0 or v_entitlements > 0 or v_orders > 0 then
    -- No audit row for the refusal itself: `raise exception` rolls the whole
    -- transaction back and would take any insert with it. Nothing was
    -- destroyed and nothing changed, so the caller surfacing this message is
    -- the entire record.
    raise exception 'trip has % publication row(s) carrying % entitlement(s) and % order(s) — the publication keeps buyers whole and is never purged',
      v_pubs, v_entitlements, v_orders;
  end if;
  -- Child counts BEFORE the cascade takes them (the audit row outlives the rows
  -- it counts, which is the point: the log says what the purge destroyed).
  -- The publication/money counts are recorded as zeroes on purpose — the guard
  -- above refuses anything else, and the row should say so out loud.
  select count(*) into v_members from public.trip_members where trip_id = p_trip_id;
  select count(*) into v_suggestions from public.suggestions where trip_id = p_trip_id;
  select count(*) into v_decisions from public.decisions where trip_id = p_trip_id;
  select count(*) into v_activity from public.activity where trip_id = p_trip_id;
  -- Audit BEFORE the effect (the admin-RPC contract): a successful delete is
  -- never unlogged.
  insert into public.admin_audit (actor_id, action, target_type, target_id, detail)
    values (auth.uid(), 'trip.purge', 'trip', p_trip_id::text,
      jsonb_build_object(
        'name', v_row.name,
        'deleted_at', v_row.deleted_at,
        'destinations', v_row.destinations,
        'start_date', v_row.start_date, 'end_date', v_row.end_date,
        'members', v_members,
        'suggestions', v_suggestions,
        'decisions', v_decisions,
        'activity', v_activity,
        'publications', v_pubs,
        'entitlements', v_entitlements,
        'purchase_orders', v_orders));
  delete from public.trips
    where id = p_trip_id and owner_id = auth.uid() and deleted_at is not null;
end;
$$;

-- Grants unchanged from 20260910_trip_trash_rpc.sql: reachable by the owner,
-- by nobody else, and never by anon.
revoke all on function public.purge_trashed_trip(uuid) from public, anon;
grant execute on function public.purge_trashed_trip(uuid) to authenticated;

create or replace function public.purge_trashed_trips()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  -- PUBLICATION-ROW GUARD (#566), sweep side: an expired trip that ever
  -- carried a publication is SKIPPED, not purged — same blast radius as the
  -- user-triggered purge above, and a janitor must never confiscate. Skipped
  -- trips stay in the trash indefinitely; the count returned is trips
  -- actually removed. Deliberately no audit row per skip: a nightly janitor
  -- row per expired trip would bury the deliberate human action the log
  -- exists to record (20260929's reasoning, kept).
  with deleted as (
    delete from public.trips t
    where t.deleted_at is not null and t.deleted_at < now() - interval '30 days'
      and not exists (
        select 1 from public.published_itineraries p where p.trip_id = t.id
      )
    returning t.id
  )
  select count(*) into removed from deleted;
  return removed;
end;
$$;

-- The sweep should never be callable by the anon/authenticated roles — it
-- bypasses RLS. service_role (and any pg_cron owner) can run it.
revoke all on function public.purge_trashed_trips() from public, anon, authenticated;
grant execute on function public.purge_trashed_trips() to service_role;
