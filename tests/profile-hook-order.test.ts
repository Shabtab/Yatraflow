// A hook that sits BELOW an early return crashes React with "Rendered more
// hooks than during the previous render" the moment the store hydrates after
// mount. It only reproduces on a full reload, never on hash navigation into an
// already-hydrated app, so clicking around the running app proves nothing
// (CODING_STANDARDS rule 6e).
//
// eslint catches the shape. This test pins the rule that the shape has no
// legitimate exception in a page component, so a later refactor cannot
// reintroduce it behind a disable comment.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(fileURLToPath(new URL('../src/pages/Profile.tsx', import.meta.url)), 'utf8')

/**
 * Line of the component's early return, or -1.
 *
 * Scope the search to the component body: the module has helper functions
 * above it whose own `if (x) return y` lines are not component guards.
 */
function earlyReturnLine(lines: string[]): number {
  const start = lines.findIndex(l => /^export function ProfilePage/.test(l))
  expect(start, 'ProfilePage not found').toBeGreaterThan(-1)
  for (let i = start; i < lines.length; i++) {
    if (/^\s{2}if\s*\(.*\)\s*return\s+/.test(lines[i])) return i + 1
  }
  return -1
}

describe('Profile: no hook below an early return', () => {
  const lines = src.split(/\r?\n/)

  it('the page has an early return (so the rule below has something to check)', () => {
    expect(earlyReturnLine(lines)).toBeGreaterThan(0)
  })

  it('declares no hook after that return', () => {
    const cut = earlyReturnLine(lines)
    // Two-space indent marks a statement, not a JSX attribute.
    const after = lines.slice(cut).join('\n')
    const hooks = after.match(/^\s{2}const\s+\w+\s*=\s*use[A-Z]\w*\(/gm) ?? []
    expect(hooks, `hooks found after the early return on line ${cut}: ${hooks.join(', ')}`).toEqual([])
  })

  it('reads me without a non-null assertion after the guard', () => {
    // `me!` after `if (!me) return null` is fine, but the two hooks that used
    // to live above it needed `me!` because TS narrowed them to never.
    const guardIdx = lines.findIndex(l => /if\s*\(!me\)\s*return\s+null/.test(l))
    expect(guardIdx).toBeGreaterThan(0)
    const hookBlock = lines.slice(0, guardIdx).join('\n')
    expect(hookBlock).not.toMatch(/notificationsFor\(me\.\w+\)/)
  })
})
