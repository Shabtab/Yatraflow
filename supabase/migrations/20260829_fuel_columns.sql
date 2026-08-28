-- 2026-08-29 — fuel-accurate self-drive costing (PR #8)
-- Idempotent: safe to re-run. Adds the columns the app now writes when a
-- car/motorcycle trip sets fuel economy, local pump price, or round-trip.
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run.

alter table public.trips add column if not exists fuel_economy_km_per_l numeric;
alter table public.trips add column if not exists fuel_price_per_l numeric;
alter table public.trips add column if not exists round_trip boolean;
