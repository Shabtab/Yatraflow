// The STE100 checker (AGENTS.md §2 rule 13) is itself a guardrail, so it gets
// pinned: a rewrite that silently stops catching violations would leave the
// rule unenforced, which is the exact defect class §2 rule 13 exists to fix.
//
// These tests run the real script against real text. They do not re-implement
// its rules — a copy of the logic here could pass while the script fails.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/lint-ste.mjs', import.meta.url))

function run(text: string) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--stdin'], {
      input: text,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stderr?: string }
    return { code: e.status ?? 1, out: e.stderr ?? '' }
  }
}

describe('STE100 lint (scripts/lint-ste.mjs)', () => {
  it('passes compliant prose', () => {
    const r = run('Check the value.\nRun the tests.\nYou must not push to main.\n')
    expect(r.code).toBe(0)
  })

  it('catches a sentence over the 20 word limit', () => {
    const long =
      'The share preview handler reads only the stored cover image URL column from the published itineraries table and therefore renders the brand card for every publication that lacks an explicit cover.'
    const r = run(long + '\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/20 words|max 20/)
  })

  it('catches a sentence that starts with a gerund', () => {
    const r = run('Checking the value before you proceed.\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/gerund/i)
  })

  it('catches a controlled-vocabulary violation', () => {
    const r = run('Utilize the helper to facilitate the migration.\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/Utilize|facilitate/)
  })

  it('catches "should" carrying a rule', () => {
    const r = run('You should push to main.\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/must/)
  })

  it('allows a sentence that names the should/must rule', () => {
    const r = run('Use must, not should.\n')
    expect(r.code).toBe(0)
  })

  it('ignores headings, tables and code fences', () => {
    const r = run('## A heading that is quite long but is a heading\n| a | b |\n```\nconst x = 1\n```\n')
    expect(r.code).toBe(0)
  })

  it('ignores code lines, so a correct file is never restructured to please it', () => {
    // Every line below is real source the checker used to flag, which forced
    // working code to be reshaped. See `isCode` in scripts/lint-ste.mjs.
    const code = [
      '    priority: \'nice-to-have\', status: \'confirmed\', orderInDay: 1,',
      '      warnings.push({ code: \'commitment-unlinked\', severity: \'low\', title, detail, fix })',
      '          <MapTab trip={effective} editable={editable} applyChange={applyChange}',
      '            onOpenDay={(dayIndex) => { setFocusedDay(dayIndex); setTab(\'timeline\') }}',
      '                options={linkStopOptions(ordered)} />',
      '  const ok = daySlots(0, deps(segs, stops)).length',
      '      expect(clock.get(s.id)?.arrive).toBe(sim.arrivalTimes[i])',
      '  count: 1, done: true,',
    ].join('\n')
    expect(run(code + '\n').code).toBe(0)
  })

  it('ignores a string literal that carries code, such as a test fixture', () => {
    const literal = '  "    priority: \'nice-to-have\', status: \'confirmed\', orderInDay: 1,",\n'
    expect(run(literal).code).toBe(0)
  })

  it('still checks prose that merely mentions code', () => {
    // A documentation sentence is prose even when it names a function.
    expect(run('The function daySlots returns the slots for a day.\n').code).toBe(0)
    const long = 'You must call the helper daySlots before you render the slots list for one whole day in the plan rail today.\n'
    expect(run(long).code).toBe(1)
  })

  it('checks a list item as prose after its marker', () => {
    const items = ['- Checking the value before you proceed.\n', '* Checking the value before you proceed.\n', '1. Checking the value before you proceed.\n', '2) Checking the value before you proceed.\n']
    for (const item of items) expect(run(item).code).toBe(1)
  })

  it('passes a compliant list item', () => {
    const good = '- Check the value.\n* Run the tests.\n1. You must not push to main.\n'
    expect(run(good).code).toBe(0)
  })

  it('catches should and an over-long sentence inside a list item', () => {
    const modal = '- You should push to main.\n'
    expect(run(modal).code).toBe(1)
    const long = '- The share preview handler reads only the stored cover image URL column from the published itineraries table and therefore renders the brand card for every publication that lacks an explicit cover.\n'
    expect(run(long).code).toBe(1)
  })

  it('measures a bold lead up to its period, not into the next sentence', () => {
    const lead = '- **The share preview handler reads only the stored cover image URL column from the published itineraries table and therefore renders the brand card.** Check the value.\n'
    expect(run(lead).code).toBe(1)
    const short = '- **Check the value.** Run the tests.\n'
    expect(run(short).code).toBe(0)
  })

  it('still skips a list item whose text is code', () => {
    const code = "- priority: 'nice-to-have', status: 'confirmed', orderInDay: 1,\n"
    expect(run(code).code).toBe(0)
  })

  it('still skips a list item inside a code fence, and still checks a plain line in one', () => {
    const bullet = '```\n- Checking the value before you proceed in a fenced block of text here\n```\n'
    const plain = '```\nChecking the value before you proceed in a fenced block of text here\n```\n'
    expect(run(bullet).code).toBe(0)
    expect(run(plain).code).toBe(1)
  })

  it('the repo script exists and is runnable', () => {
    expect(() => execFileSync(process.execPath, [SCRIPT, '--help-flag-that-is-ignored'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })).not.toThrow()
  })
})

// Fixture repositories for the default run. Each one is a throwaway git
// repository in the OS temp directory, so the gate reads real git state.
const fixtureDirs: string[] = []

afterAll(() => {
  for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true })
})

// Runs git in a fixture. A hook may set GIT_DIR, so every GIT_ variable is removed first.
function git(cwd: string, args: string[]): string {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key]
  }
  Object.assign(env, {
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.test',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.test',
  })
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// Makes a fixture repository. Its first commit holds the base text.
// origin/test points at that commit unless originTest is false.
function fixtureRepo(base: string, originTest = true): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lint-ste-'))
  fixtureDirs.push(dir)
  git(dir, ['init', '-q'])
  writeFileSync(path.join(dir, 'notes.md'), base)
  git(dir, ['add', 'notes.md'])
  git(dir, ['commit', '-q', '-m', 'base'])
  if (originTest) git(dir, ['update-ref', 'refs/remotes/origin/test', 'HEAD'])
  return dir
}

