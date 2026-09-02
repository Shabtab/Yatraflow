# YatraFlow Roadmap

Living document — reviewed each session, updated as items land. Done items move
to [CHANGELOG.md](CHANGELOG.md); this file only tracks what's ahead.

**Snapshot (2026-09-02):** v0.23.0 · all tests green (218) · realtime live
(all 8 tables) · UI-audit remediation complete (32/32, both P0s closed) ·
"Calm Travel Intelligence" redesign **in progress** on
`redesign/calm-travel-intelligence` (see
`docs/redesign/YATRAFLOW_DESIGN_DIRECTION.md` + `implementation_plan.md`):
M1 tokens ✅ · M2 landing/nav ✅ (+M2.1 pill nav, now static) · M3 Overview
bento ✅ (+ real-geometry route snapshot) · M4 Timeline polish ✅ · M5 Board
✅ (+ mockup-cleanliness, map-first canvas & motion passes) · M6 Budget/
Decisions/Share/Suggestions hierarchy ✅ · M7 Explore + Public Itinerary editorial treatment ✅ — **redesign
feature-complete**; pending v0.24.0 merge confirmation. Merges to `main` as
v0.24.0 only with user confirmation.

---

## 🔴 P0 — Compliance & licensing

### 1. ~~#23 — Basemap licensing swap~~ ✅ shipped (see CHANGELOG `[Unreleased]`)
CARTO Basemaps + Esri World Imagery replaced with keyless
[OpenFreeMap](https://openfreemap.org) vector styles (`positron` / `dark`) —
same look, MIT service, ODbL map data, no request limits, no key, no bill.
Attribution arrives via the TileJSON (`tiles.openfreemap.org/planet`) that the
style's `openmaptiles` source resolves — MapLibre renders it automatically, so
no `customAttribution` injection is needed (injecting one duplicates the
credit). Google tiles rejected: not licensed to
third-party renderers, and would need a Maps JS API rewrite plus a mandatory
billing account. **No P0 items remain.**

## 🟡 P1 — AI / LLM (issues #22 → #20, in that order)

### 2. #22 — OpenAI-compatible AI provider endpoint
- Config surface (`baseUrl` + API key — decide: encrypted `profiles` column vs
  localStorage-with-warning) so the app can call any OpenAI-compatible
  endpoint (OmniRoute, OpenAI, Groq, Together…).
- **Effort:** ~2 h · new `src/lib/aiProvider.ts` + Profile settings section.
- **Blocks:** #20.

### 3. #20 — AI companion: wire real LLM, keep offline fallback
- `src/lib/ai.ts` is a keyword router with canned answers. Add a real
  `answerQuestion` path: trip-context prompt → `/v1/chat/completions` → text.
  Keep the deterministic router as the honest offline fallback; badge the
  AiDrawer "(LLM)" vs "(offline rules)"; keep the "not live data" disclaimer.
- **Effort:** ~3 h · depends on #22.

## 🟣 UI-audit remediation — 32 findings (Vercel Web Interface Guidelines + WCAG 2.2 AA)

Full report: [`docs/UI_AUDIT.md`](docs/UI_AUDIT.md) — 2 P0 · 15 P1 · 15 P2, each
with `file:line` + a concrete example fix (on `test` until merged to `main`).
This section is the **live tracker**: tick a finding in the same commit that
fixes it; CHANGELOG carries the narrative.

| Batch | Scope | Findings | Status |
|---|---|---|---|
| 1 | Theming & touch CSS (`color-scheme`, `theme-color`, `touch-action`, `overscroll-behavior`, safe areas, `accent-color`, `text-wrap: balance`, `tabular-nums`, title clamp) | F-18 F-19 F-20 F-23 F-24 F-25 F-26 F-27 F-28 ✅ F-29 F-30 | ✅ `6a96914` |
| 2 | Shared primitives — the `Field` label fix covers ~30 call sites | F-01 (P0) ✅ F-03 ✅ F-11 ✅ | ✅ this commit |
| 3 | Focus ring (17 selectors) + reduced-motion guard | F-12 ✅ F-17 ✅ | ✅ this commit |
| 4 | A11y attributes & navigation semantics (+ orphaned F-04 folded in) | F-02 ✅ F-04 ✅ F-05 ✅ F-06 ✅ F-07 ✅ F-08 ✅ F-09 ✅ F-10 ✅ | ✅ this commit |
| 5 | Form hygiene (autocomplete, focus-first-error, unsaved-changes guard) | F-13 ✅ F-14 ✅ F-15 ✅ F-16 ✅ | ✅ this commit |
| 6 | URL state (tabs, Explore filters) + copy | F-21 ✅ F-22 ✅ F-31 ✅ F-32 ✅ | ✅ this commit |

**Progress: 16/32** · P0s: **2 of 2 closed** (F-28 ✅, F-01 ✅) · ~6 h remaining.
CSS-only batches are invisible to tsc+tests — always gate on the full
`npm run verify` (vite build is the step that catches them).

## 🟠 P2 — Polish & UX debt (not yet tracked as issues)

### 4. Loading skeleton on first boot
- Blank landing page 1–3 s while the store hydrates. Show a branded pulse
  during the initial `init()` window in `App.tsx`. **~30 min.**

### 5. Profile page: surface all UserProfile fields
- `homeCity`, `travelStyles`, `languages`, `socialLinks`, `creatorBio`,
  `isCreator` exist in the type + `updateProfile()` exists in the store but
  are not editable in `Profile.tsx`. **~1.5 h.**

### 6. Route polylines on the map
- `routing.ts` already returns road geometry (`RoadLeg.geometry`), but
  `TripMap.tsx` renders only point markers. Add a MapLibre `LineString`
  source + dashed line layer between stops. **~1 h.**

### 7. Browser push notifications
- In-app bell only today. Request `Notification` permission on login; fire a
  native notification when realtime delivers an event for the current user;
  respect the read flag; don't duplicate. **~1 h** — plumbing exists in
  `src/lib/realtimeCore.ts`.

## 🔵 P3 — Foundation for growth (1.0 enablers)

### 8. Offline-first (IndexedDB cache + service worker / PWA)
- Hydrate IndexedDB instantly on `init()`, sync Supabase in background;
  `manifest.json` + offline shell. Cache-invalidation strategy makes this
  **4–6 h** — likely post-1.0.

### 9. i18n (English + Hindi minimum)
- Extract hardcoded UI strings into `locales/en.json` / `locales/hi.json`;
  lightweight `useT()` hook or react-i18next; switcher in Profile. Tedious:
  **6–8 h.**

### 10. Integration tests: Supabase client + RLS contract
- All 138 tests are pure logic; nothing guards the live schema/RLS. Add an
  opt-in suite (`VITE_RUN_INTEGRATION=true`, never in CI by default): auth,
  trip CRUD, RLS denial, realtime pub/sub. **~3 h.**

## ⚪ P4 — Nice-to-have

| Item | Note | Effort |
|---|---|---|
| Explore pagination | gallery loads all published trips into memory | 2 h |
| Undo for more operations | reorder/move/vote/removeMember (delete already has it) | 2 h |
| Feedback button | floating widget → GitHub issue | 1 h |
| Permanent purge for deleted trips | trash + 30-day auto-purge | 1.5 h |
| Debounced store writes | rapid stop edits UPSERT per keystroke today | 1 h |

---

## 📋 Recommended order

```
1. #23  basemap licensing swap      (P0, 1h,  zero risk)
2. #22  OpenAI-compatible endpoint  (P1, 2h,  blocks #20)
3. #20  AI companion → real LLM     (P1, 3h)
4.      loading skeleton            (30m, quick win)
5.      profile fields editable     (1.5h)
6.      route polylines             (1h, visual payoff)
7.      push notifications          (1h)
8.      integration tests           (3h, protects schema+RLS)
```

Interleaved with items 2–3: **UI-audit batches 2–6** (~9 h) — tracked in the
🟣 section above; batches 2 and 3 are the highest fix-per-risk ratio left.

Items 1–7 ≈ **10 h** and reach a solid 1.0-ready state: everything marketed
works end-to-end, no legal exposure, no UX dead-ends. Items 8–10 are the
post-1.0 enablers.

---

## Working agreement (see [AGENTS.md](AGENTS.md))

- Every push ships a CHANGELOG entry; releases bump `package.json` + README.
- `npm run verify` before every push; bare commands only (no `cmd /c`).
- Push `test` freely; `main` only with the user's explicit confirmation.
- Stage explicit paths — never `git add -A` in this shared working copy.
