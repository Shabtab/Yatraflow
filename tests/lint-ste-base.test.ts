// Pins the base order of a default lint:ste run (scripts/lint-ste-base.mjs).
// The lookups are fakes, so each step of the order is tested without a
// repository. The real-git runs live in tests/lint-ste.test.ts.
import { describe, expect, it } from 'vitest'
import { chooseLintBase, GateError, requireMergeBase } from '../scripts/lint-ste-base.mjs'

// `commits` maps a ref to a commit sha. `bases` maps a ref to its merge base with HEAD.
function lookups(commits: Record<string, string>, bases: Record<string, string> = {}) {
  return {
    commitOf: (ref: string) => commits[ref] ?? null,
    mergeBaseOf: (ref: string) => bases[ref] ?? '',
  }
}

const LOCAL = {}
const CI = { CI: 'true' }

describe('lint:ste base order (scripts/lint-ste-base.mjs)', () => {
  it('uses the pull request base first, even when origin/test exists', () => {
    const base = chooseLintBase({
      env: { ...LOCAL, GITHUB_BASE_REF: 'main' },
      ...lookups({ 'origin/main': 'm1', 'origin/test': 't1' }, { 'origin/main': 'mb', 'origin/test': 'tb' }),
    })
    expect(base.sha).toBe('mb')
    expect(base.label).toMatch(/origin\/main/)
    expect(base.warning).toBe('')
  })

  it('uses the merge base with origin/test by default', () => {
    const base = chooseLintBase({
      env: LOCAL,
      ...lookups({ 'origin/test': 't1' }, { 'origin/test': 'tb' }),
    })
    expect(base.sha).toBe('tb')
    expect(base.label).toMatch(/origin\/test/)
    expect(base.warning).toBe('')
  })

  it('falls back to origin/main outside CI, and warns that origin/test is absent', () => {
    const base = chooseLintBase({
      env: LOCAL,
      ...lookups({ 'origin/main': 'm1' }, { 'origin/main': 'mb' }),
    })
    expect(base.sha).toBe('mb')
    expect(base.label).toMatch(/origin\/main/)
    expect(base.warning).toMatch(/origin\/test not found/)
    expect(base.warning).toMatch(/git fetch origin test/)
  })

  it('falls back to HEAD~1 outside CI when neither origin ref exists', () => {
    const base = chooseLintBase({
      env: LOCAL,
      ...lookups({ 'HEAD~1': 'p1' }),
    })
    expect(base.sha).toBe('p1')
    expect(base.label).toMatch(/HEAD~1/)
    expect(base.warning).toMatch(/origin\/main not found/)
  })

  it('checks uncommitted lines only when no base commit exists', () => {
    const base = chooseLintBase({ env: LOCAL, ...lookups({}) })
    expect(base.sha).toBe('HEAD')
    expect(base.label).toMatch(/uncommitted lines only/)
    expect(base.warning).toMatch(/origin\/test not found/)
  })

  it('never falls back under CI when origin/test is missing', () => {
    // origin/main and HEAD~1 both exist here. CI must still stop, not fall back.
    const run = () => chooseLintBase({
      env: CI,
      ...lookups({ 'origin/main': 'm1', 'HEAD~1': 'p1' }, { 'origin/main': 'mb' }),
    })
    expect(run).toThrow(GateError)
    expect(run).toThrow(/origin\/test not found under CI/)
  })

  it('stops under CI when the pull request base is missing, and does not use origin/test', () => {
    const run = () => chooseLintBase({
      env: { ...CI, GITHUB_BASE_REF: 'main' },
      ...lookups({ 'origin/test': 't1' }, { 'origin/test': 'tb' }),
    })
    expect(run).toThrow(GateError)
    expect(run).toThrow(/origin\/main not found under CI/)
  })

  it('uses origin/test under CI when it exists, with no warning', () => {
    const base = chooseLintBase({
      env: CI,
      ...lookups({ 'origin/test': 't1' }, { 'origin/test': 'tb' }),
    })
    expect(base.sha).toBe('tb')
    expect(base.warning).toBe('')
  })

  it('stops on a base that shares no history with HEAD, outside CI and under CI', () => {
    // A shallow clone has the ref but no merge base. The gate must not guess a range.
    for (const env of [LOCAL, CI]) {
      const run = () => chooseLintBase({ env, ...lookups({ 'origin/test': 't1' }, {}) })
      expect(run).toThrow(GateError)
      expect(run).toThrow(/no merge base/)
      expect(run).toThrow(/git fetch --unshallow/)
    }
  })

  it('never reads HEAD~1 when origin/test has no merge base', () => {
    const run = () => chooseLintBase({ env: LOCAL, ...lookups({ 'origin/test': 't1', 'HEAD~1': 'p1' }, {}) })
    expect(run).toThrow(/no merge base/)
  })

  it('requireMergeBase returns the sha, or throws a GateError with the fix', () => {
    expect(requireMergeBase('origin/test', () => 'tb')).toBe('tb')
    expect(() => requireMergeBase('origin/test', () => '')).toThrow(GateError)
    expect(() => requireMergeBase('origin/test', () => '')).toThrow(/git fetch --unshallow/)
  })
})
