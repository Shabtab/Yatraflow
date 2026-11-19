// Card hover and entrance gate. It reads the shipped CSS as text (node env, no DOM).
//
// Why it exists: cards jerked and their hover felt rough, for three causes.
//   A. A `box-shadow` transition repaints the card every frame. A big card shows its hover
//      shadow as a `::before` layer that fades on opacity instead.
//   B. An entrance keyframe that animates `transform` fights the hover lift (both own the
//      property): the hover cannot apply while the entrance runs, and the card snaps when it
//      ends. Entrances use `translate`, `scale` and `opacity`.
//   C. A `backdrop-filter` chip over a cover that zooms on hover recomputes its blur every frame.
//
// Each rule is a pure function with one known-bad and one good sample below. A rule that stops
// firing fails in this file, rather than passing silently.
//
// To add a card: append its class compound to CARD_CLASSES. It must have a `:hover` rule, and its
// own base rule must not transition `box-shadow`. To add a cover overlay, append its class to
// COVER_OVERLAYS. `.mt-card` (My trips) joins CARD_CLASSES once the My trips branch merges: on the
// current `test` state its base rule still transitions `box-shadow` and `border-color`, and that file is not ours to edit.
import { describe, it, expect } from 'vitest'
import { readCssSource } from '../scripts/css-source-graph.mjs'

/** Large cards that lift or deepen on hover. The last compound of the selector must equal one of these. */
export const CARD_CLASSES = [
  '.ex-card', '.ex-trend-card', '.mt-shelf-row', '.yf-surface.is-interactive',
  '.itin-card', '.sf-day', '.board-stop',
]
/** Cards that may keep a `border-color` transition: it marks a selected or dragged state, not the hover. */
export const BORDER_EXEMPT = ['.board-stop']
/** Elements that play an entrance. The cards above count too. */
export const ENTRANCE_ONLY = ['.trip-enter', '.ex-enter', '.yf-surface.is-entering']
/** Labels and badges that sit over a cover image which zooms on hover. */
export const COVER_OVERLAYS = ['.ex-style-tag', '.ex-price-tag', '.ex-trend-rank', '.ex-save', '.ex-save-dot']

interface Rule { selector: string; body: string }
interface Parsed { rules: Rule[]; keyframes: Map<string, string> }

