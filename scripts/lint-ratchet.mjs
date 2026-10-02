#!/usr/bin/env node
// The ESLint ratchet (AGENTS.md §2 rule 14).
//
// `npm run lint` is the repo's real check, but it reports 148 errors today,
// so wiring it into `verify` would block every push until they are all fixed.
// This script makes the count a CEILING instead of a gate: lint runs, its
// output is compared to a committed baseline, and the build fails only when
// the numbers got WORSE. Fixing errors lowers the ceiling in the same commit,
// so the debt can only shrink.
//
// Usage:
//   npm run lint:ratchet          check (fails if the count rose)
//   npm run lint:ratchet -- --update   rewrite the baseline to current counts
//
// The baseline is per-rule AND per-file, so a new file with one error is still
// caught even when the total falls elsewhere.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(ROOT, 'eslint-baseline.json')

const update = process.argv.includes('--update')

// eslint exits 1 when it finds problems, and its JSON report is on stdout.
// `execFileSync` throws on that exit and (on Windows) hands back an empty
// stdout, so spawnSync is the reliable way to get the report either way.
// Resolve eslint's bin directly: going through `npx` with `shell: true` makes
// Node warn about unescaped args.
const run = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'), 'src', '-f', 'json'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})

const raw = run.stdout ?? ''
if (!raw.trim()) {
  console.error('eslint produced no report.')
  if (run.stderr) console.error(run.stderr.trim())
  process.exit(2)
}

let report
try {
  report = JSON.parse(raw)
} catch {
  console.error('eslint report was not JSON. First 400 characters:')
  console.error(raw.slice(0, 400))
  process.exit(2)
}

/** { "<relative path>": { "<ruleId>": count } } */
function tally() {
  const out = {}
  for (const file of report) {
    if (!file.errorCount && !file.warningCount) continue
    const rel = path.relative(ROOT, file.filePath).replace(/\\/g, '/')
    const rules = {}
    for (const m of file.messages) {
      const id = m.ruleId ?? '(parse)'
      rules[id] = (rules[id] ?? 0) + 1
    }
    if (Object.keys(rules).length) out[rel] = rules
  }
  return out
}

function totals(counts) {
  let errors = 0
  let warnings = 0
  for (const m of report) {
    errors += m.errorCount
    warnings += m.warningCount
  }
  return { errors, warnings, files: Object.keys(counts).length }
}

const current = tally()
const t = totals(current)

if (update) {
  writeFileSync(
    BASELINE,
    JSON.stringify({ generatedBy: 'npm run lint:ratchet -- --update', errors: t.errors, warnings: t.warnings, files: current }, null, 2) + '\n',
    'utf8',
  )
  console.log(`baseline updated: ${t.errors} errors, ${t.warnings} warnings, ${t.files} files`)
  process.exit(0)
}

let base
try {
  base = JSON.parse(readFileSync(BASELINE, 'utf8'))
} catch {
  console.error('No eslint-baseline.json. Create one with:')
  console.error('  npm run lint:ratchet -- --update')
  process.exit(2)
}

// Compare per rule, per file. A rule that grew in any file is a regression.
const regressions = []
for (const [file, rules] of Object.entries(current)) {
  const was = base.files?.[file] ?? {}
  for (const [rule, n] of Object.entries(rules)) {
    const before = was[rule] ?? 0
    if (n > before) regressions.push({ file, rule, before, now: n })
  }
}

const dErrors = t.errors - (base.errors ?? 0)
const dWarnings = t.warnings - (base.warnings ?? 0)

console.log(`eslint: ${t.errors} errors, ${t.warnings} warnings, ${t.files} files`)
console.log(`baseline: ${base.errors} errors, ${base.warnings} warnings`)

if (regressions.length) {
  console.error(`\n${regressions.length} regression(s):\n`)
  for (const r of regressions) {
    console.error(`  ${r.file}  ${r.rule}  ${r.before} -> ${r.now}`)
  }
  console.error('\nFix these, or add an eslint-disable with a reason.')
  console.error('Do not raise the baseline to make a gate green.')
  process.exit(1)
}

if (dErrors < 0 || dWarnings < 0) {
  console.log(`\nratchet: ${-dErrors} errors and ${-dWarnings} warnings fixed.`)
  console.log('Run: npm run lint:ratchet -- --update')
}
