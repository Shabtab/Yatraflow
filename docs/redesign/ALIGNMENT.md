# CTI Redesign — Alignment Tracker

Living checklist against `docs/redesign/YATRAFLOW_DESIGN_DIRECTION.md` ("Calm Travel
Intelligence") and the 10 mockup SVGs. Update this file in **the same commit** as any
redesign work. Status per line: ✅ done · ⚠️ partial · 🚫 not started · 🔒 intentionally
deferred (reason noted).

Legend for the **Where** column:
`L=<src/pages/Landing.tsx>`, `W=<src/pages/TripWorkspace.tsx>`,
`TW=<src/pages/TimelineTab.tsx>` (or inline in W), `C=<src/styles.css>`,
`U=<src/components/ui.tsx>`, `S=<src/lib/stopKind.ts>`,
`docs` = tracker/docs only.

Last full audit: **M5 kickoff** (against doc read in full, §1–§10).

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
| "Open in Board" bridge | 🔒 deferred to M5 | arrives with the Board view rather than as a dead link |

### 6.4 Board (M5 — current milestone)
| Doc item | Status | Where / note |
|---|---|---|
| Pinned route map background | 🚫 | Board pull → reuse `TripMap` + fit controls |
| Floating day columns (kanban) | 🚫 | near-opaque soft cards reusing day/stop data |
| Cross-day drag-and-drop | 🚫 | reuse `useReorder`/`touchDnd` both paths |
| Day-level route focus on column select | 🚫 | fit bounds of selected day |
| Warnings + stop-type info within cards | 🚫 | reuse `stopKindOf` + per-day warnings |
| Clear drop zones + impact preview before persisting | 🚫 | reuse `applyChange`/proposal pattern |
| Small Trip Pulse panel | 🚫 | reuse Overview pulse + health |
| 3–7 day trips; long trips → focused-day rail | 🚫 | implement per guardrail (max 5 columns, scroll for more) |

### 6.5–6.11 Map / Suggestions / Budget / Decisions / Share / Explore / Public
| Doc item | Status | Where / note |
|---|---|---|
| 6.5 Map polish (rounded canvas, translucent panel, filter chips, numbered colour-coded stops, popup→Board/Timeline, nearby, legend) | 🚫 | M6 |
| 6.6 Suggestions hierarchy | 🚫 | M6 |
| 6.7 Budget hierarchy + unconfirmed expense treatment | 🚫 | M6 |
| 6.8 Decisions ("Next to unblock", filters, impact panel, assistant) | 🚫 | M6 |
| 6.9 Share four intents unmistakable | 🚫 | M6 |
| 6.10 Explore editorial hero, travel-style chips, "Fork this trip" | 🚫 | M7 |
| 6.11 Public itinerary editorial story + stats + fork | 🚫 | M7 |

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

## 8 · Design-quality checklist (§9) — last scored screen (Timeline, M4)

| Question | Verdict |
|---|---|
| Answers its core user question? | Yes — "where am I, what needs fixing" via sticky strip + in-day warnings |
| Main action identifiable <3s? | Yes — add-stop / stop-edit controls unchanged, strip prominent |
| Risks explained in human language? | Yes — severity pill + fix copy + "⚠ N days need attention" |
| Solid vs transparency? | near-opaque day cards per §6.3 explicitly |
| Room for route/time/cost detail? | Yes — strip totals + per-stop meta |
| Status without colour alone? | Yes — ⚠ icon + label + tag |
| Consequence visibly communicated? | Yes — impact preview, strip updates |
| Permissions understandable? | N/A this screen (Share = M6) |
| Usable on phone? | Yes — strip static <720, rail scrolls, targets ≥40px |
| Travel planning product, not generic dashboard? | Yes after M1–M4 |