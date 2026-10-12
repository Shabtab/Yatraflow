// The STE100 checker (AGENTS.md §2 rule 13) is itself a guardrail, so it gets
// pinned: a rewrite that silently stops catching violations would leave the
// rule unenforced, which is the exact defect class §2 rule 13 exists to fix.
//
// These tests run the real script against real text. They do not re-implement
// its rules — a copy of the logic here could pass while the script fails.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../scripts/lint-ste.mjs', import.meta.url))

// Real git and node runs take seconds on a slow Windows runner, so each test
// gets this explicit budget instead of vitest's five-second default.
const SLOW = 20000

// Thirty-one words, no vocabulary hit, so only the length rule can fire.
const LONG_PLAIN = 'The share preview handler reads only the stored cover image URL column from the published itineraries table and renders the brand card for every publication that lacks an explicit cover today.'

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
  }, SLOW)

  it('catches a sentence over the 20 word limit', () => {
    const long =
      'The share preview handler reads only the stored cover image URL column from the published itineraries table and therefore renders the brand card for every publication that lacks an explicit cover.'
    const r = run(long + '\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/20 words|max 20/)
  }, SLOW)

  it('catches a sentence that starts with a gerund', () => {
    const r = run('Checking the value before you proceed.\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/gerund/i)
  }, SLOW)

  it('catches a controlled-vocabulary violation', () => {
    const r = run('Utilize the helper to facilitate the migration.\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/Utilize|facilitate/)
  }, SLOW)

  it('catches "should" carrying a rule', () => {
    const r = run('You should push to main.\n')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/must/)
  }, SLOW)

  it('allows a sentence that names the should/must rule', () => {
    const r = run('Use must, not should.\n')
    expect(r.code).toBe(0)
  }, SLOW)

  it('ignores headings, tables and code fences', () => {
    const r = run('## A heading that is quite long but is a heading\n| a | b |\n```\nconst x = 1\n```\n')
    expect(r.code).toBe(0)
  }, SLOW)

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
  }, SLOW)

  it('ignores a string literal that carries code, such as a test fixture', () => {
    const literal = '  "    priority: \'nice-to-have\', status: \'confirmed\', orderInDay: 1,",\n'
    expect(run(literal).code).toBe(0)
  }, SLOW)

  it('still checks prose that merely mentions code', () => {
    // A documentation sentence is prose even when it names a function.
    expect(run('The function daySlots returns the slots for a day.\n').code).toBe(0)
    const long = 'You must call the helper daySlots before you render the slots list for one whole day in the plan rail today.\n'
    expect(run(long).code).toBe(1)
  }, SLOW)

  it('checks a list item as prose after its marker', () => {
    const items = ['- Checking the value before you proceed.\n', '* Checking the value before you proceed.\n', '1. Checking the value before you proceed.\n', '2) Checking the value before you proceed.\n']
    for (const item of items) expect(run(item).code).toBe(1)
  }, SLOW)

  it('passes a compliant list item', () => {
    const good = '- Check the value.\n* Run the tests.\n1. You must not push to main.\n'
    expect(run(good).code).toBe(0)
  }, SLOW)

  it('catches should and an over-long sentence inside a list item', () => {
    const modal = '- You should push to main.\n'
    expect(run(modal).code).toBe(1)
    const long = '- The share preview handler reads only the stored cover image URL column from the published itineraries table and therefore renders the brand card for every publication that lacks an explicit cover.\n'
    expect(run(long).code).toBe(1)
  }, SLOW)

  it('measures a bold lead up to its period, not into the next sentence', () => {
    const lead = '- **The share preview handler reads only the stored cover image URL column from the published itineraries table and therefore renders the brand card.** Check the value.\n'
    expect(run(lead).code).toBe(1)
    const short = '- **Check the value.** Run the tests.\n'
    expect(run(short).code).toBe(0)
  }, SLOW)

  it('still skips a list item whose text is code', () => {
    const code = "- priority: 'nice-to-have', status: 'confirmed', orderInDay: 1,\n"
    expect(run(code).code).toBe(0)
  }, SLOW)

  it('still skips a list item inside a code fence, and still checks a plain line in one', () => {
    const bullet = '```\n- Checking the value before you proceed in a fenced block of text here\n```\n'
    const plain = '```\nChecking the value before you proceed in a fenced block of text here\n```\n'
    expect(run(bullet).code).toBe(0)
    expect(run(plain).code).toBe(1)
  }, SLOW)

  it('measures every sentence on a line, not only the first', () => {
    // Bold, plain and underscore leads all end the first sentence, and the long
    // sentence after each one must still fail. Measuring only the first missed it.
    const bold = `**Check the value.** ${LONG_PLAIN}\n`
    const plain = `Check the value. ${LONG_PLAIN}\n`
    const italic = `_Check the value._ ${LONG_PLAIN}\n`
    expect(run(bold).code).toBe(1)
    expect(run(plain).code).toBe(1)
    expect(run(italic).code).toBe(1)
  }, SLOW)

  it('keeps an e.g. inside one sentence, so a long sentence that names one still fails', () => {
    const eg = 'Use the share link to open the trip plan in another browser, e.g. Firefox, Edge or Safari, before you publish the page to the public web.\n'
    expect(run(eg).code).toBe(1)
  }, SLOW)

  it('keeps a capital E.g. or an etc. inside one sentence, so a long sentence still fails', () => {
    // The break rule ignores letter case. It also skips etc.
    const eg = 'Use the share link to open the trip plan in another browser, E.g. Firefox, Edge or Safari, before you publish the page to the public web.\n'
    expect(run(eg).code).toBe(1)
    const etc = 'Use the share link to open the trip plan in another browser, the phone, the tablet, etc. before you publish the page to the public web.\n'
    expect(run(etc).code).toBe(1)
  }, SLOW)

  it('counts only words, so punctuation tokens do not push a sentence over the limit', () => {
    // Eighteen words and thirty-three tokens. Only the words count.
    const punctuated = 'Check the value ( a ) , b , c , d , e and f , g , h , i , j , k , l , m , n .\n'
    expect(run(punctuated).code).toBe(0)
  }, SLOW)

  it('counts the words on each side of an em dash or an en dash', () => {
    // Seventeen space-separated tokens, but twenty-four words once each dash splits a word.
    const emDash = 'Check the price—then the tax—then the fee—then the rate—then the date—then the note—then the sum—then the bill.\n'
    const enDash = 'Check the price–then the tax–then the fee–then the rate–then the date–then the note–then the sum–then the bill.\n'
    expect(run(emDash).code).toBe(1)
    expect(run(emDash).out).toMatch(/24 words/)
    expect(run(enDash).code).toBe(1)
    // A hyphen does not split a word, so a hyphenated compound still counts as one.
    const hyphen = 'Check the price-then the tax-then the fee-then the rate-then the date-then the note-then the sum-then the bill.\n'
    expect(run(hyphen).code).toBe(0)
  }, SLOW)

  it('starts a gerund step only before a determiner or a code span', () => {
    // A page name and an adjective that end in -ing are not gerunds.
    const names = 'Landing page loads fast.\nOverflowing shots carry the story.\n'
    expect(run(names).code).toBe(0)
    const stepBeforeDeterminer = 'Checking this value before you proceed.\n'
    const stepBeforeCode = 'Running `npm test` now.\n'
    expect(run(stepBeforeDeterminer).code).toBe(1)
    expect(run(stepBeforeCode).code).toBe(1)
  }, SLOW)

  it('starts a gerund step before any, some, both, no, one, my, his or her', () => {
    for (const word of ['any', 'some', 'both', 'no', 'one', 'my', 'his', 'her']) {
      expect(run('Checking ' + word + ' value before you proceed.\n').code, word).toBe(1)
    }
  }, SLOW)

  it('skips the must/should rule for a question, and still checks a statement', () => {
    const question = 'Do it now, or should they wait?\n'
    expect(run(question).code).toBe(0)
    const mixed = 'Should we wait? You should wait.\n'
    expect(run(mixed).code).toBe(1)
  }, SLOW)

  it('skips an indented code block, and still checks an indented list continuation', () => {
    // Four spaces or a tab after a blank line start a code block.
    const spaces = 'Some prose here.\n\n    Checking the value before you proceed in this code block today.\n'
    const tab = 'Some prose here.\n\n\tChecking the value before you proceed in this code block today.\n'
    expect(run(spaces).code).toBe(0)
    expect(run(tab).code).toBe(0)
    // The same indent under a list item is content of the item, so it is prose.
    const continuation = '- Run the tests.\n\n    Checking the value before you proceed in the list item text here.\n'
    expect(run(continuation).code).toBe(1)
    // An indented line right after prose continues the paragraph, so it is prose.
    const lazy = 'Some prose here.\n    Checking the value before you proceed in this line of prose text.\n'
    expect(run(lazy).code).toBe(1)
  }, SLOW)

  it('skips a table row inside a list item, after the marker', () => {
    const tableInItem = '- | Utilize the helper to facilitate | b |\n'
    expect(run(tableInItem).code).toBe(0)
  }, SLOW)

  it('strips a task box after the list marker, then checks the text', () => {
    const boxes = '- [ ] Check the value.\n- [x] Run the tests.\n'
    expect(run(boxes).code).toBe(0)
    const gerundBox = '- [x] Checking the value before you proceed.\n'
    expect(run(gerundBox).code).toBe(1)
    const shouldBox = '- [ ] You should push to main.\n'
    expect(run(shouldBox).code).toBe(1)
  }, SLOW)
})

