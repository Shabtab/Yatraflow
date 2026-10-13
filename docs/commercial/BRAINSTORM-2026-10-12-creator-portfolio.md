# Creator portfolio: brainstorm and source assessment

**Date:** 2026-10-12 UTC
**Source tree:** `HEAD` `56832cd`
**Reported refs:** `origin/test` `613df04`; `origin/main` `c9f917f`
**Status:** Proposed ideas only. This document does not set a release date.

This is a source-only assessment. The advisor used no live data, browser, or tests. The roadmap remains the single plan of record.

## Recommendation

Start with the creator's profile link and route library. Let a paid storefront follow evidence that visitors use free plans. Each creator already has one public entry point. Improve that library before adding a large portfolio suite.

## Current source baseline

The creator page shows an avatar, bio, home city, languages, and YouTube or Instagram links. It sorts live publications by newest date. Visitors can save or fork each plan. Public figures count publications, views, and forks. They do not measure personal travel or verified audience reach. (`CreatorPage` in `src/pages/CreatorPage.tsx:18`; `PubCard` in `src/components/PubCard.tsx:15`.)

Cards show estimated trip spend per person. They do not label the unlock price or say that a plan is free. A publication stores best-season text as free text. Its route summary stores ordered place names, not map geometry. (`PubCard` in `src/components/PubCard.tsx:15`; `PublishedItinerary` in `src/data/types.ts:422`.)

The Creator Hub manages the profile, publications, sales, dated traffic, and projections. Its payout schedule says that transfers are not automated. (`CreatorHubPage` in `src/pages/CreatorHubPage.tsx:84` and `:1023`.)

The public share card uses `/c/<id>` for crawler metadata. It sends browsers to `/creator/<id>` with a generic image. The web router already reads path routes. Its hash bridge keeps old links working, so a general route migration is not needed. (`renderCreator` in `api/c.js:33`; `currentRoute` and `legacyHashRoute` in `src/lib/router.ts:41` and `:112`.)

The creator page's publication links do not carry a source stamp. A direct fork from that page carries the `creator` source. The `/c/<id>` card drops query data when it redirects. Add source tags to new paths and keep the action through sign-in. (`CreatorPage` in `src/pages/CreatorPage.tsx:145`; `renderCreator` in `api/c.js:60`; `forkPublication` in `src/lib/forkPub.ts:88`.)

The code has no portfolio map, featured route, curated collections, short handles, or search and season filters. It has no travel-proof profile figures. The strategy's frequency and two-day decay claims remain unverified by this source review. Treat them as hypotheses.

## Smallest proposed release: medium effort

1. Show the unlock price or a clear free label beside estimated trip spend. Explain what each figure means.
2. Let a creator feature one live route. Show its existing best-season text. Add search only if the catalog needs it.
3. Reuse the publish-quality checklist in I-23. Add a public preview and a share path that works for logged-out visitors.
4. Measure the path from visit to plan open, copy, meaningful edit, and crew invite. Define a meaningful edit before counting it. Keep the action and source through sign-in.

Accept this release only when a creator can publish, feature, preview, and share a route. A card must separate unlock price from trip spend. Cleared profile fields must stay cleared after reload. Visitors must browse live public plans without an account. A failed read must not look empty. Sign-in must return a visitor to the action they started. The page must show only live public publications.

Pilot this with five creators. Track whether three creators share without a reminder. Track whether ten visitors outside the team open a plan. Track whether three visitors copy a plan and make a meaningful edit. Record where each visitor leaves. These numbers guide learning. They are not proof or a new release gate. Keep the existing six-week strategy gate unchanged.

## Ranked experiments

These experiments test learning questions. Their order does not promise a release sequence.

| Rank | Experiment | Effort | Dependency and learning outcome |
|---|---|---|---|
| 1 | Routes from your city | S–M | Clean origin names and trip lengths. Learn whether visitors find and open plans. |
| 2 | Reel-to-route link | S | Add an optional post link and source tag. Learn whether posts repeat and bring plan opens. |
| 3 | Make this your weekend | M | Add dates, crew, copy, and sign-in return. Learn whether visitors edit plans and invite people. |
| 4 | Seasonal collections | M | Use creator-confirmed months. Learn whether visitors open a shelf and edit a plan. |
| 5 | Public route atlas | M | Use safe public place anchors with a list fallback. Learn whether map selection leads to plan use. |
| 6 | Route freshness note | S–M | Keep review date and scope separate. Learn whether the note helps creators maintain plans and lowers uncertainty. |
| 7 | Branded route snapshots | M | Show manual examples first. Add a QR code, link, licensed assets, and map credits. Count real posts, visits, and copies. |
| 8 | Private creator activity report and export | M | Define dated operational figures for the creator's private use. Learn whether creators return to use the report. Reuse I-22's funnel data without duplicating it. |

## Scope and effort split

S means small, M means medium, and L means large.

| Proposal | Effort | Scope and limit |
|---|---|---|
| Public route map | M | Start with public place anchors and one clustered map. Keep a list fallback. Load route detail on demand. Add basemap credits. |
| Short creator handles | M | Define normalized uniqueness, reserved names, ownership, and rename rules. Keep old links working after a rename. |
| Season display and data | S / M | Display stored free text now. Use structured, creator-confirmed months only if collections need them. |
| Travel-proof stats | M / L | Call distance planned distance, never “km driven.” Count states only from canonical places. Actual nights or states visited need creator declarations or completion evidence. Decide that larger scope later. |
| External media kit | M / L | Let creators share selected dated I-56 figures with brands or others. Require creator consent and creator-controlled sharing. Demographics and future demand need new, consented data. Keep visitor request month separate from travel month. |
| Route exports | M | Use licensed assets and keep required basemap credits on each export. |

## Defer until evidence or a named dependency exists

Defer animated route clips until creators post manual snapshots. Defer custom domains until handles and rename rules work. Defer booking integrations until a pilot shows demand and partner terms are clear. This is a contextual monetization proposal. It does not approve a booking agency.

Defer elaborate themes until creators use basic branded assets. Defer a follower system until creators and visitors show repeat value. Defer demographic media kits until the product has consented audience and travel-intent data. These items have no release date.

## Evidence limits and source concerns

Demand remains unknown. The ten planned creator interviews have not happened. No outreach or creator pilot happened in this assessment. A separate local research commit, `05e9555`, is outside this branch. It found no national estimate for itinerary requests on Instagram. Vendor counts were provisional and used conflicting methods. Free questions did not prove paid intent. This document does not link to that separate file.

The source calls `select('*')` for anonymous profile reads. The schema includes email and a public profile read policy. Repository source did not show column-level restrictions. Check live role grants before making a production exposure claim. (`rereadPublicSlices` in `src/store/store.ts:325`; anonymous hydrate at `:589`; `profiles` in `supabase/schema.sql:16` and `:488`.)

The profile form sends blank bio and social fields as `undefined`. The store passes those values to the update call. This suggests a clearing problem, but no runtime check reproduced it. Treat it as a source concern. (`CreatorHubPage` in `src/pages/CreatorHubPage.tsx:317`; `updateProfile` in `src/store/store.ts:1147`.)

Creator mode copy and public pages do not define one clear visibility rule for stored bio and links. Resolve that contract before changing public display. The hub says that payouts are not automated. Sales exist, but automatic transfers do not. (`CreatorHubPage` in `src/pages/CreatorHubPage.tsx:1023`; `CreatorPage` in `src/pages/CreatorPage.tsx:90`; `renderCreator` in `api/c.js:49`.)
