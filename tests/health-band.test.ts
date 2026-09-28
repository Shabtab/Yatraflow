// ============ One band → colour mapping (#369) ============
// The Board coloured trip health from raw SCORE cuts (`>=70 ok | >=40 mid`)
// while printing the engine's BAND name — so between 40 and 54 it stated
// “Unrealistic” in reassuring mid-blue. The mapping is keyed on the band the
// engine produced, and both the Board and the Overview read this one copy.
//
// #400: the mapping was then only HALF converged — `healthBandTone` (the chip)
// was four-way while `healthBandClass` (the number and the bar) collapsed
// Comfortable and Manageable into one 'ok'. So a 70–84 trip printed the word
// "Manageable" in Comfortable-green: the middle band had no identity at all
// where the numbers live. Both surfaces now read one FOUR-way class mapping,
// so the word, the number and the bar cannot disagree.
import { describe, expect, it } from 'vitest'
import { healthBandClass, healthBandTone } from '../src/lib/healthBand'
import { scoreWarnings } from '../src/lib/engine'

describe('band → class', () => {
  it('maps every band the engine can state, and NO band is folded into another', () => {
    // #400: the pin that encoded the defect was `Manageable → 'ok'`, the same
    // class Comfortable wears. It now has its own class, so the middle band is
    // visible in the number and the bar exactly as it already was in the chip.
    expect(healthBandClass('Comfortable')).toBe('ok')
    expect(healthBandClass('Manageable')).toBe('teal')
    expect(healthBandClass('Tight')).toBe('saffron')
    expect(healthBandClass('Unrealistic')).toBe('danger')
  })

  it('the chip tone and the number/bar class agree band for band (#400)', () => {
    // The whole defect was two mappings over one band list. Whatever the chip
    // says, the number and the bar must say the same thing.
    for (const band of ['Comfortable', 'Manageable', 'Tight', 'Unrealistic'] as const) {
      expect(healthBandClass(band)).toBe(healthBandTone(band))
    }
  })

  it('a 45-score Unrealistic trip wears the BAD colour (the exact broken case)', () => {
    const warnings = Array.from({ length: 5 }, (_, i) => ({
      code: `high-${i}`, severity: 'high' as const, title: 't', detail: 'd', fix: 'f',
    }))
    const health = scoreWarnings(warnings) // 100 − 5 × 11
    expect(health.score).toBe(45)
    expect(health.band).toBe('Unrealistic')
    // …'danger', not 'mid': the old `>= 40` cut painted it re-assuring. The
    // class was renamed 'bad' → 'danger' when the mapping went four-way (the
    // same coral, under the palette's own name) — what the assertion protects is
    // the MEANING, "not the reassuring mid", which the chip tone also pins.
    expect(healthBandClass(health.band)).toBe('danger')
    expect(healthBandClass(health.band)).not.toBe(healthBandClass('Tight'))
  })

  it('a 70–84 trip reads Manageable in its OWN colour, not Comfortable-green (#400)', () => {
    // The exact case the issue names, from the engine rather than a literal.
    const score = (sev: 'high' | 'medium' | 'low', n: number) =>
      scoreWarnings(Array.from({ length: n }, (_, i) => ({
        code: `${sev}-${i}`, severity: sev, title: 't', detail: 'd', fix: 'f',
      })))
    const manageable = score('medium', 2) // 100 − 2 × 7 = 86 → next band down
    const at = (band: typeof manageable.band) => manageable.band === band
    // Whichever band the engine states in the 70–84 window, it must not be
    // wearing Comfortable's class.
    for (const health of [manageable, score('low', 2), score('medium', 1)]) {
      if (health.score >= 70 && health.score <= 84) {
        expect(at(health.band)).toBe(true)
        expect(healthBandClass(health.band)).not.toBe(healthBandClass('Comfortable'))
      }
    }
  })

  it('follows the band at each engine boundary, not a fresh cut', () => {
    for (const [band, cls] of [
      ['Comfortable', 'ok'], ['Manageable', 'teal'], ['Tight', 'saffron'], ['Unrealistic', 'danger'],
    ] as const) {
      expect(healthBandClass(band)).toBe(cls)
    }
  })
})

describe('band → chip tone', () => {
  it('keeps the palette the Overview already used for the band word', () => {
    expect(healthBandTone('Comfortable')).toBe('ok')
    expect(healthBandTone('Manageable')).toBe('teal')
    expect(healthBandTone('Tight')).toBe('saffron')
    expect(healthBandTone('Unrealistic')).toBe('danger')
  })
})

