-- ============================================================
-- 20260909_invite_codes.sql
-- Invite links move from the raw trip UUID (#/invite/<uuid>, 36 random
-- chars) to a short, meaningful code: #/join/GOA-K7QF. Three pieces:
--
-- 1. COLUMN — trips.invite_code, uppercase text, unique when present.
--    Every trip gets a code (backfilled below), so a trip created before
--    this migration still has a short link the moment its owner opens the
--    Share tab.
-- 2. LOOKUP RPC — security-definer, same capability model as
--    get_invite_trip: the code is unguessable-ish AND revocable (rotate
--    the code), and RLS has no way to know "this request came from the
--    invite link". Returns the trip row to whoever holds the code.
-- 3. BACKFILL — deterministic head from the trip name + a random tail,
--    mirroring the app's generator (src/lib/inviteCode.ts). Codes are
--    minted only for trips that don't have one; collisions retry the tail.
--
-- Run in the Supabase SQL editor (management plane). Idempotent.
-- ============================================================

alter table public.trips add column if not exists invite_code text;

-- Unique only when set; the app treats NULL as "code not minted yet".
create unique index if not exists idx_trips_invite_code
  on public.trips (invite_code) where invite_code is not null;

-- Backfill: one code per existing trip. The head follows the app's slug
-- rules (letters/digits only, ≤10 chars), the tail is 4 chars from the
-- same unambiguous alphabet. On the (astronomically rare) unique clash the
-- insert errors and the DO block retries with a fresh tail.
do $$
declare
  t record;
  head text;
  code text;
  alphabet text := 'ABCDEFGHJKLMNPQRTUVWXY346789';
begin
  for t in select id, name, start_location from public.trips where invite_code is null loop
    -- Head mirrors the app's slug rules (src/lib/inviteCode.ts): letters and
    -- digits only — no inner separators, because the single dash in a code is
    -- reserved as the head/tail divider. "Goa Beach Week" -> GOABEACHWE.
    head := upper(coalesce(nullif(t.name, ''), nullif(t.start_location, '')));
    head := regexp_replace(head, '[^A-Z0-9]+', '', 'g');
    head := left(head, 10);
    if head = '' or head is null then head := 'YATRA'; end if;

    loop
      code := head || '-' || (
        select string_agg(substr(alphabet, floor(random() * length(alphabet))::int + 1, 1), '')
        from generate_series(1, 4)
      );
      begin
        update public.trips set invite_code = code where id = t.id and invite_code is null;
        exit; -- update succeeded (no unique clash)
      exception when unique_violation then
        null; -- tail clashed — loop and try a fresh one
      end;
    end loop;
  end loop;
end $$;

-- Lookup: the code is the capability, exactly like the UUID invite link.
-- SECURITY DEFINER bypasses the trips read policy (a private trip is the
-- whole point of an invite). Case-insensitive: users type codes casually.
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
