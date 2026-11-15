-- G1 draft. Apply by hand after review. This file has not run on the hosted database.
begin;

drop function if exists public.get_creator_share_sources();
drop function if exists public.get_creator_share_sources(integer);
create or replace function public.get_creator_share_sources(p_days integer default 30)
returns table (source text, views bigint, forks bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if public.is_disabled() then
    return;
  end if;
  return query
  select e.source,
    count(*) filter (where e.kind = 'view') as views,
    count(*) filter (where e.kind = 'fork') as forks
  from public.pub_events e
  join public.published_itineraries p on p.id = e.pub_id
  where p.creator_id = auth.uid()
    and e.at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 730)))
  group by e.source
  order by 2 desc, e.source nulls first;
end;
$$;

revoke all on function public.get_creator_share_sources(integer) from public, anon;
grant execute on function public.get_creator_share_sources(integer) to authenticated;
commit;
