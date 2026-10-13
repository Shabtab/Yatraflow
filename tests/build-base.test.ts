// ============ Build base must be absolute (path-routed SPA) ============
// The app routes by PATH (/share/<payload>, /pub/<slug>, /trip/<id> …), so the
// server serves index.html at a nested URL. Vite's `base` decides whether the
// built script/link tags are root-absolute (/assets/…) or relative (./assets/…).
// A relative base resolves against the current path: on /share/<payload> every
// chunk request becomes /share/assets/…, a 404, so the SPA never boots and the
// page renders blank with console errors (#bug: share snapshot page). This pin
// fails if `base` ever returns to './' or any other non-root value.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')
const config = read('vite.config.ts')

describe('the build base is absolute, so nested routes load their assets', () => {
  it('sets base to the root path', () => {
    expect(config).toMatch(/base:\s*'\/'/)
  })

  it('never falls back to a relative base', () => {
    // './' resolves assets against the current route and 404s on a nested path.
    expect(config).not.toMatch(/base:\s*'\.\/'/)
    expect(config).not.toMatch(/base:\s*''/)
  })
})
