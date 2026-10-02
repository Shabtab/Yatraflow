#!/usr/bin/env node
// ============================================================================
// YatraFlow UI anti-pattern gate — the mechanical subset of the design rules.
// Usage:   npm run check:ui
//          npm run check:ui -- --json
//
// What this is:
//   Three checks over `src/styles.css` and `index.html`, each of which is
//   mechanically decidable with NO false positives against this repo today.
//   They exist because a UI review re-derives "does `transition: all` exist
//   here?" every single time, and because a rule nobody can run is a rule
//   that quietly stops being true.
//
// Why only three:
//   The design guidelines carry ~20 more rules. Most of them are NOT
//   enforceable as greps against YatraFlow, and a gate that fires on correct
//   code is worse than no gate — it teaches the team to ignore it. Every
//   exclusion below is here because it was MEASURED, not assumed; the counts
//   are from this repo at the time the gate landed (2026-10-02).
//
//   EXCLUDED — `scale()` inside `:hover` (9 sites, styles.css)
//     All deliberate and non-reflowing: `.ai-fab` is position:fixed,
//     `.yf-map-pin` / `.yf-map-tear` / `.yf-map-idea-add` are absolutely
//     positioned map markers, `.save-heart` is an icon button, and
//     `.yf-range` scales the slider thumb. The guideline's actual concern is
//     LAYOUT SHIFT, which none of these cause — but a regex cannot tell a
//     reflowing card-hover from a lifting map pin, so the rule stays prose.
//
//   EXCLUDED — emoji used as UI icons (403 codepoints across 78 files)
//     `src/lib/weather.ts` is a legitimate WMO weather-code -> glyph map with
//     a text label beside every glyph; `coverEmoji` is user-chosen trip
//     content; the rest are comments and the ROADMAP. A gate here is pure
//     noise. Real icon-set enforcement is a review task, not a regex.
//
//   EXCLUDED — line-height 1.5-1.75
//     16 rules use `line-height: 1`, but every one is a single-line numeric or
//     stat tile (`.stat-tile`, `.odo`, `.daybar-avg`, `.save-heart`). Headings
//     sit at 1.08-1.22 by design, where tight leading is correct. Normalizing
//     these would be ~25 false findings and worse typography.
//
//   EXCLUDED — 44x44 touch targets
//     The repo floors at 40px on purpose (WCAG 2.5.8 AA), reached on coarse
//     pointers through a `::after { inset: -6px }` hit-area extension. 44px is
//     2.5.5 AAA. Changing this is a product decision, not a lint.
//
//   EXCLUDED — contrast ratios
//     Already owned by `tests/design-system.test.ts`'s baseline ratchet, which
//     parses declaration pairs. Do NOT add a second, weaker contrast check
//     here: it would disagree with the ratchet and neither would be trusted.
//
// Exit codes: 0 clean · 1 at least one enforced rule fired · 2 bad usage
// ============================================================================

import { readFileSync } from 'node:fs'

export const RULES = [
  {
    id: 'U1',
    title: 'transition: all',
    why: 'animates every property, including layout-affecting ones, so an unrelated change animates by surprise. Name the properties.',
    file: 'src/styles.css',
    find: s => [...s.matchAll(/transition\s*:\s*all/g)],
  },
  {
    id: 'U2',
    title: 'raw z-index >= 999',
    why: 'bypasses the documented --z-* ladder (styles.css:84), so stacking stops being reason-able. Use the rung.',
    file: 'src/styles.css',
    find: s => [...s.matchAll(/z-index\s*:\s*(\d+)/g)].filter(m => Number(m[1]) >= 999),
  },
  {
    id: 'U3',
    title: 'blocked pinch-zoom',
    why: 'user-scalable=no / maximum-scale in the viewport meta stops a user from zooming. WCAG 1.4.4.',
    file: 'index.html',
    find: s => [...s.matchAll(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/g)],
  },
]

/** Line-number helper: report where a match landed, not just that it did. */
function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

/**
 * Run every rule over a { filename: source } map.
 * Returns findings sorted by file then line. Pure — no fs, no process.
 */
export function check(files) {
  const findings = []
  for (const rule of RULES) {
    const source = files[rule.file]
    if (source == null) continue
    for (const m of rule.find(source)) {
      const line = lineOf(source, m.index)
      // One finding per rule per line: U3 matches `user-scalable=no` and
      // `maximum-scale=1` independently, and a viewport line carrying both is
      // one defect to fix, not two.
      if (findings.some(f => f.rule === rule.id && f.file === rule.file && f.line === line)) continue
      findings.push({
        rule: rule.id,
        title: rule.title,
        file: rule.file,
        line,
        text: (source.split('\n')[line - 1] || '').trim().slice(0, 100),
        why: rule.why,
      })
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

function main() {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  if (args.some(a => !a.startsWith('--'))) {
    console.error('usage: check-ui [--json]')
    process.exit(2)
  }

  let files
  try {
    files = {
      'src/styles.css': readFileSync('src/styles.css', 'utf8'),
      'index.html': readFileSync('index.html', 'utf8'),
    }
  } catch {
    console.error('check:ui must run from the repo root (src/styles.css or index.html not found)')
    process.exit(2)
  }

  const findings = check(files)

  if (json) {
    console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2))
    process.exit(findings.length === 0 ? 0 : 1)
  }

  if (findings.length === 0) {
    console.log(`ui anti-patterns: ${RULES.length} rules, 0 findings`)
    process.exit(0)
  }

  console.error(`ui anti-patterns: ${findings.length} finding(s)\n`)
  for (const f of findings) {
    console.error(`  ${f.rule}  ${f.file}:${f.line}  ${f.title}`)
    console.error(`      ${f.text}`)
    console.error(`      ${f.why}\n`)
  }
  process.exit(1)
}

// Only self-execute when run directly, so tests can import `check`.
if (process.argv[1] && process.argv[1].endsWith('uiAntipatterns.mjs')) main()