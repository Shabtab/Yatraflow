// ============ #427 — the funnel's switch ships with its launch ==============
//
// The v0.65.0 create funnel reached production fully deployed and fully
// invisible: the app rendered, `/new` loaded, and all seven phases were missing
// because a build-time environment variable had never been set and nothing said
// so. A test cannot verify an environment. What it can do is stop the three
// places that name the phases from drifting apart, and keep the switch written
// down in the file a deployer actually reads — because the failure mode is
// silent in both directions: an unset variable darkens everything, and a single
// typo darkens one phase while the other six light up.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** Code only: these files explain the trap in prose that quotes the very
 *  strings being counted, so a match must come from code. */
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|\n)[^\S\n]*\/\/[^\n]*/g, '$1')

const PHASE_CALL = /createFunnelOn\(\s*'([^']+)'\s*\)/g
const QUOTED = /'([^']+)'/g

/** The phases the app actually gates — read from every call site, so a new
 *  phase cannot be added without the other two lists noticing. */
function phasesInSrc(): string[] {
  const dir = new URL('../src/', import.meta.url)
  const files = readdirSync(dir, { recursive: true }).filter(f => /\.tsx?$/.test(f))
  const found = new Set<string>()
  for (const f of files) {
    for (const m of codeOf(readFileSync(new URL(f, dir), 'utf8')).matchAll(PHASE_CALL)) found.add(m[1])
  }
  return [...found].sort()
}

/** The same list as `vite.config.ts` carries, for the production build warning. */
function phasesInConfig(): string[] {
  const config = codeOf(read('../vite.config.ts'))
  const at = config.indexOf('const FUNNEL_PHASES = [')
  if (at < 0) return []
  const list = config.slice(at, config.indexOf(']', at))
  return [...list.matchAll(QUOTED)].map(m => m[1]).sort()
}

/** The value `docs/DEPLOYMENT.md` tells a deployer to paste into Vercel. */
function phasesInDeployDoc(): string[] {
  const m = read('../docs/DEPLOYMENT.md')
    .match(/`VITE_CREATE_FUNNEL`[\s\S]{0,700}?`([a-z]+(?:,[a-z]+)+)`/)
  return m ? m[1].split(',').map(s => s.trim()).sort() : []
}

describe('#427 — the three lists that name the funnel phases cannot drift', () => {
  it('the code, the build warning and the deploy table agree exactly', () => {
    const inCode = phasesInSrc()
    // A floor, so a rename of the helper cannot silently empty this suite.
    expect(inCode.length, 'no createFunnelOn() call sites found').toBeGreaterThan(0)
    expect(phasesInConfig(), 'vite.config.ts FUNNEL_PHASES').toEqual(inCode)
    expect(phasesInDeployDoc(), 'the value in docs/DEPLOYMENT.md').toEqual(inCode)
  })
})

describe('#236 — the companion switch ships with its activation', () => {
  /** The value the flag parser accepts, read from the source it gates. */
  function exactValueInCode(): string {
    const src = codeOf(read('../src/lib/featureFlags.ts'))
    const at = src.indexOf('AI_COMPANION_ENABLED')
    expect(at, 'AI_COMPANION_ENABLED is gone — the companion has no switch').toBeGreaterThan(-1)
    const assignment = src.slice(at, src.indexOf('\n', at))
    const m = assignment.match(/===\s*'([a-z]+)'/)
    expect(m, 'the flag no longer compares against a literal').toBeTruthy()
    return m![1]
  }

  it('the deploy doc shows the exact value the parser accepts', () => {
    const value = exactValueInCode()
    const doc = read('../docs/DEPLOYMENT.md')
    // The deployer's line must name the variable AND the literal, together.
    expect(doc, 'docs/DEPLOYMENT.md must show `VITE_AI_COMPANION=<value>`').toContain(`VITE_AI_COMPANION=${value}`)
    expect(doc, 'the factory-default trap must stay documented').toMatch(/exact value/)
  })

  it('the default stays off, so a build without the variable is unchanged', () => {
    const src = codeOf(read('../src/lib/featureFlags.ts'))
    const line = src.slice(src.indexOf('AI_COMPANION_ENABLED'))
    // `?? ''` is the whole reason an absent variable is dark rather than a crash.
    expect(line.slice(0, line.indexOf('\n'))).toMatch(/\?\?\s*''/)
  })

  it('the flag is still the only gate: every mount site reads it', () => {
    // Both surfaces must sit behind the flag. A second, independent condition
    // would let one surface light up without the other, which no deploy value
    // could fix.
    for (const file of ['../src/pages/Profile.tsx', '../src/pages/TripWorkspace.tsx']) {
      // Line comments only. `codeOf` also strips block comments, and a block
      // comment in TripWorkspace.tsx contains a `*/`-shaped literal that makes
      // that regex swallow the following import line.
      const src = read(file).replace(/(^|\n)[^\S\n]*\/\/[^\n]*/g, '$1')
      expect(src, `${file} no longer imports the flag`).toMatch(/import\s*\{\s*AI_COMPANION_ENABLED\s*\}/)
      expect(src, `${file} does not gate its companion surface on the flag`).toMatch(/AI_COMPANION_ENABLED\s*&&/)
    }
  })
})

describe('#427 — the switch lives where a deployer looks', () => {
  it('the deploy table names the variable and the trap', () => {
    const doc = read('../docs/DEPLOYMENT.md')
    expect(doc).toMatch(/VITE_CREATE_FUNNEL/)
    // The asymmetry that makes a dark production build look like a code
    // regression: unset is "everything on" in dev and "everything off" in prod.
    expect(doc).toMatch(/unset in a production build means \*dark\*/)
    expect(doc).toMatch(/Redeploy/)
  })

  it('a production build with no value warns, and can never abort', () => {
    const config = read('../vite.config.ts')
    const at = config.indexOf('function warnDeployFlags')
    expect(at, 'warnDeployFlags is gone — the silent half of #427 is back').toBeGreaterThan(-1)
    const fn = config.slice(at, config.indexOf('\nexport default', at))
    // Only production is worth shouting about: a preview branch dark-running a
    // phase is what the flag is FOR, and CI builds without VERCEL_ENV at all.
    expect(fn).toMatch(/process\.env\.VERCEL_ENV !== 'production'/)
    expect(fn).toMatch(/console\.warn/)
    expect(fn, 'a build must never fail for a flag a preview may legitimately leave off').not.toMatch(/throw/)
    // …and it is actually wired to the build.
    expect(config).toMatch(/warnDeployFlags\(env\)/)
  })
})
