import { defineConfig, loadEnv } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

/** Single source of truth for the app version (feedback mailto bodies) —
 *  read from package.json at config time, inlined via the define below. */
const APP_VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }).version

/**
 * Fail a *deployment* build that would otherwise ship an app whose login can
 * only break.
 *
 * Vite inlines `VITE_*` at build time, so a Vercel environment without them —
 * the classic case being vars scoped to Production only, which leaves every
 * Preview deploy built blind — produces a site that renders perfectly and then
 * fails every auth call with a bare "Failed to fetch" (see src/lib/authErrors.ts).
 * A red deployment with this message beats a quietly broken preview.
 *
 * Enforced only on Vercel: CI (`npm run verify`) and fresh clones legitimately
 * build without credentials, so they get a loud warning instead of a failure.
 */
function assertDeployEnv(env: Record<string, string>) {
  const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
  const missing = required.filter((k) => !env[k] || env[k].includes('YOUR-PROJECT'))
  if (missing.length === 0) return

  const where = process.env.VERCEL_ENV ?? 'this environment'
  const msg =
    `Build aborted: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set for the ` +
    `"${where}" environment. Vite inlines these at build time, so the deployed app would render but ` +
    `every login would fail. Fix: Vercel → Project → Settings → Environment Variables → edit each → ` +
    `tick Production, Preview and Development → Redeploy. If they already look ticked, run ` +
    `\`vercel env ls\` — a Preview value pinned to one git branch (shown as "Preview (<branch>)") is ` +
    `absent from every other branch's build.`
  if (process.env.VERCEL) throw new Error(msg)
  console.warn(`\n[yatraflow] WARNING — ${msg}\n`)
}

/** True for files in the generated illustration folder (see docs/ART-PIPELINE.md). */
function isIllustrationPath(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').includes('/src/assets/art/')
}

/** The create-funnel phases this build can switch on — the value
 *  `VITE_CREATE_FUNNEL` has to carry to light up the v0.65.0 arc. Kept in step
 *  with the `createFunnelOn()` call sites and with the deploy table by
 *  `tests/deploy-flags.test.ts`, which reads all three. */
const FUNNEL_PHASES = ['templates', 'budget', 'readiness', 'drafts', 'crew', 'moment', 'iq']

/**
 * Warn about a production build whose create-funnel switch is wrong (#427).
 *
 * The funnel is a build-time switch, which makes "deployed but dark" silent by
 * construction: the app renders, `/new` loads, and every phase is simply
 * missing — the v0.65.0 arc went to production that way and looked like a
 * regression in the release rather than a missing environment variable. A
 * warning in the build log is the cheapest place to catch it, because the
 * variable has to be right *before* the build that bakes it.
 *
 * A warning and never an abort, deliberately: a preview branch dark-running a
 * phase is the whole point of the flag (test before main), so only the
 * production environment is worth shouting about. CI and local builds have no
 * `VERCEL_ENV` and stay quiet, which keeps `npm run verify` output clean.
 */
function warnDeployFlags(env: Record<string, string>) {
  if (process.env.VERCEL_ENV !== 'production') return

  const raw = (env.VITE_CREATE_FUNNEL ?? '').trim()
  const on = raw.split(',').map((p) => p.trim()).filter(Boolean)
  if (on.length === 0) {
    console.warn(
      `\n[yatraflow] WARNING — VITE_CREATE_FUNNEL is not set for the "production" environment, ` +
      `so this build ships the create funnel DARK: /new renders the bare form with no templates, ` +
      `budget band, readiness checklist, drafts, crew collector, moment-after screen or input IQ. ` +
      `That is the default, not a deploy failure — Vite inlines the value, so the switch has to be ` +
      `set before the build that bakes it. Fix: Vercel → Settings → Environment Variables → ` +
      `VITE_CREATE_FUNNEL=${FUNNEL_PHASES.join(',')} → tick Production, Preview and Development → ` +
      `Redeploy. See docs/DEPLOYMENT.md.\n`,
    )
    return
  }

  const unknown = on.filter((p) => !FUNNEL_PHASES.includes(p))
  if (unknown.length) {
    console.warn(
      `\n[yatraflow] WARNING — VITE_CREATE_FUNNEL lists ${unknown.join(', ')}, which ` +
      `${unknown.length > 1 ? 'are not phases' : 'is not a phase'} this build gates, so ` +
      `${unknown.length > 1 ? 'they' : 'it'} will do nothing. Valid phases: ${FUNNEL_PHASES.join(', ')}.\n`,
    )
  }
}

