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
- Environment variables (Project → Settings → Environment Variables) — required for **Preview** and **Production**:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Build settings (auto-detected Vite preset):
  - Build command: `npm run build`
  - Output directory: `dist`
  - Install command: `npm ci`

Preview deployments are protected by Vercel SSO by default — log in with your Vercel account to view them.

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
- Map tiles load from CARTO CDNs; geocoding calls go to `geocoding-api.open-meteo.com`. Both are public/free with no keys; behind a strict CSP you'd need to allow those origins plus the unpkg worker script used by maplibre-gl.

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
4. Check `vercel env ls` — `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` present for Production
5. Update `CHANGELOG.md`
6. Commit, merge to `main`, push, watch the Vercel deployment finish
7. Verify the live URL serves the new build (hard-refresh; check bundle hash changed)
