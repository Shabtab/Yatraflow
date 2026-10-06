// ============ DMCA policy page and the payment disclosure ============
// Source pins on the new legal surface. Route-vs-switch coherence is owned by
// tests/route-integrity.test.ts (table ⊆ handled); this file pins the page
// content and the disclosure lines the reader actually meets.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')

const dmca = read('src/pages/DMCAPage.tsx')
const pub = read('src/pages/PublicItinerary.tsx')
const landing = read('src/pages/Landing.tsx')

describe('the DMCA page names the contact and the counter-notice path', () => {
  it('carries the report address', () => {
    expect(dmca).toContain('support@yatraflow.app')
  })

  it('tells the poster a counter notice is possible', () => {
    expect(dmca).toContain('counter notice')
  })
})

describe('the unlock buttons disclose the payment shape', () => {
  it('both unlock spots say one-time payment, no subscription', () => {
    const hits = pub.match(/One-time payment\. No subscription\./g) ?? []
    expect(hits.length).toBe(2)
  })

  it('keeps the pinned unlock label', () => {
    expect(pub).toMatch(/Unlock full plan · \{formatInr\(price\)\}/)
  })
})

describe('the landing page links the policy', () => {
  it('carries the copyright line with a #/dmca link', () => {
    expect(landing).toContain('href="#/dmca"')
  })
})
