import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// These assertions must stay on the actual payload literals. tsc -b checks
// their column names and values against the generated database types.
describe('creator write column contracts', () => {
  const store = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const follows = readFileSync(new URL('../src/lib/creatorFollows.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  it.each([
    ['profiles', 'update', 'Update'],
    ['published_itineraries', 'upsert', 'Insert'],
  ])('checks the %s write with the compiler', (table, method, operation) => {
    const callStart = `from('${table}').${method}({`
    const callEnd = `} satisfies Database['public']['Tables']['${table}']['${operation}'])`
    const callStartIndex = store.indexOf(callStart)
    expect(callStartIndex).toBeGreaterThanOrEqual(0)
    const callEndIndex = store.indexOf(callEnd, callStartIndex)
    expect(callEndIndex).toBeGreaterThan(callStartIndex)
    expect(store.slice(callStartIndex + callStart.length, callEndIndex)).not.toContain(';')
  })
  it('checks the follow insert with the compiler', () => {
    expect(follows).toContain("insert({ follower, creator } satisfies Database['public']['Tables']['creator_follows']['Insert'])")
  })
})
