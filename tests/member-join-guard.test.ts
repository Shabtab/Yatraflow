// ============ Joining a trip goes through join_trip(), not a client insert ============
// The "members insert" policy used to accept a row for the caller's own user id,
// so any signed-in user could add themselves to any trip with any role. These
// pins hold the migration, its schema.sql mirror and the client on the server path.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

/** Normalised: this repo checks out CRLF on Windows (`core.autocrlf=true`). */
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const MIGRATION_FILE = '20261012_member_join_guard.sql'
const MIGRATION = read(`../supabase/migrations/${MIGRATION_FILE}`)
const SCHEMA = read('../supabase/schema.sql')
const STORE = read('../src/store/store.ts')

/** The text of one `create policy "<name>"` on trip_members, through its semicolon. */
function membersPolicy(sql: string, name: string): string {
  const start = sql.indexOf(`create policy "${name}" on public.trip_members`)
  expect(start, `the "${name}" policy must exist`).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf(';', start) + 1)
}

/** The join_trip definition, from its signature through its closing dollar quote. */
function joinTripDefinition(sql: string): string {
  const start = sql.indexOf('create or replace function public.join_trip(')
  expect(start, 'join_trip must be defined').toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf('$$;', start) + 3)
}

/** The source of one top-level function, from its header through the closing brace. */
function functionBody(src: string, header: string): string {
  const start = src.indexOf(header)
  expect(start, `${header} must exist`).toBeGreaterThan(-1)
  return src.slice(start, src.indexOf('\n}\n', start) + 3)
}

describe('join_trip migration', () => {
  const fn = joinTripDefinition(MIGRATION)

  it('is a security definer function with a pinned search_path', () => {
    const header = fn.slice(0, fn.indexOf('as $$'))
    expect(header).toMatch(/security definer/)
    expect(header).toMatch(/set search_path = public/)
  })

  it('adds the joiner as the literal role editor and keeps an existing member row', () => {
    expect(fn).toMatch(/insert into public\.trip_members[\s\S]*?'editor'/)
    expect(fn).toMatch(/on conflict \(trip_id, user_id\) do nothing/)
  })

  it('revokes from public and anon, then grants execute to authenticated', () => {
    const revoke = MIGRATION.search(/revoke all on function public\.join_trip\(text\) from public, anon/)
    const grant = MIGRATION.search(/grant execute on function public\.join_trip\(text\) to authenticated;/)
    expect(revoke).toBeGreaterThan(-1)
    expect(grant).toBeGreaterThan(revoke)
  })

  it('keeps the disabled-account block and the live, not-trashed, paywall guard', () => {
    expect(fn).toMatch(/public\.is_disabled\(\)/)
    expect(fn).toMatch(/t\.deleted_at is null/)
    expect(fn).toMatch(/premium_price_inr/)
  })
})

describe('members insert policy', () => {
  it('drops the old policy before it creates the new one', () => {
    const drop = MIGRATION.indexOf('drop policy if exists "members insert" on public.trip_members;')
    const create = MIGRATION.indexOf('create policy "members insert" on public.trip_members')
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
  })

  it('the migration recreates the policy with the owner branch only', () => {
    const policy = membersPolicy(MIGRATION, 'members insert')
    expect(policy).toMatch(/owner_id = auth\.uid\(\)/)
    expect(policy).not.toMatch(/user_id = auth\.uid\(\)/)
  })

  it('schema.sql carries the same owner-only policy shape', () => {
    const policy = membersPolicy(SCHEMA, 'members insert')
    expect(policy).toMatch(/owner_id = auth\.uid\(\)/)
    expect(policy).not.toMatch(/user_id = auth\.uid\(\)/)
  })

  it('no migration re-adds a self-join branch to the insert policy', () => {
    const dir = new URL('../supabase/migrations/', import.meta.url)
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
      const sql = readFileSync(new URL(file, dir), 'utf8').replace(/\r\n/g, '\n')
      if (!sql.includes('create policy "members insert" on public.trip_members')) continue
      expect(membersPolicy(sql, 'members insert'), `${file} re-adds a self-join branch`).not.toMatch(/user_id = auth\.uid\(\)/)
    }
  })
})

describe('schema.sql mirror of join_trip', () => {
  it('defines the same function text as the migration', () => {
    expect(joinTripDefinition(SCHEMA)).toBe(joinTripDefinition(MIGRATION))
  })

  it('carries the same revoke and grant lines', () => {
    expect(SCHEMA).toMatch(/revoke all on function public\.join_trip\(text\) from public, anon, authenticated;/)
    expect(SCHEMA).toMatch(/grant execute on function public\.join_trip\(text\) to authenticated;/)
  })
})

describe('joinViaInvite client path', () => {
  const body = functionBody(STORE, 'export async function joinViaInvite(')

  it('joins through the join_trip RPC', () => {
    expect(body).toMatch(/\.rpc\('join_trip'/)
  })

  it('no longer writes the membership row itself', () => {
    expect(body).not.toContain(".from('trip_members').insert({ trip_id: tripId, user_id: userId, role")
    expect(body).not.toMatch(/\.from\('trip_members'\)\.insert/)
  })

  it('takes no role argument, so a caller cannot pick one', () => {
    expect(STORE).toMatch(/export async function joinViaInvite\(tripId: ID, userId: ID\): Promise<boolean>/)
  })
})
