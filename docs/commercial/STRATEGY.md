# YatraFlow — Strategy

**Date:** 2026-10-12 · **Baseline:** `origin/test` = `23e7c8f` (v0.74.0 plus 71 unreleased commits) · **Revenue:** ₹699, one buyer account

This is the **one strategy page**. It replaces the position, sequencing and targets in the
older commercial docs. Where an older doc disagrees with this page, this page wins. The older
docs stay as reference for the detail they hold:

| Doc | What you still read it for |
| --- | --- |
| [`PLAN-MONETISATION.md`](PLAN-MONETISATION.md) | Fee arithmetic, tax branches, the M7 schema, failure modes |
| [`STEP-0-DECISIONS.md`](STEP-0-DECISIONS.md) | The ratified fee (15% → 10% tiered) and the open decisions D2, D3, D5 |
| [`REFUNDS.md`](REFUNDS.md) | The refund rules that the code follows |
| [`RESEARCH-2026-09-18-creator-market-and-paywall-value.md`](RESEARCH-2026-09-18-creator-market-and-paywall-value.md) | Why travellers buy a plan |
| [`REPORT-2026-09-15-strategy-and-position.md`](REPORT-2026-09-15-strategy-and-position.md) | Historical. Its 30% fee and ₹149 price are superseded |
| [`PLAN-LAUNCH-AND-DISTRIBUTION.md`](PLAN-LAUNCH-AND-DISTRIBUTION.md) | Historical. §4 below replaces its sequence |
| [`PLAN-COMMERCIAL-EXECUTION.md`](PLAN-COMMERCIAL-EXECUTION.md) | Historical. §4 below replaces its queues |

Every number here has a source. Re-derive a number before you quote it. The probes are in §7.

## 1. Where we stand

The product is built far ahead of its demand. The gap is not features. It is time spent on
users.

| Signal | Reading (2026-10-12) | Source |
| --- | --- | --- |
| Build rate | 815 non-merge commits and 272 merged PRs in 30 days | `git log origin/test` |
| Where the commits went | 41% fixes, 24% docs, 18% features, 6% payments | commit prefixes |
| Accounts | 37 total. Signups per week: 11, 11, 2, 3, 1 | live database |
| Active accounts | 4 signed in during the last 7 days | live database |
| Trips | 114. The top five owners hold 72 | live database |
| Group trips | 3 of 114 trips have more than one member | live database |
| Marketplace | 3 published plans, 2 creators, 12 views in 30 days | live database |
| Revenue | ₹699 from one buyer account | live database |

The older plan set this order: fix the share, measure the funnel, prove demand, then build the
payment rail. The rail shipped first. No weekly funnel reading exists. The first distribution
step, one link sent to one WhatsApp group, has no record.

The agents make code cheap. The scarce resource is founder time. Each merged PR costs review
time, and that time does not go to travellers.

## 2. The market has moved

- Free AI planning is everywhere in India. MakeMyTrip's Myra books trips from a chat. Ask Maps
  (Gemini in Google Maps) runs in India and speaks Hindi. ixigo books inside ChatGPT. Expedia
  bought Layla on 2026-07-31.
- "AI trip planner" is therefore not a position we can win.
- AI planners fail on logistics. In one test, nine of ten AI itineraries had an error. Half sent
  people to a place that was closed. Drive times, halts and pacing are their known weak spots.
- Demand is real. Self-drive trips grow, India has about 12 long weekends a year, and Char Dham
  passed 56 lakh pilgrims this season.
- Creators already have cheap rails. Topmate takes 10% on a creator's own link. MakeMyTrip and
  Cleartrip pay creators per confirmed booking.

Sources for this section are in the session research of 2026-10-12. Re-check a figure before
you put it in public copy.

## 3. Position

> **The road-trip plan your whole group can actually drive.**

YatraFlow is a logistics and coordination product. It is not an AI product and not a content
store. The rivals are a WhatsApp thread full of links and a chatbot plan that ignores the road.

What we own, and what we must keep true:

1. **A real travel clock.** Drive times, night halts at real towns, fuel halts, and a router
   that refuses to fake a route.
2. **One plan for the whole crew.** Everyone edits the same plan, and it works offline on the
   road.
3. **A plan you can take, not a PDF.** A shared plan forks into your own trip, with your dates
   and your crew.

Who we serve first: **groups of three to eight friends or family who drive a two- to five-day
trip from a metro.** Long weekends set the calendar. Pilgrimage circuits and rider groups are
the next wedges. Do not open them until the first wedge passes its gate.

## 4. The next six weeks

### Week 0 — close the risks

You must finish these before you drive any traffic.

