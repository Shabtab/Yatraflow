// CI workflow contract: the verification gate must run on the branches that
// feature work actually integrates through. Static source check — no browser.
//
// Why this exists: `ci.yml`'s `pull_request` trigger listed only `main`, which
// made `test` — the branch every feature reaches through a PR — the one
// destination where a green check list proved nothing. A PR into `test` ran
// Codacy and Vercel and no "Verify" job at all, and the gate only fired once the
// merge pushed to `test`, after the point where a red tree could still be
// refused. It was found on 2026-09-14 (PR #105) and documented in AGENTS.md
// §3.1, but prose is not a gate: nothing failed while the trigger was wrong, so
// the gap outlived the entry that described it. This test is that missing
// failure — an edit that drops a shared branch from the trigger, or that stops
// running the gate, now fails the build instead of silently weakening every
// future merge.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts?: Record<string, string> }

/** The body of one trigger under `on:`. Triggers are indented two spaces and
 *  their own keys four, so the block ends at the next line indented two spaces
 *  or fewer — the next trigger, or a new top-level key. Without that stop the
 *  `pull_request` block would run on into `push:` and could report `push`'s
 *  branch list as its own. */
function triggerBlock(name: string): string {
  const lines = workflow.split(/\r?\n/)
  // Matched by trimmed equality rather than by a RegExp assembled from the
  // name. The name is one of this file's own literals either way, but a pattern
  // built from a variable is a static-analysis finding for no benefit here — and
  // the exact match is stricter than the pattern was, since it cannot drift into
  // a longer key that merely starts with the trigger's name.
  const start = lines.findIndex((line) => line.trim() === name + ':')
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^(?: {0,2}\S)/.test(line) && !/^\s*#/.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** Branch globs declared under a trigger. Quotes stripped so `'redesign/**'`
 *  and `redesign/**` compare equal. */
function branchesOf(name: string): string[] {
  const match = triggerBlock(name).match(/^\s*branches:\s*\[([^\]]*)\]/m)
  if (!match) return []
  return match[1]
    .split(',')
    .map((branch) => branch.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

describe('ci.yml — the gate reaches the branches work integrates through', () => {
  it('runs on pull requests into test, not just main', () => {
    // The regression this file exists for: `test` was absent, so a PR there was
    // unverified while looking checked.
    expect(branchesOf('pull_request')).toContain('test')
  })

  it('keeps running on pull requests into main', () => {
    expect(branchesOf('pull_request')).toContain('main')
  })

  it('keeps the push coverage for main, test and redesign/**', () => {
    const push = branchesOf('push')
    expect(push).toContain('main')
    expect(push).toContain('test')
    expect(push).toContain('redesign/**')
  })

  it('declares both a PR trigger and a push trigger', () => {
    // A trigger renamed to an event the workflow no longer receives would leave
    // `triggerBlock` empty and `branchesOf` returning [], making the assertions
    // above pass vacuously.
    expect(triggerBlock('pull_request')).not.toBe('')
    expect(triggerBlock('push')).not.toBe('')
  })

  it('reads each trigger\'s own branch list, not a neighbour\'s', () => {
    // Pins the block boundary itself: `pull_request` is followed immediately by
    // `push`, so a parser that overruns reports `push`'s list as the PR one —
    // and would keep passing even after `test` was removed from the PR trigger.
    expect(branchesOf('pull_request')).not.toContain('redesign/**')
  })

  it('runs the real gate, and package.json still defines it', () => {
    // The workflow delegates the gate to npm rather than re-listing the steps,
    // so the contract is the script name, not its contents. Pinning the exact
    // command string here would duplicate `package.json` and fail on any
    // legitimate re-ordering of the same gate.
    expect(workflow).toMatch(/npm run verify/)
    expect(packageJson.scripts?.verify).toBeTruthy()
  })

  it('the gate itself runs the lint ratchet', () => {
    // The ratchet is the check that caught a rules-of-hooks crash hiding behind
    // 148 unlinted errors (AGENTS.md §2 rule 14). A ratchet nobody runs is the
    // same defect as an unrun check, so this pins the script name inside
    // `verify` itself.
    expect(packageJson.scripts?.verify).toMatch(/lint:ratchet/)
  })

  it('gives the gate enough time to include lint', () => {
    // eslint over src/ adds ~15-25s. A 15 minute ceiling was tuned before the
    // ratchet joined; the check name and the timeout both carry it now.
    const minutes = Number(/timeout-minutes:\s*(\d+)/.exec(workflow)?.[1])
    expect(Number.isFinite(minutes)).toBe(true)
    expect(minutes).toBeGreaterThanOrEqual(20)
    expect(workflow).toMatch(/lint ratchet/)
  })
})
