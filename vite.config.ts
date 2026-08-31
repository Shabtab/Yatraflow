import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

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

export default defineConfig(({ mode }) => {
  assertDeployEnv(loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react()],
    base: './',
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
  }
})
