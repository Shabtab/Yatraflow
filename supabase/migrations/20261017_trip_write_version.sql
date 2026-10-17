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
