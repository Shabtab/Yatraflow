# Six-week distribution pilot

This specification follows the [source audit](DISTRIBUTION-MEASUREMENT-AUDIT.md).
It tests three distribution mechanisms. It does not assume a working growth loop.
You must freeze the sample, thresholds, exclusions, and reporting dates before the first real distribution action.
Engine A means creator audiences. Engine B means group planning. Engine C means travel-business partners.

## Scope and attribution

Use existing public itineraries, creator pages, bookmarks, forks, and crew invites.
Use free plans during this pilot. Paid demand needs separate merchant, entitlement, refund, and payout readiness.
This free pilot cannot prove willingness to pay or a creator's first ₹1,000.
Keep Local Experts and audience-first Travel Creators in one proposed Creator Network.
Do not expect Local Experts without audiences to supply their own customers.

The five campaign codes are fixed in `src/data/growthCampaigns.json`.
They identify experimental slots. They contain no participant identities.

| Slot | Code | Engine |
| --- | --- | --- |
| Creator A, first route | `p_a7c1d9e4b206` | Creator audience |
| Creator A, second route | `p_f2b8a064cd19` | Creator audience |
| Creator B, route | `p_9d340e7ab165` | Creator audience |
| Partner A, guest guide | `p_c6812fa930bd` | Business partner |
| Partner B, guest guide | `p_4be09c713af8` | Business partner |
| Group invitation | No public campaign code | Authoritative membership and proposal records |

Record each slot's chosen public publication ID in your private operating ledger before launch.
Do not change that mapping after traffic starts. Never reuse these codes for another pilot.
A reused code or another publication carrying the code must be reported as a contaminated campaign.
The code is a public attribution claim. It does not authenticate a sender or prove an external post.

Example, after you replace `PUBLICATION_ID` with the actual public ID:

```text
https://www.yatraflow.in/i/PUBLICATION_ID?ref=wa&campaign=p_a7c1d9e4b206
```

Keep the existing `ref` semantics: copy, buyer, Explore, creator page, purchases, WhatsApp, or community.
Do not encode Instagram as `creator`; that existing value means a product entry point.
Record the exact external channel in the manual distribution ledger.
Use `copy` for a copied link or `community` for a relevant community post.
Do not invent new source strings or put names, handles, phone numbers, or email addresses into tracking parameters.

The app and preview handler accept only the five campaign codes.
The database drops an invalid optional campaign without blocking the trip or publication action.
The existing publication source allowlist remains unchanged.
Unrecognized and missing campaign values remain unattributed.
The existing backend `direct` bucket includes old links, missing tags, and genuine direct traffic.
You cannot separate those causes retrospectively.

Attribution applies to a public-plan arrival and its explicit fork.
A short tab-scoped return context preserves that action through sign-in for 30 minutes.
Signing in returns you to the plan; it does not automatically create a trip.
This context contains the public publication ID and allowed tags, not a visitor identity.
Denied storage loses the sign-in attribution context but does not block login or forking.
A refresh before an explicit fork can lose the arrival tag. Those later actions remain unattributed.

There is no cross-device or cross-browser attribution.
There is no persistent marketing identity or visitor fingerprint.
A fresh share from the product does not inherit a previous campaign automatically.
Creator-profile campaign routing remains outside this pilot. Use the publication link for each measured distribution action.

## Metric contracts

Use explicit UTC intervals: `[start_at, end_at)`.
Take weekly readings from completed seven-day windows. Keep the UTC bounds beside every result.
Keep counts and denominators together. A missing denominator is unknown, not zero-percent conversion.

The scorecard reads [distribution_scorecard.sql](../../supabase/reports/distribution_scorecard.sql).
It returns aggregates only. It creates no table, event, counter, or identity linkage.
Use an authorized admin session or the SQL editor. Do not publish its underlying private rows.
Set `excluded_user_ids` privately to the team, test accounts, and accounts used to prepare pilot content.
The query excludes those owners and member actors. Publication traffic cannot apply that private exclusion cohort.
Use `engine_activations` for engine totals. Do not sum campaign organizer counts, because one person can activate several campaigns.

### Acquisition

