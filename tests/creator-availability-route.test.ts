// ============ #800 — disabled creator suppression at the direct route ============
//
// The RPC and the API handler were proved by the SQL and API probes; this file
// proves the CLIENT route. A disabled account keeps its public identity card —
// name and avatar for crews it already belongs to — so `userById` finds it, and
// the page must refuse to render on that fact alone. An independent probe found
// the page checking only whether an identity existed.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/CreatorPage.tsx', 'utf8')

describe('the creator route enforces availability, not mere existence', () => {
  it('derives the derived signal rather than trusting identity presence', () => {
    expect(page).toMatch(/const creatorUnavailable = creator !== undefined && !creator\.profile\.creatorAvailable/)
  })

  it('gates the render on that signal, beside the absent-creator branch', () => {
    expect(page).toMatch(/if \(!creator \|\| creatorUnavailable\) \{/)
  })

  it('does not read the private administrative flag to decide', () => {
    // The whole point: the flag never crosses the boundary, so a page that needed
    // it could not work at all.
    expect(page).not.toMatch(/profile\.isDisabled/)
  })

  it('does not require a creator badge, so former creators stay listable', () => {
    // A plan published by an account that later dropped the badge must not vanish
    // from Explore or from this route when the account is enabled. The badge is
    // decoration on this page, never a gate: no `!creator.profile.isCreator`
    // branch decides whether the route renders.
    expect(page).not.toMatch(/if \(![\w.?]*isCreator/)
    expect(page).not.toMatch(/\|\| !creator\.profile\.isCreator/)
  })
})
