# YatraFlow Design Direction

> **Design language:** Calm Travel Intelligence  
> **Positioning:** A warm, map-aware, glass-accented planning system for trips that work in the real world.

## 1. Design concept

YatraFlow should feel like a **high-quality travel planning studio**, not a generic booking site, a spreadsheet, or an over-styled SaaS dashboard.

The visual direction blends practical, data-rich trip planning with the warmth and anticipation of travel. It must help a group understand the real consequences of its choices: route time, fatigue, cost, stays, commitments, suggestions, votes, and changing plans.

The central product promise should remain visible throughout the interface:

> **Plan trips that actually flow together.**

A YatraFlow screen should make people feel:

- Calm enough to plan a complex journey
- Confident that the route is realistic
- Clear about what needs a decision
- Included in a shared group plan
- Excited about the journey itself

## 2. Design language

The formal design language is **Calm Travel Intelligence**.

It combines five complementary directions:

| Influence | Expression in YatraFlow | Product purpose |
|---|---|---|
| Warm minimalism | Cream foundations, mint atmosphere, peach/saffron highlights, generous spacing | Makes complex planning feel welcoming instead of administrative |
| Modern collaborative SaaS | Clear hierarchy, compact metric cards, filters, status chips, actionable controls | Supports routes, budgets, decisions, collaboration and trip health |
| Restrained glassmorphism | Translucent navigation, floating map overlays, broad low-contrast shadows | Adds depth and premium polish without reducing usability |
| Editorial travel design | Strong destination stories, large headlines, route illustrations, curated public itineraries | Keeps public trips aspirational and shareable |
| Human-centred utility | Warnings, realistic travel time, cost impact, group response and context-aware guidance | Keeps every design choice connected to real travel outcomes |

### It is not

To keep the visual system coherent, YatraFlow should avoid becoming any of the following:

- **Not pure glassmorphism.** Dense itinerary cards, form fields, tables and financial data must remain near opaque.
- **Not a generic fintech dashboard.** Budgets are important, but journeys and people are the centre of the product.
- **Not a booking-site clone.** Avoid crowded hotel grids, price-pressure language and destination imagery that hides planning capability.
- **Not neumorphism.** Avoid low-contrast embossed controls that make buttons and fields unclear.
- **Not a productivity clone.** The app can borrow clarity from modern work tools, but route lines, places, trip rhythm and human decisions must make it recognisably travel-first.
- **Not visual decoration for its own sake.** Every colour, badge, route line and card should help a user make, understand or share a plan.

## 3. Core principles

### 3.1 Calm surfaces, clear actions

The canvas should feel quiet: pale backgrounds, broad whitespace, thin borders and soft depth. Important actions must still be immediately obvious.

Use colour semantically:

- **Teal** for primary planning actions, selected states and positive route progress
- **Saffron** for invitations, sharing, publishing, exploring and meaningful social actions
- **Mint/green** for confirmed, healthy, saved, synced or completed states
- **Amber** for attention, trade-offs, uncertainty, realistic route pressure and pending items
- **Coral/red** only for critical route problems, impossible plans, destructive actions or blocked errors
- **Purple** sparingly for optional/creative discovery such as scenic activities or inspiration

### 3.2 Travel intelligence, not data for data’s sake

YatraFlow’s differentiator is not that it displays an itinerary. It explains whether the itinerary works.

A user should be able to see:

- How long a route actually takes
- When they are likely to arrive
- Whether a day is too demanding
- Where a meal, fuel or rest stop is sensible
- What moving a stop changes in time, budget and trip health
- What group choice is still blocking the plan
- How much the trip is likely to cost per person

The UI should therefore lead with **meaningful consequences**, not raw fields or decorative metrics.

### 3.3 Transparency is atmosphere, not a readability tax

Transparency should create visual depth but never obscure planning content.

Use it selectively:

