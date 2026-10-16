# Distribution measurement audit

Audit date: 2026-10-15. Source baseline: `7bebcd8` on the default branch, `main`.

This audit separates acquisition, trip activation, collaboration, and expansion.
You must not describe the proposed journey as a proven growth loop.
Read the [pilot specification](DISTRIBUTION-PILOT.md) for metric definitions and experiment rules.

## Evidence and access

| Source | Result |
| --- | --- |
| Local Guide Monetization document | Google Doc export returned HTTP 403. All five pages of the later supplied PDF were read on 2026-10-16. |
| Creator Network document | Google Doc export returned HTTP 403. All thirteen pages of the later supplied PDF were read on 2026-10-16. |
| Repository exports of those documents | No matching export found. The portfolio brainstorm is related evidence, not either document. |
| `commercial/STRATEGY.md` | Read in full. Its live figures describe 2026-10-12, not this audit date. |
| `commercial/BRAINSTORM-2026-10-12-creator-portfolio.md` | Read in full. Its proposals are distinct from shipped features. |
| Older launch and execution plans | Reviewed as historical references. Their headers defer to `STRATEGY.md`. |
| Default branch | Native Git confirmed `main` at `7bebcd8`. The checkout matched it. |
| Integration branch | `origin/test` held six later commits. Their changes concern phone layout, copy, and screenshots. |
| Open issues and PRs | Initially blocked. Later API reads confirmed PRs #794 and #773, plus relevant open issues. No token was replaced. |
| Related remote work | PR #773 remains open for creator SEO rendering. Its changed-file list includes `api/c.js`. This task does not rebuild it. |
| Production database | Unverified. No Supabase variables or local environment file were available. |
| Baseline checks | Nine relevant test files passed: 227 tests. These mocks and source checks do not prove production RLS behavior. |

The initial interpretations used your brief. The later [PDF review](DISTRIBUTION-SOURCE-REVIEW.md) adds direct source evidence and page citations.
It distinguishes the free distribution pilot from paid expert success and records the planned portfolio work.
The Google Docs themselves remain unread. The PDFs do not prove current implementation or live demand.
PR #794 now holds this work. No external strategic document, production row, or deployment was changed.

You can repeat these read-only tracker checks before integration:

```bash
gh repo view hasnaina955/Yatraflow --json defaultBranchRef,pushedAt
gh pr list --repo hasnaina955/Yatraflow --state open --limit 100 \
  --json number,title,headRefName,baseRefName,url
gh issue list --repo hasnaina955/Yatraflow --state open --limit 500 \
  --json number,title,labels,url
```

You must inspect related PR diffs before integration. Git branch names cannot prove whether a PR remains open.

## Material strategy conflicts

| Existing claim | Evidence or conflict | Pilot decision |
| --- | --- | --- |
| Creators bring their own customers, so the tool works immediately. | `STRATEGY.md` §3 targets creators with audiences. Your Local Expert brief includes people without audiences. | Keep one Creator Network. Test audience distribution and business distribution separately. Do not promise demand to Local Experts. |
| The shared-plan journey forms a complete viral loop. | The historical launch plan describes available steps. Available steps do not prove repeat acquisition or later organizers. | Report each transition separately. Require linked membership and ownership records for expansion. |
| Five creators need portfolios, snapshots, and a handmade clip. | `STRATEGY.md` §4 proposes these assets. The portfolio brainstorm proposes a smaller library experiment. | Use existing public pages and manual assets. Build no Studio layers or clip renderer in this task. |
| Source tags identify who supplied the buyer. | Existing tags mix transport, share action, and in-app entry point. `creator` means a creator page. | Preserve every existing tag. Use separate opaque campaign slots for engine comparisons. Do not use tags to change payment fees. |
| The create table has no `started` rows. | This is a dated production observation. Current source also omits `user_id` on most authenticated writes. | Repair the demonstrated write mismatch. Verify current production counts independently before launch. |
| Trips with two members represent collaboration. | `adminStats.computeFunnel` checks membership length. It does not check a second person's action. | Label this confirmed membership. Count a persisted non-owner proposal separately. |
| A creator must receive a payout before distribution starts. | The strategy places payouts and merchant decisions in Week 0. This task measures distribution, not paid demand. | Use free pilot plans. Keep paid sales, payouts, tax, and merchant readiness as separate gates. |
| SEO needs a new path router. | Current web routing already uses paths. `api/i.js` provides public itinerary bodies. Creator SEO has related remote work. | Keep SEO in the strategy. Start no programmatic SEO project here. |
| The PDFs seek a paid expert success test. | A p. 5 targets the first ₹1,000. B pp. 3, 5, and 7 separates paid expert fulfillment from creator traffic. | The free pilot cannot meet that commercial gate. Keep a demand-backed paid-services follow-up separate. |
| Portfolios and manual snapshots are early priorities. | B pp. 9 and 11–12 sets these priorities. This measurement PR reuses existing creator pages. | Prepare manual assets. Defer new portfolio features only within this measurement PR. |
| The PDFs propose partner booking revenue. | A pp. 1–3 discusses eligible completed bookings. The revised Engine C tests guest-guide distribution. | Report partner-originated activation separately. Claim no booking commission or expert earnings from those forks. |

