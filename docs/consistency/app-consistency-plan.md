# YatraFlow: one-designer consistency plan (every page)

Prepared 2026-10-11. The audit was read-only, in `C:\Users\hasna\yatraflow-claude`, on branch `feat/port-686` (HEAD `305ea00`, 36 ahead and 8 behind `origin/test`, with uncommitted edits in `src/pages/Explore.tsx` and `src/styles.css`). No repo file changed.

The reference standard is the redesigned Explore and My trips pages. The plan brings every other page to that standard, one page at a time. It redesigns a page only where the audit shows a different visual language. It enhances every other page.

---

## 0. Session starter prompt (paste this into the new Claude Code session)

```text
You orchestrate the YatraFlow "one designer" consistency work. The plan is in
C:\Users\hasna\Documents\yatraflow-app-consistency-plan.md. Read all of it first.
Then read C:\Users\hasna\yatraflow-claude\AGENTS.md and CODING_STANDARDS.md.

Rules:
- Work only in C:\Users\hasna\yatraflow-claude. Do not touch any other yatraflow* folder.
- Run `git status -sb` first. The clone may hold uncommitted work on feat/port-686.
  Do not stash, reset, discard or commit it. Ask me what to do with it before you switch branches.
- Use plain `git fetch origin`. Never use a wildcard refspec.
- One feature branch per page, cut from origin/test. Open the PR into test only when I say so.
- Never push or merge without my explicit say-so.
- Keep all data and logic. Do not invent ratings, counts or reviews.
- The cream canvas #F8F7EF stays.
- Write new prose in Simplified Technical English (ASD-STE100). Use short sentences.
- Edit CHANGELOG.md with editor primitives only. Write the final state, not the session story.
- Append new CSS to the END of src/styles.css. The design-system baseline is keyed by line.
- Ask every decision with the AskUserQuestion picker.
- Credentials come only from environment variables. Never write them to a file.
- Model routing: you stay on Sonnet and orchestrate. Haiku 5.5 (effort high) does logic,
  tests and mechanical edits. Sonnet (effort high) does UI that must match a mockup, with
  before/after screenshots next to the mockup (light + dark, 1280 + 390) and motion proof.
  Opus (effort high) only guides and reviews. Pass model and effort on every Agent call.
  Give each worker a self-contained brief: what it may touch, what it must not touch,
  no push, where to write, and a short report. Check each claim against git and files.

Start with section 9 (open questions). Ask them with the picker. Then do Phase 0.
Then follow the page order in section 6. Use the per-page loop in section 5 for every page.
```

---

## 1. Rules for the session

1. Work only in `C:\Users\hasna\yatraflow-claude`. Every other `yatraflow*` folder belongs to another agent.
2. Read `AGENTS.md` and `CODING_STANDARDS.md` before the first change. Their rules win over this plan.
3. Run `git status -sb` and `git log -1 --oneline` at the start. Re-derive state from git. Do not trust a summary.
4. The clone has uncommitted edits on `feat/port-686`. You must not stash, reset or commit them. Ask the user first.
5. Use `git fetch origin`. Never use a wildcard refspec. It deletes `origin/main` and `origin/test`.
6. Cut one feature branch per page from `origin/test`. Name it `feat/consistency-<page>`.
7. Open a PR into `test` only when the user says so. Never push or merge without the user's explicit say-so.
8. Keep all existing data and logic. Do not invent ratings, counts, reviews or prices. Every figure on a page must come from real data.
9. Keep the honesty pins. Loading, failed and empty states stay three separate renderings (AGENTS.md §6).
10. The cream canvas `#F8F7EF` (`--yf-cream`) stays.
11. Write new prose in Simplified Technical English. Run `npm run lint:ste` before each commit.
12. Edit `CHANGELOG.md` with editor primitives only. Write final-state wording under `[Unreleased]`.
13. Append new CSS to the end of `src/styles.css`, under a new section comment. Do not insert above existing rules.
14. Every new interactive surface ships motion from the motion tokens (`docs/MOTION-TOKENS.md`). Every animated rule needs a `prefers-reduced-motion` opt-out. A raw `ms` value in a new rule is a defect.
15. Ask every decision with the AskUserQuestion picker. Do not ask in plain text.
16. Credentials come only from environment variables. Never write a password, key or token to a file.
17. Run `npm run verify` before you say a page is done. Run `npm run lint:ratchet` in the same commit as a fix.
18. Hand the user exact, proven localhost URLs (AGENTS.md §2.7). Prove the server serves this tree and has the Supabase ref compiled in.
19. Model routing (Claude Code, this machine):
    - The main thread stays on Sonnet. It plans, delegates, checks claims against git and files, and reports.
    - Haiku 5.5 (`model: "haiku"`, `effort: "high"`) is the default worker: logic, tests, guards, mechanical class swaps, screenshot sweeps, changelog edits.
    - Sonnet (`model: "sonnet"`, `effort: "high"`) does UI that must match a mockup. It also takes a task that Haiku failed twice (retry Haiku once with a sharper brief first).
    - Opus (`model: "opus"`, `effort: "high"`) only guides when work fails repeatedly, and reviews each page PR before the user sees it. Spawn it as a subagent. Do not switch the main model.
    - Every UI worker must prove the result visually. It writes a difference list against the mockup before it edits. It then shows before and after screenshots next to the mockup, in light and dark, at 1280 and 390. It shows motion with computed styles and a hover screenshot. Passing tests and overflow checks are not visual proof.
    - Each worker brief is self-contained: the files it may touch, the files it must not touch, no push, the output folder, and a short report format.

---

## 2. The reference standard ("house style")

These are the traits that Explore and My trips share today. Every page must match them, or have a recorded reason not to.

