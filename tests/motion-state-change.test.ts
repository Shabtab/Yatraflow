// State-change motion guards (AGENTS §2.10).
//
// The other motion gates cover a page that APPEARS: tests/design-system.test.ts
// checks that a page root carries an entrance, and scripts/browser-motion-check.mjs
// samples route-root children on load. Neither looks at what happens when a
// control CHANGES state. The My trips Grid | List switch shipped with a colour
// swap on the pressed button and cards that snapped into the new layout, and
// every gate stayed green.
//
// These checks are static (no DOM, no browser). They read the shipped source and
// CSS as text. The matching real-browser step is in scripts/browser-motion-check.mjs.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

const srcRoot = new URL('../src/', import.meta.url)
const tsxFiles = readdirSync(srcRoot, { recursive: true })
  .map((f) => String(f).split('\\').join('/'))
  .filter((f) => f.endsWith('.tsx'))

const parse = (rel: string) =>
  ts.createSourceFile(rel, readFileSync(new URL('../src/' + rel, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

const attrOf = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): ts.JsxAttribute | undefined =>
  el.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.text === name)

const stringValueOf = (attr: ts.JsxAttribute | undefined): string | null => {
  const init = attr?.initializer
  if (!init) return null
  if (ts.isStringLiteral(init)) return init.text
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) return init.expression.text
  return null
}

const reducedMotionBlocks = (): string[] => {
  const lines = css.split(/\r?\n/)
  const blocks: string[] = []
  let start = -1
  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (start === -1 && line.includes('prefers-reduced-motion: reduce') && line.includes('{')) {
      start = i
      depth = (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
      continue
    }
    if (start !== -1) {
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
      if (depth <= 0) { blocks.push(lines.slice(start, i + 1).join('\n')); start = -1 }
    }
  }
  return blocks
}

/** A segmented control: a `role="group"` with a class, holding two or more
 *  buttons whose `aria-pressed` is a comparison (`value === 'x'`). One button is
 *  pressed at a time, so the pressed state MOVES from one to the other. A group
 *  of independent chips (`aria-pressed={pressed}`) is not one: nothing travels.
 *  A <PillNav> is skipped: it carries the shared `.pill-glider`. */
