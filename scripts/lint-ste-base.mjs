// Chooses the commit that a default lint:ste run diffs from (AGENTS.md §2 rule 13).
// The caller passes the git lookups in, so a test can answer them without a repository.
//
// The order is the same for every default run. The first ref that exists sets
// the base. A pull request names its target in GITHUB_BASE_REF, and that ref
// comes first. Otherwise origin/test comes first.
//
// Outside CI, a missing first ref falls back to origin/main, then to HEAD~1.
// If no ref exists, the run checks uncommitted lines only, with a warning.
// Under CI, a missing first ref stops the gate. It never falls back there, so a
// CI misconfiguration cannot switch the check off.
//
// A ref that exists but shares no history with HEAD stops the gate everywhere.
// The gate does not guess a range in that case.

export class GateError extends Error {}

const DEFAULT_TARGET = 'origin/test'
const FALLBACK_TARGET = 'origin/main'

// Returns the merge base of ref and HEAD. No merge base means a shallow clone
// or unrelated history, so this throws instead of returning a guess.
export function requireMergeBase(ref, mergeBaseOf) {
  const sha = mergeBaseOf(ref)
  if (!sha) {
    throw new GateError(`${ref} and HEAD have no merge base: shallow clone or unrelated history; run \`git fetch --unshallow\`.`)
  }
  return sha
}

// Returns { sha, label, warning }. The sha is the diff base. The label names
// the base in the report. The warning is empty unless a fallback was used.
export function chooseLintBase({ env, commitOf, mergeBaseOf }) {
  const ci = Boolean(env.CI)
  const first = env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : DEFAULT_TARGET
  const ladder = ci ? [first] : [first, FALLBACK_TARGET]
  const missing = []
  for (const ref of ladder) {
    if (!commitOf(ref)) {
      missing.push(ref)
      continue
    }
    const sha = requireMergeBase(ref, mergeBaseOf)
    return { sha, label: `changed lines vs merge base with ${ref} (${short(sha)})`, warning: fallbackWarning(missing, ref) }
  }
  if (ci) {
    throw new GateError(`${first} not found under CI, so the gate cannot run. Fetch the full history (fetch-depth: 0).`)
  }
  const parent = commitOf('HEAD~1')
  if (parent) {
    return { sha: parent, label: `changed lines since HEAD~1 (${short(parent)})`, warning: fallbackWarning(missing, 'HEAD~1') }
  }
  return {
    sha: 'HEAD',
    label: 'uncommitted lines only, because no base commit exists',
    warning: fallbackWarning(missing, 'uncommitted lines only'),
  }
}

// The warning names each missing ref, the base used in its place, and the
// command that fetches the first missing ref. It is empty when nothing is missing.
function fallbackWarning(missing, used) {
  if (missing.length === 0) return ''
  const names = missing.map((ref) => `${ref} not found`).join(', ')
  const branch = missing[0].replace(/^origin\//, '')
  return `STE100: WARNING: ${names}. Using ${used} instead. Run: git fetch origin ${branch}`
}

function short(sha) {
  return sha.slice(0, 7)
}