| Trait | What the reference does | Where |
|---|---|---|
| Canvas | Cream `#F8F7EF` (`--yf-cream` → `--bg`) | `styles.css:70,148` |
| Hero | Rounded band (28px), mist-to-peach gradient, teal dot pattern, serif h1 with one italic accent and a saffron hand underline, one lede line, one primary CTA, quiet secondary buttons, a real-count stat row, papercut postcards, a Caveat note | `ExploreHero.tsx`, `TripsHero.tsx`, `styles.css:8411-8493` |
| Type | Playfair Display 600 for the hero h1 (`--font-serif`). Caveat 600 for one hand note (`--font-hand`). Plus Jakarta Sans 800/700 for section and card titles. Body in Plus Jakarta Sans | `styles.css:8436-8440, 8926-8937`; `DESIGN.md` Typography |
| Section head | `mt-section-head` + `mt-section-title`, actions on the right | `TripsList.tsx:333-359` |
| Cards | `--radius` 18px, 6px inner padding, `--shadow-card`; hover lifts 2px, `--shadow-card-hover`, `--line-strong` border, cover art scales 1.035 | `styles.css:8187-8194, 8628-8634` |
| Art | Papercut region art (`TripArt`) as the placeholder, real cover photo when present | `components/trips/TripArt.tsx` |
| Filters | `ex-filterbar filterbar-host`, `SearchField`, `Select` in `ex-select`, `FilterChip` row, an always-mounted "Clear filters" | `ExploreFilterBar.tsx`, `TripsList.tsx:362-407` |
| Buttons | 44px min height, 12px corners, weight 700, 1px press, token transitions. Scoped to `:is(.ex-page, .trips-page)` only | `styles.css:8395-8409` |
| States | One block for loading, failed and empty, with icon, title, body, actions | `ExploreStateBlock.tsx`, `styles.css:8802-8812` |
| Motion | `page-enter` stagger with `--stagger-step`, `cardIn` on hero and cards, `enterIndex` stagger on grids, hover lift, state-change motion on Grid/List and the filter reset | `styles.css:9728-9750, 9889+` |
| Width | Container max 1240px | `styles.css:8382-8387` |

Three gaps in the reference itself. Phase 0 closes them.

- My trips still uses the old `EmptyState` and `loading-block` (`TripsList.tsx:261,307,309,317,414,420`). Explore uses `ExploreStateBlock`. Two state components exist for one job.
- The My trips Trash view is a plain `.card` with inline styles (`TripsList.tsx:249-255`). The draft card uses an emoji thumb (`TripsList.tsx:289`).
- The button skin, the 1240px width and the hero live behind `ex-`/`mt-` page scopes. No other page can use them without copying.

---

## 3. Inventory and audit (every routed page and major surface)

Routes come from `src/App.tsx:296-385`. "Lines" is the page file only. The verdict scale is OK / enhance / redesign.

### 3.1 App shell (nav, footer, route fallback, toasts, dialogs)

- Route: every page. Audience: everyone. `App.tsx` 817 lines (includes `SharedTripPage` and `InviteGate`).
- Verdict: **enhance**.
- Evidence: the route fallback is a bare spinner line (`App.tsx:55`). The footer is a plain two-span row (`App.tsx:585-590`, `styles.css:2844`). The base `.btn` is a pill with a raw `.06s ease` transform (`styles.css:676-681`). The catalog skin excludes dialogs (`styles.css:8395`, `:where(:not(.modal *))`), so a Confirm dialog on My trips shows the old pill buttons. The topnav pill is already consistent across pages (seen in the reference screenshots).
- Motion: route panel re-mounts per route (`App.tsx:582`). Notification and user popovers have the dropdown pattern. Toasts are fine.

### 3.2 Explore (`/explore`) — reference

- Public and signed-in. 412 lines + `components/explore/*`. Verdict: **OK**. Phase 0 only moves its parts into shared primitives.
- To do (2026-10-12): restore the card hover to the catalog shadow (`.ex-trend-card`, and on My trips `.itin-card` and `.trip-card-hit`). The page-consistency baseline accepted the current hover at 8 on 2026-10-12.

### 3.3 My trips (`/trips`) — reference

- Signed-in. 483 lines + `components/trips/*`. Verdict: **OK, small enhance** (the three gaps in section 2).
- To do (2026-10-12): restore the card hover on `.itin-card` and `.trip-card-hit` to the catalog shadow. See 3.2.

### 3.4 Trip workspace header and tab bar (`/trip/:id`)

- Signed-in, the most-used surface. `TripWorkspace.tsx` 560 lines.
- Verdict: **redesign (header and tab bar only)**.
- Evidence: a navy gradient card (`TripWorkspace.tsx:362`, `styles.css:2774-2781`) with a Sora h1 and inline styles (`TripWorkspace.tsx:364-381`). A user clicks a cream editorial card on My trips and lands on a dark navy band. This is the largest visual break in the app. The tab bar is `PillNav.tabbar` (`TripWorkspace.tsx:408`). It is one of three tab styles in the app (see 3.17).
- States: "Trip not found" and "Loading trip…" are plain `loading-block` lines (`TripWorkspace.tsx:298,301`).

### 3.5 Workspace tabs

| Tab | File, lines | Verdict | Evidence |
|---|---|---|---|
| Overview | `trip/OverviewTab.tsx` 466 | enhance | 14 inline styles, 13 `.card` uses; panel titles in Sora |
| Board | `components/BoardView.tsx` 652 | OK | long-refined motion (drag follow/settle, `MOTION-TOKENS.md` catalog) |
| Map | `trip/MapTab.tsx` 1954 + `TripMap.tsx` 1607 | OK | long-refined; touch only state blocks |
| Timeline | `trip/TimelineTab.tsx` 843 + `timeline/*` | OK | long-refined; one `EmptyState` in `timeline/DaySection.tsx` |
| Group input | `trip/GroupInputTab.tsx` 592 | enhance | 27 inline styles, 2 `EmptyState` |
| Budget | `trip/BudgetTab.tsx` 707 | enhance | 29 inline styles, 2 `EmptyState`, 2 `loading-block` |
| Share | `trip/ShareTab.tsx` 612 | enhance | 16 inline styles; a tabbed layout of its own (`styles.css:5455`) |
| Settings | `trip/TripSettingsForm.tsx` 941 | OK, light enhance | V2 surface already rebuilt (`styles.css:7905+`, `tsx-` classes) |

### 3.6 Create trip (`/new`)

- Signed-in, core flow, nav item. `CreateTrip.tsx` 1658 lines.
- Verdict: **enhance (mockup for the header and the template strip)**.
- Evidence: a Sora h1 with an eyebrow (`CreateTrip.tsx:856-861`). Template cards use gradient covers with an emoji (`CreateTrip.tsx:876-877`), not the papercut art. The Trip Ticket rail is a strong, recent design (`styles.css:5592-5953`). Keep it.

### 3.7 Trip created (`/created/:id`)

- Signed-in, one view after create. `TripCreated.tsx` 612 lines.
- Verdict: **enhance**.
- Evidence: eyebrow + "<name> is live." h1 (`TripCreated.tsx:377-380`) maps directly onto the serif-with-accent pattern. The "not loaded" branch is a bare paragraph and button (`TripCreated.tsx:236-238`), not a state block.

