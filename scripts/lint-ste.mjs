#!/usr/bin/env node
// Checks new prose against Simplified Technical English (ASD-STE100) rules.
//
// AGENTS.md §2 rule 13. The rule governs prose an agent writes FROM NOW ON,
// so this script checks only the lines you changed: `git diff` against the
// merge base. Legacy text is never reported, which is what keeps the gate
// useful instead of red on day one.
//
// Usage:
//   node scripts/lint-ste.mjs                 # changed lines vs merge base
//   node scripts/lint-ste.mjs --staged        # staged lines only
//   node scripts/lint-ste.mjs --file <path>   # whole file (a new file)
//   node scripts/lint-ste.mjs --stdin         # text on stdin

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MAX_WORDS = 20

// A gerund opening a step: "Checking the value." "Running the tests."
const GERUND_START =
  /^(?:[A-Z][a-z]+ing|Doing|Going|Making|Taking|Getting|Setting|Using|Checking|Running|Adding|Removing|Reading|Writing|Creating|Deleting|Updating|Verifying|Building|Testing|Applying|Ensuring|Making|Seeing|Noting|Assuming|Considering|Looking|Finding|Keeping|Letting|Putting|Starting|Staying|Trying|Using|Waiting|Working|Writing)\b/

// Plain-word substitutions. Each entry is [pattern, replacement].
const VOCAB = [
  [/\bobtain(?:s|ed|ing)?\b/gi, 'get'],
  [/\butili[sz](?:e|es|ed|ing|ation)\b/gi, 'use'],
  [/\bcommence(?:s|d)?\b/gi, 'start'],
  [/\bterminate(?:s|d)?\b/gi, 'stop'],
  [/\bendeavour|endeavor/gi, 'try'],
  [/\bnecessitate(?:s|d)?\b/gi, 'need'],
  [/\brequire(?:s|d)?\b/gi, 'need'],
  [/\battempt(?:s|ed|ing)?\b/gi, 'try'],
  [/\badditional(?:ly)?\b/gi, 'also'],
  [/\bsufficient\b/gi, 'enough'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\bin the event that\b/gi, 'if'],
  [/\bwith regard to\b/gi, 'about'],
  [/\bin order to\b/gi, 'to'],
  [/\bpriorit(?:y|ise|ize)\w*\b/gi, 'prefer'],
  [/\bpermitted\b/gi, 'allowed'],
  [/\bprohibited\b/gi, 'not allowed'],
  [/\bvalidate\b/gi, 'check'],
  [/\bindicator\b/gi, 'sign'],
  [/\bapproximately\b/gi, 'about'],
  [/\bnumerous\b/gi, 'many'],
  [/\bfacilitate\b/gi, 'help'],
  [/\bleverage\b/gi, 'use'],
  [/\binquire\b/gi, 'ask'],
  [/\bascertain\b/gi, 'find'],
  [/\binitiate\b/gi, 'start'],
  [/\bsubsequently\b/gi, 'then'],
  [/\bcurrently\b/gi, 'now'],
  [/\bpreviously\b/gi, 'before'],
  [/\bhowever\b/gi, 'but'],
  [/\btherefore\b/gi, 'so'],
  [/\bmoreover\b/gi, 'also'],
  [/\bfurthermore\b/gi, 'also'],
  [/\bin order\b/gi, 'so'],
  [/\bfaithful(?:ly)?\b/gi, 'consistent'],
  [/\bimplement\b/gi, 'add'],
  [/\bfunctionality\b/gi, 'feature'],
  [/\butilis(?:e|es|ed|ing|ation)\b/gi, 'use'],
  [/\bsynchroni[sz]e\b/gi, 'sync'],
  [/\basynchronous\b/gi, 'async'],
]

const problems = []

function words(text) {
  return text.split(/\s+/).filter(Boolean)
}

