// ============ Build base follows the build target (path-routed SPA) ============
// The app routes by PATH (/share/<payload>, /pub/<slug>, /trip/<id> ...), so the
// server serves index.html at a nested URL. Vite's `base` decides whether the
// built script/link tags are root-absolute (/assets/...) or relative (./assets/...).
// A relative base resolves against the current path: on /share/<payload> every
// chunk request becomes /share/assets/..., a 404, so the SPA never boots and the
// page renders blank. A build opened from disk (file://), or
// one that addresses routes through the hash off http(s) like the native shell,
// cannot resolve a root-absolute path and needs the relative base. `base` is
// chosen by resolveBase(VITE_BUILD_TARGET): '/' for the web build (the default),
// './' for a file or native build.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')
const config = read('vite.config.ts')

describe('the build base follows the build target', () => {
  it('defaults the web build to the root path', () => {
    // resolveBase returns '/' unless the target is file or native.
    expect(config).toMatch(/function resolveBase\(/)
    expect(config).toMatch(/t === 'file' \|\| t === 'native' \? '\.\/' : '\//)
  })

  it('gives a file or native build the relative base, which a file:// page needs', () => {
    // A disk-opened build cannot load /assets/... from the filesystem root.
    expect(config).toMatch(/base: resolveBase\(process\.env\.VITE_BUILD_TARGET\)/)
  })
})
