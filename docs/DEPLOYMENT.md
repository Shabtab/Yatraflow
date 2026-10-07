# Deployment & Operations

YatraFlow is a static SPA backed by [Supabase](https://supabase.com) for accounts and data storage.

## Supabase setup (one-time)

1. Create a free project at [supabase.com](https://supabase.com).
2. Apply the schema: paste `supabase/schema.sql` into the Supabase SQL editor (or set `PGCONN` and run `node scripts/apply-schema.mjs`). It creates the tables, indexes, RLS policies, the `handle_new_user` trigger and the `is_member`/`is_editor` security-definer helpers.
3. Copy your project URL and **anon** key (Settings → API) — these are public by design; never expose the service_role key in a `VITE_` variable.

## Vercel (current setup)

The app lives at **https://www.yatraflow.in**, connected to `hasnaina955/Yatraflow`:

- Every push to `main` auto-deploys production (~1 min).
- Every push to another branch (e.g. `test`) gets its own preview deployment, and `yatraflow-git-<branch>-….vercel.app` always serves the branch's latest build.
- Environment variables (Project → Settings → Environment Variables) — required for **Production, Preview and Development**. When editing one, tick **all three** environment checkboxes **and leave Preview free of a Git-branch filter**: a var scoped to Production only — *or* scoped to Preview-but-pinned-to-one-branch — is silently absent from every other branch's build:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_CREATE_FUNNEL` — the create-flow funnel switch, and **the one that shipped dark** (#427). A comma-separated phase list, not a boolean; the value that lights up the whole v0.65.0 arc is
    `templates,budget,readiness,drafts,crew,moment,iq`.
    **Leaving it unset is a valid state, and in production it is a silent one**: unset in a production build means *dark* (the app renders, `/new` loads, every funnel phase is simply missing), while unset in a dev build means *everything on*. That asymmetry exists so `test` can dark-run a phase before `main` sees it, so do not "fix" a dark production build by changing the default — set the variable. `tests/deploy-flags.test.ts` keeps this list, the `createFunnelOn()` call sites and `FUNNEL_PHASES` in `vite.config.ts` identical, because a typo here silently darkens one phase while the other six light up. `vite.config.ts` warns (never aborts) when a **production** build has this empty or names a phase the code does not gate.
  - `VITE_AI_COMPANION` — deliberately **absent** from production until the 1.0 cut (M8), where the companion is unmounted as the premium perk; `AI_COMPANION_ENABLED` requires the exact value `on`. Its dark state is a decision, unlike the funnel's.
  Vite **inlines these at build time**, so changing them never affects an existing deployment — you must **Redeploy** (Vercel → Deployments → ⋯ → Redeploy) for a preview to pick them up. Since 2026-08-31 `vite.config.ts` aborts a Vercel build outright when either Supabase variable is missing, so a mis-scoped environment fails loudly instead of shipping an app whose login is broken.
- Build settings (auto-detected Vite preset):
  - Build command: `npm run build`
  - Output directory: `dist`
  - Install command: `npm ci`

Preview deployments are protected by Vercel SSO by default — log in with your Vercel account to view them.

### If login fails on a preview but works on production

That preview was **built** without the two Supabase variables, so the client fell back to its placeholder origin and every auth call went nowhere. The app still renders — the giveaway is the "This build has no backend configured" banner on the sign-in page, or a `Failed to fetch` that looks like a wrong password. Since 2026-08-31 the build guard turns this into a red deployment instead: `Build aborted: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set for the "preview" environment`.

**The dashboard lies here.** All three boxes can be ticked and a preview still build blind, because a Preview variable may be pinned to a single git branch — which only the CLI shows. This project's recurring failure was exactly that: `Preview (test)`, so only branch `test` had a backend.

1. Read the real state — the last column is the one that matters:

```powershell
vercel env ls        # column "environments (git branch)": "Preview" good, "Preview (test)" = branch-pinned
```

2. Add a branch-free record for each variable (values are in your local `.env.local`; `--force` overwrites, and note it *adds* a second record rather than editing the pinned one):

```powershell
vercel env add VITE_SUPABASE_URL     preview --value <project-url> --type config --force
vercel env add VITE_SUPABASE_ANON_KEY preview --value <anon-key>   --type config --force
```

In the dashboard, the equivalent is editing the variable and clearing its **Git Branch** field.

3. **Redeploy** — `vercel redeploy <deployment-url>`, or Deployments → ⋯ → Redeploy. Step 2 alone changes nothing on an existing deployment, because the values were already compiled in.

4. Confirm the backend is actually inlined — **on production's canonical alias only**. Two traps make this check lie to you: previews sit behind Vercel SSO, and so do *deployment-specific* URLs (`yatraflow-<8char>-<scope>.vercel.app`) even when `vercel inspect` says `target production`. An anonymous request to either returns Vercel's own login page, not the app, and the check below misleadingly reports `False`. Use `www.yatraflow.in`; the real `index.html` is ~1.2 KB, the SSO page ~340 KB, so the size tells you which one you got.

```powershell
$h = (Invoke-WebRequest https://www.yatraflow.in -UseBasicParsing).Content
$js = [regex]::Match($h, '/assets/[A-Za-z0-9_.-]+\.js').Value
(Invoke-WebRequest ("https://www.yatraflow.in" + $js) -UseBasicParsing)
  .Content.Contains('.supabase.co')   # True = backend compiled in, False = broken auth
```

**Only `.supabase.co` is a valid signal.** Do *not* test for the `http://localhost:54321` fallback: `supabase.ts` compiles `import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321'`, so that string appears in every bundle, correctly configured or not.

For a preview, a green Vercel check *is* the proof — the guard aborts unless both variables were present at build time. To compare against production, extract the inlined ref with `https://([a-z0-9]+)\.supabase\.co` and check it matches your project. The strongest check of all: the alias's bundle hash (`index-<hash>.js`) should equal the one your local `npm run build` produced — that means the artifact you verified is literally the artifact that shipped.

## Published itinerary previews (#226)

`/i/<publication-id>` is rewritten to `api/i.js` on Vercel. It returns a small Open Graph/Twitter metadata document; browsers explicitly redirect to `/#/pub/<id>`, and JavaScript-disabled visitors get a link. It does not fetch an app shell or load cross-deployment assets. Existing hash links remain valid but cannot carry per-itinerary crawler metadata.

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the function's Preview and Production environments. They refer to the same project as the client variables, but are read at runtime without the `VITE_` prefix. Use the anon key, never the service-role key. `PUBLIC_ORIGIN` optionally supplies the canonical HTTPS website origin; otherwise the Vercel production domain or the documented production URL is used. Native share links target the production website.

The function reads only public publication metadata, with a four-second deadline. Missing publications return 404; missing configuration or upstream failures return 503. Responses use `no-store`, including successful metadata, so the application does not retain unpublished metadata at the edge. External messaging services maintain their own caches, which this cannot revoke. Covers are included only when the publication supplies an HTTPS URL; no default image is promised.

Before closing #226:

1. Deploy the verified code with explicit owner approval; environment variable presence alone does not prove a deployed function can read the publication.
2. Fetch `https://www.yatraflow.in/i/pub_1cp2i9jq872` anonymously and verify the current publication's title/description, not merely HTTP 200. Verify a missing id returns 404.
3. Open the link in a browser and confirm arrival on the correct itinerary; old `/#/pub/<id>` links must still work.
4. Confirm the card in WhatsApp or the Meta Sharing Debugger. An SSO-protected preview cannot satisfy anonymous crawler acceptance.

The preview endpoint and the trip-JSON import that PR #235 also carried are both landed on `test`. What PR #235 still holds and this work does not is its route-to-title mapping (`src/lib/pageTitle.ts`, applied in `App.tsx`, so open tabs stop sharing one title) and its `.codacy.yml` exclusion, which was written for the older shell-injecting handler. PR #235's own `api/i.js` and `shareUrl.ts` are **superseded** by this implementation and must not be merged over it.

## Any other static host

```bash
npm run build      # produces dist/
```

Upload `dist/` to Netlify / Cloudflare Pages / S3 / GitHub Pages and set the two `VITE_` env vars at build time. Because routing is **hash-based** (`#/trip/abc`), no rewrite rules or 404 fallbacks are needed — the server only ever serves `index.html`.

For GitHub Pages specifically, the Vite config already uses relative asset paths (`base: './'`), so a project-pages URL subpath works without changes.

## Runtime data notes

- All user data lives in Supabase Postgres; access is gated by Row Level Security. Beyond the auth session, the client keeps an offline snapshot of the account's rows plus a durable outbox of unsynced edits (IndexedDB, since v0.65) so the installed app reads and edits offline — both keyed by account and cleared on sign-out. The in-memory store still re-hydrates on every login.
- **Email confirmation** is a Supabase Auth setting (Authentication → Sign In / Providers). With it on, signups send a confirmation email (free tier: ~2/hour); the app detects the unconfirmed state and asks the user to check their inbox.
- RLS gotcha: policies that query `trip_members` must go through the `security definer` helpers (`is_member`/`is_editor`) — a direct subquery inside a policy causes infinite recursion (Postgres `42P17`) and every request 500s.
- Top-level table ids are UUIDs; the client generates them (`crypto.randomUUID`). JSONB-internal ids (stops/days/expenses) may be any string.
- Map tiles load from OpenFreeMap (`tiles.openfreemap.org` — styles, vector tiles and the Natural Earth raster source), geocoding calls go to `geocoding-api.open-meteo.com`. Both are public/free with no keys; behind a strict CSP you'd need to allow those origins plus the unpkg worker script used by maplibre-gl.

## Environment variables

All client config is read from `VITE_`-prefixed variables (see `.env.example`). Set these at build time in Vercel (Project → Settings → Environment Variables) for **Preview** and **Production**, or in `.env.local` for local dev.

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL. |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase **anon** key (public by design). Never put the `service_role` key in a `VITE_` var. |
| `VITE_MAPPLS_KEY` | optional | Mappls REST key — powers India-best place autocomplete when set; falls back to the free stack when absent. |
| `VITE_GOOGLE_MAPS_API_KEY` | optional | Google Places key — with it, the suggestion pipeline is Google-only (honest quota/failure notes, never a silent fallback; night-halt towns still ask OSM); the place search box degrades Google → free. Quota-guarded per SKU. |
| `VITE_AI_COMPANION` | optional | `=on` mounts the AI companion drawer and its Profile settings (kept off in production until the premium launch). |

The Google key is **optional** and the app fully works without it (free stack only). See the provider facade in `src/lib/geocode.ts`.

## Release checklist

1. `npm run verify` — clean typecheck, full test suite and production build, all green
2. `npm run check:migrations` — every migration probed present on the live project; apply anything missing in the Supabase SQL editor *first* (a release whose SQL never ran fails at runtime, not in CI)
3. Smoke-test locally: login → demo trips load → create trip (persists after reload) → add stop → map renders → publish → copy from Explore
4. Check `vercel env ls` — `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` present for **Production *and* a branch-free Preview** (the `environments (git branch)` column must read `Preview`, never `Preview (<branch>)`; Production-only or branch-pinned scoping is the #1 cause of "login works here but not on the preview")
5. Update `CHANGELOG.md`; for feature-worthy releases also bump `package.json` + lockfile and refresh README highlights (newest first)
6. Commit, merge to `main` (user-gated), push, watch the Vercel deployment finish
7. Verify the live URL serves the new build (hard-refresh; check bundle hash changed), then tag the promotion merge (`vX.Y.Z`, annotated) — the tag push is what builds the Android APK