Existing public creator pages and the Creator Hub cover parts of identity, creation, business, and intelligence.
They do not establish a complete Creator Studio.
The repository does not establish Local Expert service fulfillment, booking operations, or a traveler request inbox.
Those proposals need demand evidence before implementation.

## Funnel matrix at the audit baseline

“Verified” below means a local check exercised the stated contract.
It never means the same behavior was observed in production.

| Transition | Status | Implementation and trigger | Unit, deduplication, persistence | Attribution, privacy, failure, and admin access |
| --- | --- | --- | --- | --- |
| Creator shares a plan | Implemented but unverified | `shareUrl.ts:10`, `publicationShare.ts`; share or copy actions compose `/i/:id` links. | A copied link or opened destination is an action. No proof of an actual post exists. | `ref` uses seven fixed values. The pilot needs a manual distribution ledger. No recipient data belongs in analytics. |
| Partner distributes a guide | Partially implemented | Partners can share the same public itinerary links. No separate business workflow is required. | Existing records cannot distinguish two partner campaigns. | Add fixed opaque campaign slots. Keep partner contact details outside app analytics and public URLs. |
| Link arrives at public plan | Partially implemented | `api/i.js:155` forwards a valid `ref` into `/pub/:id`. | No server arrival record exists. Crawler fetches are not browser visits. | The canonical URL stays clean. Unrecognized source values are dropped. Creator-card redirects lose query context. |
| Publication is viewed | Implemented and verified | `PublicItinerary.tsx:165` calls `registerPubView`; `store.ts:4003` calls `bump_published_stats`. | One event per publication and tab session, enforced by the normal client. Creator checks are excluded by the client. | `pub_events` persists dated rows without visitor IDs or IPs. Creator and admin readers exist. Failed writes release the client claim. No server deduplication or bot filter exists. |
| Publication is bookmarked | Implemented but unverified | `savedPubs.ts` changes browser `localStorage`. | One saved publication ID per browser list. It is reversible and device-local. | No central event or admin total exists. Storage denial loses the bookmark. This is not trip activation. Browser persistence was not exercised in this audit. |
| Publication is forked | Partially implemented | `forkPub.ts:88` fetches the paywall RPC, persists a safe copy, then calls `registerPubCopy`. | A failed persist emits no normal fork event. Successful fork counters count sessions, not trip records. | `trips.ref` retains the source category. The publication ID is not retained. Anonymous forks lose their action at `/auth`. Paid stubbing and entitlements remain separate guards. |
| New trip persists | Partially implemented | `createTripPersisted`, `persistTrip`, and `CreateTrip.finishCreate` wait for the trip and owner membership. | Same-object create retries reuse a trip ID. A trip row without owner membership is not a usable activation. | `submitted` fires after the first success but misses a successful retry. Demo trips lack a marker. Raw ownership totals include demo and imported trips. |
| Crew entry is added | Implemented and verified | `CreateTrip.addCrewMember` records `crew_added` with a count. | Raw step events can repeat. Form entries do not create memberships. | Names and numbers remain in local product state. The event sanitizer retains only the count. |
| Invite destination opens | Partially implemented | `TripCreated.tsx:352` and related branches record `moment_invite_sent` after a window or share result. | This means a destination opened or a share API completed. It does not mean delivery, acceptance, or a unique recipient. | The event has a channel enum and optional trip ID. Most authenticated calls omit `user_id`, so existing RLS refuses them. Clipboard fallback is not consistently measured. |
| Join page opens or attempt starts | Missing | `App.InviteGate` resolves the link and attempts a join after sign-in. | No safe dated attempt count or comparable invitation denominator exists. | Do not log join codes. Auth return uses a validated app route. Failure and expired-link states exist. |
| Membership is confirmed | Implemented and verified | `join_trip` inserts the authenticated user with `ON CONFLICT DO NOTHING`. | The composite `(trip_id,user_id)` key prevents duplicate memberships. Existing members keep their roles and dates. | The code is a capability. A trip ID cannot join a stranger. Owner additions and invite joins share the same membership table. Admin counts cannot identify their route retrospectively. |
| A member collaborates | Partially implemented | Persisted `suggestions.proposed_by` and `decisions.raised_by` can identify authored proposals. | Count distinct non-owner actors or trips after membership. Count records only after they exist. | The activity feed writes independently from product saves and includes private text. Do not export or treat it as confirmed edits. Votes and timeline edits lack a reliable action history for this pilot. |
| A member becomes an organizer | Partially implemented | Membership `user_id` can join to later `trips.owner_id` inside an authorized aggregate query. | Require an earlier non-owner membership and a later first known primary trip. Never infer this from separate totals. | This is prior participation, not proven invite acquisition. Removed memberships, hard deletion, demo history, and client timestamps limit historical coverage. |
| Creator or partner posts again | Missing | No product event proves a second external distribution action. | Use distinct confirmed manual ledger entries. Repeated views do not prove repeated posts. | Store campaign, week, reminder status, time, and cost. Keep participant identities in a private operating ledger. |

