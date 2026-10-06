// ============ Issue auto-close mirror for PRs merged into `test` ============
//
// GitHub's closing keywords (`Closes #N`, `Fixes #N`, `Resolves #N`) only
// auto-close an issue when the PR merges into the DEFAULT branch. This repo
// integrates on `test`, so every fix that lands there leaves its issues OPEN —
// the Wave-0 map merges (#380/#399) carried seven closing keywords and closed
// nothing until each issue was closed by hand (AGENTS.md rule 12). This script
// mirrors the tracker: it parses the merged PR's body and closes the
// referenced issues with a landing comment. The grammar is GitHub's own, plus
// this repo's claim spellings (`Claiming #N`): PR #617's body claimed five
// issues and closed none, because a claim is not a GitHub keyword.
//
// Run by .github/workflows/issue-autoclose.yml with the default Actions env
// (GITHUB_TOKEN, GITHUB_REPOSITORY) and the event payload PIPED ON STDIN —
// `node scripts/pr-auto-close.mjs < "$GITHUB_EVENT_PATH"` — so the module never
// opens a dynamic path (static scanners flag that pattern, and it was a Codacy
// finding on first landing). The pure parts (stripCode /
// parseClosingIssueRefs / buildComment) are exported for
// tests/pr-auto-close.test.ts — keep them side-effect free.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Remove fenced/inline code so an example like `` `Closes #7` `` in a PR body
 *  never closes a real issue (GitHub ignores keywords in code spans too). */
export function stripCode(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
}

// `#12`, `GH-12`, or a full issue URL — GitHub's three reference spellings.
const REF_RE = /^(?:(?:#|GH-)(\d+)|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+))/i
const SEP_RE = /^\s*(?:,\s*and\s+|,\s*|\s+and\s+|\s+)/

/** Issue numbers a text closes with its closing keywords and claims, deduped.
 *  Grammar matches GitHub — a keyword followed directly by one or
 *  more issue references joined by commas, whitespace or `and` — plus the
 *  claim spellings (`claim`, `claims`, `claiming`, `claimed`). A keyword with
 *  no reference directly after it binds nothing ("this fix closes the gap" —
 *  no match), and a reference with no keyword in front ("see #44") stays
 *  ignored. Like GitHub's own grammar, this reads no negation.
 */
export function parseClosingIssueRefs(text) {
  const clean = stripCode(text)
  const found = []
  // A literal per call, not a rebuilt module constant: global regexes carry
  // lastIndex state, and a fresh literal keeps callers independent. (A
  // `new RegExp(name.source)` also trips the non-literal-constructor lint.)
  const kw = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|claim(?:s|ing|ed)?)\s*:?\s*/gi
  let m
  while ((m = kw.exec(clean)) !== null) {
    let pos = kw.lastIndex
    for (;;) {
      const sep = SEP_RE.exec(clean.slice(pos))
      const afterSep = pos + (sep ? sep[0].length : 0)
      const ref = REF_RE.exec(clean.slice(afterSep))
      if (!ref) break
      found.push(Number(ref[1] ?? ref[2]))
      pos = afterSep + ref[0].length
    }
  }
  return [...new Set(found)]
}

/** The landing comment each mirrored close leaves behind. */
export function buildComment(prNumber, mergeSha) {
  return [
    `Closed automatically: PR #${prNumber} (merge \`${mergeSha}\`) merged into \`test\` and referenced this issue with a closing keyword or a work claim.`,
    '',
    "GitHub's closing keywords only auto-close issues on merges into the DEFAULT branch, so this workflow mirrors the tracker for the integration branch. Reopen if the fix needs follow-up.",
  ].join('\n')
}

async function main() {
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_REPOSITORY
  if (!token || !repo) {
    console.error('issue-autoclose: GITHUB_TOKEN and GITHUB_REPOSITORY are required')
    process.exitCode = 1
    return
  }
  // The event payload arrives on STDIN (fd 0 is a literal, so no scanner has
  // to reason about a dynamic path). The workflow pipes $GITHUB_EVENT_PATH in.
  const event = JSON.parse(readFileSync(0, 'utf8'))
  const pr = event.pull_request
  if (!pr?.merged) {
    console.log('issue-autoclose: not a merged PR — nothing to do')
    return
  }
  const refs = parseClosingIssueRefs(pr.body ?? '').filter(n => n !== pr.number)
  if (refs.length === 0) {
    console.log('issue-autoclose: no closing references in the PR body — nothing to do')
    return
  }
  const base = `https://api.github.com/repos/${repo}`
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'yatraflow-issue-autoclose',
    'x-github-api-version': '2022-11-28',
  }
  const sha = pr.merge_commit_sha ?? 'unknown'
  for (const n of refs) {
    const lookup = await fetch(`${base}/issues/${n}`, { headers })
    if (lookup.status === 404) { console.log(`issue-autoclose: #${n} not found — skipping`); continue }
    if (!lookup.ok) {
      console.error(`issue-autoclose: #${n} lookup failed — HTTP ${lookup.status}`)
      process.exitCode = 1
      continue
    }
    const issue = await lookup.json()
    if (issue.pull_request) { console.log(`issue-autoclose: #${n} is a pull request — skipping`); continue }
    if (issue.state === 'closed') { console.log(`issue-autoclose: #${n} already closed — skipping`); continue }
    const comment = await fetch(`${base}/issues/${n}/comments`, {
      method: 'POST', headers, body: JSON.stringify({ body: buildComment(pr.number, sha) }),
    })
    if (!comment.ok) {
      console.error(`issue-autoclose: #${n} comment failed — HTTP ${comment.status}`)
      process.exitCode = 1
      continue
    }
    const close = await fetch(`${base}/issues/${n}`, {
      method: 'PATCH', headers, body: JSON.stringify({ state: 'closed' }),
    })
    if (!close.ok) {
      console.error(`issue-autoclose: #${n} close failed — HTTP ${close.status}`)
      process.exitCode = 1
      continue
    }
    console.log(`issue-autoclose: #${n} closed via PR #${pr.number}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('issue-autoclose:', e); process.exit(1) })
}
