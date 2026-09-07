-- ============================================================
-- 20260907_shared_trip_reads.sql
-- Public itinerary pages and invite links need to read trips the viewer is
-- NOT a member of — the membership-scoped app hydration deliberately keeps
-- other people's trips out of its cache, and RLS ("trips read": owner or
-- visibility='public' or member) blocked every on-demand fetch. Two pieces:
--
-- 1. BACKFILL — a published itinerary IS a public page: make its trip public
--    so anonymous visitors and logged-in non-members can read the trip body.
--    (publishItinerary now sets visibility='public' on publish and back to
--    'private' on unpublish — this backfill covers everything published
--    before that code shipped.)
-- 2. INVITE PREVIEW — an invited trip is private by definition, and RLS has
--    no way to know "this request came from the invite link". The link is the
--    capability: a security-definer RPC returns the trip row to whoever holds
--    its UUID (unguessable, same trust as the link itself). Used only by the
--    invite gate's preview/join flow.
-- Run in the Supabase SQL editor (management plane). Idempotent.
-- ============================================================

update public.trips t
set visibility = 'public', updated_at = (extract(epoch from now()) * 1000)::bigint
where t.visibility <> 'public'
  and exists (select 1 from public.published_itineraries p where p.trip_id = t.id);

create or replace function public.get_invite_trip(p_trip_id uuid)
returns setof public.trips
language sql
security definer
set search_path = public
stable
as $$
  select t.* from public.trips t where t.id = p_trip_id;
$$;

grant execute on function public.get_invite_trip(uuid) to anon, authenticated;
