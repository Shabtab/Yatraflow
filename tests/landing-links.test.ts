// The landing links that once changed only the hash. Each one must render
// through appLink, so a web click runs one in-app navigation to its page (#714).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const landing = read('src/pages/Landing.tsx')
const planBench = read('src/components/PlanBench.tsx')

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// True when an anchor spreads appLink(target) and its text starts with label.
function linksTo(source: string, target: string, label: string): boolean {
  const anchor = new RegExp(`<a\\b[^>]*\\{\\.\\.\\.appLink\\('${escapeRegExp(target)}'\\)\\}[^>]*>\\s*${escapeRegExp(label)}[^<]*</a>`)
  return anchor.test(source)
}

describe('landing links open their pages through appLink', () => {
  it('spreads the hero planning link from one computed path', () => {
    expect(landing).toMatch(/const startPlanningPath = me \? CREATE_PATH : signupThenCreatePath\(\)/)
    expect(landing).toMatch(/<a\b[^>]*\{\.\.\.appLink\(startPlanningPath\)\}/)
  })

  it('sends Explore itineraries to /explore', () => {
    expect(linksTo(landing, '/explore', 'Explore itineraries')).toBe(true)
  })

  it('sends Create a free account to signup', () => {
    expect(linksTo(landing, '/auth?mode=signup', 'Create a free account')).toBe(true)
  })

  it('sends Copyright and DMCA to /dmca', () => {
    expect(linksTo(landing, '/dmca', 'Copyright and DMCA')).toBe(true)
  })

  it('sends or browse ready itineraries to /explore', () => {
    expect(linksTo(planBench, '/explore', 'or browse ready itineraries')).toBe(true)
  })

  it('imports the shared helper in both files', () => {
    expect(landing).toMatch(/import \{ appLink \} from '\.\.\/lib\/appLink'/)
    expect(planBench).toMatch(/import \{ appLink \} from '\.\.\/lib\/appLink'/)
  })
})