// Writes the file, then commits it.
function commitNotes(dir: string, text: string): void {
  writeFileSync(path.join(dir, 'notes.md'), text)
  git(dir, ['add', 'notes.md'])
  git(dir, ['commit', '-q', '-m', 'change'])
}

// Runs the real script with the fixture as its working directory.
function runScript(cwd: string, args: string[] = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

describe('STE100 default run (fixture repositories, real git)', () => {
  const GOOD = 'Check the value.\n'
  const BAD_LINE = 'Utilize the helper to facilitate the migration.\n'
  const BAD_BULLET = '- Checking the value. You should retry the upload.\n'
  const GOOD_BULLETS = '- Run the tests.\n1. You must not push to main.\n'

  it('fails on a committed bad line', () => {
    const dir = fixtureRepo(GOOD)
    commitNotes(dir, GOOD + BAD_LINE)
    const r = runScript(dir)
    const flaggedWords = /Utilize|facilitate/
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(flaggedWords)
  })

  it('fails on a committed bad bullet', () => {
    const dir = fixtureRepo(GOOD)
    commitNotes(dir, GOOD + BAD_BULLET)
    const r = runScript(dir)
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/gerund/)
    expect(r.stderr).toMatch(/must/)
  })

  it('fails on an uncommitted bad bullet', () => {
    const dir = fixtureRepo(GOOD)
    writeFileSync(path.join(dir, 'notes.md'), GOOD + '* Checking the value before you proceed.\n')
    expect(runScript(dir).code).toBe(1)
  })

  it('passes committed good prose and good list items', () => {
    const dir = fixtureRepo(GOOD)
    commitNotes(dir, GOOD + GOOD_BULLETS)
    const r = runScript(dir)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/OK/)
  })

  it('ignores legacy text that the branch does not change', () => {
    const dir = fixtureRepo(BAD_LINE)
    commitNotes(dir, BAD_LINE + GOOD)
    expect(runScript(dir).code).toBe(0)
  })

  it('--base <ref> checks the lines changed since that commit', () => {
    const dir = fixtureRepo(GOOD)
    const before = git(dir, ['rev-parse', 'HEAD']).trim()
    commitNotes(dir, GOOD + BAD_LINE)
    expect(runScript(dir, ['--base', before]).code).toBe(1)
    expect(runScript(dir, ['--base', 'HEAD']).code).toBe(0)
  })

  it('warns when origin/test is absent, and checks only uncommitted lines', () => {
    const dir = fixtureRepo(GOOD, false)
    commitNotes(dir, GOOD + BAD_LINE)
    const committed = runScript(dir)
    expect(committed.code).toBe(0)
    expect(committed.stderr).toMatch(/origin\/test not found/)
    expect(committed.stderr).toMatch(/git fetch origin test/)
    writeFileSync(path.join(dir, 'notes.md'), GOOD + BAD_LINE + BAD_LINE)
    expect(runScript(dir).code).toBe(1)
  })

  it('checks a new file once it is staged', () => {
    const dir = fixtureRepo(GOOD)
    writeFileSync(path.join(dir, 'new.md'), BAD_LINE)
    git(dir, ['add', 'new.md'])
    expect(runScript(dir).code).toBe(1)
  })

  it('exits 2 when --base names no commit', () => {
    const dir = fixtureRepo(GOOD)
    expect(runScript(dir, ['--base', 'no-such-ref']).code).toBe(2)
  })
})
