-- ============================================================
-- #228 · Share-attribution allowlist (option A) — two more routes in
-- ============================================================
--
-- Stage 0 (#230) pinned `?ref=` to a five-value vocabulary and taught the
-- database to refuse anything else. F7's first distribution loop needs TWO
-- more values to be storable, so the loop is measurable end to end:
--
--   wa         — the WhatsApp send stamps its own channel
--                (sharePublicationOnWhatsApp defaults its ref to 'wa').
--   community  — a distribution post outside the app (a subreddit, a
--                non-WhatsApp group), named as a CATEGORY. A free-form slug
--                would put a stranger's sentence into every share URL and,
--                later, into an analytics read; the allowlist keeps a channel
--                a category, not a message.
--
-- What this file touches, and nothing else: the two CHECK constraints grow
-- from five values to seven. No column is created (20260929 created them),
-- no function is redefined, no grant moves — so the #356 service_role rule
-- and the overload-ordering rule both have nothing to apply to, and the
-- counter body, its audience and the admin reader are byte-untouched.
--
-- Re-running is safe: both constraints drop-if-exists before they are
-- re-added, so a fresh apply and a re-apply leave identical definitions.
-- Apply AFTER 20260929_pub_events_share_source.sql (it owns the columns);
-- applied alone, the ALTER fails loudly on the missing table instead of
-- half-building anything.
--
-- No `drop policy if exists` guard is needed here because this migration
-- creates no policy — the 20260921_user_dna lesson applies to
-- `create policy`, which has no IF NOT EXISTS form; nothing in this file
-- creates one. There is likewise no DELETE of any kind.
--
-- check:migrations cannot see a constraint (it probes tables, columns and
-- buckets), so this file is declared in NO_PROBE_SURFACE with its reason —
-- the same shape as 20260929_published_itineraries_publish_rules.sql. What
-- makes the widening covered instead of unverified: the three-way vocabulary
-- pin in tests/share-attribution.test.ts reads the NEWEST definition (this
-- file, once applied in order) and asserts shareUrl.ts, api/i.js,
-- schema.sql and the constraints all agree.

alter table public.pub_events drop constraint if exists pub_events_source_check;
alter table public.pub_events add constraint pub_events_source_check
  check (source is null or source in ('copy', 'buyer', 'explore', 'creator', 'purchases', 'wa', 'community'));

alter table public.trips drop constraint if exists trips_ref_check;
alter table public.trips add constraint trips_ref_check
  check (ref is null or ref in ('copy', 'buyer', 'explore', 'creator', 'purchases', 'wa', 'community'));
