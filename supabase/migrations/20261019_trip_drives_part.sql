-- NULL preserves existing Mixed planning until the traveller answers.
-- Named fields keep reader results compatible with later table columns.
-- Unlisted fields remain NULL. Public reads never select the invite code.
begin;

alter table public.trips add column if not exists drives_part boolean;

create or replace function public.get_public_trip(p_pub_id text)
returns setof public.trips
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_trip_id uuid;
  v_pub public.published_itineraries;
  v_free int[];
  v_trip public.trips;
  v_day jsonb;
  v_days jsonb;
  v_stop jsonb;
  v_stops jsonb;
  v_day_idx int;
  i int;
  j int;
begin
  select * into v_pub from public.published_itineraries
    where id = p_pub_id limit 1;
  if not found then
    return;
  end if;

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
      return;
    end if;
  end if;

  select projected.*
  into v_trip
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
      'invite_code', null::text,
      'deleted_at', t.deleted_at,
      'driver_count', t.driver_count,
      'has_vulnerable', t.has_vulnerable,
      'drive_after_dinner_min', t.drive_after_dinner_min,
      'vehicle_profile', t.vehicle_profile,
      'cover_image_url', t.cover_image_url,
      'stay_style', t.stay_style,
      'drives_part', t.drives_part
    )
  ) as projected
  where t.id = v_pub.trip_id
    and t.visibility = 'public'
    and t.deleted_at is null
  limit 1;
  if not found then
    return;
  end if;

  v_free := coalesce(
    (select array_agg(value::int) from jsonb_array_elements_text(v_pub.free_day_indexes) as value),
    '{}'
  );

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
    return next v_trip;
    return;
  end if;

  v_days := to_jsonb(v_trip.days);

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

    if v_day_idx is null or not (v_day_idx = any (v_free)) then
      v_stops := v_day -> 'stops';
      if v_stops is null or jsonb_typeof(v_stops) <> 'array' then

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

      v_days := jsonb_set(v_days, array[i::text], v_day);
    end if;
    i := i + 1;
  end loop;

  v_trip.days := v_days;
  return next v_trip;
end;
$$;

revoke all on function public.get_public_trip(text) from public;
grant execute on function public.get_public_trip(text) to anon, authenticated;

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
      'drives_part', t.drives_part
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