| Metric | Definition and unit | Source and deduplication | Window and denominator | Limits, privacy, and verification |
| --- | --- | --- | --- | --- |
| Publication visit-sessions | Recorded publication views by source, campaign, and publication | `pub_events.kind = view`; normal client claims one event per publication and tab session | Event timestamp inside the reporting window. No denominator. | Not unique people or site visits. Multiple publications count separately. Client claims are not server deduplication. Local tests only; production unverified. No visitor identity is added. |
| Campaign visit-sessions | View rows carrying one fixed campaign code | Same event source and client claim | Same window. No denominator. | A second campaign for the same publication in one tab may receive no second view. Forwarded or edited tags cannot prove sender identity. |
| Unattributed traffic | View rows without a known campaign or source | Existing nullable fields | Same window. Share of recorded view rows only, if shown | Missing tags cannot distinguish direct, search, old links, or lost context. A missing campaign does not erase a valid source category. |
| Attributable unique visitors | Unique people or browsers arriving through a campaign | Unsupported by existing publication records | No valid numerator or denominator | Do not sum session counts and label them visitors. No persistent identity is introduced to fill this gap. |
| Qualified visitor | A person with a stated upcoming trip and a relevant planning need | Consented pilot interviews or directly observed planning, counted manually | Report the observed sample and question alongside the count | Impressions, views, and clicks do not qualify a visitor. No automatic intent claim is supported. Do not store interview free text in app analytics. |
| External reach or clicks | Platform-reported aggregate impressions or outbound clicks | Creator or partner supplies the source report | Report its own dates and counting unit | Keep separate from YatraFlow visits. Different platforms deduplicate differently. Never use follower counts as a conversion denominator. |

### Trip activation

| Metric | Definition and unit | Source and deduplication | Window and denominator | Limits, privacy, and verification |
| --- | --- | --- | --- | --- |
| Created trips | Distinct persisted trips marked `created`, with their matching owner membership | `trips.id` and `trip_members(trip_id, owner_id, owner role)` | Database trip creation timestamp inside the window. No denominator. | Excludes demos, copies, imports, unknown origins, and orphan rows. New marker coverage starts at deployment. Local behavior tests; production unverified. |
| Forked trips | The same usable-record test, with origin `forked` | Distinct trip ID, source publication ID, optional campaign, and existing source ref | Same window. No denominator. | Independent from session-deduped publication fork counters. Preserve paid access rules. Missing optional columns produce unknown origins, not failed trips. |
| Distinct activated organizers | Distinct owners of those created or forked records | Owner IDs are joined only inside the authorized aggregate | Same window. No denominator. | One owner can activate multiple trips but counts once here. Exclude the team cohort before interpretation. Do not export owner IDs. |
| Activation by campaign | Activated fork records carrying the campaign code | The trip's immutable origin fields | Same trip timestamp window. No visitor denominator. | Only explicit publication forks carry this attribution. A later independent creation is not automatically credited to an old visit. |
| Failed or incomplete attempts | Form errors, failed saves, unfinished starts, and lost acknowledgements | Diagnostic create events plus orphan counts and observed pilot failures | Report raw events or observed cases, never unique failed people | No complete failure event log exists. A start without a submit is not proven failure. Retries can recover. Do not subtract event counts to invent drop-off. |
| Bookmarks | Device-local saved publication IDs | `savedPubs.ts` | No central total or denominator | Unsupported as an admin metric. A bookmark is not activation. Preserve browser-local behavior. |
| Create-flow diagnostics | Raw starts, step events, share destinations opened, and submit acknowledgements | Existing `create_funnel_events`; complete paged read | Event timestamp inside the window | Events can repeat or fail. Distinct submitted trip IDs deduplicate acknowledgements only. The submit/start ratio is not linked conversion. No anonymous backfill is performed. |

The trip row timestamp marks insertion. Owner membership confirms usability at the time of the reading.
It does not provide an exact historical completion timestamp for a delayed recovery.
Soft-deleted retained trips remain historical activations. Hard deletion removes evidence.
You must report this survivor bias instead of reconstructing missing records from names or activity text.

A pending fork action retains one UUID through retries and refreshes in the same tab.
Refresh recovery needs `sessionStorage`. With denied storage, only in-memory retries can reuse the pending ID.
Only a matching owned row and owner membership can resolve an ambiguous duplicate write as success.
After confirmed success, a later deliberate fork creates another trip.
New tabs, cleared storage, and separate devices cannot share a pending action key.
Do not claim global exactly-once creation across those boundaries.

### Collaboration and expansion