function stripComments(css: string): string {
  return css.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** A small CSS reader: rules, nested at-rules (flattened) and keyframes. */
export function parseCss(input: string): Parsed {
  const out: Parsed = { rules: [], keyframes: new Map() }
  const walk = (css: string) => {
    let i = 0
    let start = 0
    while (i < css.length) {
      const ch = css[i]
      if (ch === '"' || ch === "'") {
        const end = css.indexOf(ch, i + 1)
        i = end === -1 ? css.length : end + 1
        continue
      }
      if (ch === ';') { start = i + 1; i++; continue }
      if (ch !== '{') { i++; continue }
      let depth = 1
      let j = i + 1
      while (j < css.length && depth > 0) {
        const c = css[j]
        if (c === '"' || c === "'") { const end = css.indexOf(c, j + 1); j = end === -1 ? css.length : end + 1; continue }
        if (c === '{') depth++
        else if (c === '}') depth--
        j++
      }
      const prelude = css.slice(start, i).trim()
      const inner = css.slice(i + 1, j - 1)
      const kf = prelude.match(/^@(?:-webkit-)?keyframes\s+([\w-]+)/)
      if (kf) out.keyframes.set(kf[1], inner)
      else if (prelude.startsWith('@')) walk(inner)
      else out.rules.push({ selector: prelude, body: inner })
      i = j
      start = j
    }
  }
  walk(stripComments(input))
  return out
}

function declValue(body: string, prop: string): string | null {
  const m = body.match(new RegExp(`(?<![\\w-])${prop}\\s*:\\s*([^;]+)`))
  return m ? m[1].trim() : null
}

/** Splits a selector list on top-level commas. */
function selectorParts(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const c of selector) {
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/** The last compound selector, without `:where()` style groups. Null when it ends in a pseudo-class or pseudo-element. */
function lastCompound(part: string): string | null {
  const flat = part.replace(/\([^()]*\)/g, '')
  if (/(?::|::)[\w-]+$/.test(flat)) return null
  const m = flat.match(/([^\s>+~]+)$/)
  return m ? m[1] : null
}

function isClass(compound: string | null, cls: string): boolean {
  if (!compound) return false
  const esc = cls.replace(/\./g, '\\.')
  return new RegExp(`^(?:[a-z]+)?${esc}(?:\\[[^\\]]*\\])*$`).test(compound)
}

function hasHoverRule(rules: Rule[], cls: string): boolean {
  const esc = cls.replace(/\./g, '\\.')
  const re = new RegExp(`${esc}(?:\\[[^\\]]*\\])*:hover`)
  return rules.some(r => selectorParts(r.selector).some(p => re.test(p)))
}

/** Rule A: a card with a hover rule must not transition `box-shadow` or `border-color` in its own base rule. */
export function shadowTransitionProblems(css: string, cards: string[], borderExempt: string[] = []): string[] {
  const { rules } = parseCss(css)
  const problems: string[] = []
  for (const card of cards) {
    if (!hasHoverRule(rules, card)) {
      problems.push(`${card}: no :hover rule found, so the list entry is stale`)
      continue
    }
    for (const r of rules) {
      if (!selectorParts(r.selector).some(p => isClass(lastCompound(p), card))) continue
      const tr = declValue(r.body, 'transition')
      const banned = borderExempt.includes(card) ? /\b(?:box-shadow|all)\b/ : /\b(?:box-shadow|border-color|all)\b/
      if (tr && banned.test(tr)) problems.push(`${r.selector}: transition animates box-shadow or border-color (${tr})`)
    }
  }
  return problems
}

/** Rule B: an entrance used by a card, or by an entrance element, must not animate `transform`. */
export function entranceTransformProblems(css: string, elements: string[]): string[] {
  const { rules, keyframes } = parseCss(css)
  const problems: string[] = []
  for (const r of rules) {
    if (!selectorParts(r.selector).some(p => elements.some(el => isClass(lastCompound(p), el)))) continue
    const value = [declValue(r.body, 'animation'), declValue(r.body, 'animation-name')].filter(Boolean).join(' ')
    for (const name of value.split(/[\s,]+/)) {
      const frames = keyframes.get(name)
      if (frames && /(?<![\w-])transform\s*:/.test(frames)) problems.push(`${r.selector}: @keyframes ${name} animates transform`)
    }
  }
  return [...new Set(problems)]
}

/** Rule C: a cover overlay must not carry `backdrop-filter`. */
export function overlayBlurProblems(css: string, overlays: string[]): string[] {
  const { rules } = parseCss(css)
  const problems: string[] = []
  for (const r of rules) {
    if (!selectorParts(r.selector).some(p => overlays.some(o => isClass(lastCompound(p), o)))) continue
    if (/(?<![\w-])(?:-webkit-)?backdrop-filter\s*:/.test(r.body)) problems.push(`${r.selector}: backdrop-filter over a zooming cover`)
  }
  return problems
}

const BAD_SHADOW = '.ex-card { transition: transform .2s, box-shadow .2s; }\n.ex-card:hover { transform: translateY(-2px); }'
const BAD_BORDER = '.ex-card { transition: transform .2s, border-color .2s; }\n.ex-card:hover { transform: translateY(-2px); }'
const GOOD_SHADOW = '.ex-card { transition: transform .2s; }\n.ex-card:hover { transform: translateY(-2px); }'
const BAD_ENTRANCE = '@keyframes rise { from { opacity: 0; transform: translateY(14px); } }\n.ex-enter { animation: rise 1s backwards; }'
const GOOD_ENTRANCE = '@keyframes rise { from { opacity: 0; translate: 0 14px; scale: .98; } }\n.ex-enter { animation: rise 1s backwards; }'
const BAD_BLUR = '.ex-style-tag { background: red; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }'
const GOOD_BLUR = '.ex-style-tag { background: color-mix(in srgb, var(--card) 95%, transparent); }'

describe('card hover gate: every rule fires on a known-bad sample', () => {
  it('rule A fails a card whose base rule transitions box-shadow, and passes one that does not', () => {
    expect(shadowTransitionProblems(BAD_SHADOW, ['.ex-card'])).toHaveLength(1)
    expect(shadowTransitionProblems(GOOD_SHADOW, ['.ex-card'])).toEqual([])
    // A border-color transition repaints the page every frame, so it fails too, unless the card is exempt.
    expect(shadowTransitionProblems(BAD_BORDER, ['.ex-card'])).toHaveLength(1)
    expect(shadowTransitionProblems(BAD_BORDER, ['.ex-card'], ['.ex-card'])).toEqual([])
    // `transition: all` also covers box-shadow.
    expect(shadowTransitionProblems('.ex-card { transition: all .2s; }\n.ex-card:hover { top: 0; }', ['.ex-card'])).toHaveLength(1)
    // A listed card with no hover rule is a stale entry.
    expect(shadowTransitionProblems(GOOD_SHADOW, ['.ex-gone'])).toHaveLength(1)
    // A rule inside @media still counts, and a themed base selector is still the card's own rule.
    expect(shadowTransitionProblems('@media (min-width: 1px) { :root:where([data-theme=\'dark\']) .ex-card { transition: box-shadow 1s; } }\n.ex-card:hover { top: 0; }', ['.ex-card'])).toHaveLength(1)
  })

  it('rule B fails an entrance keyframe that animates transform, and passes translate and scale', () => {
    expect(entranceTransformProblems(BAD_ENTRANCE, ['.ex-enter'])).toEqual(['.ex-enter: @keyframes rise animates transform'])
    expect(entranceTransformProblems(GOOD_ENTRANCE, ['.ex-enter'])).toEqual([])
    // `animation-name` on a longer selector counts when its last compound is a listed element.
    expect(entranceTransformProblems('@keyframes rise { from { transform: scale(.9); } }\n.page-enter > .sf-day { animation-name: rise; }', ['.sf-day'])).toHaveLength(1)
  })

  it('rule C fails a cover overlay with backdrop-filter, and passes a solid one', () => {
    expect(overlayBlurProblems(BAD_BLUR, ['.ex-style-tag'])).toHaveLength(1)
    expect(overlayBlurProblems(GOOD_BLUR, ['.ex-style-tag'])).toEqual([])
    expect(overlayBlurProblems('.ex-card .ex-style-tag { backdrop-filter: blur(4px); }', ['.ex-style-tag'])).toHaveLength(1)
  })
})

describe('card hover gate: the shipped CSS', () => {
  const css = readCssSource('src/styles.css') as string

  it('A: no listed card transitions box-shadow in its own base rule', () => {
    expect(shadowTransitionProblems(css, CARD_CLASSES, BORDER_EXEMPT)).toEqual([])
  })

  it('B: no entrance used by a listed card or entrance element animates transform', () => {
    expect(entranceTransformProblems(css, [...CARD_CLASSES, ...ENTRANCE_ONLY])).toEqual([])
  })

  it('C: no cover overlay carries backdrop-filter', () => {
    expect(overlayBlurProblems(css, COVER_OVERLAYS)).toEqual([])
  })

  it('the entrance keyframes the cards share are the ones the gate reads', () => {
    const { keyframes } = parseCss(css)
    expect(keyframes.has('cardIn')).toBe(true)
    expect(keyframes.has('sf-rise')).toBe(true)
  })
})
