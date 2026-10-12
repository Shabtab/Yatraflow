# YatraFlow — Launch plan: from built to shared

> ⚠️ **HISTORICAL (2026-10-12).** [`STRATEGY.md`](STRATEGY.md) replaces this doc's position, sequence and targets. Read this doc for its detail only.

**Date:** 2026-09-15 · **Product:** `v0.54.0` · **Method:** live deployment loaded in a real
browser (Chrome via playwright), plus `src/` read directly. Screenshots:
`landing-live-2026-09-15.png` and `explore-live-2026-09-15.png` (same folder).

---

## The verdict: you are already past "working/usable"

That part of the ask is done, and it is worth saying plainly before planning anything else.

| Checked | Result |
|---|---|
| Live site loads | HTTP 200 **[MEASURED]** |
| Console on the landing page | **0 messages — 0 errors, 0 warnings** **[MEASURED]** |
| Landing page | Hero, real product screenshot, "Price a trip in 10 seconds · no signup" widget, trip-code join box **[MEASURED — screenshot]** |
| Public itinerary page, logged out | **"Save itinerary" (browser-only) works anonymously; "Fork this trip" is shown but is a login gate** — `forkPublication` redirects to `/auth` when there is no session **[MEASURED — `forkPub.ts`]** |
| Anonymous fork path | **Login-gated.** `forkPublication` accepts a null user only so it can redirect to `/auth` — it does not fork anonymously **[MEASURED — corrected 2026-09-15]** |
| Providers | Keyless — MapLibre/OpenFreeMap, Open-Meteo, OSRM demo **[MEASURED]** |
| Console errors on Explore | 2 — both Wikipedia 404s for place names with no article. Benign, expected in a fallback chain **[MEASURED]** |

**The viral loop is complete in code.** Share a link → view anonymously → save it without an
account → click fork (which gates on login and creates the account) → invite your crew. Every
step exists; the fork step is a login gate rather than an anonymous action, which is a normal
design but adds a drop-off point worth measuring.

So the blockers are not engineering. They are two things, and neither is a feature.

---

## The four blockers, in leverage order

| # | Blocker | Effort | Why it's in this position |
|---|---|---|---|
| 1 | **A shared link previews as nothing** | ~1 day | Multiplies everything below it. Currently a share is a bare URL. |
| 2 | **The gallery is empty** | ~2–3 weeks | The real work, and the reason a visitor would stay. |
| 3 | **No measurement** | ~half a day | Without it you cannot tell whether a share worked. |
| 4 | Nothing else | — | See "what not to do" below. |

### 1. A shared link previews as nothing

Measured, not inferred:

- **No Open Graph tags anywhere** — no `og:title`, `og:description`, `og:image`, `twitter:card` **[MEASURED]**
- **`document.title` is never set dynamically** — every page in the app carries the same static title **[MEASURED]**
- **Hash routing** (`location.hash` / `hashchange`, `App.tsx`) — so the server serves the same `/` document for every route, and a link-preview fetcher cannot tell one itinerary from another **[MEASURED]**

**Paste a YatraFlow itinerary into WhatsApp today and you get a bare blue URL.** No title, no
description, no image. WhatsApp is the exact channel this product is positioned against — the
README's own framing is *"Plan Indian trips together — not in a chaotic group chat."* The app
can generate the link (`navigator.share` in `native.ts`); the link carries nothing.

### 2. The gallery is empty

`#/explore` contains **one** itinerary:

> **Spiti Valley Circuit — Shimla in, Manali out (copy)**
> 10 days · ₹15,000/person · 7 places · Shimla → Manali
> Why featured: 2 forks · 3 views · by `Has9.🎓`

That is a duplicate from the publish path, with a mangled author name, and it is the entire
public supply. The page's own hero reads *"Real multi-day plans from travellers who actually
went"* — a claim one copied test trip cannot support.

Driving traffic here today spends the one first impression you get, on a shop with one item in
the window.

### 3. No measurement

`computeFunnel()` in `src/lib/adminStats.ts` **already computes** activation, collaboration,
publication and **view→copy** percentages **[MEASURED]**. The numbers exist. Nobody is keeping
them. You cannot currently answer "did that share produce anything?"

---

## Phase 1 — Make the link worth clicking · ~1 day · do this first

Everything else is multiplied by whether the link previews.

**1.1 Add default Open Graph metadata to `index.html`.** Title, description, image, `twitter:card`.
This fixes shares of the root URL immediately and costs nothing.

**1.2 Add a shareable path route for public itineraries — `/i/:id`.** Keep hash routing inside
the app; add a small Vercel serverless function that:

- reads the publication row for `:id`
- returns minimal HTML with `og:title`, `og:description` and `og:image` for **that** itinerary
- boots the existing SPA on top of it

This is the piece hash routing cannot give you: the fragment is never sent to the server, so
per-itinerary previews are impossible without a real path. It is additive — no router rewrite,
no risk to the working app.

**1.3 Generate the preview image.** Start with one good static card; make it per-itinerary
(title + route + ₹/person) once the route works. The cost number is the hook — "Leh–Ladakh, 10
days, ₹5,408/person" is a better preview than any logo.

**1.4 Set `document.title` on route change.** Two lines. Fixes browser tabs, history, and every
future bookmark.

**1.5 Clean the shelf.** Unpublish the `(copy)` rows — `dedupePublished()`, the unpublish owner
gate and the stale-page nudge all ship already **[MEASURED]**. Fix the author display name
(`Has9.🎓`).

