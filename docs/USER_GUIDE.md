# YatraFlow User Guide

Everything you need to plan a trip with your group. ⏱ ~5 minutes to learn.

---

## 1. Log in

Open [YatraFlow](https://yatraflow-blond.vercel.app). Either:

- **Create an account** (name + email + password), or
- Click **Try the demo account** for instant access with sample trips.

> Your data lives only in *this browser*. Don't clear site data if you want to keep your plans, and know that friends on their own devices won't see them — this MVP has no server.

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

- **Add stops** to any day: name, category, location (searchable — picking from suggestions pins it accurately on the map), duration, opening hours, entry fee, transport cost, priority.
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
Your browser's localStorage only. Clearing site data resets the app to demo state.

**Why does the map route look like crow-flies lines?**
Routes are haversine distances × a road factor — good enough for planning realism, not navigation.

**Someone deleted everything?!**
If the app ever shows corrupted state, use the crash screen's "Reset app data & reload" button — it restores fresh demo data.
