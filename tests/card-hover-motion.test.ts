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
// COVER_OVERLAYS. The My trips card and postcard joined after #981 merged.
import { describe, it, expect } from 'vitest'
import { readCssSource } from '../scripts/css-source-graph.mjs'

/** Large cards that lift or deepen on hover. The last compound of the selector must equal one of these. */
export const CARD_CLASSES = [
  '.ex-card', '.ex-trend-card', '.mt-shelf-row', '.yf-surface.is-interactive',
  '.itin-card', '.sf-day', '.board-stop', '.mt-card', '.mt-pc',
]
/** Cards that may keep a `border-color` transition: it marks a selected or dragged state, not the hover. */
export const BORDER_EXEMPT = ['.board-stop']
/** Elements that play an entrance. The cards above count too. */
export const ENTRANCE_ONLY = ['.trip-enter', '.ex-enter', '.yf-surface.is-entering']
/** Labels and badges that sit over a cover image which zooms on hover. */
export const COVER_OVERLAYS = ['.ex-style-tag', '.ex-price-tag', '.ex-trend-rank', '.ex-save', '.ex-save-dot', '.mt-stamp', '.mt-status']

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

/** The value of the first `prop:` declaration in a rule body. Plain string parsing, no RegExp from a variable. */
function declValue(body: string, prop: string): string | null {
  for (const decl of body.split(';')) {
    const colon = decl.indexOf(':')
    if (colon !== -1 && decl.slice(0, colon).trim() === prop) return decl.slice(colon + 1).trim()
  }
  return null
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

/** True when the compound carries every class of `cls` (`.a.b` needs both), whatever else it carries. */
function compoundHasClass(compound: string | null, cls: string): boolean {
  if (!compound) return false
  const have = new Set(compound.replace(/\[[^\]]*\]/g, '').match(/\.[\w-]+/g) ?? [])
  return (cls.match(/\.[\w-]+/g) ?? []).every(c => have.has(c))
}

/** The rules whose selector ends in a compound that carries the class. */
function rulesFor(rules: Rule[], cls: string): Rule[] {
  return rules.filter(r => selectorParts(r.selector).some(p => compoundHasClass(lastCompound(p), cls)))
}

const STALE = 'no rule uses this selector, so the list entry is stale'

/** True when `part` has `cls` followed by optional attribute selectors and then `:hover`. */
function hoversOn(part: string, cls: string): boolean {
  for (let at = part.indexOf(cls); at !== -1; at = part.indexOf(cls, at + 1)) {
    let i = at + cls.length
    while (part[i] === '[') {
      const close = part.indexOf(']', i)
      if (close === -1) break
      i = close + 1
    }
    if (part.startsWith(':hover', i)) return true
  }
  return false
}

function hasHoverRule(rules: Rule[], cls: string): boolean {
  return rules.some(r => selectorParts(r.selector).some(p => hoversOn(p, cls)))
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
    for (const r of rulesFor(rules, card)) {
      const tr = declValue(r.body, 'transition')
      const banned = borderExempt.includes(card) ? /\b(?:box-shadow|all)\b/ : /\b(?:box-shadow|border-color|all)\b/
      if (tr && banned.test(tr)) problems.push(`${r.selector}: transition animates box-shadow or border-color (${tr})`)
    }
  }
  return problems
}

function animationNames(body: string): string[] {
  return [declValue(body, 'animation'), declValue(body, 'animation-name')].filter(Boolean).join(' ').split(/[\s,]+/)
}

/**
 * Rule B: an entrance used by a card, or by an entrance element, must not animate `transform`.
 * Coverage: every element must match a rule, and every entrance user must play a known keyframe.
 */
export function entranceTransformProblems(css: string, elements: string[], entranceUsers: string[] = []): string[] {
  const { rules, keyframes } = parseCss(css)
  const problems: string[] = []
  for (const el of elements) {
    const own = rulesFor(rules, el)
    if (own.length === 0) problems.push(`${el}: ${STALE}`)
    for (const r of own) {
      for (const name of animationNames(r.body)) {
        const frames = keyframes.get(name)
        if (frames && /(?<![\w-])transform\s*:/.test(frames)) problems.push(`${r.selector}: @keyframes ${name} animates transform`)
      }
    }
  }
  for (const el of entranceUsers) {
    if (!rulesFor(rules, el).some(r => animationNames(r.body).some(n => keyframes.has(n)))) {
      problems.push(`${el}: no rule plays a known entrance keyframe, so Rule B reads nothing for it`)
    }
  }
  return [...new Set(problems)]
}

