-- G3b. Route states: the Indian states and union territories a published route
-- covers, by ISO 3166-2:IN code (see src/data/indiaStates.ts).
-- DRAFT. Not applied. The user runs this file by hand on the hosted database (AGENTS.md §2.15).
-- No backfill: rows published before this migration keep state_codes null. They show
-- no states until the creator publishes again.
-- Public read: the "published read" policy already lets anon and authenticated select
-- every column of a live row, so state_codes needs no grant and no view change.
-- The publications_stamp_reviewed_at trigger changes reviewed_at only, so it leaves this column alone.
begin;

alter table public.published_itineraries add column if not exists state_codes text[];

comment on column public.published_itineraries.state_codes is
  'ISO 3166-2:IN codes of the states and union territories this route covers. Null before G3b, or when a publish had no codes.';

-- Each element must be one of the 36 codes. Null elements, duplicates and nested arrays fail.
-- At most 36 items. A null array is allowed. service_role gets EXECUTE too, so server writes pass the check.
-- The constraint goes first, because it depends on the function. A re-run then drops cleanly.
alter table public.published_itineraries drop constraint if exists published_state_codes_check;
drop function if exists public.valid_route_state_codes(text[]);
create or replace function public.valid_route_state_codes(p_codes text[])
returns boolean language sql immutable set search_path = public
as $$
  select p_codes is null or (
    cardinality(p_codes) <= 36
    and coalesce(array_ndims(p_codes), 1) = 1
    and cardinality(p_codes) = (select count(distinct c) from unnest(p_codes) c)
    and coalesce((
      select bool_and(c is not null and c = any (array[
        'AN','AP','AR','AS','BR','CH','CT','DH','DL','GA','GJ','HP','HR','JH','JK','KA','KL','LA',
        'LD','MH','ML','MN','MP','MZ','NL','OR','PB','PY','RJ','SK','TG','TN','TR','UP','UT','WB'
      ]::text[]))
      from unnest(p_codes) c
    ), true)
  )
$$;
revoke all on function public.valid_route_state_codes(text[]) from public, anon;
grant execute on function public.valid_route_state_codes(text[]) to authenticated, service_role;

alter table public.published_itineraries add constraint published_state_codes_check
  check (public.valid_route_state_codes(state_codes) is true);

commit;