## Counting and reliability findings

### Publication counters

The normal client claims `yf-viewed-<publication>` and `yf-forked-<publication>` independently.
Refreshes reuse those tab-session claims. A new tab or denied storage changes the effective unit.
The RPC atomically updates a lifetime counter and inserts its dated event.
It does not verify a browser session, a real persisted fork, or the creator exclusion.
Direct RPC requests can inflate counts. These records remain directional traffic diagnostics.

Explore and creator cards can fork a plan without opening its publication page.
Equal units do not establish equal cohorts.
Forks divided by views is an aggregate activity ratio. It does not measure individual visitor conversion.
The same restriction applies to sales divided by fork-session counts.
Preserve ratios above 100%. Do not clamp them or describe them as impossible.

The old publication page retains arrival state when only its slug changes.
Its mount-only view effect also misses a publication that arrives after a failed-read retry.
Scope the component to one publication and wait for its row before registration.

### Create events

The table permits authenticated inserts only when `user_id = auth.uid()`.
Most page calls omit that value. Anonymous and authenticated roles use different policies.
The client backfill tries UPDATE, but the table intentionally has no UPDATE policy.
An UPDATE policy keyed only by a public client session token would create an unsafe ownership mechanism.
Remove that backfill. Do not link anonymous history to an account through a guessed session token.

The existing admin read requests 20,000 rows in one call.
A PostgREST response cap can silently return fewer rows.
Use stable paged reads with a fixed upper time boundary and fail if any page fails.
Keep raw event counts separate from distinct submitted trip IDs and authoritative trip activation.

`submitted` metadata accepts any short transport string.
Template and abandonment strings also need actual vocabulary checks, not only character checks.
Enforce the closed shapes at the database boundary as well as in the normal client.
Analytics rejection must remain independent from trip, fork, share, and join success.

### Authoritative trip activation

You need both the trip row and its matching owner membership.
Use distinct trip IDs. Use the database trip creation timestamp for the reporting window.
Separate created, forked, copied, imported, demo, and unknown origins.
Never classify old records from private names or `(copy)` title patterns.
Preserve unknown historical origins as unknown.

At the baseline, fork persistence has no shared in-flight guard or retained failed-copy retry.
A rapid second click can create another UUID.
A retry after a partially acknowledged save can also create another UUID.
The correction must reuse the same pending action's ID and verify persisted ownership before treating conflicts as success.
Separate later deliberate copies remain separate real trips.

### Membership and collaboration

`20261012a_join_trip_function.sql` authenticates callers, checks disabled accounts, and resolves a live invite capability.
`20261012b_member_insert_owner_only.sql` restricts direct membership inserts to trip owners.
That second migration rotates some codes and must not be rerun blindly.
No analytics change needs broader membership policies or access to invitation secrets.

Use persisted authored suggestions and decisions as a narrow meaningful-action definition.
This omits edits, votes, deleted proposals, and some offline actions.
It measures a verified subset of collaboration, not every useful contribution.
Existing member-scoped write policies permit members to write actor fields.
These are normal app authorship records, not an independently verified identity or fraud signal.

## Chosen implementation boundary