| Item | Why |
| --- | --- |
| Confirm the live checks of P0 #689 | The issue is closed. Prove on the live project that no `masteradmin` account keeps a public password, and that no fixture page stays in the sitemap or in Explore (#672). |
| Fix the create-funnel events | The live table holds no `started` row. We cannot measure a broken funnel. |
| Decide the router | The public OSRM demo server forbids commercial use (STEP-0 D6). Self-host it or pay for one. |

### Weeks 1–6 — feature freeze, distribution sprint

1. **Freeze features.** The agents work only on problems that a real user hit or that the
   funnel shows. Polish, consistency ratchets and the UI audit wait.
2. **Run three real group trips** (#233). Use real groups of four or more. Diwali week is the
   first window. Write down where each crew stalls.
3. **Put the crew first.** Ask "Who is coming?" in the first step, with a WhatsApp invite. Today
   111 of 114 trips stay solo, so the invite step does not fire.
4. **Publish 15–20 corridor plans that we drove or checked.** For example: Delhi → Rishikesh,
   Mumbai → Goa coast, Bengaluru → Coorg, the Spiti loop, the Char Dham circuit. Label them as
   written by the YatraFlow team. Each one is a share page, a search page and a demo.
5. **Recruit ten small travel creators** (10k to 100k followers). Offer one thing: a free "fork
   my route" link for their bio. Count the forks.
6. **Read the funnel every week** and write the reading into the release log.

### The one metric

**Weekly crew trips:** trips with two or more members that a person we do not know edited in
the week. A solo trip by the founder does not count.

### The gate at week 6

Write these numbers down before week 1 starts. Do not change them after the first reading.

| Measure | Pass mark |
| --- | --- |
| Trips owned by people we do not know | 40 or more |
| Share of those trips with a second member | 30% or more |
| Owners who return in week 4 | 20% or more |

**If the gate passes:** turn on the paid fork and the affiliate test (§5), then pitch one
rental company.

**If the gate fails:** find the step that stalls, the crew invite or the share. Fix that one
step, or test the next wedge. Do not build new features to fix a demand problem.

## 5. How we make money, in order

1. **Now: no revenue target.** At ₹25.30 net per unlock, ₹5 lakh a month needs about 19,800
   unlocks a month. That needs millions of views. Used group trips come first.
2. **After the gate: the paid fork.** A buyer pays to fork a whole plan, paid days included,
   into their own trip. This settles the open question between `PLAN-MONETISATION.md` §2 and the
   research doc. Creators are a distribution channel, not stock for a store.
3. **After the gate: booking affiliates.** The planner already knows where the group sleeps and
   when it arrives. A "beds in this town tonight" link helps at that moment. We do not become a
   travel agent.
4. **Later: rental partners.** Self-drive rental firms (Zoomcar, Revv, Myles) earn more when
   trips run longer. A good plan makes trips longer. Zoomcar already embeds a third-party
   planner. Pitch this only with the gate's numbers in hand.
5. **Paused: the AI subscription.** Free AI planners set the price of AI at zero. Revisit only if
   users ask for the companion.

Before the first real sale, three decisions must close: the merchant-of-record branch with a
CA (STEP-0 D3, #234), payouts and KYC (I-14), and the customer refund wording. Ask the CA to
confirm the s.194-O TDS rate. We believe it fell from 1% to 0.1% in October 2024. That would move
the fee floor in `PLAN-MONETISATION.md` from about 3.86% to about 2.96%. This is unverified.

## 6. What we stop doing

- Releases that only polish. A release must answer a user problem or a funnel reading.
- More process than the work needs. A new ratchet, baseline or rule needs a failure behind it.
- New commercial machinery before the gate. Reconciliation, subscriptions and creator levels
  wait.
- Docs that restate numbers. Link to the probe in §7 instead.

## 7. How to re-derive this page

```bash
git log origin/test --since="30 days ago" --no-merges --oneline | wc -l   # build rate
gh issue list --state open --json number,title,labels \
  --jq '.[] | select(any(.labels[]; .name | endswith("P0"))) | "\(.number) \(.title)"'   # open P0s
git rev-list --left-right --count origin/main...origin/test               # branch drift
```

Run these as read-only SQL in the Supabase SQL editor:

```sql
select count(*) from auth.users;                                     -- accounts
select count(*) filter (where last_sign_in_at > now() - interval '7 days') from auth.users;
select count(*) from (select trip_id from public.trip_members
  group by trip_id having count(distinct user_id) > 1) t;            -- group trips
select status, count(*), sum(amount_inr) from public.purchase_orders group by status;
```

Review this page at the week-6 gate. Update §1 with the new readings and record the gate
result in §4.