### 3.8 Public itinerary (`/pub/:slug`)

- Public and signed-in. The share and paywall page. `PublicItinerary.tsx` 944 lines.
- Verdict: **enhance, with a mockup** (it is the money page).
- Evidence: already editorial (paper sheet, kickers, "Why this route works"). But the h1 is Sora 800 (`PublicItinerary.tsx:547`, `styles.css:2672-2675`). The section titles are Sora 800 (`styles.css:3846`). The hero is forced-dark navy over a photo (`styles.css:2660-2664`). Save and Fork use their own `save-btn`/`fork-btn` (`PublicItinerary.tsx:575-579`). The loading branch nests `.container` inside `.container` (`PublicItinerary.tsx:394-395`). A start-point mockup exists: `docs/redesign/yatraflow-editorial-public-itinerary-mockup.svg`.

### 3.9 Creator page (`/creator/:id`)

- Public and signed-in. Linked from the Explore Creators panel. `CreatorPage.tsx` 155 lines.
- Verdict: **redesign (small page)**.
- Evidence: the grid uses the old `PubCard` in `.explore-grid` (`CreatorPage.tsx:144-149`), not `ExploreCard`. A visitor clicks a creator on Explore and sees a different card for the same itinerary. The hero is a navy band (`styles.css:5339-5347`). The stats use `stat-tile` (`CreatorPage.tsx:107-119`). The h2 has an inline style (`CreatorPage.tsx:122`). The state branches are good and must stay (`CreatorPage.tsx:46-67,124-143`).

### 3.10 Purchases (`/purchases`)

- Signed-in, reached from the My trips hero. `Purchases.tsx` 357 lines.
- Verdict: **enhance**.
- Evidence: a ghost back button and a plain h1 (`Purchases.tsx:126-131`). The failed state is a bespoke `.card` (`Purchases.tsx:160-167`), the loading state is `loading-block` (`:169`), and the empty states are `EmptyState` (`:156,171`): three state styles on one page. Rows use `CoverThumb` with an emoji fallback (`:238`).

### 3.11 Auth (`/auth`) and DMCA (`/dmca`)

- Public. `Auth.tsx` 195 lines, `DMCAPage.tsx` 37 lines.
- Verdict: **enhance**.
- Evidence: a centred `.card.auth-card` with a Sora h1 (`Auth.tsx:131-132`, `styles.css:1929-1932`). 7 inline styles in Auth, 3 in DMCA. Tabs are `PillNav.tabbar.auth-tabs` (`Auth.tsx:137`). DMCA reuses the auth card for a policy text (`DMCAPage.tsx:8-10`).

### 3.12 Invite gate (`/join/:code`, `/invite/:id`) and shared snapshot (`/share/:payload`)

- Public, the first screen an invited friend sees. Inside `App.tsx:611-814`.
- Verdict: **enhance**.
- Evidence: bare `empty-state` blocks with inline `fontSize: 26` h1s (`App.tsx:665,675,777,798`). Two branches have no `page-enter` (`App.tsx:775,796`), so they appear without motion. The invite does not show a trip preview beyond its name (`App.tsx:798`).

### 3.13 Profile & settings (`/profile`)

- Signed-in. `Profile.tsx` 545 lines.
- Verdict: **enhance**.
- Evidence: a bare h1 and a meta line (`Profile.tsx:90-91`), then a stack of `.card` panels with `h3` + `hr.divider` (`Profile.tsx:98-124`). 26 inline styles. Choice rows use `Chip` (`Profile.tsx:117,128`), not `FilterChip`.

### 3.14 Creator hub (`/creator-hub`, Earnings inside it)

- Signed-in creators only. `CreatorHubPage.tsx` 1129 lines (+ `TrendChart.tsx` 334).
- Verdict: **enhance**.
- Evidence: a plain `hub-head` with a Sora h1 (`CreatorHubPage.tsx:207-218`). The view switch is chips in `filter-pillbar` (`:233-238`), a second tab style. The v0.66 dashboard structure is sound (`styles.css:7643+`). Keep the data and chart.

### 3.15 Landing (`/`)

- Public, signed-out front door and SEO page. `Landing.tsx` 370 lines + `PlanBench.tsx` 589.
- Verdict: **redesign, mockup required**.
- Evidence: a different visual language. A heavy Sora hero with an inline-coloured span (`Landing.tsx:42-43`), a navy "adventure" card (`:59-65`), a saffron gradient button (`:54`), a boarding-pass strip, a ticker, a bento with dark photo cells. 17 inline styles. See `docs/screenshots/landing-live-2026-09-15.png`. The Plan Bench calculator is a working tool. Keep its logic.
- A start-point mockup exists: `docs/redesign/yatraflow-enhanced-homepage-mockup.svg` (older direction; treat as input only).

### 3.16 Native home (`/` in the Android shell) and bottom nav

- Signed-in, Android shell only. `NativeHome.tsx` 153 lines, `BottomNav.tsx` 72.
- Verdict: **enhance (last)**.
- Evidence: its own `app-home` system (`NativeHome.tsx:96-125`, `styles.css:6003-6091`), Sora h1, emoji trip rows. Not visible on the web.

### 3.17 Admin (`/admin`)

- Admins only, unlinked. `AdminPage.tsx` 859 lines.
- Verdict: **enhance (minimal, last)**.
- Evidence: bare h1 (`AdminPage.tsx:58-60`), 38 inline styles, `filter-pillbar` chips as a tablist (`:66-72`), 5 `EmptyState`.

### 3.18 Cross-cutting surfaces

| Surface | Verdict | Evidence |
|---|---|---|
| Tabs and segmented controls | enhance (one primitive) | Three styles: `PillNav.tabbar` (workspace, auth), `filter-pillbar` chips (hub, admin, 5 uses), `ViewSwitch` (My trips). `PillNav` class counts: 5× `filter-pillbar`, 3× `tabbar`, 2× `mode-pillbar`, 1× `view-pillbar` |
| Empty, loading, error states | enhance (one primitive) | `EmptyState` in 8 files (25 uses), `loading-block` in 8 files, `ExploreStateBlock` in Explore only, bespoke error cards in Purchases |
| Dialogs (`Modal`, `ConfirmDialog`) | enhance | `ui.tsx:27,97`; excluded from the button skin (`styles.css:8395`) |
| Error boundary | enhance | `ErrorBoundary.tsx:73`, `empty-state` with inline padding |
| Unlock reveal | OK, image-dependent | `UnlockReveal.tsx:60`, `CoverThumb` with emoji fallback |
| Offline and remote-edit banners | OK | `OfflineBanner.tsx`, `RemoteEditBanner.tsx` |
| Static Ladakh calculator, server-rendered `/i/` body, OG card | out of scope | `public/ladakh-trip-cost-calculator/` and `api/_publicBody.js` are on `origin/test`; separate stacks with their own fonts |

