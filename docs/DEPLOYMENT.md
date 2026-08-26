# Deployment & Operations

YatraFlow is a static SPA — no server, no database, no environment variables.

## Vercel (current setup)

The app lives at **https://yatraflow-blond.vercel.app**, connected to `hasnaina955/Yatraflow`:

- Every push to `main` auto-deploys production (~1 min).
- Every PR gets its own preview deployment.
- Settings (auto-detected Vite preset):
  - Build command: `npm run build`
  - Output directory: `dist`
  - Install command: `npm ci`

## Any other static host

```bash
npm run build      # produces dist/
```

Upload `dist/` to Netlify / Cloudflare Pages / S3 / GitHub Pages. Because routing is **hash-based** (`#/trip/abc`), no rewrite rules or 404 fallbacks are needed — the server only ever serves `index.html`.

For GitHub Pages specifically, the Vite config already uses relative asset paths (`base: './'`), so a project-pages URL subpath works without changes.

## Runtime data notes

- All user data is per-browser `localStorage` under key `yatraflow_db_v1`. There is no server state, so there's nothing to migrate on deploy.
- The store validates loaded data shape (`isValidDb`) and reseeds demo content if the payload is missing or incompatible — schema changes that rename fields will silently reset users rather than crash. Bump the key (`yatraflow_db_v2` + code) when you *want* a hard reset instead.
- Map tiles load from CARTO CDNs; geocoding calls go to `geocoding-api.open-meteo.com`. Both are public/free with no keys; behind a strict CSP you'd need to allow those origins plus the unpkg worker script used by maplibre-gl.

## Release checklist

1. `npx tsc --noEmit` — clean
2. `npm run build` — succeeds
3. Smoke-test locally: login → create trip → add stop → map renders → publish → copy from Explore
4. Update `CHANGELOG.md`
5. Commit, push to `main`, watch the Vercel deployment finish
6. Verify the live URL serves the new build (hard-refresh; check bundle hash changed)