1. Repair authenticated event calls and the successful create retry path.
2. Remove the ineffective anonymous-session backfill.
3. Enforce bounded event metadata without opening UPDATE or SELECT policies.
4. Correct activity-ratio and membership labels.
5. Page the existing admin event read.
6. Retain explicit fork context across sign-in without persistent visitor tracking.
7. Add nullable trip-origin fields and five fixed opaque campaign slots.
8. Preserve existing source tags, counters, share URLs, paywall reads, and event retention.
9. Add an aggregate SQL scorecard over authoritative rows.
10. Check SQL locally in an isolated database and document separate production checks.

The fixed campaign slots serve one pilot. They contain no creator or partner identities.
Do not repurpose a slot after data accrues. A later pilot needs new reviewed codes or a justified registry.
Group activity comes from membership records, not another public tracking parameter.

Defer a full campaign management service, general visitor identity, a new dashboard, and a new analytics vendor.
Defer complete edit history and historical attribution reconstruction.
Defer portfolio maps, clips, service bookings, and broad SEO work.

## Production verification procedure

Use an authorized read-only session or the Supabase SQL editor.
Do not print credentials or private rows. Do not submit synthetic production events.

1. Run `npm run check:migrations` with the existing bindings. Exit 2 means credentials are unavailable.
2. Inspect applied function signatures and the actual policies through `pg_proc` and `pg_policies`.
3. Count create events by event and UTC day. Compare the rollout period with preceding days.
4. Check distinct submitted trip IDs against existing trip and owner-member records.
5. Check `join_trip` membership uniqueness and the owner-only insert policy.
6. Run the scorecard with explicit UTC bounds and a securely supplied team exclusion cohort.
7. Observe genuine pilot actions. Compare their resulting records with the expected counts.
8. Record failed or unavailable reads as unverified. Never replace them with zero.

```sql
begin transaction read only;
-- These column probes must succeed without returning private rows.
select creation_kind, source_pub_id, campaign_id from public.trips limit 0;
select campaign_id from public.pub_events limit 0;

select event, (at at time zone 'utc')::date as day, count(*)
from public.create_funnel_events
where at >= now() - interval '14 days'
group by event, day order by day, event;

select policyname, cmd, roles, permissive, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('create_funnel_events', 'trip_members');

select p.proname, pg_get_function_arguments(p.oid), p.prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('join_trip', 'bump_published_stats', 'guard_create_funnel_event');

select tgname, pg_get_triggerdef(oid)
from pg_trigger
where not tgisinternal
  and tgname in ('trips_guard_origin', 'create_funnel_guard');

select count(*) as submitted_rows, count(distinct e.trip_id) as submitted_trip_ids,
  count(distinct e.trip_id) filter (where m.user_id is not null) as usable_submitted_trip_ids
from public.create_funnel_events e
left join public.trips t on t.id = e.trip_id
left join public.trip_members m
  on m.trip_id = t.id and m.user_id = t.owner_id and m.role = 'owner'
where e.event = 'submitted' and e.at >= now() - interval '14 days';
rollback;
```

These reads do not establish live action behavior by themselves.
You must record migration application and genuine pilot observations before claiming production readiness.
The migration check must report `0 missing` after all repository migrations are present.
Both named triggers must appear. The counter function must expose the new defaulted fourth argument.
The column probes must succeed. An absent probe result is not proof of an empty cohort.

## Local implementation evidence

Verification date: 2026-10-16. These results describe this checkout, not production.

| Check | Result and limit |
| --- | --- |
| `npm run verify` | Passed. Type checks, lint limits, prose checks, 5,070 tests, and the production build passed. |
| Optional external router audit | One test remains skipped. It needs separate external-service credentials. |
| Existing lint debt | The check kept its existing baseline: 139 errors and 29 warnings. No baseline was raised. |
| `node scripts/integration/growth-db.mjs` | Passed in isolated PostgreSQL 17. Both new migrations ran twice. |
| Database behavior | Tested authenticated writes, metadata guards, usable activation, counter compatibility, owner-only membership, and duplicate joins. |
| Scorecard fixtures | Tested campaign cohorts, distinct engine organizers, member proposals, productive returns, conservative expansion, and aggregate output. |
| Retry behavior | Tested failed forks, shared pending IDs, refresh recovery, paid guards, denied storage, and browsers without `randomUUID`. |
| `npm run check:migrations` | Exit 2: no credentials. The result does not establish whether production migrations are present. |
| Signed-in browser flows | Unverified. No backend bindings or disposable test account were available. |

The repository browser skill needs a disposable account for signed-in flows.
Real sign-in seeds sample trips. Do not use a production account for that browser harness.
The local database harness accepts no remote database URL and removes its isolated container afterward.
The build warns about missing backend bindings and existing large bundles.
No production deployment, migration, event, or external campaign occurred during this work.