### 3.19 What the audit did not see

- The audit did not render the signed-in legacy pages. The only signed-in screenshots are of My trips (`scratchpad\mtshots6`). Dark mode and 390px for Profile, Hub, Purchases, Workspace and Create trip are **not verified**. The first sweep in Phase 0 must capture them as the "before" set.
- Accessibility was checked by reading code only (heading levels, labels, roles). No axe run was made.

---

## 4. Phase 0: foundations (do this before any page)

Phase 0 makes each page cheaper and keeps the pages the same. Do it on one branch: `feat/consistency-foundations`.

### 4.1 Decisions first (picker)

Ask the open questions in section 9 that change Phase 0: Q1 (serif scope), Q2 (title font), Q3 (button skin scope). Record the answers in `DESIGN.md` Typography and Components, in STE, in the same branch.

### 4.2 Shared design primitives

Put them in `src/components/page/`. Keep the `ex-`/`mt-` class names that exist. Add neutral wrappers. Do not rename existing selectors (the line-keyed baseline and many pins read them).

| Primitive | Built from | Used by |
|---|---|---|
| `PageHero` (full editorial hero: kicker, serif h1 + accent, lede, primary, secondary, stats, postcards, note) | merge `ExploreHero` and `TripsHero`; both become thin callers | Explore, My trips, Creator page, Landing (if Q6 says so) |
| `PageHeader` (compact editorial header: back link, kicker, serif h1 with optional accent, lede, actions, optional stat row; no postcards) | new, same tokens as the hero | Purchases, Profile, Creator hub, Create trip, Trip created, Auth, Admin, Workspace header (if the mockup picks it) |
| `StateBlock` (`kind: 'loading' \| 'failed' \| 'empty' \| 'kept'`, icon, optional `art` slot, title, body, actions; `role="status"` on loading and kept) | `ExploreStateBlock` + `EmptyState` | every page; replaces `EmptyState` and `loading-block` by a ratchet |
| `SectionHead` (h2 + right-side actions) | `mt-section-head` | My trips, Creator page, Purchases, Hub, Profile |
| `Surface` card skin (`.yf-surface`: radius, `--shadow-card`, `--line-strong` hover only when clickable) | `.ex-card`/`.mt-card` shell without the cover | settings panels, hub panels, purchase rows |
| `SegmentedTabs` (one tab look, `useTablist` keyboard contract, pill glider motion) | `PillNav` + `ViewSwitch` look | workspace tabs, auth tabs, hub, admin |
| `FilterBar` (layout shell around `SearchField`, `Select`, `FilterChip`, Clear) | `ExploreFilterBar` layout | Explore, My trips, Admin tables |

The parked "universal trip card" fits here later. It would merge `ExploreCard`, `TripCard`, `UpNextCard`, `PubCard` and the purchase row on one cover + body + facts + foot frame. Do not build it in Phase 0. The first step toward it is in the Creator page (replace `PubCard` with `ExploreCard`). The second is Purchases (a row variant). Decide on the full card after those two pages (Q8).

### 4.3 Page skin scope

- Add a page-scope class `yf-page`. Move the button rules at `styles.css:8395-8409` and the 1240px width rule at `:8382` to also match `.yf-page`. Do this with a new rule block at the end of the file. Do not edit the old lines.
- Each converted page adds `yf-page` to its root. The skin then reaches it. Unconverted pages stay as they are.
- After the last page, a final cleanup branch folds the skin into the base `.btn`, if Q3 says so.

### 4.4 Tokens

Add to the shared-tokens `:root` block at the end of `styles.css` (append a new block; do not edit `:8926`):

- `--hero-radius: 28px`, `--hero-pad: 44px` (and the phone values), so `PageHero` and `PageHeader` share them.
- `--title-font` (the answer to Q2) for section and card titles.
- `--page-max: 1240px`.

Check both themes. Run the contrast part of `tests/design-system.test.ts`.

### 4.5 Design-consistency guard (`tests/page-consistency.test.ts`)

Node env, no DOM, reads source as text. It is a ratchet: each count may only fall. Store the counts in `tests/page-consistency-baseline.json`, keyed by file (not by line).

- Each page root that `App.tsx` routes must carry `yf-page`, or sit in the baseline allowlist. The allowlist may only shrink.
- Count `<EmptyState` and `loading-block` per file. A count may not rise. A new file must use `StateBlock`.
- Count `style={{` per page file. A count may not rise.
- A page `<h1>` must sit inside `PageHero` or `PageHeader`, or be in the allowlist.
- `--font-serif` and `--font-hand` may appear only in the rules that Q1 allows.
- A card rule with `:hover` must use `--shadow-card-hover` and motion-token durations.
- Prove the guard can fail. Add one known-bad fixture string per rule in the test itself.

Note the scan trap (AGENTS.md): a guard that greps a literal also reads comments in the guarded file. Do not quote the guarded literals in new comments.

### 4.6 Motion interaction checks

A worker is adding interaction checks (hover, state change) to the motion guard. Do not duplicate it.

- Before Phase 0 ends, read its branch or PR state with `git ls-remote --heads origin` and `gh pr list --state open --limit 500`.
- When it lands, add each converted page's routes and interactions to its list in the same page PR.
- Until it lands, each page PR carries manual motion proof (section 5, step 7).
- `scripts/browser-motion-check.mjs` covers public routes only (`/`, `/explore`, `/auth`, `/trips`). Add `/pub/<fixture>`, `/creator/<fixture>`, `/dmca` when those pages convert.

### 4.7 Playwright-style screenshot sweep script

Add `scripts/ui-sweep.mjs` (dev only; not part of `verify`). Reuse the CDP approach in `scratchpad\mtshots6\cdp.mjs` (headless Edge/Chrome, no new dependency), or Playwright if it is already installed.

