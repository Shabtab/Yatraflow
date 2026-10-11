#!/usr/bin/env node
// Checks new prose against Simplified Technical English (ASD-STE100) rules.
//
// AGENTS.md §2 rule 13. The rule governs prose an agent writes FROM NOW ON,
// so this script checks only the lines a branch changed. The default run
// compares the working tree with the merge base of origin/test. Committed and
// uncommitted lines both count. Legacy text is never reported, which keeps the
// gate useful instead of red on day one. A list item is checked after its marker.
//
// Usage:
//   node scripts/lint-ste.mjs                 # changed lines vs origin/test
//   node scripts/lint-ste.mjs --base <ref>    # changed lines vs <ref>
//   node scripts/lint-ste.mjs --staged        # staged lines only (index vs HEAD)
//   node scripts/lint-ste.mjs --file <path>   # whole file (a new file)
//   node scripts/lint-ste.mjs --stdin         # text on stdin
//
// Without origin/test, the default run checks uncommitted lines and warns.
// Run `git fetch origin test` to restore the full check. Stage a new file
// with `git add -N` so the default run sees it.

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

// A list marker starts a list item. The text after the marker is prose.
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/

function isProse(line) {
  const raw = line.trim()
  if (!raw) return false
  if (raw.startsWith('#')) return false        // heading
  if (raw.startsWith('|')) return false        // table row
  if (/^```/.test(raw)) return false           // fence
  // The code rules judge the text after the marker. Remove the marker first.
  const t = raw.replace(LIST_MARKER, '')
  if (!t) return false
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
    .replace(LIST_MARKER, '')               // list marker
    .replace(/^>\s*/, '')                   // quote marker
    .replace(/\*+/g, '')                    // emphasis marks, which can hide a sentence end
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

// Prose lines checked in this run. The report prints the count.
let checkedLines = 0

// A list item inside a code fence is code, so the gate still skips it.
function checkIfProse(file, lineno, text, inFence = false) {
  if (inFence && LIST_MARKER.test(text)) return
  if (!isProse(text)) return
  checkedLines += 1
  checkLine(file, lineno, text)
}

// Marks each line that sits inside a code fence. Fence lines are marked too.
function fenceMask(lines) {
  const mask = []
  let open = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      open = !open
      mask.push(true)
    } else {
      mask.push(open)
    }
  }
  return mask
}

// Git runs with core.quotePath off, so file names stay unquoted for the parser.
function git(args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const TEST_BASE = 'origin/test'

function commitOf(ref) {
  try {
    return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim()
  } catch {
    return null
  }
}

// The commit the default run compares with. Null when origin/test is absent.
function defaultBase() {
  if (!commitOf(TEST_BASE)) return null
  try {
    const sha = git(['merge-base', TEST_BASE, 'HEAD']).trim()
    return sha ? { sha, label: `changed lines vs merge base with ${TEST_BASE} (${sha.slice(0, 7)})` } : null
  } catch {
    return null // no shared history with origin/test
  }
}

// Added lines of `git diff -U0`, each with its file and line number.
// The prefixes are forced, so a diff.noprefix setting cannot hide every file.
function addedLines(args) {
  const out = git(['diff', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', ...args])
  const added = []
  let file = null
  let lineno = 0
  for (const line of out.split(/\r?\n/)) {
    let m
    if (line === '+++ /dev/null') { file = null; continue }
    if ((m = /^\+\+\+ b\/(.*)$/.exec(line))) { file = m[1]; continue }
    if ((m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line))) { lineno = parseInt(m[1], 10); continue }
    if (file !== null && line.startsWith('+')) {
      added.push({ file, lineno, text: line.slice(1) })
      lineno += 1
    }
  }
  return added
}

let topLevel = null

// The new text of a file: the index for --staged, otherwise the working tree.
function newText(file, staged) {
  if (staged) return git(['show', `:${file}`])
  topLevel ??= git(['rev-parse', '--show-toplevel']).trim()
  return readFileSync(path.join(topLevel, file), 'utf8')
}

// Checks each added line, with the code fence state of its file.
function checkAdded(added, staged) {
  const masks = new Map()
  for (const a of added) {
    if (!masks.has(a.file)) masks.set(a.file, fenceMask(newText(a.file, staged).split(/\r?\n/)))
    checkIfProse(a.file, a.lineno, a.text, masks.get(a.file)[a.lineno - 1] === true)
  }
}

const argv = process.argv.slice(2)
const argValue = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)

function fail(message) {
  console.error(`STE100: ${message}`)
  process.exit(2)
}

// Prints the verdict and exits. Each problem line lists every rule it breaks.
function report(label) {
  if (!problems.length) {
    console.log(`STE100: OK. ${checkedLines} prose line(s) checked: ${label}.`)
    process.exit(0)
  }
  const byLine = new Map()
  for (const p of problems) {
    const key = `${p.file}:${p.lineno}`
    if (!byLine.has(key)) byLine.set(key, { text: p.text, kinds: [] })
    byLine.get(key).kinds.push(p.kind)
  }
  console.error(`STE100: ${problems.length} problem(s) on ${byLine.size} line(s)\n`)
  for (const [key, { text, kinds }] of byLine) {
    console.error(`  ${key}  ${kinds.join('; ')}`)
    console.error(`      ${text}`)
  }
  console.error('\nSee AGENTS.md §2 rule 13.')
  process.exit(1)
}

// The commit the diff starts from, and how the report names it.
function chooseBase() {
  if (argv.includes('--base')) {
    const ref = argValue('--base')
    if (!ref) fail('--base needs a ref.')
    const sha = commitOf(ref)
    if (!sha) fail(`--base ${ref} is not a commit.`)
    return { sha, label: `changed lines vs ${ref}` }
  }
  const base = defaultBase()
  if (base) return base
  console.error(`STE100: WARNING: ${TEST_BASE} not found. Only uncommitted lines are checked. Run: git fetch origin test`)
  return { sha: 'HEAD', label: `uncommitted lines only, because ${TEST_BASE} is absent` }
}

// Checks every line of a whole text, such as a file or stdin.
function checkWholeText(file, text) {
  const lines = text.split(/\r?\n/)
  const mask = fenceMask(lines)
  lines.forEach((line, i) => checkIfProse(file, i + 1, line, mask[i]))
}

function main() {
  if (argv.includes('--stdin')) {
    checkWholeText('<stdin>', readFileSync(0, 'utf8'))
    return report('stdin')
  }
  if (argv.includes('--file')) {
    const f = argValue('--file')
    if (!f) fail('--file needs a path.')
    const abs = path.resolve(f)
    checkWholeText(abs, readFileSync(abs, 'utf8'))
    return report(`file ${f}`)
  }
  if (argv.includes('--staged')) {
    checkAdded(addedLines(['--cached']), true)
    return report('staged lines')
  }
  const base = chooseBase()
  checkAdded(addedLines([base.sha]), false)
  return report(base.label)
}

try {
  main()
} catch (err) {
  fail(`cannot read the input: ${String(err.message).split('\n')[0]}`)
}