function segmentedGroups(): { file: string; cls: string }[] {
  const found: { file: string; cls: string }[] = []
  for (const rel of tsxFiles) {
    const sf = parse(rel)
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node)) {
        const open = node.openingElement
        const role = stringValueOf(attrOf(open, 'role'))
        const cls = stringValueOf(attrOf(open, 'className'))
        // Only plain elements: <PillNav role="group"> brings the shared .pill-glider with it.
        const isPlainElement = /^[a-z]/.test(open.tagName.getText())
        if (isPlainElement && role === 'group' && cls) {
          let comparedButtons = 0
          const countButtons = (n: ts.Node) => {
            const el = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null
            if (el && el.tagName.getText() === 'button') {
              const pressed = attrOf(el, 'aria-pressed')
              const expr = pressed?.initializer && ts.isJsxExpression(pressed.initializer) ? pressed.initializer.expression : undefined
              if (expr && ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) comparedButtons++
            }
            ts.forEachChild(n, countButtons)
          }
          node.children.forEach(countButtons)
          if (comparedButtons >= 2) for (const token of cls.split(/\s+/).filter(Boolean)) found.push({ file: 'src/' + rel, cls: token })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return found
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Segmented controls found outside the Explore and My trips pages that still
 *  have no glider. This is a ratchet: it may only shrink. When one gets a glider,
 *  the guard below fails until the entry is removed, so the list cannot go stale. */
const KNOWN_WITHOUT_GLIDER: Record<string, string> = {
  'map-day-filter': 'Trip map day filter (src/components/TripMap.tsx): not on Explore or My trips',
}

describe('a control that changes state carries motion (AGENTS §2.10)', () => {
  const allGroups = segmentedGroups()
  const groups = allGroups.filter((g) => !(g.cls in KNOWN_WITHOUT_GLIDER))

  it('keeps the known-gap list honest', () => {
    for (const cls of Object.keys(KNOWN_WITHOUT_GLIDER)) {
      expect(allGroups.map((g) => g.cls), `.${cls} is no longer a segmented control: remove it from KNOWN_WITHOUT_GLIDER`).toContain(cls)
      const hasGlider = new RegExp(`${escapeRe('.' + cls)}[^{,]*::(?:before|after)\s*\{`).test(css)
      expect(hasGlider, `.${cls} now has a glider rule: remove it from KNOWN_WITHOUT_GLIDER so the full guard applies`).toBe(false)
    }
  })

  it('finds the segmented controls it is meant to guard', () => {
    // A discovery that finds nothing would let every check below pass on an empty
    // set. The My trips Grid | List switch is the known member.
    expect(groups.map((g) => g.cls)).toContain('mt-seg')
  })

  for (const { file, cls } of groups) {
    const base = escapeRe(`.${cls}`)

    it(`${cls} (${file}) slides a glider with motion tokens`, () => {
      // A rule on the group's ::before or ::after (the glider) that moves it with
      // a duration token and an easing token, never a raw ms value.
      const gliderRule = new RegExp(`${base}(?:\\[[^\\]]*\\])?::(?:before|after)\\s*\\{([^}]*)\\}`, 'g')
      const transitions = [...css.matchAll(gliderRule)].map((m) => m[1]).filter((body) => /transition\s*:/.test(body))
      expect(transitions.length, `.${cls} has no glider rule with a transition`).toBeGreaterThan(0)
      for (const body of transitions) {
        const transition = body.match(/transition\s*:([^;]*);/)?.[1] ?? ''
        expect(transition, `.${cls} glider transition`).toMatch(/var\(--motion-(fast|med|slow)\)/)
        expect(transition, `.${cls} glider transition`).toMatch(/var\(--ease-/)
        expect(transition, `.${cls} glider transition must not use a raw duration`).not.toMatch(/\d+m?s\b/)
      }
      // The glider must have somewhere to go: a rule that moves it for the other
      // choice (a data attribute on the group).
      const movesGlider = new RegExp(`${base}\\[[^\\]]+\\]::(?:before|after)\\s*\\{[^}]*(left|transform)\\s*:`)
      expect(css, `.${cls} glider never moves`).toMatch(movesGlider)
    })

    it(`${cls} (${file}) turns the glider off under prefers-reduced-motion`, () => {
      const optedOut = reducedMotionBlocks().some((block) =>
        new RegExp(`${base}::(?:before|after)[^{]*\\{[^}]*transition\\s*:\\s*none`).test(block))
      expect(optedOut, `.${cls}::before has no transition: none in a reduced-motion block`).toBe(true)
    })
  }
})

describe('My trips replays the card entrance when the layout changes', () => {
  it('keys the card grid by its layout, so a Grid | List switch remounts the cards', () => {
    const sf = parse('pages/TripsList.tsx')
    let keyed = false
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const cls = attrOf(node, 'className')?.initializer?.getText() ?? ''
        const key = attrOf(node, 'key')
        const keyExpr = key?.initializer && ts.isJsxExpression(key.initializer) ? key.initializer.expression?.getText() : ''
        if (/\bmt-grid\b/.test(cls) && keyExpr === 'layout') keyed = true
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    expect(keyed, 'the `mt-grid` element needs key={layout}: without it the cards snap into the new layout').toBe(true)
  })

  it('gives every card an entrance that the remount can replay', () => {
    expect(css).toMatch(/\.mt-card\s*\{[^}]*animation:\s*cardIn var\(--motion-slow\) var\(--ease-out\)/)
  })

  it('keeps the entrance off under prefers-reduced-motion', () => {
    const offUnderReduce = reducedMotionBlocks().some((block) => /\.mt-card[^{]*\{[^}]*animation\s*:\s*none/.test(block))
    expect(offUnderReduce).toBe(true)
  })
})

describe('the Clear filters button appears with motion', () => {
  it('fades in with a token duration and opts out under prefers-reduced-motion', () => {
    expect(css).toMatch(/\.ex-page \.ex-clear,\s*\.trips-page \.ex-clear\[style\*='visible'\]\s*\{\s*animation:\s*ex-clear-in var\(--motion-med\) var\(--ease-out\)/)
    expect(css).toMatch(/@keyframes ex-clear-in\s*\{/)
    const optedOut = reducedMotionBlocks().some((block) => /\.ex-clear[^{]*\{[^}]*animation\s*:\s*none/.test(block))
    expect(optedOut).toBe(true)
  })
})

describe('a list item that leaves plays an exit (AGENTS §2.10)', () => {
  const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  it('plays the exit on motion tokens, never a raw duration', () => {
    expect(css).toMatch(/@keyframes presence-out\s*\{[\s\S]*?to\s*\{[^}]*opacity:\s*0/)
    const rule = css.match(/\[data-presence='exit'\]\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule, 'no [data-presence="exit"] rule').not.toBe('')
    expect(rule).toMatch(/animation:\s*presence-out var\(--motion-med\) var\(--ease-out\)/)
    expect(rule, 'a leaving item must not take clicks').toMatch(/pointer-events:\s*none/)
    expect(rule).not.toMatch(/\d+m?s\b/)
    const clearRule = css.match(/\.ex-clear\[data-presence='exit'\]\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(clearRule).toMatch(/animation:\s*ex-clear-out var\(--motion-med\) var\(--ease-out\)/)
  })

  it('fades the My trips Clear filters button out on the same tokens', () => {
    const rule = css.match(/\.trips-page \.ex-clear\[style\*='hidden'\]\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule, 'no hidden-state rule for the My trips Clear filters button').not.toBe('')
    expect(rule).toMatch(/opacity var\(--motion-med\) var\(--ease-out\)/)
    expect(rule, 'the button must turn hidden only when the fade ends').toMatch(/visibility 0s linear var\(--motion-med\)/)
  })

  it('opts out under prefers-reduced-motion', () => {
    const blocks = reducedMotionBlocks()
    expect(blocks.some(block => /\[data-presence='exit'\][^{]*\{[^}]*animation\s*:\s*none/.test(block))).toBe(true)
    expect(blocks.some(block => /\.trips-page \.ex-clear\[style\*='hidden'\][^{]*\{[^}]*transition\s*:\s*none/.test(block))).toBe(true)
  })

  it('skips the exit for reduced motion and a hidden tab, and times it on the token', () => {
    const hook = read('src/lib/usePresenceList.ts')
    expect(hook).toMatch(/!prefersReducedMotion\(\)\s*&&\s*document\.visibilityState === 'visible'/)
    expect(hook).toContain("motionTiming('--motion-med')")
    expect(hook).toMatch(/toggleAttribute\('inert'/)
    expect(hook, 'focus must leave the item before it goes inert').toMatch(/target\.focus\(/)
    expect(hook).not.toMatch(/setTimeout\([^)]*,\s*\d+\s*\)/)
  })

  // Every list that drops items wears the hook. A new list that drops items
  // without it would vanish its items between two frames again.
  const wired: { file: string; uses: RegExp }[] = [
    { file: 'src/pages/TripsList.tsx', uses: /usePresenceList\(\s*otherTrips,/ },
    { file: 'src/pages/TripsList.tsx', uses: /usePresenceList\(trashed,/ },
    { file: 'src/pages/Explore.tsx', uses: /usePresenceList\(\s*gridPubs\.slice\(0, visibleCount\),/ },
    { file: 'src/components/trips/SavedShelfSection.tsx', uses: /usePresenceList\(shelfRows,/ },
    { file: 'src/components/explore/ExploreFilterBar.tsx', uses: /usePresenceList\(\s*filtersActive/ },
  ]
  for (const { file, uses } of wired) {
    it(`${file} keeps a leaving item mounted: ${uses.source.slice(0, 40)}`, () => {
      const source = read(file)
      expect(source).toMatch(uses)
      expect(source, 'the list must mark each item with presenceAttrs').toContain('presenceAttrs(')
      expect(source, 'the list must attach the hook to its container').toMatch(/ref=\{attach\w+\}/)
    })
  }

  it('lets both card components wear the presence attributes', () => {
    expect(read('src/components/trips/TripCard.tsx')).toMatch(/\{\.\.\.presence\}/)
    expect(read('src/components/explore/ExploreCard.tsx')).toMatch(/\{\.\.\.presence\}/)
  })
})
