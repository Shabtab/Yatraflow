// The lint ratchet (AGENTS.md §2 rule 14) is a guardrail, so it gets pinned.
// A ratchet that stops catching a regression is worse than no ratchet: it
// reports green while the count climbs.
//
// These tests run the real script. They do not re-implement its comparison,
// because a copy of that logic here could pass while the script fails.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'lint-ratchet.mjs')
const BASELINE = path.join(ROOT, 'eslint-baseline.json')
const PROBE = path.join(ROOT, 'src', '__ratchet_probe_tmp.ts')

function ratchet(args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

afterEach(() => {
  if (existsSync(PROBE)) unlinkSync(PROBE)
})

// Each case shells out to a full `eslint src`, which takes ~15s on this
// tree. The default 5s timeout would fail on the work, not the assertion.
const ESLINT_RUN_MS = 120_000

describe('lint ratchet (scripts/lint-ratchet.mjs)', () => {
  it('passes against the committed baseline', () => {
    const r = ratchet()
    expect(r.stdout).toContain('eslint:')
    expect(r.status, r.stdout + r.stderr).toBe(0)
  }, ESLINT_RUN_MS)

  it('fails when a file adds errors', () => {
    writeFileSync(
      PROBE,
      'export function __probe(a: any) {\n  const unused = 1\n  return a\n}\n',
      'utf8',
    )
    const r = ratchet()
    expect(r.status).toBe(1)
    expect(r.stdout + r.stderr).toContain('__ratchet_probe_tmp.ts')
    // It must name the file, not just report a higher total.
    expect(r.stdout + r.stderr).toMatch(/no-explicit-any|no-unused-vars/)
  }, ESLINT_RUN_MS)

  it('reports what --update wrote, so a raise shows in the diff', () => {
    const before = readFileSync(BASELINE, 'utf8')
    const r = ratchet(['--update'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('baseline updated:')
    // With no source change, the rewritten baseline must be byte-identical.
    expect(readFileSync(BASELINE, 'utf8')).toBe(before)
  }, ESLINT_RUN_MS)

  it('the baseline records its own totals', () => {
    const base = JSON.parse(readFileSync(BASELINE, 'utf8'))
    expect(typeof base.errors).toBe('number')
    expect(typeof base.warnings).toBe('number')
    expect(base.errors).toBeGreaterThan(0)
  })
})