- Input: a route list, themes (`light`, `dark`), widths (1280, 390; 320 as an option), an output folder.
- Output: `.verify-evidence/sweep/<branch>/<route>-<width>-<theme>.png` and one JSON line per shot with `scrollWidth > innerWidth` (overflow), the h1 text, and console errors.
- Hover mode: hover the first card and the primary button, then capture.
- Motion mode: sample opacity and transform of the page root's children per frame, like `browser-motion-check.mjs`.
- Signed-in routes need a session on the same origin (AGENTS.md §2.7). Use a persistent browser profile that the user signs in once, on the same port. If you automate sign-in, read `YF_SWEEP_EMAIL` and `YF_SWEEP_PASSWORD` from the environment only. Never write them to a file or a log.
- Check `.gitignore` covers `.verify-evidence/`.
- Run it once at the end of Phase 0 on every route. That is the "before" set for every page.

### 4.8 Phase 0 acceptance

- `PageHero`, `PageHeader`, `StateBlock`, `SectionHead`, `SegmentedTabs`, `FilterBar` exist. Explore and My trips use them with no visual change (before/after screenshots match at 1280 and 390, light and dark).
- My trips uses `StateBlock` for all states. Its Trash view uses `Surface` and `SectionHead`.
- The guard passes and fails on its fixtures.
- The sweep script runs and writes the full before set.
- `DESIGN.md` records the Q1–Q3 answers.
- `npm run verify` passes. The changelog entry is in.

### 4.9 Phase 0 effort and routing

| Task | Model | Worker-hours |
|---|---|---|
| Primitives + Explore/My trips migration with no visual change | Haiku (Sonnet if the screenshots differ twice) | 6–8 |
| `yf-page` scope + tokens | Haiku | 1–2 |
| Consistency guard + baseline + fixtures | Haiku | 2–3 |
| Sweep script + first full sweep | Haiku | 3–4 |
| `DESIGN.md` + changelog | Haiku | 1 |
| Review | Opus | 1 |
| **Total** | | **14–19** |

---

## 5. The per-page workflow loop

Run this loop for every page. Do not start the next page until the user accepts the current one.

1. **Branch.** `git fetch origin`. Cut `feat/consistency-<page>` from `origin/test`. Check `git status -sb`.
2. **Mockup gate.** If the page table says "mockup required", the user must approve a mockup first. A Sonnet worker builds the mockup as a static HTML file in the scratchpad (same tokens, real data shapes from fixtures). Show it at 1280 and 390, light and dark. Ask approval with the picker. Do not write app code before approval.
3. **Difference list.** The worker writes a numbered list of differences between the current page (the Phase 0 "before" screenshots) and the target (the mockup, or section 2 when no mockup). Each line names the file and the selector. The orchestrator checks the list before the build.
4. **Build.** Adopt the Phase 0 primitives first. Then page-specific CSS, appended at the end of `styles.css`. Keep every handler, read state and honesty branch. Add `yf-page` to the root.
5. **Before/after screenshots.** Run the sweep on the page routes: light and dark, 1280 and 390. Put each after-shot next to its before-shot and the mockup. The worker lists each difference from step 3 as fixed, or as open with a reason.
6. **Phone and overflow.** At 390 (and 320), check no horizontal scroll, 44px touch targets, no clipped text. Overflow checks support the screenshots. They do not replace them.
7. **Motion proof.** Show the entrance (frame samples), hover on a card and on the primary button (computed `transform`, `box-shadow`, `transition-duration` and a hover screenshot), and one state change (a filter, tab or toggle). Confirm the reduced-motion opt-out with emulated `prefers-reduced-motion: reduce`.
8. **Accessibility basics.** One h1. Heading levels do not skip. Every control has a name. Focus ring is `var(--ring)`. Contrast passes in the design-system test.
9. **Guards.** Update `tests/page-consistency-baseline.json` downward only. Add the page's routes to the motion check if it is public. Add a page pin test when the page has a load-bearing structure (for example, the paywall lock order).
10. **Verify gate.** `npm run verify`. Then `npm run lint:ratchet`. If the design-system baseline moves, follow the re-baseline procedure in AGENTS.md and prove the diff is line numbers only.
11. **Changelog.** One `[Unreleased]` entry under Changed, written in STE, final state, editor primitives only.
12. **Opus review.** An Opus subagent reviews the diff, the screenshots and the difference list. Fix what it finds.
13. **Localhost hand-off.** Give the user the exact URLs, light and dark, and what to check. Wait for acceptance.
14. **PR.** On the user's say-so, push the branch and open a PR into `test`. Never merge without the user's say-so. After a merge, check `gh issue view` for any referenced issue.

---

## 6. Page plan (in build order)

### 6.1 Why this order

The order ranks by three things: how many users see the page, how much a shared primitive gets proven for later pages, and how much risk the page carries.

1. The shell and the workspace header come first. Every signed-in session passes through them, and the break from My trips into a trip is the most visible one.
2. Small sibling pages come next (Purchases, Creator page, Trip created, Invite). They are cheap, they prove `PageHeader`, `StateBlock` and the card reuse, and they remove obvious mismatches beside the reference pages.
3. The public money and share pages follow (Public itinerary), once the primitives are proven.
4. Create trip and the forms follow. They are large and need care, but they gain most from proven primitives.
5. Landing is a full redesign and depends on images. Start its mockup early so approval runs in parallel. Build it late.
6. Android home and Admin come last. Few users see them.

### 6.2 Common acceptance checklist (every page)

- [ ] Root carries `page-enter` and `yf-page`.
- [ ] h1 is in `PageHero` or `PageHeader`, in the agreed font (Q1).
- [ ] Section titles use `SectionHead` and `--title-font`.
- [ ] Every loading, failed and empty branch uses `StateBlock`. The three stay separate renderings.
- [ ] Cards use the `Surface` or card skin, with the token hover.
- [ ] Buttons follow the page skin. One primary button per view.
- [ ] No new inline style. The page's inline-style count falls.
- [ ] No invented data. Every number has a source in the store or a read.
- [ ] Light and dark screenshots at 1280 and 390, next to the before set and the mockup.
- [ ] Motion proof: entrance, hover, one state change, reduced motion.
- [ ] No horizontal scroll at 390 and 320. Touch targets are 44px.
- [ ] `npm run verify` and `npm run lint:ratchet` pass. The changelog entry is in.

### 6.3 Pages

**P1. App shell: footer, route fallback, dialogs, error boundary**
- Verdict: enhance. Mockup: not required.
- Scope: route fallback (`App.tsx:55,299`) and `ErrorBoundary` to `StateBlock`. Footer gets the editorial type and a small hand-drawn route mark (no new links). `Modal` and `ConfirmDialog` buttons follow the page skin (needs Q3). Keep the topnav as it is.
- Reuse: `StateBlock`, `yf-page` button skin.
- Tests: guard counts for `App.tsx` fall. Pin that the route fallback keeps `role="status"`.
- Risks: the dialog skin reaches every page, including the workspace. Sweep all routes after it.
- Effort: 3–4 h. Routing: Haiku; Opus review.
- Images: none.

