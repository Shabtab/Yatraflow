import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const categories = ['Added', 'Changed', 'Fixed', 'Removed']
const pendingRoot = 'changelog.d/pending/'
const receiptRoot = 'changelog.d/releases/'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const sha = (text) => createHash('sha256').update(text).digest('hex')
const normalize = (text) => text.replace(/\s+/g, ' ').trim()
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
const read = (root, file) => readFileSync(path.join(root, file), 'utf8')
const blob = (root, ref, file) => git(root, ['show', `${ref}:${file}`])
const filesAt = (root, ref, folder) => git(root, ['ls-tree', '-r', '--name-only', ref, '--', folder]).trim().split('\n').filter(Boolean)
const filesHere = (root, folder) => existsSync(path.join(root, folder))
  ? readdirSync(path.join(root, folder)).map((name) => folder + name).sort() : []

export function parseFragment(file, text) {
  const id = path.posix.basename(file, '.md')
  if (!uuid.test(id) || file !== `${pendingRoot}${id}.md`) throw new Error(`Invalid fragment path: ${file}`)
  if (text.includes('\r') || !text.endsWith('\n')) throw new Error(`${file}: use LF and a final newline`)
  const entries = []
  let category = ''
  let previous = -1
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const heading = /^### (Added|Changed|Fixed|Removed)$/.exec(line)
    if (heading) {
      if (category && !entries.some((entry) => entry.category === category)) throw new Error(`${file}: empty section`)
      category = heading[1]
      const position = categories.indexOf(category)
      if (position <= previous) throw new Error(`${file}: invalid section order`)
      previous = position
    } else if (/^- \*\*[^*\n]+[.!?]\*\*(?: .*)?$/.test(line) && category) entries.push({ category, text: line })
    else throw new Error(`${file}: use a category and a bullet with a bold outcome sentence`)
  }
  if (!entries.length || !entries.some((entry) => entry.category === category)) throw new Error(`${file}: empty fragment or section`)
  return { id, file, text, entries, sha256: sha(text) }
}

