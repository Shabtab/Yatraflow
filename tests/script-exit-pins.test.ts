// #656 — an error path must set process.exitCode and return. A direct
// process.exit can truncate the diagnostic on Windows while the write sits in
// the queue, so the message that explains the failure is the part that goes
// missing.
//
// This pin lists every call site that is still allowed under scripts/. A new
// site fails this file, and a removed site fails it too, so the list cannot go
// stale. What remains: the gallery usage path (#656 AC2 exempts usage), plus
// the harness and one-off scripts the issue's sweep did not name.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPTS = fileURLToPath(new URL('../scripts', import.meta.url))

// file (relative to scripts/, forward slashes) → the exact trimmed source
// lines that may still call process.exit.
const ALLOWED: Record<string, string[]> = {
  'browser-motion-check.mjs': ['process.exit(1)'],
  'gallery-geocode.mjs': ['process.exit(2)'],
  'integration/cleanupHarness.mjs': [
    "if (auth.error) { console.log('FATAL: no session for cleanup pass:', auth.error.message); process.exit(1); }",
    "if (found.error) { console.log('FATAL: cannot list leftovers:', found.error.message); process.exit(1); }",
  ],
  'integration/integrationHarness.mjs': [
    'process.exit(0);',
    'process.exit(2);',
    'process.exit(2);',
    'if (failures === 0) { console.log(`${GREEN}integration harness: ${passes} passed · ${ms}s${OFF}`); process.exit(0); }',
    'process.exit(1);',
  ],
  'seedCreatorFixture.mjs': ['process.exit(2)', 'process.exit(2)', 'process.exit(2)', 'process.exit(2)'],
  'uiAntipatterns.mjs': [
    'process.exit(2)',
    'process.exit(2)',
    'process.exit(findings.length === 0 ? 0 : 1)',
    'process.exit(0)',
    'process.exit(1)',
  ],
  'validate-itinerary.mjs': ['process.exit(2)', 'process.exit(failed ? 1 : 0)'],
  'verify-google-places.mjs': ['process.exit(1)'],
}

function collect(dir: string, acc: Record<string, string[]> = {}) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) collect(p, acc)
    else if (e.name.endsWith('.mjs')) {
      const hits = readFileSync(p, 'utf8')
        .split(/\r?\n/)
        .filter(l => l.includes('process.exit('))
        .map(l => l.trim())
      if (hits.length) {
        const rel = p.slice(SCRIPTS.length + 1).split('\\').join('/')
        acc[rel] = hits
      }
    }
  }
  return acc
}

// Sorted arrays make the comparison order-insensitive and count-sensitive: an
// added site shows up as an extra entry, a fixed site as a missing one.
const sorted = (o: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]))

describe('process.exit call sites in scripts/ (#656)', () => {
  it('matches the allowlist exactly', () => {
    expect(sorted(collect(SCRIPTS))).toEqual(sorted(ALLOWED))
  })

  it('the sweep files from #656 carry no process.exit at all', () => {
    const actual = collect(SCRIPTS)
    const sweep = [
      'apply-schema.mjs',
      'clean-env.mjs',
      'gallery-geocode.mjs',
      'lint-ratchet.mjs',
      'lint-ste.mjs',
      'new-itinerary.mjs',
      // the batch's own two scripts, fixed under #655 and #652
      'pr-auto-close.mjs',
      'next-step-probe.mjs',
    ]
    // gallery-geocode keeps ONE usage exit, which AC2 exempts.
    expect(actual['gallery-geocode.mjs'] ?? []).toEqual(['process.exit(2)'])
    for (const f of sweep.filter(f => f !== 'gallery-geocode.mjs')) {
      expect(actual[f], `${f} must not call process.exit`).toBeUndefined()
    }
  })

  it('a usage exit carries the comment that exempts it', () => {
    const src = readFileSync(join(SCRIPTS, 'gallery-geocode.mjs'), 'utf8')
    expect(src).toContain('An immediate exit is allowed here (#656).')
  })
})
