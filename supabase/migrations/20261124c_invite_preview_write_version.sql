-- #1019: a valid invite link showed "This invite didn't load" to people who
-- were not on the trip yet. The client refuses a preview with no valid
-- write_version, and get_trip_by_invite_code did not return that column.
-- This migration adds write_version to the returned row and changes nothing
-- else: the same signature, language, security definer, search path, owner
-- and grants. Safe to run twice.
begin;

create or replace function public.get_trip_by_invite_code(p_code text)
returns setof public.trips
language sql
security definer
set search_path = public
stable
as $$
  select projected.*
  from public.trips t
  cross join lateral jsonb_populate_record(
    null::public.trips,
    jsonb_build_object(
      'id', t.id,
      'owner_id', t.owner_id,
      'name', t.name,
      'start_location', t.start_location,
      'destinations', t.destinations,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'travellers', t.travellers,
      'transport_mode', t.transport_mode,
      'budget_per_person_inr', t.budget_per_person_inr,
      'travel_style', t.travel_style,
      'fixed_commitments', t.fixed_commitments,
      'days', t.days,
      'expenses', t.expenses,
      'cover_emoji', t.cover_emoji,
      'visibility', t.visibility,
      'created_at', t.created_at,
      'updated_at', t.updated_at,
      'start_location_coords', t.start_location_coords,
      'destination_coords', t.destination_coords,
      'fuel_economy_km_per_l', t.fuel_economy_km_per_l,
      'fuel_price_per_l', t.fuel_price_per_l,
      'round_trip', t.round_trip,
      'invite_code', t.invite_code,
      'deleted_at', t.deleted_at,
      'driver_count', t.driver_count,
      'has_vulnerable', t.has_vulnerable,
      'drive_after_dinner_min', t.drive_after_dinner_min,
      'vehicle_profile', t.vehicle_profile,
      'cover_image_url', t.cover_image_url,
      'stay_style', t.stay_style,
      'drives_part', t.drives_part,
      'write_version', t.write_version
    )
  ) as projected
  where upper(t.invite_code) = upper(trim(p_code))
    and t.deleted_at is null
    and (
      t.owner_id = auth.uid()
      or public.is_member(t.id)
      or public.is_admin()

      or t.visibility = 'private'

      or not exists (
        select 1 from public.published_itineraries p
        where p.trip_id = t.id and coalesce(p.premium_price_inr, 0) > 0
      )

      or exists (
        select 1 from public.published_itineraries p
        where p.trip_id = t.id
          and (
            p.creator_id = auth.uid()
            or exists (
              select 1 from public.entitlements e
              where e.pub_id = p.id and e.user_id = auth.uid()
            )
          )
      )
    );
$$;

revoke all on function public.get_trip_by_invite_code(text) from public;
grant execute on function public.get_trip_by_invite_code(text) to anon, authenticated;

commit;