// ============ #400 — the serialized-surface proof (styles.css) ============
// styles.css is a SERIALIZED surface (AGENTS §1) and the design-system ratchet
// baseline is line-keyed, so any edit here moves line numbers. The rule is to
// re-baseline and then prove the finding NAMES are identical before/after. This
// suite is that proof, plus the thing a line-keyed baseline cannot see: that
// every band the mapper can EMIT has a real colour rule, and that the two
// class names it stopped emitting are gone rather than merely unreachable.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/styles.css', 'utf8')
const BAND_CLASSES = ['ok', 'teal', 'saffron', 'danger'] as const

/** Selector names of every health/pulse rule in a stylesheet, sorted. */
function healthSelectors(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/^\s*(\.[^{\n@]+\{[^}]*\})/gm)) {
    const sel = m[1].slice(0, m[1].indexOf('{')).trim()
    if (/health|pulse/.test(sel)) out.push(sel)
  }
  return out.sort()
}

describe('#400 — every band the mapper emits has a colour rule', () => {
  it('the number, the bar and the Board band label are painted for all four', () => {
    for (const cls of BAND_CLASSES) {
      expect(css).toMatch(new RegExp(`\\.health-num-big\\.${cls}\\s*\\{`))
      expect(css).toMatch(new RegExp(`\\.health-bar > i\\.${cls}\\s*\\{`))
      expect(css).toMatch(new RegExp(`\\.board-pulse-band\\.${cls}\\s*\\{`))
    }
  })

  it('all three families use the SAME four names, so none can drift', () => {
    // Deduplicated: the pulse's coral has a light-theme override that re-declares
    // `danger` under `:root:not([data-theme='dark'])`, which is the same class
    // wearing a deeper ink — not a fifth band.
    const classes = (prefix: string) =>
      [...new Set([...css.matchAll(new RegExp(`\\.${prefix}\\.(\\w+)\\s*\\{`, 'g'))].map(m => m[1]))].sort()
    const expected = [...BAND_CLASSES].sort()
    expect(classes('health-num-big')).toEqual(expected)
    expect(classes('board-pulse-band')).toEqual(expected)
    expect(classes('health-bar > i')).toEqual(expected)
  })

  it('the two pre-#400 class names are gone, not merely unused', () => {
    // `healthBandClass` stopped emitting 'mid'/'bad'. A leftover rule is a rule
    // nothing can reach, and leaves two live-looking vocabularies in the file.
    for (const dead of ['mid', 'bad']) {
      expect(css).not.toMatch(new RegExp(`\\.health-num-big\\.${dead}\\s*\\{`))
      expect(css).not.toMatch(new RegExp(`\\.health-bar > i\\.${dead}\\s*\\{`))
      expect(css).not.toMatch(new RegExp(`\\.board-pulse-band\\.${dead}\\s*\\{`))
    }
  })

  it('the teal number uses the ink family, not the raw brand teal (AA at 54px)', () => {
    const rule = css.match(/\.health-num-big\.teal\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('var(--ink-teal)')
    expect(rule).not.toMatch(/var\(--teal\)/)
  })

  it('selector-set proof: the band vocabulary is the ONLY thing that changed', () => {
    // The re-baseline proof. "Before" is re-derived from git rather than copied,
    // so this cannot rot into a list that describes an old tree. Skips when there
    // is no git context (a shallow export): the rules above still hold.
    let before: string[]
    try {
      before = healthSelectors(execSync('git show origin/test:src/styles.css', { encoding: 'utf8' }))
    } catch {
      return
    }
    const after = healthSelectors(css)
    const added = after.filter(s => !before.includes(s))
    const removed = before.filter(s => !after.includes(s))
    const isNew = (s: string) => /\.(teal|saffron|danger)$/.test(s)
    const isOld = (s: string) => /\.(mid|bad)$/.test(s)
    // 3 families × 2 old names out; 3 families × 3 new names in.
    expect(removed.filter(isOld)).toHaveLength(6)
    expect(added.filter(isNew)).toHaveLength(9)
    // Nothing outside the band vocabulary moved — this is the assertion that
    // would catch an unreviewed rule riding along in a "small" CSS edit.
    expect(added.filter(s => !isNew(s))).toEqual([])
    expect(removed.filter(s => !isOld(s))).toEqual([])
  })
})
