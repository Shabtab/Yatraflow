-- ============ Create-time vehicle estimate columns ============
-- #377: four things the create form computes into its bill and then dropped
-- on the floor at submit — the vehicle profile, the tank size, the rental
-- daily rate and (for train trips) the local-train flag. The profile already
-- had a column (20260915_trip_party_prefs.sql); these three never did, so
-- "set the tank while creating → open Settings → gone" was structural.
--
-- This migration gives the remaining fields their columns. The row mapping
-- (`src/lib/tripRow.ts`) carries the sanitizers: tank 5..300 L, rent
-- 0..100000 ₹/day, local_train a strict boolean — junk becomes NULL and the
-- engine falls back to its defaults, exactly like the party sanitizers.
--
-- Idempotent (`add column if not exists`), so this file is safe to re-run
-- against an install that is already up to date.
--
-- Pre-application behaviour: until the columns exist, the store's
-- optional-column probe reports `tankL: false` / `rentPerDayInr: false` /
-- `localTrain: false` (see `probeOptionalColumns` in `src/store/store.ts`),
-- the fields stay unwritten, and creating with them set silently keeps them
-- session-only — the same missing-optional-column shape as `cover_image_url`
-- and `stay_style` before them.

alter table public.trips add column if not exists tank_l numeric;
alter table public.trips add column if not exists rent_per_day_inr numeric;
alter table public.trips add column if not exists local_train boolean;
