-- v0.37 creator dashboard: track when a publication was last synced with its
-- itinerary, so Profile can flag "your public page is behind your trip" when
-- the trip is edited after publishing. Nullable — rows published before this
-- migration fall back to published_at for staleness.
-- Run in the Supabase SQL editor (or supabase db push) once per environment.

alter table public.published_itineraries
  add column if not exists refreshed_at bigint;