export function splitChangelog(text) {
  if (/^(?:<{7}|={7}|>{7})(?: .*)?$/m.test(text)) throw new Error('CHANGELOG.md contains conflict markers')
  const anchors = [...text.matchAll(/^## \[Unreleased\](?=\r?$)/gm)]
  if (anchors.length !== 1) throw new Error('CHANGELOG.md must have exactly one ## [Unreleased] heading')
  const start = anchors[0].index + anchors[0][0].length
  const tail = text.slice(start)
  const release = /^## \[\d+\.\d+\.\d+(?:-native(?:\.[0-9]+)?)?\] - \d{4}-\d{2}-\d{2}\r?$/m.exec(tail)
  if (!release) throw new Error('CHANGELOG.md needs a dated release heading')
  return { prefix: text.slice(0, start), pending: tail.slice(0, release.index), history: tail.slice(release.index) }
}

export function assertInsertionOnly(before, after, insertions) {
  const addedLines = insertions.reduce((count, insertion) => count + insertion.text.split('\n').length - 1, 0)
  if (after.split('\n').length < before.split('\n').length + addedLines) throw new Error('Changelog line-loss guard failed')
  let expected = before
  let previous = before.length + 1
  for (const insertion of [...insertions].sort((left, right) => right.offset - left.offset)) {
    if (!Number.isInteger(insertion.offset) || insertion.offset < 0 || insertion.offset > before.length || insertion.offset >= previous) throw new Error('Invalid insertion offset')
    previous = insertion.offset
    expected = expected.slice(0, insertion.offset) + insertion.text + expected.slice(insertion.offset)
  }
  if (expected !== after) throw new Error('Changelog edits must contain insertions only')
  splitChangelog(after)
}

function validateInputs(fragments, receipts) {
  const retired = new Set()
  for (const receipt of receipts) {
    if (receipt.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(receipt.version) || !/^[0-9a-f]{40,64}$/.test(receipt.source) ||
        !Array.isArray(receipt.fragments) || !/^[0-9a-f]{64}$/.test(receipt.blockHash) || !/^[0-9a-f]{64}$/.test(receipt.changelogHash)) throw new Error('Malformed release receipt')
    for (const input of receipt.fragments) {
      if (!uuid.test(input.id) || !/^[0-9a-f]{64}$/.test(input.sha256) || retired.has(input.id)) throw new Error('Reused or invalid receipt ID')
      retired.add(input.id)
    }
  }
  const bullets = new Set()
  for (const fragment of fragments) {
    if (retired.has(fragment.id)) throw new Error(`Retired fragment restored: ${fragment.id}`)
    for (const entry of fragment.entries) {
      const key = normalize(entry.text)
      if (bullets.has(key)) throw new Error('Duplicate fragment bullet; review the notes')
      bullets.add(key)
    }
  }
}

function readInputs(root, ref) {
  const list = (folder) => ref ? filesAt(root, ref, folder) : filesHere(root, folder)
  const get = (file) => ref ? blob(root, ref, file) : read(root, file)
  const fragments = list(pendingRoot).map((file) => parseFragment(file, get(file)))
  const receipts = list(receiptRoot).map((file) => {
    const receipt = JSON.parse(get(file))
    if (file !== `${receiptRoot}${receipt.version}.json`) throw new Error('Receipt filename does not match its version')
    return receipt
  })
  validateInputs(fragments, receipts)
  const transitionFile = 'changelog.d/transition.json'
  const hasTransition = ref ? filesAt(root, ref, 'changelog.d/').includes(transitionFile) : existsSync(path.join(root, transitionFile))
  const transitionText = hasTransition ? get(transitionFile) : null
  const transition = transitionText ? JSON.parse(transitionText) : null
  if (transition && (Object.keys(transition).length !== 1 || !/^\d+\.\d+\.\d+$/.test(transition.untilRelease))) throw new Error('Malformed transition boundary')
  if (transition && receipts.length) throw new Error('Remove the transition boundary at the first release')
  return { fragments, receipts, transition, transitionText }
}

export function planRelease(text, fragments, receipts, version, date, source) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a web version: X.Y.Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Invalid release date')
  validateInputs(fragments, receipts)
  const parts = splitChangelog(text)
  if (receipts.some((receipt) => receipt.version === version) || text.includes(`## [${version}]`)) throw new Error('Release already assembled')
  if (!fragments.length) throw new Error('No fragments selected')
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const insertions = [{ offset: parts.prefix.length, text: `${newline}${newline}## [${version}] - ${date}` }]
  const headings = [...parts.pending.matchAll(/^### (Added|Changed|Fixed|Removed)(?=\r?$)/gm)]
  let lastCategory = -1
  for (const heading of headings) {
    const position = categories.indexOf(heading[1])
    if (position <= lastCategory) throw new Error('Legacy categories are out of order or repeated')
    lastCategory = position
  }
  for (const category of categories) {
    const bullets = [...fragments].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      .flatMap((fragment) => fragment.entries.filter((entry) => entry.category === category).map((entry) => entry.text))
    if (!bullets.length) continue
    const heading = headings.find((item) => item[1] === category)
    const nextHeading = headings.find((item) => categories.indexOf(item[1]) > categories.indexOf(category))
    const offset = heading ? parts.prefix.length + heading.index + heading[0].length
      : nextHeading ? parts.prefix.length + nextHeading.index : parts.prefix.length + parts.pending.length
    const added = heading ? `${newline}${newline}${bullets.join(newline + newline)}`
      : `### ${category}${newline}${newline}${bullets.join(newline + newline)}${newline}${newline}`
    const existing = insertions.find((insertion) => insertion.offset === offset)
    if (existing) existing.text += added
    else insertions.push({ offset, text: added })
  }
  let after = text
  for (const insertion of [...insertions].sort((left, right) => right.offset - left.offset)) after = after.slice(0, insertion.offset) + insertion.text + after.slice(insertion.offset)
  assertInsertionOnly(text, after, insertions)
  const historyOffset = after.indexOf(parts.history)
  if (historyOffset < 0 || after.slice(historyOffset) !== parts.history) throw new Error('Released history changed')
  const receipt = { schema: 1, version, date, source,
    fragments: [...fragments].sort((left, right) => left.id < right.id ? -1 : 1).map(({ id, sha256 }) => ({ id, sha256 })),
    blockHash: sha(after.slice(parts.prefix.length, historyOffset)), changelogHash: sha(after) }
  return { before: text, after, insertions, receipt, fragments }
}

export function releaseAt(root, source, version, date) {
  const resolved = git(root, ['rev-parse', '--verify', `${source}^{commit}`]).trim()
  const inputs = readInputs(root, resolved)
  const text = blob(root, resolved, 'CHANGELOG.md')
  const parts = splitChangelog(text)
  const latest = /^## \[([^\]]+)\]/.exec(parts.history)?.[1]
  if (parts.pending.trim() && latest !== inputs.transition?.untilRelease) throw new Error('Unexplained prose remains under Unreleased')
  for (const fragment of inputs.fragments) {
    execFileSync(process.execPath, [fileURLToPath(new URL('./lint-ste.mjs', import.meta.url)), '--stdin'], { cwd: root, input: fragment.text, stdio: 'pipe' })
  }
  return { ...planRelease(text, inputs.fragments, inputs.receipts, version, date, resolved), transitionText: inputs.transitionText }
}

export function renderPatch(plan) {
  const newline = plan.before.includes('\r\n') ? '\r\n' : '\n'
  const output = ['diff --git a/CHANGELOG.md b/CHANGELOG.md', '--- a/CHANGELOG.md', '+++ b/CHANGELOG.md']
  let added = 0
  for (const insertion of [...plan.insertions].sort((left, right) => left.offset - right.offset)) {
    const line = plan.before.slice(0, insertion.offset).split(newline).length
    const onHeading = insertion.offset !== plan.before.length && plan.before[insertion.offset] !== '\r' && plan.before[insertion.offset] !== '\n'
    const inserted = insertion.text.split(newline)
    if (onHeading) inserted.pop()
    else inserted.shift()
    const context = onHeading ? line - 1 : line
    output.push(`@@ -${context},0 +${context + added + 1},${inserted.length} @@`, ...inserted.map((value) => '+' + value + (newline === '\r\n' ? '\r' : '')))
    added += inserted.length
  }
  for (const fragment of plan.fragments) {
    const contents = fragment.text.slice(0, -1).split('\n')
    output.push(`diff --git a/${fragment.file} b/${fragment.file}`, 'deleted file mode 100644', `--- a/${fragment.file}`, '+++ /dev/null',
      `@@ -1,${contents.length} +0,0 @@`, ...contents.map((line) => '-' + line))
  }
  if (plan.transitionText) {
    const file = 'changelog.d/transition.json'
    const contents = plan.transitionText.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
    output.push(`diff --git a/${file} b/${file}`, 'deleted file mode 100644', `--- a/${file}`, '+++ /dev/null',
      `@@ -1,${contents.length} +0,0 @@`, ...contents.map((line) => '-' + line))
  }
  const file = `${receiptRoot}${plan.receipt.version}.json`
  const contents = JSON.stringify(plan.receipt, null, 2).split('\n')
  output.push(`diff --git a/${file} b/${file}`, 'new file mode 100644', '--- /dev/null', `+++ b/${file}`,
    `@@ -0,0 +1,${contents.length} @@`, ...contents.map((line) => '+' + line))
  return output.join('\n') + '\n'
}

export function check(root, options = {}) {
  const { fragments, receipts } = readInputs(root)
  splitChangelog(read(root, 'CHANGELOG.md'))
  for (const fragment of fragments) execFileSync(process.execPath, [fileURLToPath(new URL('./lint-ste.mjs', import.meta.url)), '--file', path.join(root, fragment.file)], { cwd: root, stdio: 'pipe' })
  if (options.base) checkDelta(root, options.base, options.head)
  return { fragments: fragments.length, receipts: receipts.length }
}

function checkDelta(root, baseRef, headRef) {
  const base = git(root, ['rev-parse', '--verify', `${baseRef}^{commit}`]).trim()
  if (headRef) git(root, ['rev-parse', '--verify', `${headRef}^{commit}`])
  const common = git(root, ['merge-base', base, headRef || 'HEAD']).trim()
  const get = (file) => headRef ? blob(root, headRef, file) : read(root, file)
  const list = (folder) => headRef ? filesAt(root, headRef, folder) : filesHere(root, folder)
  const beforeInputs = readInputs(root, common)
  const afterInputs = headRef ? readInputs(root, headRef) : readInputs(root)
  const oldText = blob(root, common, 'CHANGELOG.md')
  const newText = get('CHANGELOG.md')
  const oldReceipts = filesAt(root, common, receiptRoot)
  for (const file of oldReceipts) if (!list(receiptRoot).includes(file) || get(file) !== blob(root, common, file)) throw new Error('Retired receipts are immutable')
  const addedReceipts = list(receiptRoot).filter((file) => !oldReceipts.includes(file))
  if (addedReceipts.length) {
    if (addedReceipts.length !== 1) throw new Error('Check one release at a time')
    const receipt = JSON.parse(get(addedReceipts[0]))
    if (git(root, ['merge-base', receipt.source, headRef || 'HEAD']).trim() !== receipt.source) throw new Error('Release source must be an ancestor')
    const plan = releaseAt(root, receipt.source, receipt.version, receipt.date)
    const oldParts = splitChangelog(oldText)
    const sourceParts = splitChangelog(plan.before)
    if (JSON.stringify(receipt) !== JSON.stringify(plan.receipt) || newText !== plan.after || oldParts.prefix !== sourceParts.prefix || oldParts.history !== sourceParts.history) throw new Error('Release receipt or changelog does not match frozen inputs')
    for (const input of plan.fragments) {
      if (list(pendingRoot).includes(input.file)) throw new Error('Selected fragment was not consumed')
      const previous = beforeInputs.fragments.find((fragment) => fragment.id === input.id)
      if (previous && previous.sha256 !== input.sha256) {
        const parents = git(root, ['rev-list', '--parents', '-n', '1', receipt.source]).trim().split(' ')
        if (parents.length !== 2 || git(root, ['merge-base', common, receipt.source]).trim() !== common ||
            !filesAt(root, parents[1], pendingRoot).includes(input.file) ||
            blob(root, parents[1], input.file) !== previous.text) throw new Error('Stale release inputs')
      }
    }
    for (const previous of beforeInputs.fragments) {
      if (!plan.fragments.some((fragment) => fragment.id === previous.id) && !afterInputs.fragments.some((fragment) => fragment.id === previous.id && fragment.sha256 === previous.sha256)) throw new Error('Unselected fragment changed during release')
    }
    return
  }
  for (const previous of beforeInputs.fragments) if (!afterInputs.fragments.some((fragment) => fragment.id === previous.id)) throw new Error('Only a checked release can delete a fragment')
  if (oldText !== newText) {
    const oldParts = splitChangelog(oldText)
    const newParts = splitChangelog(newText)
    const transition = afterInputs.transition
    if (!transition) throw new Error('Direct changelog edit needs a checked release receipt')
    const latest = /^## \[([^\]]+)\]/.exec(newParts.history)?.[1]
    if (latest !== transition.untilRelease || oldParts.prefix !== newParts.prefix || oldParts.history !== newParts.history || normalize(oldParts.pending) === normalize(newParts.pending)) throw new Error('Direct changelog bridge ended or history changed')
    return
  }
  const oldContents = new Set(beforeInputs.fragments.map((fragment) => normalize(fragment.text)))
  const changed = afterInputs.fragments.some((fragment) => {
    const previous = beforeInputs.fragments.find((item) => item.id === fragment.id)
    return normalize(fragment.text) !== normalize(previous?.text || '') && !oldContents.has(normalize(fragment.text))
  })
  if (!changed) throw new Error('This change needs a new or substantive pending fragment')
}

// Picks the range that PR coverage is checked over. A pull request run names it
// with the event SHAs. A push run checks format only, because the PR run is the
// gate and a push can carry any history. A local run starts at the merge base
// with origin/test. With no commit ahead of that base there is no range to cover.
export function checkRange(root, values, env = process.env) {
  if (values.base) return { base: values.base, head: values.head }
  if (env.CI) {
    if (env.GITHUB_EVENT_NAME !== 'pull_request') return {}
    const event = env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : null
    const base = event?.pull_request?.base?.sha
    const head = event?.pull_request?.head?.sha
    if (!base || !head) throw new Error('CI needs PR base and head SHAs')
    return { base, head }
  }
  let base
  try { base = git(root, ['merge-base', 'origin/test', 'HEAD']).trim() }
  catch { throw new Error('Fetch origin test or pass --base <commit>') }
  return base === git(root, ['rev-parse', 'HEAD']).trim() ? {} : { base }
}

function command() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    section: { type: 'string' }, message: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' },
    version: { type: 'string' }, date: { type: 'string' }, write: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
  } })
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()
  if (positionals[0] === 'new') {
    if (!categories.includes(values.section) || !values.message) throw new Error('Use --section Added|Changed|Fixed|Removed --message "Outcome sentence."')
    const file = `${pendingRoot}${randomUUID()}.md`
    const text = `### ${values.section}\n\n- **${values.message}**\n`
    parseFragment(file, text)
    mkdirSync(path.join(root, pendingRoot), { recursive: true })
    writeFileSync(path.join(root, file), text, { flag: 'wx' })
    console.log(file)
  } else if (positionals[0] === 'check') {
    const range = checkRange(root, values)
    const result = check(root, range)
    console.log(`Changelog: ${result.fragments} pending fragment(s), ${result.receipts} receipt(s); ${range.base ? 'coverage passed.' : 'format checked, no PR range to cover.'}`)
  } else if (positionals[0] === 'release') {
    if (!values.base || !values.version || !values.date) throw new Error('Use --base <commit> --version X.Y.Z --date YYYY-MM-DD')
    check(root)
    const plan = releaseAt(root, values.base, values.version, values.date)
    if (read(root, 'CHANGELOG.md') !== plan.before) throw new Error('CHANGELOG.md changed since the frozen input; freeze a new commit')
    const currentTransition = existsSync(path.join(root, 'changelog.d/transition.json')) ? read(root, 'changelog.d/transition.json') : null
    if (currentTransition !== plan.transitionText) throw new Error('Transition boundary changed since the frozen input')
    for (const fragment of plan.fragments) if (!existsSync(path.join(root, fragment.file)) || read(root, fragment.file) !== fragment.text) throw new Error('Fragment changed since the frozen input')
    if (values.write) {
      if (values['dry-run']) throw new Error('Choose --write or --dry-run')
      writeFileSync(path.join(root, 'changelog-release.patch'), renderPatch(plan), { flag: 'wx' })
      console.log('Wrote changelog-release.patch. Review and apply it with editor primitives. CHANGELOG.md is unchanged.')
    } else process.stdout.write(renderPatch(plan))
  } else throw new Error('Use new, check, or release')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { command() }
  catch (error) { console.error(`Changelog: ${error.message}`); process.exitCode = 1 }
}
