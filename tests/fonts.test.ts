// ============ Brand font supply chain ============
// Source pins for the self-hosted fonts. A missing weight or a re-added CDN
// link must fail here, not at render time.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')

const html = read('index.html')
const main = read('src/main.tsx')
const css = read('src/styles.css')

const SORA_WEIGHTS = ['600', '700', '800']
const JAKARTA_WEIGHTS = ['400', '500', '600', '700', '800']

describe('brand fonts ship from the bundle, not a CDN', () => {
  it('index.html carries no font CDN reference — no preconnect, no stylesheet', () => {
    expect(html).not.toContain('fonts.googleapis.com')
    expect(html).not.toContain('fonts.gstatic.com')
  })

  it('main.tsx vendors every weight the removed Google Fonts link loaded', () => {
    for (const weight of SORA_WEIGHTS) {
      expect(main).toContain(`@fontsource/sora/${weight}.css`)
    }
    for (const weight of JAKARTA_WEIGHTS) {
      expect(main).toContain(`@fontsource/plus-jakarta-sans/${weight}.css`)
    }
  })

  it('styles.css keeps the family names the vendored @font-face rules declare', () => {
    expect(css).toContain("'Sora'")
    expect(css).toContain("'Plus Jakarta Sans'")
  })
})
