# Contributing to YatraFlow

Thanks for wanting to help! This is a small, deliberately dependency-light MVP — the rules below keep it that way.

## Setup

Clone, install, link your Supabase project, and start the dev server:

```bash
git clone https://github.com/hasnaina955/Yatraflow.git
cd Yatraflow
npm install
npm run dev
```

Full environment setup (Supabase keys, env vars, deploy) is in [DEPLOYMENT.md](../docs/DEPLOYMENT.md) and the top-level [README](../README.md#getting-started).

Sign up / log in with a real account (Supabase auth) — first sign-in seeds demo trip data automatically.

## Before you open a PR

1. **Type check passes:**
   ```bash
   npm run build   # runs `tsc -b` then `vite build`
   ```
   The project runs TypeScript *strict* — no `any` leaks, no suppressed errors without a comment explaining why. (`npx tsc --noEmit` also works for a check without a build.)

2. **Build passes:** `npm run build` (this also runs the type check).

3. **Test your flow end-to-end** at http://localhost:5173 — especially trip creation → timeline editing → map, since those share state.

## Ground rules

- **No new runtime libraries** (UI kits, routers, state managers) without prior discussion. The MVP intentionally hand-rolls routing and components.
- **Styles live in `src/styles.css`** — plain CSS with custom properties for theming. No Tailwind/CSS-in-JS. Follow existing naming (`kebab-case`, `.yf-` prefix only for maplibre overrides).
- **Transparency promise:** any estimate you add must show its assumptions to the user. Never present a computed number as authoritative — the engine's disclaimers exist for a reason.
- **Respect the MVP constraints:** no real payments, no bookings, no fake "live" data. If a feature needs one of these, design it as an explicit placeholder or raise an issue first.
- **India-first:** INR currency formatting via `formatInr()`, Indian place names in seeds/examples.
- **Comment density:** match surrounding code — short `// ---- section ----` banners and notes explaining *why*, not *what*.

## Code map (where does my change go?)

| I'm changing… | Edit |
|---|---|
| An entity/field | `src/data/types.ts` (+ `seed.ts` if demo data should show it) |
| How estimates/math work | `src/lib/engine.ts` (or `impact.ts` for deltas) |
| Weather / road routing / snapshot shares / geocoding & opening hours | `src/lib/weather.ts`, `routing.ts`, `snapshot.ts`, `geocode.ts` |
| A mutation/action | `src/store/store.ts` |
| A screen | `src/pages/*` |
| A shared widget | `src/components/ui.tsx` |
| Location search behaviour | `src/components/LocationInput.tsx` |
| Map rendering | `src/components/TripMap.tsx` (vendored lib lives in `components/mapcn/` — avoid editing it) |

## Commits

Short imperative subject lines ("Add weather field to stops"), body for anything non-obvious. Pushing to `main` auto-deploys to Vercel, so keep `main` green.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, browser + OS, and console output if any. If it's a blank-screen bug, include whether "Reset app data & reload" fixes it — that tells us localStorage corruption vs code crash.