/** Rule C: a cover overlay must not carry `backdrop-filter`. Every overlay must match a rule. */
export function overlayBlurProblems(css: string, overlays: string[]): string[] {
  const { rules } = parseCss(css)
  const problems: string[] = []
  for (const o of overlays) {
    const own = rulesFor(rules, o)
    if (own.length === 0) problems.push(`${o}: ${STALE}`)
    for (const r of own) {
      if (/(?<![\w-])(?:-webkit-)?backdrop-filter\s*:/.test(r.body)) problems.push(`${r.selector}: backdrop-filter over a zooming cover`)
    }
  }
  return [...new Set(problems)]
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
    // A compound with extra classes is still the card's own rule. A longer class name is not.
    expect(shadowTransitionProblems('.ex-card.featured { transition: box-shadow 1s; }\n.ex-card:hover { top: 0; }', ['.ex-card'])).toHaveLength(1)
    expect(shadowTransitionProblems('.featured.ex-card[data-id] { transition: border-color 1s; }\n.ex-card:hover { top: 0; }', ['.ex-card'])).toHaveLength(1)
    expect(shadowTransitionProblems('.ex-card-link { transition: box-shadow 1s; }\n.ex-card:hover { top: 0; }', ['.ex-card'])).toEqual([])
    // A rule inside @media still counts, and a themed base selector is still the card's own rule.
    expect(shadowTransitionProblems('@media (min-width: 1px) { :root:where([data-theme=\'dark\']) .ex-card { transition: box-shadow 1s; } }\n.ex-card:hover { top: 0; }', ['.ex-card'])).toHaveLength(1)
  })

  it('rule B fails an entrance keyframe that animates transform, and passes translate and scale', () => {
    expect(entranceTransformProblems(BAD_ENTRANCE, ['.ex-enter'])).toEqual(['.ex-enter: @keyframes rise animates transform'])
    expect(entranceTransformProblems(GOOD_ENTRANCE, ['.ex-enter'])).toEqual([])
    // `animation-name` on a longer selector counts when its last compound is a listed element.
    expect(entranceTransformProblems('@keyframes rise { from { transform: scale(.9); } }\n.page-enter > .sf-day { animation-name: rise; }', ['.sf-day'])).toHaveLength(1)
    // A compound with extra classes still counts.
    expect(entranceTransformProblems('@keyframes rise { from { transform: scale(.9); } }\n.ex-enter.late { animation: rise 1s; }', ['.ex-enter'])).toHaveLength(1)
    // Coverage: a renamed element, or an entrance user with no known keyframe, fails instead of passing on nothing.
    expect(entranceTransformProblems(GOOD_ENTRANCE, ['.ex-renamed'])).toEqual([`.ex-renamed: ${STALE}`])
    expect(entranceTransformProblems(GOOD_ENTRANCE, ['.ex-enter'], ['.ex-renamed'])).toHaveLength(1)
    expect(entranceTransformProblems('.ex-enter { animation: missing 1s; }', ['.ex-enter'], ['.ex-enter'])).toHaveLength(1)
    expect(entranceTransformProblems(GOOD_ENTRANCE, ['.ex-enter'], ['.ex-enter'])).toEqual([])
  })

  it('rule C fails a cover overlay with backdrop-filter, and passes a solid one', () => {
    expect(overlayBlurProblems(BAD_BLUR, ['.ex-style-tag'])).toHaveLength(1)
    expect(overlayBlurProblems(GOOD_BLUR, ['.ex-style-tag'])).toEqual([])
    expect(overlayBlurProblems('.ex-card .ex-style-tag { backdrop-filter: blur(4px); }', ['.ex-style-tag'])).toHaveLength(1)
    expect(overlayBlurProblems('.ex-style-tag.is-paid { backdrop-filter: blur(4px); }', ['.ex-style-tag'])).toHaveLength(1)
    // Coverage: a renamed overlay fails instead of passing on nothing.
    expect(overlayBlurProblems(GOOD_BLUR, ['.ex-style-renamed'])).toEqual([`.ex-style-renamed: ${STALE}`])
  })
})

describe('card hover gate: the shipped CSS', () => {
  const css = readCssSource('src/styles.css') as string

  it('A: no listed card transitions box-shadow in its own base rule', () => {
    expect(shadowTransitionProblems(css, CARD_CLASSES, BORDER_EXEMPT)).toEqual([])
  })

  it('B: no entrance used by a listed card or entrance element animates transform', () => {
    expect(entranceTransformProblems(css, [...CARD_CLASSES, ...ENTRANCE_ONLY], ENTRANCE_ONLY)).toEqual([])
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
