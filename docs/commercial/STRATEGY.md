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

**Distribution revision, 2026-10-15:** the [measurement audit](DISTRIBUTION-MEASUREMENT-AUDIT.md) records the revised three-engine hypothesis.
The [pilot specification](DISTRIBUTION-PILOT.md) separates creator audiences, group planning, and travel-business partners.
Its proposed gates need ratification before traffic starts. They differ from the earlier creator-only gates below.
Local Experts without audiences need a distribution partner. Their expertise alone does not establish customer demand.
This revision does not approve Studio construction, paid acquisition, or new commercial terms.

The [creator portfolio brainstorm](BRAINSTORM-2026-10-12-creator-portfolio.md) records source limits and proposals. `ROADMAP.md` remains the plan of record.

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

### Creator evidence (checked on the source page, 2026-10-12)

| Figure | Why it matters | Source |
| --- | --- | --- |
| 4.12M Indian creators in 2025, up from 0.96M in 2020. 66% are outside the metros. | The supply of creators is large and spread across the country. | ISB–Hashfame report, 2026-07-14 |
| Over 2–2.5M monetised content creators in India. | Many creators already sell something. A better way to earn is a direct draw. | BCG, 2025-05-03 |
| Topmate takes 10% on a creator's own link and 20% on its marketplace. | Our split fee (§5) matches the market norm. | topmate.io pricing page |
| Gumroad takes 10% + $0.50 on a direct sale and 30% on its marketplace. | 10% is the norm for a creator's own buyers. | gumroad.com pricing page |
| Cleartrip's creators get a "TRIP" comment that sends a booking link by DM. No follower minimum. | An Indian OTA already runs the comment-to-plan flow. We compete on the plan, not on payouts. | Cleartrip, 2026-06-24 |
| MakeMyTrip's creator programme pays on engagement and states no follower minimum. | The OTAs court small creators too. | Skift, 2026-06-03 |
| Instagram allows one private reply per comment, within seven days. | A "comment ROUTE" flow must fit that limit. | Meta Private Replies docs |
| Carousels earn the most saves on Instagram. | The snapshot tool needs a day-by-day carousel. | Socialinsider, 2026-02-20 |
| Polarsteps reached 20M users, up from 15M in July 2025. | Travellers share trip maps. | Polarsteps, 2026-03-27 |

**Not measured yet:** how often followers ask creators for an itinerary. Only vendors of
comment-to-DM tools claim it. The ten creator interviews in §4 measure it.

## 3. Position

> **The road-trip plan your whole group can actually drive.**

YatraFlow is a logistics and coordination product. It is not an AI product. The rivals are a
WhatsApp thread full of links and a chatbot plan that ignores the road.

What we own, and what we must keep true:

1. **A real travel clock.** Drive times, night halts at real towns, fuel halts, and a router
   that refuses to fake a route.
2. **One plan for the whole crew.** Everyone edits the same plan, and it works offline on the
   road.
3. **A plan you can take, not a PDF.** A shared plan forks into your own trip, with your dates
   and your crew.

### Who we serve first: creators, then their crews

**The first customer is the small Indian travel creator** (10k to 100k followers). The creator
is a customer and the distribution at the same time. Each creator brings an audience, so the
tool works for them on day one, with no other users on the platform.

**Groups of three to eight who drive a two- to five-day trip** are the proof that the product
works. They arrive through creator routes, and each one invites a crew.

The loop:

> A creator's route → followers fork it → each follower invites a crew → a group trip → new
> followers find the creator.

We build a **creator tool**, not a creator marketplace. In a tool, the creator brings the
buyers. In a marketplace, we must bring buyers and sellers at the same time. Explore stays a
shelf until creator traffic gives it buyers.

What the tool gives a creator:

1. **One link that answers "itinerary please?"** This is the most common comment under an
   Indian travel Reel.
2. **A plan that stays useful.** A Reel fades in two days. A YatraFlow plan keeps real drive
   times, and followers fork it with their own dates and crew.
3. **A portfolio.** One creator page with a map of every trip, bio-ready stats (km driven, states
   covered, nights on the road), trips by season, and a short handle. Its media-kit section shows
   brands the forks, the demand by month and where the audience plans to go.
4. **Content tools.** Assets that make the creator's posts better, each with a link back to the
   plan (§4).
5. **Income from more than one source.** Paid forks first. A share of stay and rental links
   later. Brand placements after that.

Pilgrimage circuits and rider groups are the next wedges. Do not open them until the first
wedge passes its gate.

## 4. The next six weeks

### Week 0 — close the risks

You must finish these before you drive any traffic.

| Item | Why |
| --- | --- |
| Confirm the live checks of P0 #689 | The issue is closed. Prove on the live project that no `masteradmin` account keeps a public password, and that no fixture page stays in the sitemap or in Explore (#672). |
| Fix the create-funnel events | The live table holds no `started` row. We cannot measure a broken funnel. |
| Decide the router | The public OSRM demo server forbids commercial use (STEP-0 D6). Self-host it or pay for one. |
| Build creator payouts | The earnings tab shows a schedule, but no payouts table, KYC or transfer exists (I-14). A creator must be able to take money out before we sell them a way to earn it. |
| Close the merchant-of-record decision | A real creator sale needs the CA's answer first (STEP-0 D3, #234). |