// Fixture repositories for the default run. Each one is a throwaway git
// repository in the OS temp directory, so the gate reads real git state.
const fixtureDirs: string[] = []

afterAll(() => {
  for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true })
})

// Runs git in a fixture. Every GIT_ variable is removed first, so a hook or an
// outer repository cannot leak in. System config is skipped, and autocrlf is
// off, so the fixture keeps the line endings it wrote.
function git(cwd: string, args: string[]): string {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key]
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.test',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.test',
  })
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// Makes a fixture repository on branch main. Its first commit holds the base
// text. origin/test points at that commit unless originTest is false.
function fixtureRepo(base: string, originTest = true): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lint-ste-'))
  fixtureDirs.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  writeFileSync(path.join(dir, 'notes.md'), base)
  git(dir, ['add', 'notes.md'])
  git(dir, ['commit', '-q', '-m', 'base'])
  if (originTest) git(dir, ['update-ref', 'refs/remotes/origin/test', 'HEAD'])
  return dir
}

// Writes a file at a path inside the fixture, then commits it. A distinct
// message keeps two commits with the same parent and tree from hashing alike.
function commitFile(dir: string, rel: string, text: string, message = 'change'): void {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
  git(dir, ['add', rel])
  git(dir, ['commit', '-q', '-m', message])
}