| Metric | Definition and unit | Source and deduplication | Window and denominator | Limits, privacy, and verification |
| --- | --- | --- | --- | --- |
| Trips with two confirmed members | Activated cohort trips with an owner and at least one distinct non-owner | Composite membership key; one count per trip | Membership date precedes the period end. Denominator: usable activated cohort trips | This is membership coverage, not meaningful collaboration. Owner additions and invite joins are mixed. Removed membership history is unavailable. |
| New confirmed memberships | Non-owner membership rows created during the window | Distinct `(trip_id,user_id)` pairs | `joined_at` inside the window. No invitation denominator | Duplicate joins cannot add another current row. Owner additions also count. Client clocks affect owner-added rows; `join_trip` supplies a server date. |
| Distinct new members | Distinct users in those new membership rows | Internal distinct user IDs | Same window | A person joining two trips counts once. This is a current-record count, not proof of a newly acquired account. |
| Confirmed invitation join rate | Successful invite joins divided by valid unique invitation recipients or attempts | Unsupported denominator and route history | Do not compute a rate | An opened share destination is not an invitation recipient. Membership rows do not establish which invitation action caused the join. |
| Meaningful collaboration | A non-owner member authors a persisted suggestion or decision after joining | `suggestions.proposed_by` or `decisions.raised_by`; count records, distinct authors, or distinct trips explicitly | Action timestamp inside the window and after membership | This verified subset excludes generic activity, membership, views, votes, and timeline edits. It omits deleted records. Do not select titles, comments, or contents. |
| Collaborative activation | An activated cohort trip has a confirmed non-owner member who performs that meaningful action | Join the same trip and actor records; one count per trip | Denominator, if shown: activated cohort trips | Membership and action must describe the same trip and person. Do not combine unrelated aggregate counts. |
| Participant becomes first known organizer | A prior non-owner member later owns their first known usable created or forked trip | Internal join on the same user ID; one count per person | New trip inside the window and strictly after prior membership | Exclude earlier non-demo owned records, including unknown origins. Attribute participation to the earliest qualifying membership. This is not proof that an invite caused acquisition. Historical gaps can undercount. |

Do not alter invitation capabilities or RLS to improve these metrics.
Do not store invitation codes, recipient names, phone numbers, or private trip titles in the scorecard or event metadata.

### Repeat distribution, effort, and retention

| Metric | Contract | Source, unit, window, and deduplication | Limits and privacy |
| --- | --- | --- | --- |
| Repeat creators | A creator performs at least two distinct confirmed distribution actions | Private operating ledger, distinct symbolic creator slot and post/action, six weeks | Record whether each action needed a reminder. Repeated page views prove nothing about posting. |
| Repeat partners | A partner distributes to two separate eligible customer cohorts | Same manual ledger, symbolic partner slot, six weeks | A second repost to the same people is not a new cohort. Record preparation and relationship effort. |
| Campaigns producing activation | Campaign slots with at least one usable activated trip | Authoritative campaign trip counts; distinct slots per window | Report concentration. One creator producing every result is a dependency, not a repeatable channel. |
| Manual effort | All preparation, setup, correction, outreach, support, and reporting minutes | Ledger minutes per campaign and engine per week | Report zero only when zero was recorded. Missing time remains unknown. |
| Cost | Direct payments, incentives, assets, travel, and distribution costs | Ledger INR per campaign and engine per week | Report incentives separately. Divide cost by activated organizers only when the denominator is positive. Report effort beside cash cost. |
| Return to view | A traveler reopens an existing trip | Unsupported historical view identity | Do not substitute an app open or a publication view count. |
| Return to edit or organize | A traveler makes a useful persisted planning change after a separate earlier planning occasion | Consented direct observation during the pilot; report sample and elapsed days | Existing trip timestamps lack actor and action detail. Activity writes can precede failed saves. Automated historical retention is unsupported. |
| Return to collaborate | A prior participant makes another persisted proposal on a later UTC day | The same internal actor and trip keys; distinct active days | Proposal persistence measures a subset. A new page session cannot be proved. Do not label it generic retention. |
| New independent trip | A prior participant later activates another trip as organizer | Same linked expansion contract above | Travel is episodic. A six-week absence without a new trip need is not proof of lost product value. |

## Readiness gate

You must finish these checks before the six-week measurement window starts.

1. Check related open issues and PRs when GitHub API access returns.
2. Apply the additive attribution migration before the new app deploys.
3. Deploy the app and apply the event guard migration afterward.
4. Run the migration check and independent read-only production probes.
5. Confirm a genuine successful create records a usable trip and its acknowledgement.
6. Confirm a genuine fork carries its public publication ID and allowed campaign.
7. Confirm a genuine join creates one membership, even when its link is revisited.
8. Confirm a genuine non-owner proposal appears in the correct cohort aggregate.
9. Freeze the campaign-publication mapping, team exclusion cohort, dates, thresholds, and effort budget.
10. Verify free plan content, share previews, and the app's backend configuration.