| Surface level | Intended treatment | Typical locations |
|---|---|---|
| Level 1: Atmospheric canvas | Soft mint/cream/peach gradients and ambient shapes | Landing, Explore, workspace background |
| Level 2: Expressive overlays | White/translucent surfaces with thin white borders and diffuse shadows | Navigation, map overlays, hero support cards, Board columns |
| Level 3: Functional content | Near-opaque white/off-white cards | Timeline stops, budget records, decision choices, forms |
| Level 4: High-priority feedback | Solid, high-contrast surfaces | CTAs, impact previews, safety warnings, success confirmation |

**Rule:** if users must read, compare or edit several pieces of information, use a near-opaque surface.

### 3.4 Depth without clutter

Create depth through:

- Large-radius cards rather than many small boxes
- Soft diffuse shadows rather than hard dark shadows
- Thin light borders on translucent surfaces
- Layered route cards and map controls where appropriate
- Gentle ambient gradients rather than busy illustrations
- Clear spacing and limited visual competition

Avoid:

- Excessive blur
- Heavy glass effects behind dense text
- Multiple competing accent colours within one card
- Oversized emojis inside operational data
- Too many badges, pills or borders

### 3.5 Function follows trip stage

Different trip stages need different visual intensity:

- **Landing and Explore:** more atmospheric, emotive and editorial
- **Create Trip:** simple, focused and mostly solid
- **Overview:** compact briefing with clear priority signals
- **Timeline:** dense, chronological and highly readable
- **Board:** spatial, interactive and map-aware
- **Map:** calm geographic context with clear controls
- **Suggestions:** useful discovery constrained by route and time
- **Budget:** transparent, grounded and connected to choices
- **Decisions:** social clarity and informed group choice
- **Share:** clear distinctions between inviting, viewing, publishing and exporting
- **Public itinerary:** editorial storytelling backed by practical trip data

## 4. Colour system

The current navy-teal and saffron identity should be retained and refined rather than replaced.

### 4.1 Core palette

| Token | Suggested value | Use |
|---|---:|---|
| `--yf-ink` | `#102E4B` | Primary headings, high-trust text, strong structure |
| `--yf-navy` | `#123F49` | Header bands, dark cards, map/AI anchor surfaces |
| `--yf-teal-700` | `#0C716D` | Hover/pressed primary states |
| `--yf-teal-600` | `#0D8D82` | Primary buttons, selected tabs, active states |
| `--yf-teal-100` | `#E5F4EE` | Selected backgrounds, low-emphasis success surfaces |
| `--yf-mint` | `#DFF5ED` | Confirmed/synced states and optimistic support surfaces |
| `--yf-saffron` | `#F3AA3D` | Invite, share, explore, publish and positive attention |
| `--yf-saffron-100` | `#FFF4E4` | Warm action-card backgrounds |
| `--yf-amber` | `#E4AE43` | Route trade-offs, pending actions, fatigue-aware warnings |
| `--yf-amber-100` | `#FFF7E9` | Soft warning surfaces |
| `--yf-coral` | `#D6534D` | Critical risk, blocked plans, destructive states |
| `--yf-coral-100` | `#FFF0EC` | Gentle alert surfaces |
| `--yf-purple` | `#897ABB` | Optional scenic/creative activity category |
| `--yf-purple-100` | `#F0EAFA` | Low-emphasis discovery background |
| `--yf-cream` | `#F8F7EF` | Main app canvas |
| `--yf-mist` | `#ECF8F4` | Mint atmospheric canvas edge/gradient |
| `--yf-peach` | `#FFF2E8` | Warm atmospheric canvas edge/gradient |
| `--yf-surface` | `#FFFFFF` | Primary readable card surface |
| `--yf-surface-muted` | `#F0F4F1` | Inputs, neutral filter controls, secondary surfaces |
| `--yf-border` | `#DCE7E1` | Soft card/input boundaries |
| `--yf-text-muted` | `#637B7D` | Secondary information and helper text |

### 4.2 Background treatment

The default background should use a restrained, low-contrast atmosphere:

```css
background:
  radial-gradient(circle at 18% 12%, rgba(124, 225, 207, 0.20), transparent 32%),
  radial-gradient(circle at 88% 28%, rgba(255, 179, 107, 0.16), transparent 30%),
  linear-gradient(135deg, #ECF8F4 0%, #F8F7EF 52%, #FFF2E8 100%);
```