// Writes notes.md at the top of the fixture, then commits it.
function commitNotes(dir: string, text: string, message?: string): void {
  commitFile(dir, 'notes.md', text, message)
}

// A shallow clone of a repository. Its HEAD and origin/test are both roots
// with no shared history, the state that `git clone --depth 1` leaves behind.
function shallowFixture(): string {
  const upstream = fixtureRepo('Check the value.\n')
  git(upstream, ['branch', 'test'])
  commitNotes(upstream, 'Check the value.\nRun the tests.\n')
  const clone = mkdtempSync(path.join(tmpdir(), 'lint-ste-clone-'))
  fixtureDirs.push(clone)
  git(upstream, ['clone', '-q', '--depth', '1', pathToFileURL(upstream).href, clone])
  git(clone, ['fetch', '-q', '--depth', '1', 'origin', 'test:refs/remotes/origin/test'])
  return clone
}

// Runs the real script with the fixture as its working directory. The CI and
// base variables are removed first, so the outer environment cannot change the
// base. A test passes its own values through `env`.
function runScript(cwd: string, args: string[] = [], env: Record<string, string> = {}) {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key === 'CI' || key === 'GITHUB_BASE_REF' || key.startsWith('GIT_')) continue
    clean[key] = value
  }
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...clean, ...env } })
  return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