The local SQL harness uses an isolated disposable PostgreSQL database.
It does not establish deployed migration status, Supabase role grants, or production success.
Do not run a fixture generator or the write-based integration harness against production for this audit.

## Six-week execution

Use two audience-first creators, two travel businesses, and three real groups as the initial sample.
Each group must plan a real upcoming trip. Recruit four or more intended travelers per group.
Count confirmed membership separately from stated crew size.
Use five campaign slots for their public routes and guides.
Do not count Local Experts without audiences as failed creator distributors.
Place their expertise in a partner-supplied guide only when a business agrees to distribute it.

| Week | Required work | Evidence and decision |
| --- | --- | --- |
| 1 | Interview the creators and partners. Match each route to a real upcoming trip need. Observe one full traveler path. | Record actual distribution actions, qualified visitor interviews, first persisted trips, failures, and all manual minutes. |
| 2 | Run Creator A's second route. Ask both partners to distribute to a second eligible cohort. Start the first group trip. | Separate prompted and unprompted repeat distribution. Check campaign contamination and join friction. |
| 3 | Repeat the best useful content format manually. Run the remaining real group trips. | Report per-engine organizers, memberships, member proposals, costs, and effort. Do not compare raw views as channel quality. |
| 4 | Observe productive returns in the earliest eligible cohorts. Ask inactive participants where they stopped. | Separate no current trip need from product failure. Record observed edits, proposals, and independent new trips. |
| 5 | Repeat the strongest mechanism with another genuine opportunity. Test whether it works without repeated founder intervention. | Keep the original thresholds and campaign mapping. Do not introduce a new Studio feature to rescue weak demand. |
| 6 | Close the reporting window. Review counts, participant feedback, repeat behavior, effort, and concentration. | Continue, revise, or stop each engine separately. Record unsupported and unverified metrics beside the decision. |

The following pass marks are proposals. You must ratify them before the first reading.
They replace no existing business gate silently. Record the decision beside `STRATEGY.md` §4.

| Engine | Proposed learning gate | Failure response |
| --- | --- | --- |
| Creator audience | Both creators distribute twice; at least one repeat is unprompted; at least five distinct outside-team organizers activate. | Diagnose posting, traffic quality, content relevance, and sign-in separately. Do not build more creator tools from reach alone. |
| Business partner | Both partners reach two customer cohorts; at least five outside-team organizers activate; effort is recorded completely. | Check whether distribution repeats and whether manual guide work fits the recorded budget. Do not describe relationship work as free acquisition. |
| Group planning | Three genuine groups form; at least two have a non-owner persisted proposal; observe whether any participant becomes an organizer. | Distinguish invite friction from weak shared planning value. Zero observed expansion leaves the hypothesis unproven. |

Proposed operating cap: 24 founder hours across six weeks, with zero cash incentives.
Allocate six hours to creator route preparation and six hours to partner guides.
Allocate six hours to outreach, three hours to observation and support, and three hours to reporting.
Record overruns. Pause new work at the total cap, unless you explicitly ratify a new experiment.
These are proposed research limits, not authorization to contact participants or spend money.
Do not change a threshold after seeing a result. Version a new experiment instead.
Small samples support learning, not statistical superiority or a causal channel comparison.
Route quality, creator audiences, season, partner customers, and trip timing differ between these cohorts.

Keep SEO visible in later planning. Record search traffic as unattributed when the existing logs cannot identify it.
Build no bulk destination pages, marketplace operations, booking system, or complete Creator Studio for this pilot.

## Weekly operating ledger

Keep the ledger in an access-controlled location outside public app analytics.
Use symbolic participant slots in the scorecard and any repository report.

```text
week_utc_start, week_utc_end, campaign_code, public_publication_id,
engine, external_channel, distribution_action_number,
distribution_confirmed, reminder_required, customer_cohort_number,
preparation_minutes, outreach_minutes, support_minutes, reporting_minutes,
cash_cost_inr, incentive_cost_inr, report_status
```

Store consented interview notes and participant contacts separately.
Do not place identities or private planning contents in this ledger template's public exports.
Keep missing reports distinct from zero results.
Record the scorecard bounds and code revision beside each weekly aggregate.
Publish only aggregate learning after checking that small cells cannot identify private participant behavior.