Use this most visibly on:

- Landing page
- Explore page
- Public itinerary surfaces
- Workspace outer canvas

Keep the effect quiet behind detailed workspace content.

### 4.3 Status colour rules

| Meaning | Colour | Example |
|---|---|---|
| Confirmed / saved / healthy | Mint or teal | Hotel confirmed, trip synced, change saved |
| Primary action | Teal | Add stop, save change, apply route edit |
| Invite / discover / publish | Saffron | Invite travellers, publish itinerary, Explore CTA |
| Needs attention | Amber | Long driving day, unconfirmed expense, pending group answer |
| Critical conflict | Coral | Missed fixed commitment, unrealistic schedule, destructive delete |
| Optional / inspiration | Purple | Scenic viewpoint, flexible activity, optional detour |

## 5. Typography and shape

### 5.1 Typography

Use a modern humanist sans-serif with excellent screen readability. The hierarchy should feel confident but not corporate.

- **Display headings:** 600–700 weight, deep navy `--yf-ink`
- **Section headings:** 600–700 weight, concise and action-oriented
- **Body:** 400–500 weight, dark desaturated teal/grey
- **Micro-labels:** 700 weight, uppercase only for short metadata labels
- **Numbers:** tabular numerals for budgets, distance, durations and scores

Writing style:

- Clear, warm and practical
- Directly state what has changed or what needs attention
- Avoid generic system language such as “data unavailable” where a useful explanation is possible
- Explain the consequence of a route/budget decision in plain language

Good:

> Day 3 needs a real break.

> Adding this stop shifts arrival by 45 minutes.

> 2 travellers still need to vote.

Avoid:

> Warning: schedule status has changed.

> Data record incomplete.

### 5.2 Radius and spacing

| Element | Suggested radius |
|---|---:|
| Large page/hero panel | `24px–30px` |
| Primary workspace card | `18px–24px` |
| Standard card / input / modal | `12px–16px` |
| Filter chip / status pill | `999px` or `12px–14px` |
| Button | `12px–16px` |

Use generous vertical rhythm. White space is a feature: it separates route logic, group decision-making and budget information into understandable blocks.

## 6. Page-by-page direction

### 6.1 Landing page: warm, confident, product-led

The landing page should use the most expressive version of the design system.

Key elements:

- Translucent rounded navigation bar
- Soft mint/cream/peach atmosphere
- Strong outcome-led headline: **“Plan trips that actually flow together.”**
- Clear teal primary CTA: **Start planning free**
- Saffron secondary CTA: **Explore itineraries**
- Product preview that shows a realistic route, time, cost, trip-health signal and live group state
- Feature cards explaining the product through practical outcomes rather than generic feature names

The hero should show YatraFlow’s intelligence, not only a beautiful travel destination.

### 6.2 Overview: Bento trip briefing

Overview should answer: **“Is this trip working, and what should I do next?”**

Recommended structure:

- Large Trip Health card with score, short diagnosis and a direct recommendation link
- Compact total cost and per-person cost cards
- Travel effort card for total distance and driving time
- Priority-actions card for the most consequential trip issues
- Route snapshot/map thumbnail
- Group pulse strip for members, unresolved decisions and upcoming commitments

Avoid turning the Overview into another long list of data cards. Make it a prioritised briefing.

### 6.3 Timeline: precision, chronology and calm density

Timeline remains the core editing surface for detailed, long or complex trips.

Keep:

- Existing travel strips and route-day structure
- Departure/arrival clock
- Distance, duration, transport mode and cost
- Fatigue-aware halt suggestions
- Editable stops and impact preview
- Accessible drag-and-drop and move controls

Modernise through:

- A sticky total-trip summary strip
- Day-jump rail for long trips
- Compact, expandable route-day headers
- Clear stop-type markers: Drive, Stay, Food, Fuel, Rest, Activity, Viewpoint
- Warning state directly inside the affected day
- Direct **Open in Board** bridge for coordination work

Timeline cards should remain near opaque. Functionality and readability come before visual transparency here.

### 6.4 Board: spatial group coordination

Board is a supplementary view, not a Timeline replacement.

It should combine:

