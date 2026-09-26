// ============ Id tokens — the other half of #267's lesson ============
//
// #267 moved the presence key off `Math.random()`, and a comment-aware tripwire
// pinned that one module. Two sites kept the weak generator because each looked
// like "not really identity": the seed `uid()` (an id shape) and the toast's
// `Date.now() + Math.random()` (a React key). Both are the identity the app
// keys rows and lists on, and both were flagged by the static analyzer the
// moment a diff touched their line.
//
// The id SHAPE is a contract — `uid('st')` must stay `st_<token>` for callers
// and tests — so these pin the shape, the uniqueness, and the generator source.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomToken } from '../src/lib/randomId'
import { uid } from '../src/data/seed'

/** Code lines only: a comment may name the weak generator (its history is
 *  worth recording) without being a call site. Same filter as
 *  tests/presence.test.ts uses for its own module. */
const codeOf = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n')

describe('randomToken', () => {
  it('is lowercase hex of the requested byte length', () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{16}$/)
    expect(randomToken(6)).toMatch(/^[0-9a-f]{12}$/)
    expect(randomToken(1)).toMatch(/^[0-9a-f]{2}$/)
  })

  it('does not repeat across 500 draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => randomToken()))
    expect(seen.size).toBe(500)
  })
})

describe('uid — the shared row id', () => {
  it('keeps the <prefix>_<token> shape callers pin', () => {
    expect(uid('st')).toMatch(/^st_[0-9a-f]{12}$/)
    expect(uid('day')).toMatch(/^day_[0-9a-f]{12}$/)
  })

  it('is unique across prefixes and draws', () => {
    const ids = new Set([
      ...Array.from({ length: 300 }, () => uid('st')),
      ...Array.from({ length: 100 }, () => uid('ex')),
    ])
    expect(ids.size).toBe(400)
  })
})

describe('no id mint draws from the weak generator', () => {
  it('the token helper, the row ids and the toast list are off Math.random', () => {
    for (const path of ['../src/lib/randomId.ts', '../src/data/seed.ts', '../src/components/ui.tsx']) {
      expect(codeOf(path), path).not.toMatch(/Math\s*\.\s*random\s*\(/)
    }
  })

  // PlanBench is deliberately NOT in that list: its Math.random() calls pick a
  // demo preset and scatter ambient particle offsets — randomness with no
  // identity role. Pinning them would be a false-positive hunt, and routing a
  // demo picker through the CSPRNG would say the opposite of the rule.
})
