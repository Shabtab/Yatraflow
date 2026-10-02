// Pure-logic tests for the UI anti-pattern gate. Node env, no DOM — the
// checker is a pure function over { filename: source }, so the fixtures below
// are the whole surface. What matters is that each rule fires on its own
// violation AND stays silent on the shapes this repo deliberately uses, since
// a gate that cries wolf on correct code stops being run.
import { describe, it, expect } from 'vitest'
import { check, RULES } from '../scripts/uiAntipatterns.mjs'

const cleanCss = `
.btn { transition: color 180ms ease, background 180ms ease; }
.panel { z-index: var(--z-modal); }
.map-pin { z-index: 3; }
.sheet { z-index: 40; }
`
const cleanHtml = `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />`
const ok = { 'src/styles.css': cleanCss, 'index.html': cleanHtml }

describe('ui anti-pattern gate', () => {
  it('is silent on the shapes this repo actually uses', () => {
    expect(check(ok)).toEqual([])
  })

  it('exposes three enforced rules, each with a reason', () => {
    expect(RULES.map(r => r.id)).toEqual(['U1', 'U2', 'U3'])
    for (const r of RULES) expect(r.why.length).toBeGreaterThan(20)
  })

  describe('U1 transition: all', () => {
    it('catches the shorthand', () => {
      const f = check({ 'src/styles.css': '.x { transition: all 200ms ease; }' })
      expect(f).toHaveLength(1)
      expect(f[0]).toMatchObject({ rule: 'U1', line: 1 })
    })

    it('does not fire on an explicit property list, however long', () => {
      const many = '.x { transition: color 1s, background 1s, opacity 1s, border-color 1s, transform 1s; }'
      expect(check({ 'src/styles.css': many })).toEqual([])
    })
  })

  describe('U2 raw z-index', () => {
    it('catches a 999 literal', () => {
      const f = check({ 'src/styles.css': '.a { z-index: 999; }' })
      expect(f).toHaveLength(1)
      expect(f[0].rule).toBe('U2')
    })

    it('catches a four-digit literal', () => {
      expect(check({ 'src/styles.css': '.a { z-index: 9999; }' })).toHaveLength(1)
    })

    it('leaves the ladder and its rungs alone', () => {
      // the documented --z-* ladder tops out at --z-impact: 210
      const ladder = '.a { z-index: var(--z-impact); }\n.b { z-index: 210; }\n.c { z-index: 0; }'
      expect(check({ 'src/styles.css': ladder })).toEqual([])
    })
  })

  describe('U3 pinch-zoom', () => {
    it('catches user-scalable=no', () => {
      const f = check({ 'index.html': '<meta name="viewport" content="width=device-width, user-scalable=no" />' })
      expect(f).toHaveLength(1)
      expect(f[0].rule).toBe('U3')
    })

    it('catches maximum-scale=1', () => {
      expect(check({ 'index.html': '<meta name="viewport" content="width=device-width, maximum-scale=1" />' })).toHaveLength(1)
    })

    it('allows viewport-fit=cover, which is not a zoom block', () => {
      expect(check({ 'index.html': cleanHtml })).toEqual([])
    })

    it('reports a line carrying both zoom blocks once, not twice', () => {
      const both = '<meta name="viewport" content="width=device-width, user-scalable=no, maximum-scale=1" />'
      expect(check({ 'index.html': both })).toHaveLength(1)
    })
  })

  describe('reporting', () => {
    it('reports a real line number for a violation below line 1', () => {
      const src = '.a { color: red; }\n.b { color: red; }\n.c { transition: all 1s; }'
      expect(check({ 'src/styles.css': src })[0].line).toBe(3)
    })

    it('quotes the offending line so the message is actionable', () => {
      const f = check({ 'src/styles.css': '.btn { transition: all 200ms; }' })
      expect(f[0].text).toContain('transition: all')
    })

    it('ignores a rule whose file is absent, rather than throwing', () => {
      expect(check({ 'index.html': cleanHtml })).toEqual([])
      expect(check({})).toEqual([])
    })

    it('sorts findings by file then line', () => {
      const files = {
        'src/styles.css': '.a { z-index: 5; }\n.b { z-index: 9999; }',
        'index.html': '<meta content="user-scalable=no" />',
      }
      const f = check(files)
      expect(f.map(x => `${x.file}:${x.line}`)).toEqual(['index.html:1', 'src/styles.css:2'])
    })

    it('collects every violation, not just the first per file', () => {
      const f = check({ 'src/styles.css': '.a { z-index: 999; }\n.b { z-index: 1000; }\n.c { transition: all 1s; }' })
      expect(f).toHaveLength(3)
    })
  })
})