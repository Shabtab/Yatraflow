-- ============ #354 — the publish rules, as a database backstop ============
--
-- Six rules decide whether a row may be published, and until now every one of
-- them lived ONLY inside `PublicationForm`. The writer enforced none of them and
-- this table had no CHECK either, so any caller other than that one form — a
-- future surface, the admin console, a direct REST call — could write a row that
-- is broken in ways no reader can see from inside the app:
--
--   * a coverless row, whose shared link silently previews as the brand card
--     (`api/i.js` falls back to `og-default.png` when cover_image_url is null);
--   * a row priced above the gateway's ceiling, which fails at CHECKOUT with no
--     visible cause (purchase_orders.amount_inr caps at 100000);
--   * a priced row whose every day is free — a paid unlock that reveals content
--     the reader can already see, i.e. charged for nothing.
--
-- The client-side half of this fix is `lib/publishRules.publishValidation`, and
-- `publishItinerary` now calls it before its first cache write. This file is
-- the OTHER half: the database refuses the same rows even if the client is
-- bypassed entirely, which is the whole point of a backstop — a rule enforced
-- only by the process that would break is a suggestion.
--
-- TWO THINGS THIS FILE DELIBERATELY DOES NOT DO:
--
--   * It does NOT re-assert the rules in a TRIGGER. A CHECK is enough for
--     column-shape invariants, and a trigger would also fire on the RLS-gated
--     admin update paths, where a "refuse" is harder to explain than a constraint
--     violation. The two column rules below need no function.
--   * It does NOT require the cover on EVERY row. Unpublishing is a MARKER
--     (#350), not a delete, so a legacy row published before the cover rule
--     exists keeps its row with a null cover. The constraint is NOT VALID, so
--     existing rows are grandfathered rather than forcing a migration-time
--     cleanup nobody asked for — and the client already refuses a coverless
--     publish, so no NEW row can arrive in that state.
--
-- IDEMPOTENT: re-running is safe. `drop constraint if exists` precedes each
-- `add constraint`, and each is added NOT VALID, so no table is ever rewritten.

-- ---------- 1. The cover must be an https URL when there is one -----------
-- NULL passes, which is deliberate and is what grandfathers legacy rows: the
-- form has required a cover since v0.38, so a null here is a PRE-rule row, and
-- the client refuses a new one.
--
-- The pattern is the handler's own `^https://\S+$` — a pasted value is stored
-- verbatim and `api/i.js` refuses anything else, so a row that slips past this
-- CHECK is a row whose link previews as the brand card instead of its own
-- picture. The three client-side call sites are pinned to the same literal by
-- `tests/share-preview.test.ts`.
alter table public.published_itineraries
  drop constraint if exists published_itineraries_cover_https;

alter table public.published_itineraries
  add constraint published_itineraries_cover_https
  check (
    cover_image_url is null
    or (cover_image_url ~ '^https://\S+$')
  ) not valid;

-- ---------- 2. The price must be one the gateway can actually take ----------
-- purchase_orders.amount_inr is capped at 100000 (the gateway's sensible
-- test-mode ceiling). A publication above it accepts at publish time and 503s
-- when a buyer tries to pay, which is the worst possible moment to discover it.
-- NULL means "entirely free" and is unaffected.
alter table public.published_itineraries
  drop constraint if exists published_itineraries_price_in_range;

alter table public.published_itineraries
  add constraint published_itineraries_price_in_range
  check (
    premium_price_inr is null
    or (premium_price_inr >= 0 and premium_price_inr <= 100000)
  ) not valid;

-- ---------- 3. A priced publication must withhold at least one day ----------
-- The "charged for nothing" row: a price with every day free publishes an Unlock
-- CTA that reveals what the reader can already see.
--
-- free_day_indexes is a JSONB ARRAY of day indexes, so the predicate is written
-- in the jsonb shape rather than as a scalar count: `jsonb_typeof` guards the
-- poisoned-column case #352 was written for (a scalar there made `get_public_trip`
-- raise for EVERY visitor), and `jsonb_array_length` is only called once the
-- type is known to be an array. A null or non-array column is left alone rather
-- than refused — this constraint is about the PRICED-with-nothing-withheld
-- contradiction, not about being strict with legacy data.
--
-- Note the `< 1` and the type guard are both needed: `jsonb_array_length` of
-- `[]` is 0, and 0 free days on a priced plan is the other half of the same
-- bug (a publication hydrated with `free_day_indexes: []`).
alter table public.published_itineraries
  drop constraint if exists published_itineraries_priced_withholds_a_day;

alter table public.published_itineraries
  add constraint published_itineraries_priced_withholds_a_day
  check (
    premium_price_inr is null
    or premium_price_inr = 0
    or (
      free_day_indexes is null
      or jsonb_typeof(free_day_indexes) <> 'array'
      or jsonb_array_length(free_day_indexes) >= 1
    )
  ) not valid;

-- ---------- Why NOT VALID, and what it does NOT cost ----------
-- NOT VALID means: enforced for every INSERT and UPDATE from now on, and existing
-- rows are left alone. That is the honest trade here — the alternative is a
-- migration that either fails on legacy data or silently rewrites publications a
-- creator is still selling. To tighten it later, first count what is out there:
--
--   select count(*) from public.published_itineraries
--   where cover_image_url is null;
--   select count(*) from public.published_itineraries
--   where premium_price_inr > 100000;
--   select count(*) from public.published_itineraries
--   where premium_price_inr > 0
--     and jsonb_typeof(free_day_indexes) = 'array'
--     and jsonb_array_length(free_day_indexes) < 1;
--
-- and then VALIDATE each constraint (which takes a lock and re-checks):
--   alter table public.published_itineraries
--     validate constraint published_itineraries_cover_https;
