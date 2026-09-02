# CTI Redesign — Alignment Tracker

Living checklist against `docs/redesign/YATRAFLOW_DESIGN_DIRECTION.md` ("Calm Travel
Intelligence") and the 10 mockup SVGs. Update this file in **the same commit** as any
redesign work. Status per line: ✅ done · ⚠️ partial · 🚫 not started · 🔒 intentionally
deferred (reason noted).

Legend for the **Where** column:
`L=<src/pages/Landing.tsx>`, `W=<src/pages/TripWorkspace.tsx>`,
`TW=<src/pages/TimelineTab.tsx>` (or inline in W), `B=<src/components/BoardView.tsx>`,
`TM=<src/components/TripMap.tsx>`, `C=<src/styles.css>`,
`U=<src/components/ui.tsx>`, `S=<src/lib/stopKind.ts>`,
`docs` = tracker/docs only.

Last full audit: **M6 complete + post-M5 board polish & motion pass** (2026-09-02) — Board re-verified against the doc after the mockup-cleanliness, canvas and motion/glass passes; M6 rows reflect the shipped Budget/Decisions/Share/Suggestions hierarchy.

---

## 1 · Language core (§1–§3)

| Doc item | Status | Where / note |
|---|---|---|
| §1 promise visible: "Plan trips that actually flow together" | ✅ | L hero H1, teal-accented "flow together" |
| §2 five influences balanced (warm minimalism / collab SaaS / restrained glass / editorial / human-centred utility) | ✅ | tokens + surfaces M1–M4 |
| §3.1 calm canvas + semantic colour (teal primary / saffron explore / mint confirmed / amber attention / coral critical / purple optional) | ✅ | `--yf-*` palette + per-screen usage; secondary CTA made saffron at M5 kickoff |
| §3.1 "Not pure glassmorphism" — dense cards near opaque | ✅ | day cards radius-lg + shadow-soft, near-opaque fills |
| §7.1 changes feel safe (impact preview, plain-language consequence) | ✅ | pre-existing `ImpactPreviewPanel` retained; language reused in Timeline strip pill |

## 2 · Tokens & canvas (§4)

| Doc item | Status | Where / note |
|---|---|---|
| §4.1 `--yf-*` palette light | ✅ | C `:root` tokens (M1 `d7b86d5`) |
| §4.1 `--yf-*` palette dark | ✅ | C dark block mirrors every token; QA'd both themes |
| §4.2 atmospheric background | ✅ | C `.atmos` (radial mint+peach over mist→cream→peach linear) — used on Landing + workspace shell |
| §4.3 status colour rules | ✅ | saffron=explore/invite, amber=attention, coral=critical in nav, strip pill, Board planned |

## 3 · Typography & shape (§5)

| Doc item | Status | Where / note |
|---|---|---|
| §5.1 display 600–700, deep navy `--yf-ink` | ✅ | `--font-display` headings, ink tokens |
| §5.1 micro-labels 700 uppercase short | ✅ | `.pulse-label`, stop-kind tags, nav kicker |
| §5.1 tabular numerals for budget/distance/scores | ✅ | M3/M4 stat + strip figures |
| §5.2 radius ladder (hero 24–30 / card 18–24 / input 12–16 / chip 999) | ✅ | `--radius-*`, pill nav 999, bento cards lg |
| §5.2 generous vertical rhythm, whitespace as feature | ✅ | airier bento + day cards |

## 4 · Screens (§6)

### 6.1 Landing
| Doc item | Status | Where / note |
|---|---|---|
| Translucent rounded navigation bar | ✅ | floating glass pill + cream control tray (M2.1) |
| Soft mint/cream/peach atmosphere | ✅ | `.atmos` + gradient card |
| Headline "Plan trips that actually flow together." | ✅ | L H1 |
| Teal primary CTA "Start planning free" | ✅ | L `.btn-primary`→`#/auth?mode=signup` |
| Saffron secondary CTA "Explore itineraries" | ✅ | L `.btn-saffron`→`#/explore` (copy fixed at M5 kickoff: was "Explore trips", outline) |
| Product preview: route, time, cost, health, live group state | ✅ | L dark "Your next adventure" card (route squiggle, per-person ₹, driving time, health 53, Day-3 warning, synced count) |
| Feature cards = practical outcomes | ✅ | 3-outcome section per mockup |

### 6.2 Overview (Bento briefing)
| Doc item | Status | Where / note |
|---|---|---|
| Large Trip Health card: score, diagnosis, direct recommendation | ✅ | W `.health-big` 54px score + bar + reasons + "View health recommendations" |
| Compact total cost + per-person cost cards | ✅ | W stat cluster |
| Travel effort card (distance + driving time) | ✅ | W stat cluster |
| Priority-actions card (most consequential issues) | ✅ | W + link to Timeline |
| Route snapshot / map thumbnail | ✅ | W dark route-snap card → "Open map" |
| Group pulse strip (members, unresolved decisions, commitments) | ✅ | W full-width `.pulse-bar` + invite link |
| Not "another list of data cards" — prioritised briefing | ✅ | bento layout, lead with issues |

### 6.3 Timeline
| Doc item | Status | Where / note |
|---|---|---|
| Keep travel strips, route-day structure, clock, distance/duration/mode/cost | ✅ | untouched editing surface |
| Fatigue-aware halt suggestions, editable stops, impact preview | ✅ | pre-existing |
| Accessible drag-and-drop + move controls | ✅ | pre-existing (HTML5 + `touchDnd`) |
| Sticky total-trip summary strip | ✅ | TW glass pill "TRIP TOTAL" (static <720px) |
| Day-jump rail for long trips | ✅ | TW ≥4 days, amber+warn tint |
| Compact, expandable route-day headers | ✅ | TW day card header (collapse prefs retained) |
| Clear stop-type markers (Drive/Stay/Food/Fuel/Rest/Activity/Viewpoint) | ✅ | S `stopKindOf()` + spine colour + uppercase tag |
| Warning state directly inside the affected day | ✅ | TW header pill + in-body items/fixes |
| "Open in Board" bridge | ✅ | TW header button "Open in Board →" (added with the Board view itself) |

### 6.4 Board (M5 — complete; polish passes 2026-09-02)
Post-M5 polish per user review against the board mockup: mockup card anatomy (accent spine + kicker + title + one meta line), mist wash over the map, 1680px board canvas with compacted trip band, equal-size glass corner panels, centred content-fitted columns, board-choreography motion (stagger/hover/drag pulse). See `CHANGELOG.md [Unreleased]`.
| Doc item | Status | Where / note |
|---|---|---|
| Pinned route map background | ✅ | B `.board-map` embeds the existing `TripMap` (no second map system); lazy chunk shared with Map tab |
| Floating day columns (kanban) | ✅ | B `.board-col` near-opaque soft cards with **kind-coloured face washes** + tinted borders; content-fitted uniform height (board floor grows — no internal scrollbars in realistic days) |
| Cross-day drag-and-drop | ✅ | B `useReorder` + `touchDnd` both paths (AGENTS §4 pair); payload `{stopId, fromDay}` |
| Day-level route focus on column select | ✅ | TM `focusDay` prop (additive) drives the existing day filter; column header click toggles |
| Warnings + stop-type info within cards | ✅ | B `stopKindOf` coloured spine + uppercase kicker (mockup card anatomy: kicker → title → one meta line) + `dayWarnings` severity pill on its own header row |
| Clear drop zones + impact preview before persisting | ✅ | B dashed "＋ Add or drop a stop" zone (foreign-drop only) → `applyChange` → ImpactPreviewPanel |
| Small Trip Pulse panel | ✅ | B compact 264px **glass corner pair** with the info card (equal size, 18px blur + sheen) top-right: health score/band/bar, overloaded days, decisions, budget + "Open health advice →" |
| 3–7 day trips; long trips → focused-day rail | ✅ | B flex-width columns (264px basis, 250–424px) that centre when short and scroll horizontally when long; mobile stacks |
| "Open in Board" bridge from Timeline | ✅ | TW header button (§6.3 deferred item shipped here) |

### 6.5–6.11 Map / Suggestions / Budget / Decisions / Share / Explore / Public
| Doc item | Status | Where / note |
|---|---|---|
| 6.5 Map polish (rounded canvas, translucent panel, filter chips, numbered colour-coded stops, popup→Board/Timeline, nearby, legend) | ⚠️ | Pre-existing: day-filter chips, numbered colour-coded stops, legend ⓘ, nearby-idea chips all shipped; toolbar hides on Board embed (`showToolbar`). Deferred: in-map place search, popup→Board/Timeline cross-links (M6 remainder) |
| 6.6 Suggestions hierarchy | ⚠️ | "Best fit" teal badge on ≥60%-consensus open suggestions; purpose chips + detour scope pre-existing. Deferred: route-position/"why it fits" copy per card |
| 6.7 Budget hierarchy + unconfirmed expense treatment | ✅ | Navy `.budget-hero` (total + per-person/day + usage bar + plain-language state), "Keep estimates honest" reassurance band, optional-vs-essential split; per-person accountability in hero sub |
| 6.8 Decisions ("Next to unblock", filters, impact panel, assistant) | ⚠️ | Stat strip (open / need-your-vote / resolved), All/Open/Needs-me/Resolved filters, ⚡ Next-to-unblock emphasis. Deferred: per-decision route/budget impact panel + grounded assistant prompt (needs engine data) |
| 6.9 Share four intents unmistakable | ⚠️ | Numbered intent tags: 1·Plan together (teal), 2·Share publicly (saffron), 3·Keep a record (info); plain-language permission copy pre-existing. View-only live link exists as the `viewer` member role — deliberate divergence (doc's four-intent table collapses to three surfaces; snapshot link doubles as the no-account read link) |
| 6.10 Explore editorial hero, travel-style chips, "Fork this trip" | ✅ | E dark-teal hero + in-hero search, style chips w/ counts + ♥ Saved chip, featured card w/ explained credibility, cards show 🍴 forks + ♡ + Fork CTA (copy renamed) |
| 6.11 Public itinerary editorial story + stats + fork | ✅ | PI editorial hero + byline, "practical bit" stat card, paper sheet (action rail, why-this-route-works, RouteSnapshot glance card, day highlights), Fork CTA; divergence: no "Open interactive map" (no public map route), Save = localStorage |

## 5 · Interaction & accessibility (§7)

| Doc item | Status | Where / note |
|---|---|---|
| §7.1 preview impact / see what changes / review before saving | ✅ | pre-existing + kept in Board plan |
| §7.2 every warning → understandable next step | ✅ | Timeline in-day fixes + "Make this day easier", Overview links |
| §7.3 not colour-alone; icon/label pairings | ✅ | ⚠ pills, spine+tag pairs |
| §7.3 focus visible over translucent surfaces | ✅ | `:focus-visible` rings, scroll-padding nav offset |
| §7.3 reduced motion respected | ✅ | global `prefers-reduced-motion` |
| §7.3 touch targets ≥40px / 16px inputs ≤720px | ✅ | established mobile block |
| z-index ladder (toast 200 > modal 100 > impact 90 > notif 80 > expanded map 70) | ✅ | Board columns/map/Pulse audit due in M5 |

## 6 · Robustness guards (§8 + plan)

| Guarantee | Status | Where / note |
|---|---|---|
| Additive: tokens evolve, no rewrite | ✅ | legacy tokens untouched; new ones additive |
| Engine / store / Supabase untouched | ✅ | zero data-model change through M4 |
| Monolithic `@media (max-width:720px)` stays the only mobile block | ✅ | M5 must follow |
| Per milestone: verify gate + both themes + §9 checklist | ✅ | each commit gated; QA in light+dark |

## 7 · Known deliberate divergences (doc vs mockup vs shipped)

- **CTA copy:** doc §6.1 says "Explore itineraries"; homepage mockup SVG says "Explore trips".
  Shipped follows **the doc** (user directive: doc is authoritative) — fixed at M5 kickoff.
- **Nav:** mockups show a single translucent bar; shipped splits into a glass pill + cream
  control tray. Rationale: the "floating nav" language the user asked for on the real product
  while keeping logged-out CTAs legible. Logged as M2.1.
- **Dark mode:** the doc is light-first and never mentions it; the app ships both themes —
  every `--yf-*` token is mirrored in the dark block (documented in `implementation_plan.md`).

## 8 · Design-quality checklist (§9) — last scored screen (Board, post-M5 polish)

| Question | Verdict |
|---|---|
| Answers its core user question? | Yes — "where does each stop live + how does moving it affect the route" via pinned map + columns + pulse |
| Main action identifiable <3s? | Yes — drag a card to a column; dashed "＋ Add or drop a stop" zone is the obvious drop target |
| Risks explained in human language? | Yes — severity pill on column header + impact preview on drop |
| Solid vs transparency? | near-opaque columns (`--card` 97%) per §3.1; info/pulse use deepened level-2 glass (0.58 alpha, 18px blur + sheen) |
| Room for route/time/cost detail? | Yes — map keeps route; cards keep clock/km meta; pulse carries budget |
| Status without colour alone? | Yes — ⚠ icon + label on warn pill; band text + score number |
| Consequence visibly communicated? | Yes — every cross-day drop opens the impact preview before saving |
| Permissions understandable? | N/A this screen (Share = M6) |
| Usable on phone? | Yes — map stacks to 240 px block, columns flow below, ≥40 px touch rows |
| Travel planning product, not generic dashboard? | Yes — the pinned route makes it unmistakably a trip planner |

- **Nav stickiness:** M2.1 shipped the pill as `position: sticky` (floating over content); user review found it
  obstructs the page while scrolling — shipped is now **static** (scrolls away) while keeping the pill look.
  Logged 2026-09-02.
- **Motion & glass intensity:** the doc/motion isn't specified by the design doc; per user direction the app ships
  a subtle & premium motion system (one easing family, transform/opacity only, `prefers-reduced-motion` honoured)
  and deeper glass (blur 18px + saturate + sheen, alpha 0.58) on the existing level-2 surfaces. Content cards stay
  solid per §3.1. Logged 2026-09-02.