---

## Phase 2 — Build the shelf · ~2–3 weeks · the real work

**Target: 20 published itineraries**, so that every style filter returns at least three and
Explore never looks abandoned. Publishing is already built; this is editorial work, and it is
the founder's job because it *is* the product's differentiator.

Each itinerary needs: a real route with real stops, costs from the engine, a two-line "why this
trip", and a cover image. Priority routes, because these are what people actually search:
Leh–Ladakh · Spiti · Goa · Kerala · Rajasthan · Meghalaya · Coorg · Rann of Kutch · Hampi · Andamans.

Build them **in the app**. It is also the most efficient way to find the bugs that only appear
on real trips.

**One constraint, and it is not optional.** The gallery hero claims *"from travellers who
actually went"*. Either those trips happened, or the copy changes. This is the project's own
rule — the README says *"No fake live traffic or prices — ever"* — and the published gallery is
the most visible place it could be broken.

---

## Phase 3 — Instrument · ~half a day

**3.1 Record the funnel weekly.** `computeFunnel()` already returns the numbers; put them in the
admin console and write them down. Baseline before you drive traffic, or you will have no
before-and-after.

**3.2 Add share attribution.** Append a reference to share links (the invite-code machinery
already exists) so a fork can be traced to the share that produced it.

**3.3 Track exactly four things:** shares → views → forks → signups. Nothing else matters at
launch. Ignore DAU, MAU and session duration until this funnel is non-zero.

---

## Phase 4 — The first distribution loop

**The share unit is the public itinerary page, not the app.** Nobody shares a tool; they share a
trip. So the loop is: a good itinerary → a previewed link → an anonymous visitor who sees real
costs → fork → invite the crew.

> **Once unlocks are live (M7):** the loop gains a second share unit — the
> **purchase share card** ("I bought the Spiti plan", I-21): buyers posting their own purchase
> are the highest-trust artifact this loop can circulate. The buyer-side pitch that makes the
> purchase postable in the first place (time saved, mistakes avoided, the "structure you can
> edit" positioning) is researched with citations in
> `RESEARCH-2026-09-18-creator-market-and-paywall-value.md` §1/§4.

Channels, in order of effort — and stop when one works:

1. **Your own trips, with real people.** Build a trip with four or five friends in the app. It
   costs nothing, it produces the first published itineraries, and it is the only channel where
   you watch someone use the product. Target: five real trips with 4+ people each.
2. **Reddit** — `r/IndiaTravel`, `r/india_travel`, `r/roadtrip`. Post the **itinerary**, not the
   app: *"Spiti in 10 days — the route, the fuel cost, and where we stayed."* Link the public
   page. The honest-numbers angle is the hook, and it is the one thing a competitor cannot
   copy. One route per post, spaced out.
3. **Route-specific communities** — Leh/Spiti/Meghalaya rider groups, Facebook groups, Telegram.
   Same play, warmer audience.
4. **SEO — later, not now.** Each published itinerary is a page that can rank for *"Delhi to
   Spiti itinerary"* or *"Goa 4-day trip cost"*. It needs Phase 1.2 (a real path) to be
   indexable at all. Do not start here; start it once there are 20 itineraries.
5. **Product Hunt / Hacker News** — later, and only with a real angle: the engineering rigour and
   the "we tell you when we don't know the road" rule. Launching these into an empty gallery
   wastes them permanently.

**Do not run paid acquisition.** You cannot compute a CAC and you have no conversion baseline,
so you would be buying data you can get free in Phase 4.

---

## Phase 5 — The gate: decide the thresholds before you start

Write these down now, so the result cannot be reinterpreted later.

| Signal | If it fails, the problem is |
|---|---|
| Shares → views | The share unit, or the preview |
| Views → forks | The itinerary content, or the anonymous CTA |
| Forks → signups | The signup step |
| Signups → a second session | **The product** — go back to M6, not to marketing |

That last row is the one to hold yourself to. If people sign up and never come back, no amount of
distribution fixes it, and the honest move is to stop distributing.

---

## What NOT to do next

- **Don't build M7 (payments).** There is no one to charge. It stays behind the gate in the report.
- **Don't do Hindi/i18n yet.** It is a distribution unlock for a channel you have not opened.
  Worth doing once one channel works.
- **Don't launch on Product Hunt into an empty gallery.**
- **Don't fix the "seed guard".** It is already implemented — `tripCountUnknown` at
  `store.ts:630`, issue `#94`. My earlier report called it an open blocker; that came from the
  roadmap's prose, and the code disproves it. Corrected in `REPORT-2026-09-15-strategy-and-position.md` (same folder) §2.5.
- **Don't chase the marketplace.** It is Stage 4 and it needs field operations.

---

## Week one

| # | Task | Why now |
|---|---|---|
| 1 | Default OG tags in `index.html` | Cheapest fix, immediate effect on every share |
| 2 | `/i/:id` preview route + one preview image | Makes an itinerary shareable |
| 3 | `document.title` on route change | Two lines |
| 4 | Unpublish the `(copy)` rows; fix the author name | Explore stops looking broken |
| 5 | Record the `computeFunnel()` baseline | Before you drive any traffic |
| 6 | Publish 3 itineraries from real trips you have taken | Starts the shelf |
| 7 | Send one of those links to a WhatsApp group you are already in | The first honest test of the loop |

Task 7 is the real milestone. If the preview shows up and someone forks it, the loop works and
everything after this is volume. If it does not, you have learned the most important thing
available this week, for the price of one message.
