# YatraFlow Roadmap

Living document — reviewed each session, updated as items land. Done items move
to [CHANGELOG.md](CHANGELOG.md); this file only tracks what's ahead.

**Snapshot (2026-08-31):** v0.19.0 · 138 tests green · CI gate on `main` ·
realtime live (all 8 tables) · basemap licensing (#23) shipped · 2 open issues
(#20, #22).

---

## 🔴 P0 — Compliance & licensing

### 1. ~~#23 — Basemap licensing swap~~ ✅ shipped (see CHANGELOG `[Unreleased]`)
CARTO Basemaps + Esri World Imagery replaced with keyless
[OpenFreeMap](https://openfreemap.org) vector styles (`positron` / `dark`) —
same look, MIT service, ODbL map data, no request limits, no key, no bill.
Attribution is injected explicitly (`BASEMAP_ATTRIBUTION` →
`attributionControl.customAttribution`) because OpenFreeMap's `style.json` ships
without a `sources.*.attribution` field. Google tiles rejected: not licensed to
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

Items 1–7 ≈ **10 h** and reach a solid 1.0-ready state: everything marketed
works end-to-end, no legal exposure, no UX dead-ends. Items 8–10 are the
post-1.0 enablers.

---

## Working agreement (see [AGENTS.md](AGENTS.md))

- Every push ships a CHANGELOG entry; releases bump `package.json` + README.
- `npm run verify` before every push; bare commands only (no `cmd /c`).
- Push `test` freely; `main` only with the user's explicit confirmation.
- Stage explicit paths — never `git add -A` in this shared working copy.
