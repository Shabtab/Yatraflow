// ============ The fixture guard: a seed script stays off the live project ===========
// One run of scripts/seedCreatorFixture.mjs against the live project put fake
// "(fixture)" itineraries into the live sitemap, and it could also leave fake
// sales, accounts with a password committed in this repo, and a masteradmin.
// The rules are in scripts/fixtureGuard.mjs (pure, so this file can call it).
// The CLI runs its whole seed on import, so its wiring is pinned as source.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const guardPath = '../scripts/fixtureGuard.mjs'
const guard = await import(guardPath)

const REMOTE = 'https://abcdefgh.supabase.co'
const OWN_PASSWORD = 'a-long-own-password'
const check = (url: string, env: Record<string, string> = {}, flags: string[] = []) =>
  guard.checkFixtureTarget({ url, env, args: new Set(flags) })

describe('which hosts count as local', () => {
  it.each([
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
    'http://0.0.0.0:54321',
    'http://host.docker.internal:54321',
    'http://supabase.localhost:54321',
  ])('treats %s as local', (url) => {
    expect(guard.parseTarget(url)?.local).toBe(true)
  })

  it.each([
    REMOTE,
    'http://192.168.1.20:54321', // a LAN address can sit in front of someone else's project
    'http://10.0.0.5:54321',
    'https://localhost.example.com', // looks local, is not
    'https://example.com/localhost',
  ])('treats %s as remote', (url) => {
    expect(guard.parseTarget(url)?.local).toBe(false)
  })

  it('does not treat an unusable URL as local', () => {
    expect(guard.parseTarget('')).toBeNull()
    expect(guard.parseTarget('not a url')).toBeNull()
    const verdict = check('not a url')
    expect(verdict.ok).toBe(false)
    expect(verdict.problems[0]).toMatch(/not a valid URL/)
  })
})

describe('the decision to write', () => {
  it('lets a local project through with the default password', () => {
    const v = check('http://127.0.0.1:54321')
    expect(v.ok).toBe(true)
    expect(v.local).toBe(true)
    expect(v.promoteAdmin).toBe(true)
  })

  it('refuses a remote project by default, and says how to opt in', () => {
    const v = check(REMOTE)
    expect(v.ok).toBe(false)
    expect(v.host).toBe('abcdefgh.supabase.co')
    expect(v.problems.join(' ')).toContain('FIXTURE_ALLOW_REMOTE=abcdefgh.supabase.co')
  })

  it('wants the exact host typed, so a stale env file cannot approve a project', () => {
    for (const typed of ['true', '1', 'yes', 'other.supabase.co', 'supabase.co']) {
      expect(check(REMOTE, { FIXTURE_ALLOW_REMOTE: typed, FIXTURE_PASSWORD: OWN_PASSWORD }).ok).toBe(false)
    }
    expect(check(REMOTE, { FIXTURE_ALLOW_REMOTE: 'ABCDEFGH.supabase.co', FIXTURE_PASSWORD: OWN_PASSWORD }).ok).toBe(true)
  })

  it('refuses the public default password on a remote project', () => {
    const base = { FIXTURE_ALLOW_REMOTE: 'abcdefgh.supabase.co' }
    expect(check(REMOTE, base).ok).toBe(false) // no password set
    expect(check(REMOTE, { ...base, FIXTURE_PASSWORD: guard.FIXTURE_DEFAULT_PASSWORD }).ok).toBe(false)
    expect(check(REMOTE, { ...base, FIXTURE_PASSWORD: 'short' }).ok).toBe(false)
    expect(check(REMOTE, { ...base, FIXTURE_PASSWORD: OWN_PASSWORD }).ok).toBe(true)
  })

  it('needs --promote-admin to promote on a remote project only', () => {
    const allowed = { FIXTURE_ALLOW_REMOTE: 'abcdefgh.supabase.co', FIXTURE_PASSWORD: OWN_PASSWORD }
    expect(check(REMOTE, allowed).promoteAdmin).toBe(false)
    expect(check(REMOTE, allowed, ['--promote-admin']).promoteAdmin).toBe(true)
    expect(check('http://localhost:54321').promoteAdmin).toBe(true)
  })

  it('keeps the default password out of the CLI, so there is one source for it', () => {
    expect(read('../scripts/seedCreatorFixture.mjs')).not.toContain(guard.FIXTURE_DEFAULT_PASSWORD)
  })
})

describe('the CLI asks the guard before it writes', () => {
  const cli = read('../scripts/seedCreatorFixture.mjs')

  it('imports the guard and builds one verdict from the env and the flags', () => {
    expect(cli).toContain("from './fixtureGuard.mjs'")
    expect(cli).toContain('const GUARD = checkFixtureTarget(')
    expect(cli).toContain("FIXTURE_ALLOW_REMOTE: env('FIXTURE_ALLOW_REMOTE')")
  })

  it('stops --apply and --clean before either of them runs', () => {
    const refuse = cli.indexOf('(CLEAN || APPLY) && !GUARD.ok')
    const clean = cli.indexOf('await clean()')
    const apply = cli.indexOf('await apply()')
    expect(refuse).toBeGreaterThan(-1)
    expect(refuse).toBeLessThan(clean) // --clean signs the accounts up first, so it needs the guard too
    expect(refuse).toBeLessThan(apply)
    expect(cli.slice(refuse, clean)).toContain('process.exit(2)')
  })

  it('never blocks the dry run', () => {
    // The refusal needs --apply or --clean; a plain run reaches the dry-run branch.
    expect(cli).toContain('(CLEAN || APPLY) && !GUARD.ok')
    expect(cli).toContain('Dry run — nothing was written')
  })

  it('gates the admin promotion on both write paths', () => {
    expect(cli).toContain('GUARD.promoteAdmin ? await promoteMasteradmin(')
    expect(cli).toContain('GUARD.promoteAdmin ? adminPromotionSql(')
  })
})
