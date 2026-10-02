// The STE100 checker (AGENTS.md §2 rule 13) is itself a guardrail, so it gets
// pinned: a rewrite that silently stops catching violations would leave the
// rule unenforced, which is the exact defect class §2 rule 13 exists to fix.
//
// These tests run the real script against real text. They do not re-implement
// its rules — a copy of the logic here could pass while the script fails.
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/lint-ste.mjs', import.meta.url))

function run(text: string) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--stdin'], {
      input: text,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stderr?: string }
    return { code: e.status ?? 1, out: e.stderr ?? '' }
  }
}

describe('STE100 lint (scripts/lint-ste.mjs)', () => {
  it('passes compliant prose', () => {
    const r = run('Check the value.\nRun the tests.\nYou must not push to main.\n')
    expect(r.code).toBe(0)
  })

  it('catches a sentence over the 20 word limit', () => {
    const long =
      'The share preview handler reads only the stored cover image URL column from the published itineraries table and therefore renders the brand card for every publication that lacks an explicit cover.'
    const r = run(long + '\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/20 words|max 20/)
  })

  it('catches a sentence that starts with a gerund', () => {
    const r = run('Checking the value before you proceed.\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/gerund/i)
  })

  it('catches a controlled-vocabulary violation', () => {
    const r = run('Utilize the helper to facilitate the migration.\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/Utilize|facilitate/)
  })

  it('catches "should" carrying a rule', () => {
    const r = run('You should push to main.\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/must/)
  })

  it('allows a sentence that names the should/must rule', () => {
    const r = run('Use must, not should.\n')
    expect(r.code).toBe(0)
  })

  it('ignores headings, tables and code fences', () => {
    const r = run('## A heading that is quite long but is a heading\n| a | b |\n```\nconst x = 1\n```\n')
    expect(r.code).toBe(0)
  })

  it('the repo script exists and is runnable', () => {
    expect(() => execFileSync(process.execPath, [SCRIPT, '--help-flag-that-is-ignored'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })).not.toThrow()
  })
})
