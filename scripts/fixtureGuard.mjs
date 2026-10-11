// ============================================================================
// YatraFlow — the fixture guard (a seed script must not reach the live project)
// ============================================================================
// WHY THIS EXISTS
//   `seedCreatorFixture.mjs` writes to whichever Supabase project `.env.local`
//   names. This repo has one live project, so one run against it put fake
//   publications ("pub-fixture-…", titled "(fixture)") into the live sitemap,
//   and could also leave fake sales, five accounts with a password committed in
//   this repo, and an admin promoted to `masteradmin`.
//
// THE RULE
//   A fixture writes to a LOCAL project by default. A remote project needs two
//   things the operator must type on purpose:
//     1. FIXTURE_ALLOW_REMOTE=<the exact host of the project URL>, so a stale
//        `.env.local` cannot approve a project the operator never named.
//     2. FIXTURE_PASSWORD set to your own value. The default password below
//        works on a local project only.
//   Promoting an account to `masteradmin` on a remote project also needs the
//   `--promote-admin` flag.
//   A dry run is never blocked: it writes nothing.
//
// This module is PURE: no I/O, no env reads, no network. The CLI passes the
// values in, and tests/fixture-guard.test.ts calls it directly. That is the
// `fixtureFunnelPlan.mjs` precedent: a CLI that runs on import cannot be tested.
// ============================================================================

/** The password every fixture account gets when FIXTURE_PASSWORD is not set.
 *  It is public (it is in this file), so it is accepted on a local project only. */
export const FIXTURE_DEFAULT_PASSWORD = 'yatraflow-fixture-2026'

const MIN_REMOTE_PASSWORD_LENGTH = 12

/** The hosts that mean "this machine". A LAN address is NOT local: another
 *  person's project can sit behind it. */
export function isLocalHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '')
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0.0.0.0' ||
    h === 'host.docker.internal' ||
    h.endsWith('.localhost')
  )
}

/** Parse the project URL. Returns null when it is not a usable URL. */
export function parseTarget(rawUrl) {
  try {
    const u = new URL(String(rawUrl))
    if (!u.hostname) return null
    return { host: u.hostname.toLowerCase(), local: isLocalHost(u.hostname) }
  } catch {
    return null
  }
}

/**
 * Decide whether the fixture may write to this project.
 *
 * @param {object} input
 * @param {string} input.url        VITE_SUPABASE_URL
 * @param {Record<string, string | undefined>} input.env   FIXTURE_ALLOW_REMOTE, FIXTURE_PASSWORD
 * @param {Set<string>} input.args  the CLI flags
 * @returns {{ ok: boolean, host: string, local: boolean, promoteAdmin: boolean, problems: string[] }}
 */
export function checkFixtureTarget({ url, env, args }) {
  const target = parseTarget(url)
  if (!target) {
    return {
      ok: false, host: '', local: false, promoteAdmin: false,
      problems: [`The project URL "${url}" is not a valid URL, so the fixture cannot tell where it would write.`],
    }
  }

  const problems = []
  if (!target.local) {
    const allowed = String(env.FIXTURE_ALLOW_REMOTE ?? '').trim().toLowerCase()
    if (allowed !== target.host) {
      problems.push(
        `This project is REMOTE (${target.host}). A fixture writes to a local project by default. ` +
          `To write here on purpose, set FIXTURE_ALLOW_REMOTE=${target.host}.`,
      )
    }
    const password = String(env.FIXTURE_PASSWORD ?? '')
    if (password === FIXTURE_DEFAULT_PASSWORD || password.length < MIN_REMOTE_PASSWORD_LENGTH) {
      problems.push(
        `A remote project needs your own FIXTURE_PASSWORD (at least ${MIN_REMOTE_PASSWORD_LENGTH} characters). ` +
          `The default password is public, because it is committed in this repo.`,
      )
    }
  }

  return {
    ok: problems.length === 0,
    host: target.host,
    local: target.local,
    // A local project may promote the admin freely. A remote one needs the flag.
    promoteAdmin: target.local || args.has('--promote-admin'),
    problems,
  }
}