**P2. Trip workspace header and tab bar**
- Verdict: redesign (header and tabs only). Mockup: **required**. Start from `docs/redesign/yatraflow-calm-travel-intelligence-workspace-mockups.svg` as input.
- Scope: replace the navy `trip-head-card` with an editorial header: cover thumb or papercut art, serif trip name, route and dates line, member stack and presence, the Invite & share action. Replace the tab bar with `SegmentedTabs`. Keep the tab keyboard contract (`useTablist`), counts, deep-link `initialTab`, the `container--board`/`container--map` widths, and the compact-on-scroll padding transition. The "Trip not found" and "Loading trip…" branches move to `StateBlock`.
- Reuse: `PageHeader` (variant `trip`), `SegmentedTabs`, `TripArt`.
- Tests: pin that every tab key in `TABS` still renders one tab with `aria-controls`. Keep the existing presence and role tests green.
- Risks: the Map and Board tabs use a wider container. The header must not push the map below the fold at 1280×800. Check the map height in the screenshots.
- Effort: 8–10 h. Routing: Sonnet (mockup match); Haiku for the tests; Opus review.
- Images: the header thumb uses the generated region art when it lands (image plan phase 5). Build with `TripArt` now.

**P3. Purchases**
- Verdict: enhance. Mockup: not required.
- Scope: `PageHeader` with a back link to My trips, kicker "My trips", serif h1 "My purchases", the lede, and the real summary figures (count, paid total, refunded, pending) as the stat row. All four state branches to `StateBlock`. Purchase rows on the `Surface` skin with a hover lift. Keep every honesty caveat (`Purchases.tsx:143-153,176-208`).
- Reuse: `PageHeader`, `StateBlock`, `Surface`. A row variant of the card is the second step to the universal card.
- Tests: pin that "at least" appears when the total is not readable. Pin that failed and empty are separate branches.
- Risks: the summary line holds legal-grade honesty. Do not round or merge its parts.
- Effort: 3–4 h. Routing: Haiku; Opus review.
- Images: row thumbs use region art when it lands (image plan phase 5). Until then, replace the emoji with `TripArt` only if Q10 says so.

**P4. Creator page**
- Verdict: redesign (small). Mockup: **required** (a short one: hero + grid).
- Scope: a `PageHero` variant with the avatar in place of postcards, the creator name as the serif h1, home city and languages as the lede, bio, social links and Copy link as quiet buttons, the three real figures as the stat row (keep "unavailable" when a read failed). The grid uses `ExploreCard` in `ex-grid`, with `enterIndex` stagger. Keep all state branches.
- Reuse: `PageHero`, `ExploreCard`, `StateBlock`, `SectionHead`.
- Tests: pin that `CreatorPage` imports `ExploreCard` and not `PubCard`. If `PubCard` then has no caller, delete it in the same PR and say so in the changelog.
- Risks: `PubCard` fork attribution passes `'creator'` as the source (`CreatorPage.tsx:147`). `ExploreCard` must carry the same source, or the share-attribution tests break.
- Effort: 4–5 h. Routing: Sonnet; Haiku for the tests; Opus review.
- Images: card covers follow Explore. No new images.

**P5. Trip created**
- Verdict: enhance. Mockup: not required.
- Scope: `PageHeader` with kicker "Trip created" and a serif h1 with the trip name as the italic accent and "is live." The "not loaded" branch to `StateBlock`. Cards on the `Surface` skin. Keep the `useReveal` choreography.
- Reuse: `PageHeader`, `StateBlock`, `Surface`.
- Tests: keep `create-*` and `createHandoff` tests green.
- Effort: 3 h. Routing: Haiku; Opus review.
- Images: none.

**P6. Invite gate and shared snapshot**
- Verdict: enhance. Mockup: not required.
- Scope: every branch to `StateBlock` inside a `page-enter` root. The signed-out invite shows a small trip preview from data the gate already holds (name, route, dates, member count), with no new reads. Log in and Create account keep their `next` parameters exactly.
- Reuse: `StateBlock`, `PageHeader` (compact), `TripArt`.
- Tests: `join-invite.test.ts` and `fetch-shared-trip.test.ts` stay green. Pin that both auth buttons carry `next`.
- Risks: the `next` round-trip is load-bearing (`App.tsx:789-794`). Do not change the navigation calls.
- Effort: 2–3 h. Routing: Haiku; Opus review.
- Images: none.

**P7. Public itinerary**
- Verdict: enhance. Mockup: **required**. Start from `docs/redesign/yatraflow-editorial-public-itinerary-mockup.svg` as input.
- Scope: serif h1 and section titles (Q1), the Save and Fork buttons on the page skin, the loading and failed branches to `StateBlock` (fix the nested container at `PublicItinerary.tsx:394-395`), the day highlight cards on the card skin with hover. Decide the hero (Q5): keep the photo over a forced-dark scrim, or move to the cream editorial band with the photo as a framed postcard.
- Reuse: `PageHero` or `PageHeader`, `StateBlock`, card skin.
- Tests: the paywall pins (locked days, preview split, price undefined when free, entitlement read order) must stay green. Add `/pub/<fixture>` to the motion check.
- Risks: this is the money page. The unlock, fork and entitlement branches are long and subtle (`PublicItinerary.tsx:390-522`). Change markup and classes only. Do not move logic. The server-rendered body in `api/_publicBody.js` must still match the visible content for SEO.
- Effort: 8–10 h. Routing: Sonnet; Haiku for the tests; Opus review (required, money page).
- Images: the hero fallback uses region art when it lands (image plan phase 5).

**P8. Auth and DMCA**
- Verdict: enhance. Mockup: required only if you add a side visual (Q-auth in section 9).
- Scope: the auth card gets a serif title and the page skin. Tabs move to `SegmentedTabs`. Inline styles move to classes. DMCA becomes a `PageHeader` + `Surface` text page, not an auth card.
- Reuse: `PageHeader`, `SegmentedTabs`, `Surface`.
- Tests: `auth-errors.test.ts`, `age-gate.test.ts`, `dmca-page.test.ts` stay green.
- Risks: the auth tablist ids are referenced by `aria-labelledby` (`Auth.tsx:158`). Keep them.
- Effort: 2–3 h (5–6 h with a side visual). Routing: Haiku (Sonnet if a mockup); Opus review.
- Images: a side visual would use a Landing image from image plan batch 6.