/** Vite `base` for the build. The web build is served from an http(s) origin at
 *  a nested path (Vercel, and Capacitor's https://localhost), so its asset URLs
 *  must be root-absolute (/assets/…) or a deep route loads them from the wrong
 *  place. A build opened straight from disk (file://) — or any target that, like
 *  the native shell, addresses routes through the hash off http(s) — cannot
 *  resolve a root-absolute path, so it takes the relative base (./assets/…).
 *  `VITE_BUILD_TARGET` names the target; unset (the normal web build) is `/`.
 *  This mirrors the router's own split: src/lib/router.ts `routeHref` keeps the
 *  path form only on http(s) and falls back to the hash form for native and
 *  file documents. */
function resolveBase(target: string | undefined): string {
  const t = (target ?? '').trim().toLowerCase()
  return t === 'file' || t === 'native' ? './' : '/'
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  assertDeployEnv(env)
  warnDeployFlags(env)
  return {
    plugins: [react()],
    // Absolute base for the web build, relative for a file/native build. The app
    // routes by PATH on the web (/share/<payload>, /pub/<slug>, /trip/<id> …), so
    // index.html is served at a nested URL. A relative base emits `./assets/…`
    // script tags, which the browser resolves against the current path — on
    // /share/<payload> that becomes /share/assets/…, which vercel.json's
    // catch-all answers with index.html, so the browser refuses the module (wrong
    // MIME type) and the SPA never boots. A root base keeps every asset URL
    // absolute (/assets/…), which also matches the root-registered service worker
    // (/sw.js) and Capacitor's default https://localhost scheme.
    //
    // A build opened straight from disk (file://) cannot resolve /assets/… — the
    // browser looks at the filesystem root — so that target needs the relative
    // base. VITE_BUILD_TARGET is the build-time analogue of the router's runtime
    // protocol/native check (src/lib/router.ts routeHref falls back to the hash
    // form off http(s)); set it to `file` or `native` for such a build. Pinned by
    // tests/build-base.test.ts.
    base: resolveBase(process.env.VITE_BUILD_TARGET),
    define: {
      // Inlined at build time from package.json — consumed by the feedback
      // mailto so bug reports carry the exact shipped version.
      __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    build: {
      // Ship sourcemaps so Lighthouse's "unused JavaScript" attribution and
      // production stack traces map back to source instead of minified bundles.
      sourcemap: true,
      // Never inline the illustration set. Vite inlines any file under 4 KB as
      // base64 in the JS bundle, and a small AVIF is under 4 KB. Every other
      // asset keeps Vite's default limit (returning undefined falls back to it).
      assetsInlineLimit: (filePath) => (isIllustrationPath(filePath) ? false : undefined),
    },
    server: {
      proxy: {
        // mirror the Vercel rewrite so local dev also avoids Mappls' missing CORS headers
        '/mappls': {
          target: 'https://search.mappls.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/mappls/, ''),
        },
      },
    },
    test: {
      // The repo's tests live in exactly these two trees. Vitest 4's default
      // include is **/*.{test,spec}.* minus node_modules/.git, which swept up
      // STALE COPIES of this repo inside tool working dirs (.cache/itinerary/,      // .agents/, .impeccable/ — all git-ignored) and failed the verify gate
      // on months-old tests the repo tree had already fixed. Pinning include
      // makes any tool-debris copy structurally invisible to the gate.
      include: ['tests/**/*.test.ts', 'scripts/**/*.test.ts'],
      exclude: [...configDefaults.exclude, '**/.cache/**'],
    },
  }
})