const GOOD = 'Check the value.\n'
const BAD_LINE = 'Utilize the helper to facilitate the migration.\n'
const BAD_BULLET = '- Checking the value. You should retry the upload.\n'
const GOOD_BULLETS = '- Run the tests.\n1. You must not push to main.\n'

describe('STE100 default run (fixture repositories, real git)', () => {
  it('fails on a committed bad line', () => {
    const dir = fixtureRepo(GOOD)
    commitNotes(dir, GOOD + BAD_LINE)
    const r = runScript(dir)
    const flaggedWords = /Utilize|facilitate/
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(flaggedWords)
  }, SLOW)

  it('fails on a committed bad bullet', () => {
    const dir = fixtureRepo(GOOD)
    commitNotes(dir, GOOD + BAD_BULLET)
    const r = runScript(dir)
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/gerund/)
    expect(r.stderr).toMatch(/must/)
  }, SLOW)

  it('fails on an uncommitted bad bullet', () => {
    const dir = fixtureRepo(GOOD)
    writeFileSync(path.join(dir, 'notes.md'), GOOD + '* Checking the value before you proceed.\n')
    expect(runScript(dir).code).toBe(1)
  }, SLOW)

  it('passes committed good prose and good list items', () => {
    const dir = fixtureRepo(GOOD)
    commitNotes(dir, GOOD + GOOD_BULLETS)
    const r = runScript(dir)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/OK/)
  }, SLOW)

  it('ignores legacy text that the branch does not change', () => {
    const dir = fixtureRepo(BAD_LINE)
    commitNotes(dir, BAD_LINE + GOOD)
    expect(runScript(dir).code).toBe(0)
  }, SLOW)

  it('--base <ref> checks the lines changed since that commit', () => {
    const dir = fixtureRepo(GOOD)
    const before = git(dir, ['rev-parse', 'HEAD']).trim()
    commitNotes(dir, GOOD + BAD_LINE)
    expect(runScript(dir, ['--base', before]).code).toBe(1)
    expect(runScript(dir, ['--base', 'HEAD']).code).toBe(0)
  }, SLOW)

  it('--base diffs against the merge base, so a line the base also has still counts', () => {
    // Both branches add the same bad line. The line is new on main, so the
    // check must fail. A diff against the tip of side would hide it.
    const dir = fixtureRepo(GOOD)
    git(dir, ['checkout', '-q', '-b', 'side'])
    commitNotes(dir, GOOD + BAD_LINE, 'side change')
    git(dir, ['checkout', '-q', 'main'])
    commitNotes(dir, GOOD + BAD_LINE, 'main change')
    expect(runScript(dir, ['--base', 'side']).code).toBe(1)
  }, SLOW)

  it('warns when origin/test is absent, and falls back to HEAD~1 outside CI', () => {
    // With no origin/main either, the last commit is the base, so the committed bad line is inside the range.
    const dir = fixtureRepo(GOOD, false)
    commitNotes(dir, GOOD + BAD_LINE)
    const committed = runScript(dir)
    expect(committed.code).toBe(1)
    expect(committed.stderr).toMatch(/origin\/test not found/)
    expect(committed.stderr).toMatch(/git fetch origin test/)
    expect(committed.stderr).toMatch(/HEAD~1/)
  }, SLOW)

  it('falls back to origin/main when origin/test is absent, and names the base it used', () => {
    const dir = fixtureRepo(GOOD, false)
    git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    commitNotes(dir, GOOD + BAD_LINE)
    const r = runScript(dir)
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/origin\/test not found/)
    expect(r.stderr).toMatch(/merge base with origin\/main/)
  }, SLOW)

  it('checks only uncommitted lines when no base commit exists', () => {
    // A single commit has no parent, and no origin ref exists, so only uncommitted lines count.
    const dir = fixtureRepo(GOOD, false)
    expect(runScript(dir).code).toBe(0)
    writeFileSync(path.join(dir, 'notes.md'), GOOD + BAD_LINE)
    const r = runScript(dir)
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/uncommitted lines only/)
  }, SLOW)

  it('fails closed under CI when origin/test is absent', () => {
    const dir = fixtureRepo(GOOD, false)
    commitNotes(dir, GOOD + BAD_LINE)
    const r = runScript(dir, [], { CI: 'true' })
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/origin\/test not found under CI/)
  }, SLOW)

  it('never falls back under CI, even when origin/main exists', () => {
    const dir = fixtureRepo(GOOD, false)
    git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    commitNotes(dir, GOOD + BAD_LINE)
    const r = runScript(dir, [], { CI: 'true' })
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/origin\/test not found under CI/)
  }, SLOW)

  it('fails closed on a shallow clone with no merge base, and names the fix', () => {
    const clone = shallowFixture()
    const r = runScript(clone)
    expect(r.code).toBe(2)
    expect(r.stderr).toMatch(/shallow clone or unrelated history/)
    expect(r.stderr).toMatch(/git fetch --unshallow/)
  }, SLOW)

  it('prints a visible note when the range has no lines', () => {
    const dir = fixtureRepo(GOOD)
    const r = runScript(dir)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/0 lines in range \(base == HEAD\)/)
  }, SLOW)

  it('uses origin/$GITHUB_BASE_REF as the base in a pull request', () => {
    const dir = fixtureRepo(GOOD)
    const base = git(dir, ['rev-parse', 'HEAD']).trim()
    git(dir, ['update-ref', 'refs/remotes/origin/main', base])
    commitNotes(dir, GOOD + BAD_LINE)
    git(dir, ['update-ref', 'refs/remotes/origin/test', 'HEAD'])
    expect(runScript(dir).code).toBe(0)
    expect(runScript(dir, [], { GITHUB_BASE_REF: 'main' }).code).toBe(1)
  }, SLOW)

  it('checks a new file once it is staged', () => {
    const dir = fixtureRepo(GOOD)
    writeFileSync(path.join(dir, 'new.md'), BAD_LINE)
    git(dir, ['add', 'new.md'])
    expect(runScript(dir).code).toBe(1)
  }, SLOW)

  it('reads a path with a space, and drops the tab that git adds after the name', () => {
    // Git ends the +++ line of such a path with a tab. Without the strip, the gate read a file that does not exist.
    const flagged = /Utilize|facilitate/
    const dir = fixtureRepo(GOOD)
    commitFile(dir, 'docs/sp ace/n.md', BAD_LINE)
    const bad = runScript(dir)
    expect(bad.code).toBe(1)
    expect(bad.stderr).toMatch(flagged)
    const clean = fixtureRepo(GOOD)
    commitFile(clean, 'docs/sp ace/n.md', GOOD)
    expect(runScript(clean).code).toBe(0)
  }, SLOW)

  it('exempts docs/consistency/ from the diff runs, and still checks the same line elsewhere', () => {
    // docs/consistency/ holds planning notes written before the rules applied.
    const exempt = fixtureRepo(GOOD)
    commitFile(exempt, 'docs/consistency/plan.md', GOOD + BAD_LINE)
    expect(runScript(exempt).code).toBe(0)
    // An explicit --file names the file, so it is still checked.
    expect(runScript(exempt, ['--file', 'docs/consistency/plan.md']).code).toBe(1)
    const checked = fixtureRepo(GOOD)
    commitFile(checked, 'docs/plan.md', GOOD + BAD_LINE)
    expect(runScript(checked).code).toBe(1)
    // The prefix ends with a slash, so a sibling name stays checked.
    const sibling = fixtureRepo(GOOD)
    commitFile(sibling, 'docs/consistency-plan.md', GOOD + BAD_LINE)
    expect(runScript(sibling).code).toBe(1)
  }, SLOW)

  it('exits 2 when --base names no commit', () => {
    const dir = fixtureRepo(GOOD)
    expect(runScript(dir, ['--base', 'no-such-ref']).code).toBe(2)
  }, SLOW)
})