**P9. Profile & settings**
- Verdict: enhance. Mockup: not required.
- Scope: `PageHeader` (h1, trip count and email as the lede). Panels on the `Surface` skin with `SectionHead`-style titles. Choice rows on `FilterChip`. Inline styles to classes. Keep the AI-companion flag gate.
- Reuse: `PageHeader`, `Surface`, `FilterChip`.
- Tests: `browserNotifications.test.ts`, `featureFlags.test.ts` stay green.
- Effort: 3–4 h. Routing: Haiku; Opus review.
- Images: none.

**P10. Creator hub (with Earnings)**
- Verdict: enhance. Mockup: not required (dashboard keeps its structure).
- Scope: `PageHeader` with the View public page action. The Overview/Earnings switch moves to `SegmentedTabs`. Panels on `Surface`. The Earnings loading and failed states to `StateBlock` (`CreatorHubPage.tsx:971`). Keep the KPI strip and `TrendChart` as they are.
- Reuse: `PageHeader`, `SegmentedTabs`, `Surface`, `StateBlock`.
- Tests: `earnings.test.ts`, `creator-trend.test.ts` stay green. Pin that a failed sales read never renders "No sales yet" (AGENTS.md §6).
- Risks: the empty-vs-failed rule for sales is a known past incident. Keep both branches.
- Effort: 5–6 h. Routing: Haiku; Opus review.
- Images: none.

**P11. Create trip**
- Verdict: enhance. Mockup: **required** (header and template strip only).
- Scope: `PageHeader` (kicker "Start something", serif h1). Template cards use `TripArt` by region in place of the emoji and gradient. The draft banner on the `Surface` skin. Keep the Trip Ticket rail, the readiness logic, the dock on phones and every form contract.
- Reuse: `PageHeader`, `TripArt`, `Surface`.
- Tests: all `create-*` and `createDraft` tests stay green. `create-a11y.test.ts` must pass.
- Risks: a 1658-line file with a fixed mobile dock (`styles.css:5954`). Edit by unique anchors only (CODING_STANDARDS §3).
- Effort: 6–8 h. Routing: Sonnet (mockup match); Haiku for the tests; Opus review.
- Images: template covers and the ticket scenery use region art when it lands (image plan phase 5).

**P12. Workspace tabs (one PR per tab)**
- Order: Overview, Budget, Group input, Share, Settings, then Timeline/Board/Map states only.
- Verdict: enhance (Overview, Budget, Group input, Share), light enhance (Settings), OK with state blocks only (Timeline, Board, Map).
- Mockup: not required. The existing SVG mockups in `docs/redesign/` (budget, decisions, share) are reference input only.
- Scope per tab: panel titles to `--title-font`, panels on `Surface`, states to `StateBlock`, inline styles to classes, hover and state-change motion from the catalog.
- Tests: each tab's existing pins stay green (budget-*, decision-*, group-input-busy, share-attribution, day-*).
- Risks: these are tool surfaces. Density matters more than editorial space. Do not add hero bands inside tabs.
- Effort: Overview 4, Budget 4, Group input 4, Share 4, Settings 2, Timeline/Board/Map 2. **Total 20 h.** Routing: Haiku; Sonnet only where Haiku fails twice; Opus review per PR.
- Images: none (image plan row 23 keeps icons in tool states).

**P13. Landing**
- Verdict: redesign. Mockup: **required**. Start the mockup right after Phase 0, so approval runs in parallel.
- Scope: the hero moves to the editorial `PageHero` language (serif h1 with one accent, cream band, papercut postcards, hand note). The Plan Bench keeps its logic and gets the page skin. Feature, steps and CTA sections get the card skin and `SectionHead`. Keep the invite-code entry and the demo buttons. Keep the RouteSquiggle as a product demo, or move it into a card (mockup decides).
- Reuse: `PageHero`, `Surface`, `SectionHead`, `TripArt`.
- Tests: `hero-contrast.test.ts` and the landing motion entry in `browser-motion-check.mjs` stay green. Pin one primary CTA in the hero.
- Risks: SEO and first impression. The landing runs continuous animations that `App.tsx:166-175` gates. Keep that gate. Keep the heading text that search depends on, or ask.
- Effort: 12–16 h. Routing: Sonnet; Haiku for the tests; Opus review (required).
- Images: the two Landing images and the OG card come from image plan batch 6. Build with papercut SVG first, then swap.

**P14. Native home and bottom nav (Android shell)**
- Verdict: enhance. Mockup: not required.
- Scope: greeting as a compact `PageHeader`, trip rows on the card skin with `TripArt` thumbs, actions on the page skin. Keep the shell gate (`isNative && me`).
- Tests: `android-back.test.ts` stays green.
- Risks: needs an Android build or the shell emulation to check. Web screenshots alone do not prove it.
- Effort: 3 h. Routing: Haiku; Opus review.
- Images: row thumbs use region art when it lands.

**P15. Admin**
- Verdict: enhance (minimal). Mockup: not required.
- Scope: `PageHeader`, `SegmentedTabs`, `StateBlock`, inline styles to classes. Keep the audit-log notice.
- Tests: `admin-*.test.ts` stay green.
- Effort: 2–3 h. Routing: Haiku; Opus review.
- Images: none.

**P16. Final fold-in**
- Fold the `yf-page` skin into the base rules (if Q3 says app-wide). Delete the now-empty allowlist entries in the guard. Delete dead CSS for removed selectors, in its own commit.
- Effort: 3–4 h. Routing: Haiku; Opus review.

---

## 7. One-page summary table

