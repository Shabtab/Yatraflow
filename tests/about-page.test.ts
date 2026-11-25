// ============ The /about page is wired, public, and honest ============
// The story page is the one marketing surface a signed-out visitor reads. It
// fails silently in three ways: the route answers for nobody (so the footer
// link lands on the landing page), the page is unreachable before sign-in, or
// the copy claims money the product cannot pay (#234) or real crews it does not
// have (#233). All three are static checks, so they run without a browser.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { ROUTED_SEGMENTS } from '../src/lib/routes'
import { SITE, pageTitle, routeParts } from '../src/lib/pageTitle'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const app = read('src/App.tsx')
const about = read('src/pages/AboutPage.tsx')

describe('/about route', () => {
  it('ships a page component', () => {
    expect(existsSync(new URL('../src/pages/AboutPage.tsx', import.meta.url))).toBe(true)
  })

  it('answers before the signed-in switch, so a signed-out visitor reaches it', () => {
    const aboutBranch = app.indexOf("parts[0] === 'about'")
    const signedOutBranch = app.indexOf('} else if (!me) {')
    expect(aboutBranch).toBeGreaterThan(-1)
    expect(signedOutBranch).toBeGreaterThan(-1)
    expect(aboutBranch, '/about must be answered before the `!me` branch, or it falls to the landing page').toBeLessThan(signedOutBranch)
    expect(app.slice(aboutBranch, aboutBranch + 400)).toContain('<AboutPage />')
  })

  it('is reachable from the global footer and the landing page', () => {
    expect(app).toMatch(/\{\.\.\.appLink\('\/about'\)\}[^<]*About YatraFlow/)
    expect(read('src/pages/Landing.tsx')).toMatch(/\{\.\.\.appLink\('\/about'\)\}>About</)
  })

  it('is bridged from the old hash form and titled in the tab', () => {
    expect(ROUTED_SEGMENTS).toContain('about')
    expect(pageTitle(routeParts('/about'))).toBe(`About · ${SITE}`)
  })

  it('carries the locked positioning lines rather than retyping them', () => {
    expect(about).toMatch(/import \{ HERO_HEADLINE, HERO_SUPPORT \} from '\.\.\/lib\/positioning'/)
    expect(about).toMatch(/headline=\{\{ lead: HERO_HEADLINE \}\}/)
    expect(about).toMatch(/lede=\{HERO_SUPPORT\}/)
  })
})

describe('/about copy stays inside the locked claims', () => {
  // The three things the marketing constraints forbid on a public page. The
  // roadmap paragraph names the payout rail only to say it is not ready, so a
  // bare "payout" word is allowed; a promise of money is not.
  const forbidden: [string, RegExp][] = [
    ['a sale or a seller', /\b(sell|sells|selling|sold|buyer|buyers|buy now)\b/i],
    ['revenue', /\b(revenue|earn(?:ings)?|paid out|payouts? run|weekly payout)\b/i],
    ['a real crew of travellers', /\b(real travellers|real crews|thousands of travellers|our users|happy customers)\b/i],
  ]

  it.each(forbidden)('makes no claim about %s', (_label, pattern) => {
    expect(about).not.toMatch(pattern)
  })

  it('states plainly that the creator tools come after the payout rail exists', () => {
    expect(about).toMatch(/nothing here promises income today/)
  })
})
