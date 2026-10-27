// Negative-control runner for the r13 repair. For each control it records a
// raw transcript: baseline bytes and hashes, a green focused run, the exact
// mutation, the focused run that must fail on a named assertion, and the
// restore that must return the exact baseline bytes.
//
// A non-zero exit is not a kill. Each control names the test title that must
// fail, and the run is a kill only when that title appears as a failing test.
// An infrastructure error aborts the control as UNPROVEN.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const EVIDENCE = process.env.CONTROL_OUT

const NODE = process.execPath
const VITEST = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const now = () => new Date().toISOString()
// vitest colours its output, and a colour code can sit inside a test title.
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '')
const sha256 = (file) => createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex')

function runVitest(testFile, filter) {
  const args = [VITEST, 'run', testFile]
  if (filter) args.push('-t', filter)
  const started = now()
  const r = spawnSync(NODE, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', CI: 'true' },
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    command: `${NODE} ${args.join(' ')}`,
    started,
    ended: now(),
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

// A run passes when vitest exits 0 and reports no failed test.
function passed(run) {
  const out = stripAnsi(run.stdout)
  return run.status === 0 && !/Tests\s+\d+ failed/.test(out)
}

// A kill needs the named assertion to be the thing that failed, so a broken
// environment cannot pass itself off as a caught mutant.
export function killed(run, failingTitle) {
  const out = stripAnsi(run.stdout)
  if (run.status === 0) return false
  // The per-test list marks a failure with a cross before the title. The
  // summary block repeats it, so the cross line is the reliable signal.
  return [...out.matchAll(/×\s*/g)].some((match) => out.startsWith(failingTitle, match.index + match[0].length))
}

function infraBroken(run) {
  const out = stripAnsi(run.stdout + run.stderr)
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|Test Files\s+no tests/.test(out)) return true
  // A suite that fails to collect names no failing test, so it proves nothing.
  return /Test Files\s+\d+ failed/.test(out) && !/×/.test(out)
}

const controls = []

function control(name, spec) {
  controls.push({ name, ...spec })
}

control('schema-cutover-policy-block-removed', {
  file: 'supabase/schema.sql',
  testFile: 'tests/stage-c/838-schema-fresh-bootstrap.test.ts',
  mutate: (text) => {
    // Remove the restored block: the 15 drops and the 4 narrow creates.
    const start = text.indexOf('-- Remove direct whole-row write paths')
    const end = text.indexOf('drop trigger if exists suggestions_guard_contributions')
    if (start < 0 || end < 0) throw new Error('cutover block not found')
    return text.slice(0, start) + text.slice(end)
  },
  failingTitle: 'leaves no permissive FOR ALL and no admin write',
})

control('schema-delete-policy-widened-permissive-all', {
  file: 'supabase/schema.sql',
  testFile: 'tests/stage-c/838-schema-fresh-bootstrap.test.ts',
  // A permissive FOR ALL the way a careless edit would add it.
  mutate: (text) =>
    text.replace(
      'drop trigger if exists suggestions_guard_contributions on public.suggestions;',
      'create policy "admin write" on public.activity for all to authenticated using (public.is_admin()) with check (public.is_admin());\ndrop trigger if exists suggestions_guard_contributions on public.suggestions;',
    ),
  failingTitle: 'leaves no permissive FOR ALL and no admin write',
})

control('schema-delete-scope-widened-to-any-editor', {
  file: 'supabase/schema.sql',
  testFile: 'tests/stage-c/838-schema-fresh-bootstrap.test.ts',
  mutate: (text) =>
    text.replace(
      `create policy "suggestions delete" on public.suggestions for delete using (public.is_editor(trip_id) and (proposed_by = auth.uid() or exists (select 1 from public.trips t where t.id = suggestions.trip_id and t.owner_id = auth.uid())));`,
      `create policy "suggestions delete" on public.suggestions for delete using (public.is_editor(trip_id));`,
    ),
  failingTitle: 'scopes suggestions and decisions UPDATE to editors',
})

control('ste-checker-sql-blanket-skip', {
  file: 'scripts/lint-ste.mjs',
  testFile: 'tests/lint-ste.test.ts',
  // Re-introduce the reviewed P2 hole: a .sql statement line is always code,
  // so a comment-rule test that relies on a statement line sees a miss.
  mutate: (text) => {
    const anchor = "  if (name === 'comment' || name === 'statement') {"
    if (!text.includes(anchor)) throw new Error('checkIfProse anchor not found')
    return text.replace(anchor, "  if (name === 'statement') return\n  if (false) {")
  },
  failingTitle: 'reads a RAISE message as prose, and no other SQL literal',
})

control('sql-needs-duplicate-refusal', {
  file: 'supabase/migrations/20261025c_place_exposure.sql',
  testFile: 'tests/stage-c/838-collab-transitions-db.test.ts',
  // Make the refusal condition unreachable, so a same-place accept is absorbed
  // into the existing stop. The statement stays syntactically valid.
  mutate: (text) => {
    const anchor = /( *)(if v_stop_id is not null then(\r?\n) *-- The promised repeat-confirmation contract)/
    if (!anchor.test(text)) throw new Error('needsDuplicate branch not found')
    return text.replace(anchor, '$1if false then$3            -- The promised repeat-confirmation contract')
  },
  failingTitle: 'refuses a same-place same-day accept as needsDuplicate',
})

control('decoder-needs-duplicate-case', {
  file: 'src/store/collabCommand.ts',
  testFile: 'tests/suggestion-accept-repeat.test.ts',
  mutate: (text) => {
    const anchor = "      case 'needsDuplicate': {"
    if (!text.includes(anchor)) throw new Error('decoder case not found')
    return text.replace(anchor, "      case 'needsDuplicate-unreachable': {")
  },
  failingTitle: 'a same-place same-day accept is refused as needsDuplicate',
})

control('ui-duplicate-followup', {
  file: 'src/pages/trip/GroupInputTab.tsx',
  testFile: 'tests/suggestion-followup-render.test.ts',
  mutate: (text) => {
    // The file may use CRLF, so the anchor is matched line by line.
    const anchor = /( *)case 'needsDuplicate':(\r?\n)( *)return \{ duplicate:/
    if (!anchor.test(text)) throw new Error('UI duplicate branch not found')
    return text.replace(anchor, "$1case 'needsDuplicate-unreachable':$2$3return { duplicate:")
  },
  failingTitle: 'a needsDuplicate receipt opens this panel for the server-resolved day',
})

control('exposure-weather-true-active-stop', {
  file: 'src/lib/ai.ts',
  testFile: 'tests/stage-c/843-exposure-persistence.test.ts',
  // The claimed mutant: a true weather flag no longer reads as outdoor.
  mutate: (text) => {
    const anchor = "  return stop.weatherSensitive === true ? 'outdoor' : 'unknown'"
    if (!text.includes(anchor)) throw new Error('exposureEvidence fallback not found')
    return text.replace(anchor, "  return 'unknown'")
  },
  failingTitle: 'reads a true weather-sensitive flag as outdoor evidence',
})

function execute(c) {
  const record = { name: c.name, file: c.file, testFile: c.testFile, failingTitle: c.failingTitle }
  const abs = path.join(ROOT, c.file)
  const baseline = readFileSync(abs)
  record.baselineSha256 = createHash('sha256').update(baseline).digest('hex')
  record.baselineBytes = baseline.length

  const green = runVitest(c.testFile)
  record.baselineRun = green
  if (!passed(green)) {
    record.verdict = 'UNPROVEN: baseline run did not pass'
    return record
  }

  let mutated
  try {
    mutated = c.mutate(baseline.toString('utf8'))
  } catch (err) {
    record.verdict = `UNPROVEN: mutation failed: ${err.message}`
    return record
  }
  if (mutated === baseline.toString('utf8')) {
    record.verdict = 'UNPROVEN: mutation changed no bytes'
    return record
  }
  writeFileSync(abs, mutated)
  record.mutantSha256 = sha256(c.file)
  if (record.mutantSha256 === record.baselineSha256) {
    record.verdict = 'UNPROVEN: mutant hashes equal baseline'
    writeFileSync(abs, baseline)
    return record
  }

  const red = runVitest(c.testFile)
  record.mutantRun = red
  try {
    if (infraBroken(red)) {
      record.verdict = 'UNPROVEN: mutant run failed for infrastructure reasons, not an assertion'
    } else if (!killed(red, c.failingTitle)) {
      record.verdict = `UNPROVEN: the named assertion did not fail (wanted "${c.failingTitle}")`
    } else {
      record.verdict = 'KILLED'
    }
  } finally {
    writeFileSync(abs, baseline)
  }

  record.restoredSha256 = sha256(c.file)
  record.restoredBytes = readFileSync(abs).length
  record.restoredExact = record.restoredSha256 === record.baselineSha256
  if (!record.restoredExact) record.verdict = 'ERROR: restore did not return the baseline bytes'
  return record
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!EVIDENCE) throw new Error('CONTROL_OUT must name the evidence directory')
  mkdirSync(EVIDENCE, { recursive: true })
  const JSONL = path.join(EVIDENCE, 'controls-r13.jsonl')
  writeFileSync(JSONL, '')
  for (const c of controls) {
    const record = execute(c)
    const { baselineRun, mutantRun, ...summary } = record
    writeFileSync(
      path.join(EVIDENCE, `control-${c.name}.baseline.log`),
      `${baselineRun.command}\nstarted ${baselineRun.started}\nended ${baselineRun.ended}\nexit ${baselineRun.status}\n\n--- stdout ---\n${baselineRun.stdout}\n--- stderr ---\n${baselineRun.stderr}\n`,
    )
    if (mutantRun) {
      writeFileSync(
        path.join(EVIDENCE, `control-${c.name}.mutant.log`),
        `${mutantRun.command}\nstarted ${mutantRun.started}\nended ${mutantRun.ended}\nexit ${mutantRun.status}\n\n--- stdout ---\n${mutantRun.stdout}\n--- stderr ---\n${mutantRun.stderr}\n`,
      )
    }
    appendFileSync(JSONL, JSON.stringify(summary) + '\n')
    console.log(`${record.verdict.padEnd(8)} ${c.name}`)
    if (!record.restoredExact) process.exitCode = 2
  }
}
