begin;

create or replace function public.guard_trip_settings()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.visibility is not distinct from old.visibility
    and new.deleted_at is not distinct from old.deleted_at then
    return new;
  end if;
  if current_user='service_role' then
    return new;
  end if;
  if auth.uid() is not null and public.is_disabled() then
    raise exception 'This account cannot change trip settings.' using errcode='42501';
  end if;
  if current_user='postgres' then
    return new;
  end if;
  if auth.uid() is not null and not public.is_disabled()
    and (old.owner_id=auth.uid() or public.is_admin()) then
    return new;
  end if;
  raise exception 'Only the trip owner can change these settings.' using errcode='42501';
end;
$$;
revoke all on function public.guard_trip_settings() from public,anon,authenticated,service_role;
drop trigger if exists trips_settings_boundary on public.trips;
create trigger trips_settings_boundary before update of visibility,deleted_at on public.trips
  for each row execute function public.guard_trip_settings();

drop policy if exists "suggestions read" on public.suggestions;
create policy "suggestions read" on public.suggestions
  for select to authenticated using(public.is_member(trip_id) or public.is_admin());
drop policy if exists "decisions read" on public.decisions;
create policy "decisions read" on public.decisions
  for select to authenticated using(public.is_member(trip_id) or public.is_admin());
drop policy if exists "activity read" on public.activity;
create policy "activity read" on public.activity
  for select to authenticated using(public.is_member(trip_id) or public.is_admin());

commit;