| # | Page / surface | Route | Audience | Lines | Verdict | Mockup | Effort (h) | Images |
|---|---|---|---|---|---|---|---|---|
| 0 | Foundations | — | — | — | build | no | 14–19 | no |
| 1 | App shell | all | all | 817 | enhance | no | 3–4 | no |
| 2 | Workspace header + tabs | `/trip/:id` | signed-in | 560 | **redesign** | **yes** | 8–10 | later (thumb) |
| 3 | Purchases | `/purchases` | signed-in | 357 | enhance | no | 3–4 | later (thumbs) |
| 4 | Creator page | `/creator/:id` | public | 155 | **redesign** | **yes** (short) | 4–5 | no |
| 5 | Trip created | `/created/:id` | signed-in | 612 | enhance | no | 3 | no |
| 6 | Invite + shared snapshot | `/join`, `/invite`, `/share` | public | in App.tsx | enhance | no | 2–3 | no |
| 7 | Public itinerary | `/pub/:slug` | public | 944 | enhance | **yes** | 8–10 | later (hero fallback) |
| 8 | Auth + DMCA | `/auth`, `/dmca` | public | 195 + 37 | enhance | only with a side visual | 2–6 | optional (batch 6) |
| 9 | Profile & settings | `/profile` | signed-in | 545 | enhance | no | 3–4 | no |
| 10 | Creator hub + Earnings | `/creator-hub` | creators | 1129 | enhance | no | 5–6 | no |
| 11 | Create trip | `/new` | signed-in | 1658 | enhance | **yes** (header + templates) | 6–8 | later (templates, ticket) |
| 12 | Workspace tabs (8) | `/trip/:id/<tab>` | signed-in | ~6,800 | enhance / OK | no | 20 | no |
| 13 | Landing | `/` | signed-out | 370 + 589 | **redesign** | **yes** | 12–16 | **yes** (batch 6) |
| 14 | Native home + bottom nav | `/` (shell) | Android | 153 + 72 | enhance | no | 3 | later (thumbs) |
| 15 | Admin | `/admin` | admins | 859 | enhance | no | 2–3 | no |
| 16 | Final fold-in | — | — | — | cleanup | no | 3–4 | no |
| — | Explore | `/explore` | public | 412 | OK (reference) | — | in Phase 0 | done |
| — | My trips | `/trips` | signed-in | 483 | OK, small enhance | — | in Phase 0 | done |
| | **Total** | | | | | | **~105–130** | |

---

## 8. Image-set dependency

The plan is `scratchpad\image-set-plan.md` (prepared 2026-10-11; the user sent it to Codex). Copy it next to this plan if the scratchpad may be cleaned: `C:\Users\hasna\Documents\yatraflow-image-set-plan.md`.

- No page in this plan waits for images. Every page builds with the papercut `TripArt` SVG first. The image plan keeps that SVG as the loading placeholder and the error floor, so nothing is thrown away.
- `StateBlock` gets an optional `art` slot in Phase 0. Image plan phase 5 fills it with the empty-state vignettes. Use the slot only on page-level states. Tool states inside the workspace keep their icons (image plan row 23).
- Pages that take generated art later (image plan phase 5): Workspace header thumb (P2), Purchases rows (P3), Public itinerary hero fallback (P7), Create trip templates and ticket scenery (P11), Native home rows (P14), Unlock reveal (shell), and the `CoverThumb` change that drops the automatic Wikipedia photo.
- The Landing (P13) needs image plan batch 6 (two Landing images and the OG card). Build the Landing with papercut art. Swap in the batch 6 files in a follow-up PR when they exist.
- When the image pipeline (image plan phases 1–2) lands on `test`, rebase the open page branch before the next page starts. Do not wire images inside a page PR. Keep the image work in its own PRs.

---

## 9. Open questions for the user (ask with the picker)

1. **Serif scope.** `DESIGN.md` says Playfair and Caveat appear only in a catalog hero. Do you want the serif h1 on every page header (recommended), on heroes only, or nowhere new?
2. **Title font.** Explore and My trips use Plus Jakarta Sans 800 for section and card titles. The rest of the app uses Sora. Which one wins app-wide?
3. **Button skin.** Promote the catalog button (12px corners, 44px) to every page and every dialog, or keep pill buttons inside the workspace tools?
4. **Workspace header.** Move the trip header from navy to the cream editorial band (recommended), or keep a dark band and only change the type?
5. **Public itinerary hero.** Keep the photo under a dark scrim, or move to the cream band with the photo as a framed postcard?
6. **Landing.** Redesign now in parallel (mockup first), or wait until the image set batch 6 exists?
7. **Hand notes.** Where may a Caveat note appear: heroes only, or also empty states and the trip-created moment?
8. **Universal trip card.** Keep it parked until after P3 and P4, then decide? Or start it in Phase 0?
9. **Scope.** Are Admin (P15) and the Android home (P14) in scope, or should they wait?
10. **Purchases fallback.** Replace the emoji thumb with papercut art now, or wait for the generated images?
11. **Uncommitted work.** The clone has uncommitted edits on `feat/port-686`. At the end of this audit they were in `src/pages/Explore.tsx`, `src/styles.css`, `scripts/browser-motion-check.mjs` and `src/components/trips/ViewSwitch.tsx`. Another worker (the motion interaction checks) was still editing. Wait for that worker, then commit the edits on that branch, or leave them, before the new branches start?
12. **PR size.** One PR per workspace tab (recommended), or one PR for all tabs?
13. **Auth side visual.** Add a papercut side panel to the auth card (needs a mockup), or keep the single card?
14. **Port.** The signed-in browser profile from the last session is bound to port 5191. Use 5191 for this work, or another port that you sign in on once?

---

## 10. Risks (all pages)

1. **Global skin regressions.** The button and card skin today is scoped to two pages. Promoting it reaches the Timeline, Map and Board, which are long-refined. Mitigation: the opt-in `yf-page` scope, a full-route sweep after any shared rule changes, and the fold-in only at the end.
2. **Signed-in proof gap.** CI motion checks cover public routes only. The signed-in pages (Workspace, Purchases, Hub, Profile, Create trip) need a session bound to the dev-server origin. Mitigation: the sweep script with a persistent profile, credentials from environment variables only, and manual proof in each PR.
3. **Logic in large files.** Public itinerary (paywall, entitlements), Create trip (1658 lines), and the workspace carry honesty and money logic. A visual change can break a pin. Mitigation: markup and classes only, unique-anchor edits, Opus review on P2, P7, P11 and P13.
4. **Line-keyed baseline.** Any CSS inserted above existing rules remaps the design-system baseline. Mitigation: append only; re-baseline by the AGENTS.md procedure and prove the diff is line numbers only.
5. **Parallel lanes.** Other agents edit the same pages, and `feat/port-686` is behind `origin/test` by 8 commits. Mitigation: branch every page from a fresh `origin/test`, check `git ls-remote --heads origin` for the page before you start, and claim the work.
6. **Guard comment trap.** A source-scanning guard also reads comments in the guarded file. Mitigation: do not quote guarded literals in new comments; re-run the guard after any comment edit.
7. **Not-yet-seen states.** Dark mode and 390px for most legacy pages were not rendered in this audit. Mitigation: the Phase 0 "before" sweep, before any page work.
