-- ============================================================
-- Calculator hand-off · share attribution — one more route in
-- ============================================================
--
-- F7's allowlist let `wa` and `community` be stored, so the distribution loop
-- could be measured end to end. The destination trip-cost calculators add one
-- more route in, and a recorded value that the database refuses is a broken
-- hand-off, not a missing statistic:
--
--   calculator — a destination calculator's primary CTA. The static page at
--                /<slug>/ links to /new?ref=calculator&calc=…, and the trip
--                the visitor creates carries that ref through the same
--                vocabulary every other in-app surface uses.
--
-- What this file touches, and nothing else: the two CHECK constraints grow
-- from seven values to eight. No column is created (20260929 created them),
-- no function is redefined, no grant moves — so the #356 service_role rule
-- and the overload-ordering rule both have nothing to apply to, and the
-- counter body, its audience and the admin reader are byte-untouched.
--
-- The list is in alphabetical order, the same order as SHARE_SOURCES in
-- src/lib/shareUrl.ts: the two are pinned to each other, so the order is part
-- of the contract, not a preference.
--
-- Re-running is safe: both constraints drop-if-exists before they are
-- re-added, so a fresh apply and a re-apply leave identical definitions.
-- Apply AFTER 20260930_pub_events_share_source_allowlist.sql (it holds the
-- seven-value definition this file widens); applied alone on a database that
-- never ran 20260929, the ALTER fails loudly on the missing table instead of
-- half-building anything.
--
-- No `drop policy if exists` guard is needed here because this migration
-- creates no policy — the 20260921_user_dna lesson applies to
-- `create policy`, which has no IF NOT EXISTS form; nothing in this file
-- creates one. There is likewise no DELETE of any kind.
--
-- check:migrations cannot see a constraint (it probes tables, columns and
-- buckets), so this file is declared in NO_PROBE_SURFACE with its reason —
-- the same shape as the 20260930 allowlist file. What makes the widening
-- covered instead of unverified: the three-way vocabulary pin in
-- tests/share-attribution.test.ts reads the NEWEST definition (this file,
-- once applied in order) and asserts shareUrl.ts, api/i.js, schema.sql and
-- the constraints all agree.

alter table public.pub_events drop constraint if exists pub_events_source_check;
alter table public.pub_events add constraint pub_events_source_check
  check (source is null or source in ('buyer', 'calculator', 'community', 'copy', 'creator', 'explore', 'purchases', 'wa'));

alter table public.trips drop constraint if exists trips_ref_check;
alter table public.trips add constraint trips_ref_check
  check (ref is null or ref in ('buyer', 'calculator', 'community', 'copy', 'creator', 'explore', 'purchases', 'wa'));
