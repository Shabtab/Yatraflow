# YatraFlow User Guide

Everything you need to plan a trip with your group. ⏱ ~5 minutes to learn.

---

## 1. Log in

Open [YatraFlow](https://yatraflow-blond.vercel.app). Either:

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

- **Add stops** to any day: name, category, location (searchable — Mappls-backed suggestions when configured, with keyless fallbacks), duration, opening hours, entry fee, transport cost, priority.
- **Context-aware opening hours** — Opens at / Closes at appear only when they're relevant (a geocoded attraction, or categories like temple/museum/food/hotel), and clear themselves for a whole city or town.
- **Stoppage-point suggestions** — the Map tab and empty days suggest attractions, restaurants, cafés, hotels, fuel pumps and ATMs near your route (Mappls Nearby). "Add" opens a pick-a-day dialog — choose the day and confirm **Add to timeline**.
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
- Routes are straight-line approximations — great for shape and relative distance, not turn-by-turn navigation.

## 5. Collaborate

### Invite
**Share tab → copy invite link.** Friends who open it join your trip (you control whether they can edit or just comment).

### Suggest
The **Suggestions** tab lets anyone propose a stop with votes and comments. When something wins the group over, accept it straight into the timeline — you'll see the time/cost impact first.

### Decide
Stuck between options? Raise a **Decision** ("Varkala beach day vs backwater cruise") with per-option cost/time impacts. Everyone votes; anyone can resolve.

## 6. Watch the budget

The **Budget** tab totals expenses per person and for the group, splits essential vs optional, breaks down by category, and compares against the trip budget. Add expenses as you plan (entry fees, fuel shares, hotel nights) or as you spend.

## 7. Ask the companion

The **AI drawer** answers questions grounded in *your actual trip data*: "Make Day 2 less tiring", "Can we still make the airport if we add this?", "What should we cut with kids along?" Every answer cites the assumptions behind its numbers. It's rule-based, not magic — but it never invents facts.

## 8. Publish & explore

Proud of a route? **Share tab → publish** puts it in the public **Explore** gallery with a tagline, best season and tips. You choose which days preview free.

Browsing Explore: filter by style/budget/duration, open any itinerary, **Copy This Trip**, and it becomes yours to edit.

## FAQ

**Are the times and costs real?**
They're transparent estimates from declared assumptions (speeds, ₹/km, buffers) — shown alongside every number. No live traffic or prices are used anywhere.

**Can I actually book hotels/trains here?**
No — booking buttons are placeholders in this MVP. Nothing takes payment.

**Where is my data stored?**
In Supabase (hosted Postgres), tied to your account — it follows you across devices. Trip access is enforced server-side by row-level security.

**Why does the map route look like crow-flies lines?**
Routes are haversine distances × a road factor — good enough for planning realism, not navigation.

**Someone deleted everything?!**
Shared trips are protected by row-level security and soft confirmation dialogs with undo toasts — full-account loss would require losing your Supabase project itself.
