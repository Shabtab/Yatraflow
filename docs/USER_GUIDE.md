# YatraFlow User Guide

Everything you need to plan a trip with your group. ⏱ ~5 minutes to learn.

---

## 1. Log in

Open [YatraFlow](https://www.yatraflow.in). Either:

- **Create an account** (name + email + password — 8+ characters), or
- **Log in** if you already have one. Your session survives reloads and follows you across devices.

New accounts get a fully-modelled **Kerala demo trip** on first login — open it to see stops, votes, budgets and warnings in action. You can also pull it in anytime with the **🚀 Load demo trips** button on My Trips.

> Your data lives in Supabase and is protected by row-level security: only you (and people you invite, per their role) can see your trips.

## 2. Create a trip

**Plan a new trip** from the nav:

1. **Name** it ("Kerala monsoon escape").
2. **Starting location** — start typing ("Koch…") and pick a real place from the dropdown. Use ↑/↓ + Enter if you prefer the keyboard.
3. **Destinations** — search and add each stop in visit order. Reorder with the ↑/↓ arrows on each chip; ✕ removes one.
4. **Dates** — pick start and end; the app tells you how many days you're planning.
5. **Crew & budget** — traveller count and per-person budget in ₹.
6. **Transport mode & travel style** — these change how travel time and cost are estimated (a motorcycle trip at 44 km/h ≠ a bus trip at 34 km/h).
7. *(Optional)* **Fixed commitments** — hotel check-ins, train/flight departures, events with day + time. The planner protects these when warning about tight schedules.

## 3. Build the timeline

Inside a trip, open the **Timeline** tab:

- **Add stops** to any day: name, category, location (searchable — Google Places when configured, otherwise the keyless Mappls/OSM/Wikipedia stack), duration, opening hours, entry fee, transport cost, priority.
- **Context-aware opening hours** — Opens at / Closes at appear only when they're relevant (a geocoded attraction, or categories like temple/museum/food/hotel), and clear themselves for a whole city or town.
- **Stoppage-point suggestions** — the Map tab and empty days suggest attractions, restaurants, cafés, hotels, fuel pumps and ATMs near your route (live OpenStreetMap, Wikipedia and Mappls data; pins only at verified coordinates). "Add" opens a pick-a-day dialog — choose the day and confirm **Add to timeline**.
- **Leg-aware travel panel** — once you pick a geocoded place, a "🚗 Travel to this stop" panel appears showing where you're coming from and where you're headed next. It auto-fills the road distance, travel time and fuel/fare cost, and computes your **arrival time** from the **departure time** (default 08:30). Every value stays editable — arrows step by 1 minute.
- **Read the time rail** — each stop shows its scheduled **arrival** and **departure** in the left gutter, with dashed connectors for travel legs between stops.
- **Drag stops anywhere** — reorder within a day, or drag a stop onto another day: drop it on a card to insert before it, into a gap between stops, or at the day's end. Every move shows its impact before saving.
- **Day tools** — click a day title to rename it; ▾ collapses the day; the thin progress bar shows how full the day is (green → saffron → red as warnings appear); ⧉ Copy duplicates the day onto the next; empty days suggest "Continue to…" and nearby places.
- **Reorder** stops within a day or **move them between days** — every change re-runs the schedule simulation instantly.
- **Mark statuses:** `suggested` → `confirmed` / `needs-booking` / `rejected`. Rejected stops drop off the map and out of estimates.
- Watch the **health signals**: warnings appear when a day is overstuffed, a stop would arrive after closing time, or a fixed commitment gets squeezed.

## 4. Read the map

The **Map** tab shows your whole route:

- Each day gets its own colour; pins are numbered in visiting order.
- Click a pin to open that stop's details.
- Use the day filter chips to focus on one day.
- Routes follow real roads (OSRM road geometry) — great for shape and distance honesty, still not turn-by-turn navigation; if the road service can't be reached the tab says so and draws straight-line estimates.

### The travel clock (long drives, planned for you)

YatraFlow plans long drives by the **clock, not just kilometres**: it knows the human
facts — meals happen at mealtimes wherever the road is, ~2 hours behind the wheel is
time for a stretch, dinner ends the driving day, and nobody should drive past 23:00.

- **The route asks for its own days.** A 700 km drive suggests "this needs 2 travel
  days — apply?", balanced so no single day is brutal. Keeping your own day count is
  fine — the plan says honestly that the fatigue verdict stays red.
- **Night halts are honest km first, real towns next.** The engine marks where each
  driving day should end on the clock; the map strip pins nearby stay options to
  that point — accept one and the bill gains the stay line automatically.
  (Lodging-anchored halt placement itself is P1-C, still open.)
- **Late starts get honest plans, not night driving.** Start too late and the map
  offers a short hop to a night halt — or, if it's really late, suggests leaving at
  06:00 tomorrow instead.
- **Short trips are never ignored.** Even 80 km of hill crawl earns a stretch
  suggestion, and below the planning floor the strip still shows what's along the way.
- **The bill includes the bed.** Hotel stops are priced on the Budget tab
  (bases × rooms × rate), with the formula shown right on the page.

## 5. Collaborate

### Invite
**Share tab → copy invite link.** Friends who open it join your trip (you control whether they can edit or just comment).

### Suggest & decide — one stream
The **Group input** tab is where the group talks plans. One stream holds both **stop ideas** and **decisions**, with filter pills (All / Stop ideas / Decisions / Need you / Resolved) and clickable count chips up top.

- **Propose a stop** from the composer: name it, pick the **day** and **category**, search the area, set visit time, entry fee and transport cost, and say why it's worth it. The group votes ▲/▼ and comments right on the card; editors accept it into the timeline or decline it.
- **Raise a decision** ("Beach day or backwater day?") with two or more options, optional context ("forecast says rain"), and an optional ₹ impact per option. Everyone votes.
- **Cards that need you float up.** Anything you haven't voted on gets an amber edge, a "Needs your vote" chip, and a slot in the sidebar digest — click a digest row to jump to the card.
- **Decisions show who voted what.** Each option lists its voters, a tally chip and its ₹ impact; the leading option is tinted and a verdict line says where the tally leans. Editors resolve with the final say.
- Only two things ping your bell: a new question for the group, and its resolution. Individual votes live in the activity feed, not your notifications.

## 6. Watch the budget

The **Budget tab** opens with four tiles — **per person** (vs target), **per day**, **remaining vs target**, **% spent** — so over/under is one glance away.

- **Cost per day** bars show each day's expenses plus that day's drive, with a tick marking the daily average; a day running hot turns amber with a trim suggestion.
- **Where the money goes** breaks the total into categories (stay, food, transport, …) with icons.
- **Add an expense in one row** at the very top of the tab: name + amount, with the ⋯ toggle for category, who paid, per-person/optional flags and attaching it to a stop. Pencil-edit any line in place — no delete-and-retype.
- **Who paid · who owes**: expenses can carry a payer; the card compares what each member fronted against their fair share and spells out the simplest settlements ("Riya → Meera ₹3,131"). It appears on any trip with 2+ travellers and walks you through inviting the crew and tagging payers until there's something to settle.
- **Essential vs optional** shows what you could trim if you need to save.

## 7. Ask the companion

The **AI drawer** answers questions grounded in *your actual trip data*: "Make Day 2 less tiring", "Can we still make the airport if we add this?", "What should we cut with kids along?" Every answer cites the assumptions behind its numbers. The offline brain is rule-based and never invents facts; connect your own OpenAI-compatible endpoint in Profile and it answers through that instead, badged so you always know which brain answered. The drawer is rolling out as a premium perk, so it may not be visible in your app yet.

## 8. Publish, explore & grow an audience

Proud of a route? **Share tab → publish** puts it in the public **Explore** gallery with a tagline, best season and tips. You choose which days preview free — the rest stay locked at the server until a reader buys the plan.

Browsing Explore: filter by style/budget/duration, sort by popularity or **newest**, open any itinerary, and **fork** it into your trips as your own editable copy.

**Creators get a public page.** Turn on creator mode in Profile to add a bio and YouTube/Instagram links, then share `#/creator/<your-id>` — it lists everything you've published with your lifetime views and forks. It's linked from every Explore card, from each of your public itineraries ("More from you"), and from Profile ("View your public page").

**Keep your pages honest — and see your creator hub.** The **Creator hub** (in the nav once you're a creator) opens on how your work is doing:

- **Overview** — a lifetime figures strip and a recorded-traffic trend (visits, forks and unlocks over 7, 30 or 90 days), then one row per publication with its funnel and its actions (**Edit**, plus the **"Page behind itinerary"** flag with its **Update page** shortcut whenever you change a trip after publishing). Unpublish takes a page down without touching the trip.
- **Earnings** — the real sales ledger: what each buyer actually paid at purchase time, the platform-fee split on each sale, and payout runs derived from it (disbursement itself is manual — the ledger says so). A **Projection** toggle does the honest what-if arithmetic for pages that haven't sold, clearly marked as *not money*.

## FAQ

**Are the times and costs real?**
They're transparent estimates from declared assumptions (speeds, ₹/km, buffers) — shown alongside every number. No live traffic or prices are used anywhere.

**Can I actually book hotels/trains here?**
No — booking is out of scope: flag a stop *needs booking* and add your own confirmations. (Money does move in exactly one place — a reader can pay a creator to unlock a priced itinerary.)

**Where is my data stored?**
In Supabase (hosted Postgres), tied to your account — it follows you across devices. Trip access is enforced server-side by row-level security.

**Why does the map route look like crow-flies lines?**
It usually shouldn't: routes follow real roads from the OSRM network. Only when that service can't be reached does the map fall back to straight-line estimates — and the Map tab says so rather than pretending.

**Someone deleted everything?!**
Shared trips are protected by row-level security and soft confirmation dialogs with undo toasts — full-account loss would require losing your Supabase project itself.
