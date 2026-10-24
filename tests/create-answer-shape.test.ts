// ============ The guided create flow's answers are square boxes ============
// A review of the create branch found the accommodation row, the driver row and
// the Mixed answer pair rendering as 999px pills. The cause was an appended
// `.gcf.trip-starter` block: it copied the job of the older `.gcf` pill rules,
// but one class deeper, so it beat the boxed `.trip-starter` block by
// specificity instead of by intent. The approved mockup is the other way round,
// and the legacy long form has always been boxed.
//
// The older pill declarations above the boxed block are not a defect. They are
// the legacy and guided baselines, and the boxed block overrides them on source
// order, which is the documented append-only pattern. What must never come back
// is a pill declaration AT OR AFTER the boxed block, or a selector that outranks
// it. These pins read the shipped stylesheet as text, so a later session cannot
// re-pill the guided answers without turning the build red.
//
// Comments are stripped before every assertion: this file and the CSS both
// discuss pills by name, and a guard that fires on its own explanation is a
// guard that gets deleted.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const raw = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** The stylesheet without comments, so prose about a rule is not read as one. */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, ' ')

interface Rule { selector: string; body: string; at: number }

/** Top-level rules, selector, body and offset, in source order. */
function rules(source: string): Rule[] {
  const out: Rule[] = []
  let depth = 0
  let selector = ''
  let body = ''
  let start = 0
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '{') {
      if (depth === 0) { body = ''; start = i }
      depth++
      continue
    }
    if (c === '}') {
      depth--
      if (depth === 0) {
        const s = selector.trim()
        if (s && !s.startsWith('@')) out.push({ selector: s, body, at: start })
        selector = ''
        continue
      }
    }
    if (depth === 0) selector += c
    else if (depth === 1) body += c
  }
  return out
}

const all = rules(css)

/** The shared boxed rule: the one place the square answer shape is declared. */
const BOXED = '.trip-starter :is(.ct-mode, .ct-style, .ct-tier button, .crew-btn)'
const boxed = all.find(r => r.selector === BOXED)
const boxedAt = boxed?.at ?? -1

/** Rules whose selector names one of the answer controls. */
const ANSWER = /(\.ct-tier|\.crew-row|\.transport-answer-pair|\.ct-style|\.ct-mode)/

describe('the guided create answers keep the boxed shape', () => {
  it('finds the shared boxed rule, so the guard cannot pass on nothing', () => {
    expect(boxed, `missing ${BOXED}`).toBeDefined()
    expect(boxed!.body).toMatch(/border-radius:\s*8px/)
    expect(boxed!.body).toMatch(/border:\s*1px solid/)
  })

  it('declares no pill radius at or after the boxed block', () => {
    // Everything above it is the legacy and guided baseline that the boxed rule
    // is meant to override. A pill below it wins the cascade, which is exactly
    // the regression: 185a894f appended `.gcf.trip-starter … 999px`.
    const offenders = all
      .filter(r => r.at > boxedAt && ANSWER.test(r.selector))
      .filter(r => /border-radius:\s*999px/.test(r.body))
      .map(r => r.selector)
    expect(offenders, `pill radius after the boxed block on: ${offenders.join(' | ')}`).toEqual([])
  })

  it('adds no selector that outranks the boxed rule for an answer control', () => {
    // `.gcf.trip-starter` is 0,3,0 and beats the boxed 0,2,0 rule regardless of
    // order. That pairing is the trap; it must not come back.
    const offenders = all
      .filter(r => /\.gcf\b/.test(r.selector) && /\.trip-starter\b/.test(r.selector))
      .filter(r => ANSWER.test(r.selector))
      .map(r => r.selector)
    expect(offenders, `higher-specificity answer rule: ${offenders.join(' | ')}`).toEqual([])
  })

  it('keeps the selection settle and its reduced-motion off switch', () => {
    expect(css).toMatch(/@keyframes create-choice-settle/)
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/create-choice-settle|animation:\s*none/)
  })

  it('keeps the check mark on the selected answer', () => {
    expect(css).toMatch(/\.trip-starter :is\([^)]*\)::after \{[^}]*border-width: 0 2px 2px 0/)
    expect(css).toMatch(/\)\.on::after \{ opacity: 1;/)
  })

  it('keeps a distinct tint per answer, so the boxes are not one flat colour', () => {
    const tints = [...css.matchAll(/\.trip-starter \[data-choice='[a-z-]+'\][^{]*\{ --choice-tint:/g)]
    expect(tints.length).toBeGreaterThanOrEqual(8)
  })
})
