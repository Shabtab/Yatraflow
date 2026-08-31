# Deployment & Operations

YatraFlow is a static SPA backed by [Supabase](https://supabase.com) for accounts and data storage.

## Supabase setup (one-time)

1. Create a free project at [supabase.com](https://supabase.com).
2. Apply the schema: paste `supabase/schema.sql` into the Supabase SQL editor (or set `PGCONN` and run `node scripts/apply-schema.mjs`). It creates the tables, indexes, RLS policies, the `handle_new_user` trigger and the `is_member`/`is_editor` security-definer helpers.
3. Copy your project URL and **anon** key (Settings → API) — these are public by design; never expose the service_role key in a `VITE_` variable.

## Vercel (current setup)

The app lives at **https://yatraflow-blond.vercel.app**, connected to `hasnaina955/Yatraflow`:

- Every push to `main` auto-deploys production (~1 min).
- Every push to another branch (e.g. `test`) gets its own preview deployment, and `yatraflow-git-<branch>-….vercel.app` always serves the branch's latest build.
- Environment variables (Project → Settings → Environment Variables) — required for **Production, Preview and Development**. When editing one, tick **all three** environment checkboxes **and leave Preview free of a Git-branch filter**: a var scoped to Production only — *or* scoped to Preview-but-pinned-to-one-branch — is silently absent from every other branch's build:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  Vite **inlines these at build time**, so changing them never affects an existing deployment — you must **Redeploy** (Vercel → Deployments → ⋯ → Redeploy) for a preview to pick them up. Since 2026-08-31 `vite.config.ts` aborts a Vercel build outright when either is missing, so a mis-scoped environment fails loudly instead of shipping an app whose login is broken.
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

4. Confirm the backend is actually inlined — **on production's canonical alias only**. Two traps make this check lie to you: previews sit behind Vercel SSO, and so do *deployment-specific* URLs (`yatraflow-<8char>-<scope>.vercel.app`) even when `vercel inspect` says `target production`. An anonymous request to either returns Vercel's own login page, not the app, and the check below misleadingly reports `False`. Use `yatraflow-blond.vercel.app`; the real `index.html` is ~1.2 KB, the SSO page ~340 KB, so the size tells you which one you got.

```powershell
$h = (Invoke-WebRequest https://yatraflow-blond.vercel.app -UseBasicParsing).Content
$js = [regex]::Match($h, '/assets/[A-Za-z0-9_.-]+\.js').Value
(Invoke-WebRequest ("https://yatraflow-blond.vercel.app" + $js) -UseBasicParsing)
  .Content.Contains('.supabase.co')   # True = backend compiled in, False = broken auth
```

**Only `.supabase.co` is a valid signal.** Do *not* test for the `http://localhost:54321` fallback: `supabase.ts` compiles `import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321'`, so that string appears in every bundle, correctly configured or not.

For a preview, a green Vercel check *is* the proof — the guard aborts unless both variables were present at build time. To compare against production, extract the inlined ref with `https://([a-z0-9]+)\.supabase\.co` and check it matches your project. The strongest check of all: the alias's bundle hash (`index-<hash>.js`) should equal the one your local `npm run build` produced — that means the artifact you verified is literally the artifact that shipped.

## Any other static host

```bash
npm run build      # produces dist/
```

Upload `dist/` to Netlify / Cloudflare Pages / S3 / GitHub Pages and set the two `VITE_` env vars at build time. Because routing is **hash-based** (`#/trip/abc`), no rewrite rules or 404 fallbacks are needed — the server only ever serves `index.html`.

For GitHub Pages specifically, the Vite config already uses relative asset paths (`base: './'`), so a project-pages URL subpath works without changes.

## Runtime data notes

- All user data lives in Supabase Postgres; access is gated by Row Level Security. There is no client-side persistence beyond the auth session — the in-memory store re-hydrates on every login.
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
| `VITE_GOOGLE_MAPS_API_KEY` | optional | Google Places key — opt-in Google autocomplete/nearby/opening-hours; quota-guarded, always falls back to the free stack. |

The Google key is **optional** and the app fully works without it (free stack only). See the provider facade in `src/lib/geocode.ts`.

## Release checklist

1. `npx tsc --noEmit` — clean
2. `npm run build` — succeeds
3. Smoke-test locally: login → demo trips load → create trip (persists after reload) → add stop → map renders → publish → copy from Explore
4. Check `vercel env ls` — `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` present for **Production *and* a branch-free Preview** (the `environments (git branch)` column must read `Preview`, never `Preview (<branch>)`; Production-only or branch-pinned scoping is the #1 cause of "login works here but not on the preview")
5. Update `CHANGELOG.md`
6. Commit, merge to `main`, push, watch the Vercel deployment finish
7. Verify the live URL serves the new build (hard-refresh; check bundle hash changed)
