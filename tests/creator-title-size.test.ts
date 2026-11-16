import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'

describe('Creator title roles', () => {
  const source = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const styles = postcss.parse(source('src/styles/pages/creator.css') + source('src/styles/legacy/12-pages.css'))
  for (const selector of ['.cr-store-grid .ex-card-title', '.cr-store-featured .ex-feature-title', '.cr-hub-publications .hub-card-title']) {
    it(`${selector} follows R20`, () => {
      const declarations = new Map<string, string>()
      styles.walkRules(rule => {
        if (rule.selectors.includes(selector)) rule.walkDecls(decl => { declarations.set(decl.prop, decl.value) })
      })
      expect(Object.fromEntries(declarations)).toMatchObject({
        'font-family': 'var(--font-body)', 'font-size': '18px', 'font-weight': '800', 'line-height': '1.3',
      })
    })
  }
})