- A pinned route map in the background
- Floating day columns for Kanban-style planning
- Existing cross-day drag-and-drop behaviour
- Day-level route focus when a column is selected
- Route warnings and stop-type information within cards
- Clear drop zones for moving flexible activities
- A small Trip Pulse panel with health, unresolved decisions and budget state

Board works best for:

- 3–7 day trips
- Collaborative planning sessions
- Moving flexible activities across days
- Visualising the route while coordinating the group

For longer trips, use a horizontally scrollable focused-day rail or show only adjacent days, rather than displaying ten narrow columns at once.

### 6.5 Map: a route-control surface

The Map view should do more than display pins.

Recommended elements:

- Large rounded map canvas
- Semi-translucent route panel
- Search for places, fuel, food, rest, stays and activities
- Day filter chips
- Numbered route stops and colour-coded stop categories
- Compact selected-stop popup with direct Timeline/Board navigation
- Nearby-idea count and entry point
- Map legend and clear fit/zoom controls

Use low-opacity overlays only for lightweight context. Inputs, selected-place cards and route detail need a readable background.

### 6.6 Suggestions: inspiration constrained by reality

Suggestions should answer: **“What genuinely improves this route?”**

Each suggestion should explain:

- Its purpose: meal, fuel, rest, stay, activity or scenic stop
- Where it falls in the day’s route
- Distance/time since the previous stop
- Detour from the current route
- Why it is a good fit
- The expected impact before it is added

Give “best fit” recommendations higher visual emphasis than optional scenic discoveries.

Suggested wording:

> Day 3 needs a real break.

> Best timing for a 35–45 minute reset, about 128 km into the journey.

### 6.7 Budget: transparent and decision-aware

Budget should answer: **“What will this trip cost, what will I pay, and what can still change?”**

Recommended hierarchy:

- Total trip estimate against group budget
- Per-person estimate against per-person target
- Budget watch card for the greatest uncertainty
- Category breakdown: transport/fuel, stays, food/breaks, activities/permits
- Cost-by-day breakdown
- Conditional/pending markers for unconfirmed stays or unresolved choices
- Constant reminder that itinerary changes preview their cost before saving

Avoid financial-dashboard visual overload. Use simple proportional bars, clear figures and explanatory labels.

### 6.8 Decisions: group clarity and informed choice

Decisions should feel like a place to unblock the trip, not another task manager.

Recommended structure:

- Open-decision count, crew response rate and resolved total
- “Next to unblock” card for the highest-consequence choice
- Filters: Open, Needs me, Resolved
- Decision cards with title, context, due date, creator, options and vote count
- Route/budget impact panel alongside a high-impact decision
- Assistant prompt for a recommendation grounded in current trip data

Every significant decision should show what it changes:

- Drive time
- Arrival time
- Cost
- Fixed commitment risk
- Trip health
- Following-day feasibility

### 6.9 Share: make access types unmistakable

The Share tab should clearly separate four user intentions:

| Intent | Recommended action |
|---|---|
| Plan together | Invite a collaborator/editor by email |
| Let someone read | Copy a live view-only link |
| Share publicly | Prepare and publish to Explore |
| Keep a record | Download a portable snapshot/JSON export |

Describe permissions in plain language. Never make users guess whether a shared link grants edit access.

### 6.10 Explore: discover, trust and fork

Explore should feel like a collection of travel plans made by people who actually went.

Recommended structure:

- Dark-teal editorial hero with route-aware search
- Travel-style chips: road trips, weekends, families, motorcycle, budget-first
- Budget and duration filters
- Featured itinerary with a clear credibility explanation
- Community trip cards showing creator, duration, per-person cost, travel mode, route quality signals and fork count
- Public itinerary cards that emphasise real pacing, rest stops, cost transparency and practical notes

The key CTA should be **Fork this trip**, not simply “Book” or “Use template.” Forking communicates that the original itinerary is a useful starting point that can be adapted to a different group, date and budget.

### 6.11 Public itinerary: editorial story, practical evidence

A public itinerary is a shareable travel document, not the private workspace.

Use:

- A destination-led hero
- Creator attribution
- Large readable title and short route story
- Practical stat cluster: days, route distance, road time, stops and per-person estimate
- “Why this route works” explanation
- Route-at-a-glance panel
- Curated day highlights before the detailed itinerary
- Save and Fork actions

Public pages can be more visual and editorial than workspace screens, but must still communicate route realism and cost credibility.

## 7. Interaction language

### 7.1 Changes should feel safe

YatraFlow’s impact preview is a core trust mechanism. The interface should make it visible and reassuring.

Use action language such as:

- **Preview impact**
- **See what changes**
- **Review before saving**
- **This moves arrival by 45 minutes**
- **This adds ₹1,200 to the group total**
- **This protects the next morning’s route**

Avoid silent edits for major route, time or cost changes.

### 7.2 Make the next action obvious

Every warning should lead to an understandable next step:

| State | Recommended action language |
|---|---|
| Heavy travel day | `Make this day easier` |
| Missing rest/meal halt | `Find a sensible break` |
| Unconfirmed stay | `Choose a stay` |
| Pending group choice | `Ask the group` or `Vote now` |
| Budget uncertainty | `Review cost impact` |
| No fixed commitments | `Add a train, flight or check-in` |
| No crew members | `Invite travellers` |

### 7.3 Respect accessibility

The visual system must retain the app’s accessibility and functional standards:

- Do not rely on colour alone to communicate risk or status
- Pair status colours with icons, labels and descriptive copy
- Maintain sufficient contrast for all text and controls
- Keep keyboard focus visible over map tiles and translucent surfaces
- Preserve accessible drag-and-drop alternatives such as move-up/move-down controls
- Respect reduced-motion preferences
- Avoid tiny type for route time, cost or safety messages
- Ensure map controls, chips and cards have touch-friendly hit targets

## 8. Practical implementation guidance

This design direction is intentionally additive. It should enhance the established product architecture instead of forcing a visual rewrite.

### Preserve existing functional foundations

- Existing Timeline remains the detailed, default editing experience
- Existing Map remains available as a focused geographic view
- Existing route/time/cost impact preview remains mandatory for consequential changes
- Existing realtime collaboration, invitation, sharing, publish and snapshot concepts remain intact
- Existing Budget, Decisions and Suggestions remain dedicated information spaces
- Existing design tokens should evolve gradually rather than being discarded

### Introduce new visual structure incrementally

1. Update global colour, surface, typography, radius and shadow tokens.
2. Modernise the landing page and global navigation first.
3. Reshape Overview into a Bento trip briefing.
4. Improve Timeline density and long-trip navigation without changing its route logic.
5. Add Board as an optional new workspace view, not a replacement.
6. Redesign Map, Suggestions, Budget, Decisions and Share around action-focused hierarchy.
7. Give Explore and Public Itinerary their more editorial, discovery-focused treatment.

### Board implementation guardrails

- Keep Board as a separate view/tab.
- Reuse existing day/stop data and drag-and-drop behaviour.
- Use the existing map component rather than building a second map system.
- Keep detailed stop editing in the existing editor flow.
- Show an impact preview after cross-day changes before persisting consequential updates.
- Use a focused-day rail for long trips rather than rendering too many thin columns.
- Audit stacking layers for map controls, columns, dialogs, assistants and impact-preview sheets.

## 9. Design-quality checklist

Before shipping a redesigned screen, verify:

- Does the screen clearly answer its core user question?
- Can the user identify the main action in under three seconds?
- Are risks explained in human language, not only by a score or colour?
- Does a card need transparency, or would a solid surface read better?
- Does the design preserve room for route/time/cost detail?
- Do status labels work without colour alone?
- Does a route or budget change visibly communicate its consequence?
- Are collaboration and permissions understandable?
- Is the screen still usable on a phone?
- Does it look and feel like a travel planning product rather than a generic dashboard?

## 10. One-sentence style statement

> **YatraFlow blends calm, premium travel warmth with the clarity of a modern collaborative workspace, using soft atmospheric backgrounds, navy-teal information hierarchy, saffron moments of action and restrained translucent surfaces to make complex trip planning feel human, confident and shared.**