### Weeks 1–6 — feature freeze, creator sprint

1. **Freeze features.** The agents work only on the creator track below, on problems that a
   real user hit, or on what the funnel shows. Polish, consistency ratchets and the UI audit
   wait.
2. **Talk to ten creators** (10k to 100k followers). Ask one question: "What do you do when
   people ask for your itinerary?" Write down the answers word for word.
3. **Serve five creators by hand.** Build their plans for them from content they already have:
   a Reel caption, a YouTube description, a doc. Point the import pipeline at these sources.
   Give each creator a portfolio page, a snapshot set and one hand-made route clip.
4. **Count what they post.** Give each asset a link with its own share source (#230), so the
   funnel shows which format brings forks.
5. **Run three real group trips** (#233). Use real groups of four or more. Diwali week is the
   first window. Write down where each crew stalls.
6. **Put the crew first.** Ask "Who is coming?" in the first step, with a WhatsApp invite. Today
   111 of 114 trips stay solo, so the invite step does not fire.
7. **Read the funnel every week** and write the reading into the release log.

### Content tools, in build order

Do each by hand for the five creators first. Build the tool only for the format they post.

| Tool | What it is | Cost | When |
| --- | --- | --- | --- |
| **Creator portfolio** | Trip map, bio stats, trips by season, short handle, media kit. The creator page (`/c/:id`) already exists. | Low | Build in the sprint |
| **Branded route snapshot** | The route, halts and drive times in the creator's logo, colours and handle. A QR code and a short link back to the plan. Formats: 9:16 Story, 4:5 post, and a carousel with one slide per day. | Low to medium | Build in the sprint if creators post the hand-made ones |
| **Animated route clip** | The camera flies along the route, day by day, as a 9:16 MP4. Browsers record WebM, and Instagram wants MP4, so a server render is likely. | High | After the gate |

Two rules apply to every export:

- **Keep the map credit.** Every image and clip carries the OpenStreetMap and OpenFreeMap
  credit.
- **Keep Google content out.** Google's terms limit the use of Places photos and details away
  from a Google map. Exports use only our route data and the open basemap.

The free version always carries the YatraFlow link. That link is the distribution. Creator
Pro restyles the link to match the creator's brand. It never removes the link.

### The two metrics

- **Weekly creator posts:** posts by creators that link to a YatraFlow plan.
- **Weekly crew trips:** trips with two or more members that a person we do not know edited in
  the week. A solo trip by the founder does not count.

### The gate at week 6

Write these numbers down before week 1 starts. Do not change them after the first reading.

| Track | Measure | Pass mark |
| --- | --- | --- |
| Creators | Creators who post a YatraFlow link with no prompt | 5 or more |
| Creators | Plan views from creator links | 1,000 or more |
| Creators | Creators who earn money and receive a payout | 1 or more |
| Crews | Trips owned by people we do not know | 40 or more |
| Crews | Share of those trips with a second member | 30% or more |
| Crews | Owners who return in week 4 | 20% or more |

These pass marks are assumptions. Set the final numbers before the first reading.

**If the gate passes:** build the content tool that creators post most. Turn on the affiliate
test (§5). Then pitch one rental company.

**If the creator track fails:** find out why creators did not post. The cause is the asset, the
plan or the payout. Fix that one thing. Do not build new tools to fix a demand problem.

**If the crew track fails:** find the step that stalls, the crew invite or the share. Fix that
one step, or test the next wedge.

## 5. How we make money, in order

The rule: **we earn when the creator earns, and we charge a creator only after the creator
earns.**

1. **Now: no revenue target.** At ₹25.30 net per unlock, ₹5 lakh a month needs about 19,800
   unlocks a month. That needs millions of views. Creator posts and used group trips come first.
2. **Now: the paid fork, with a split fee.** A buyer pays to fork a whole plan, paid days
   included, into their own trip. This settles the open question between
   `PLAN-MONETISATION.md` §2 and the research doc. The fee depends on who brought the buyer:
   about 10% when the creator's own link brought the buyer, and about 15–20% when Explore did.
   The low rate matches Topmate on the creator's own traffic. Share attribution (#230) already
   tells the two apart. This changes the flat ladder in STEP-0 D1, so ratify it there before the
   first real sale.
3. **After the gate: booking affiliates, shared with the creator.** The planner already knows
   where the group sleeps and when it arrives. A "beds in this town tonight" link helps at that
   moment. On a creator's plan, we split the commission with the creator. We do not become a
   travel agent.
4. **After the gate: Creator Pro.** Demand insights, brand styling on every export, the animated
   clip, and import of many trips at once. About ₹299–499 a month. That price is an assumption.
   Offer it only to creators who already earn.
5. **Later: brand and partner deals.** States, stays and self-drive rental firms (Zoomcar, Revv,
   Myles) pay to reach a creator's route audience. Rental firms earn more when trips run
   longer, and a good plan makes trips longer. Pitch this only with the gate's numbers in hand.
6. **Paused: the AI subscription.** Free AI planners set the price of AI at zero. Revisit only if
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