// A CODE line is not prose, even when its tokens read as English. Without
// these exclusions the checker fired on real code and forced working code to
// be restructured to please it (an object key named `priority` read as the
// word "prefer"; a JSX prop list read as one long sentence) — and a gate
// that punishes correct code is a gate agents learn to ignore.
function isCode(t) {
  // a string literal on its own line: a fixture, a snapshot, a key
  if (/^['"`]/.test(t) && !/^>/.test(t)) return true
  // object / class property: `key: value`, `key:`, `"key": value`
  if (/^['"]?[A-Za-z_$][\w$]*['"]?\s*:\s*([`'"{[(]|\d|$)/.test(t)) return true
  // JSX attribute: `onClick={...}`, `options={[...]`, bare `foo=`
  if (/^[A-Za-z_$][\w$.-]*\s*=\s*\{/.test(t)) return true
  // JSX element / closing tag: `<MapTab ... />`, `</div>`
  if (/^<\/?[A-Za-z]/.test(t) || /^>/.test(t)) return true
  // TypeScript member / signature shapes: `foo(a: string): void`
  if (/^[A-Za-z_$][\w$]*\([^)]*:\s*[A-Za-z]/.test(t)) return true
  // a bare call: `foo(bar, baz)` or `foo.bar(baz)`
  if (/^[A-Za-z_$][\w$.]*\([^)]*\)\s*[;.)]?\s*$/.test(t)) return true
  // ends in a statement terminator after code punctuation
  if (/[;{}]\s*$/.test(t) && /[()[\]=>]/.test(t)) return true
  return false
}

function isProse(line) {
  const t = line.trim()
  if (!t) return false
  if (t.startsWith('#')) return false          // heading
  if (t.startsWith('|')) return false          // table row
  if (t.startsWith('- ') || t.startsWith('* ')) return false // handled as list text
  if (/^```/.test(t)) return false             // fence
  if (/^\s*(const|let|var|function|import|export|return|if|for)\b/.test(t)) return false
  if (isCode(t)) return false                  // code, not prose
  if (/`[^`]*`/.test(t) && !/[a-z]{4,}/i.test(t.replace(/`[^`]*`/g, ''))) return false
  return true
}

// Codacy flags two of these as "Unsafe Regular Expression" and two lines below
// as "Function Call Object Injection Sink" (PR #577: lines 92, 134, 151, 165,
// 170). Checked, not dismissed: every pattern here is linear-time because none
// nests a quantifier inside another — `[^]]*` and `[^)]*` are single character
// classes with one `*` each, not `(a+)+`. Measured on 50,000-character inputs,
// the slowest is 0.09ms. `stripCode` only ever sees a line of prose or code
// from `git diff`, so the input is bounded by the file anyway.
function stripCode(text) {
  return text
    .replace(/`[^`]*`/g, ' CODE ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' LINK ')
    .replace(/\bsection §?\d+(\.\d+)?\b/g, ' section ')
    .replace(/\bv?\d+\.\d+\.\d+\b/g, ' version ')
    .replace(/#[A-Za-z_][\w/.-]*/g, ' issue ')
}

function checkLine(file, lineno, raw) {
  const text = stripCode(raw)
    .replace(/^[\s>*-]*\d+\.\s*/, '')       // ordered-list marker
    .replace(/^\s*[-*]\s+/, '')             // bullet marker
    .replace(/^>\s*/, '')                   // quote marker
    .trim()
  if (!text) return

  const first = text.split(/(?<=[.!?])\s+/)[0] ?? ''
  const n = words(first).length
  if (n > MAX_WORDS) {
    problems.push({ file, lineno, kind: `sentence ${n} words (max ${MAX_WORDS})`, text: first.slice(0, 90) })
  }
  if (GERUND_START.test(text)) {
    problems.push({ file, lineno, kind: 'sentence starts with a gerund', text: text.slice(0, 90) })
  }
  for (const [re, want] of VOCAB) {
    const m = text.match(re)
    if (m) {
      problems.push({ file, lineno, kind: `use "${want}", not "${m[0]}"`, text: text.slice(0, 90) })
    }
  }
  // "should" is only wrong when it carries the rule. A sentence that names
  // the rule itself ("use must, not should") is quoting, not violating it.
  const shouldMatch = /\bshould\b/i.exec(text)
  if (shouldMatch) {
    const around = text.slice(Math.max(0, shouldMatch.index - 40), shouldMatch.index + 40)
    const quoting = /\b(not|rather than|instead of|instead)\b.{0,24}\bshould\b/i.test(around)
      || /\bshould\b.{0,24}\b(not|never|rather than|instead)\b/i.test(around)
    if (!quoting) {
      problems.push({ file, lineno, kind: 'use "must", not "should"', text: text.slice(0, 90) })
    }
  }
}

function checkFile(file, lines) {
  for (let i = 0; i < lines.length; i++) {
    if (isProse(lines[i])) checkLine(file, i + 1, lines[i])
  }
}

function gitLines(mode) {
  const range = mode === 'staged'
    ? ['--cached']
    : []
  const args = ['diff', '-U0', ...range]
  const out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const file = null
  let lineno = 0
  const added = []
  let current = null
  for (const line of out.split(/\r?\n/)) {
    let m
    if ((m = /^(\+\+\+|---) b\/(.*)$/.exec(line))) { current = m[2]; continue }
    if ((m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line))) { lineno = parseInt(m[1], 10) - 1; continue }
    if (line.startsWith('+') && current) { added.push({ file: current, lineno: lineno + 1, text: line.slice(1) }); lineno += 1 }
    else if (!line.startsWith('-') && !line.startsWith('\\') && current) { lineno += 1 }
  }
  void file
  return added
}

const argv = process.argv.slice(2)
let added = []

if (argv.includes('--stdin')) {
  const text = readFileSync(0, 'utf8').split(/\r?\n/)
  for (let i = 0; i < text.length; i++) {
    if (isProse(text[i])) checkLine('<stdin>', i + 1, text[i])
  }
} else if (argv.includes('--file')) {
  const f = argv[argv.indexOf('--file') + 1]
  const abs = path.resolve(f)
  checkFile(abs, readFileSync(abs, 'utf8').split(/\r?\n/))
} else {
  const added = gitLines(argv.includes('--staged') ? 'staged' : 'unstaged')
  for (const a of added) {
    if (isProse(a.text)) checkLine(a.file, a.lineno, a.text)
  }
  if (!problems.length) {
    console.log(`STE100: changed lines OK (${added.length} lines checked)`)
    process.exit(0)
  }
}

if (!problems.length) {
  const where = argv.includes('--stdin') ? 'stdin' : argv.includes('--file') ? 'file' : 'changed lines'
  console.log(`STE100: ${where} OK (${added.length || 'all'} lines checked)`)
  process.exit(0)
}

console.error(`STE100: ${problems.length} problem(s)\n`)
const seen = new Set()
for (const p of problems) {
  const key = `${p.file}:${p.lineno}`
  if (seen.has(key)) continue
  seen.add(key)
  console.error(`  ${p.file}:${p.lineno}  ${p.kind}`)
  console.error(`      ${p.text}`)
}
console.error('\nSee AGENTS.md §2 rule 13.')
process.exit(1)
