// ============ Joining a trip goes through join_trip(), by invite code only ============
// The "members insert" policy used to accept a row for the caller's own user id,
// so any signed-in user could add themselves to any trip with any role. A trip id
// also revealed the invite code. These pins hold the two migration steps, the
// schema.sql mirror, the trip-id preview and the client on the server path.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

/** Normalised: this repo checks out CRLF on Windows (`core.autocrlf=true`). */
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// The fix ships as two files. The add step runs before the app deploy. The
// tighten step runs after the new app is live. Each file's header says so.
const ADD_FILE = '20261012a_join_trip_function.sql'
const TIGHTEN_FILE = '20261012b_member_insert_owner_only.sql'
const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url)
const ADD_SQL = read(`../supabase/migrations/${ADD_FILE}`)
const TIGHTEN_SQL = read(`../supabase/migrations/${TIGHTEN_FILE}`)
const SCHEMA = read('../supabase/schema.sql')
const STORE = read('../src/store/store.ts')
const APP = read('../src/App.tsx')
const SHARE_TAB = read('../src/pages/trip/ShareTab.tsx')

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

describe('the fix ships as an add step, then a tighten step', () => {
  it('runs in name order: the add step first, the tighten step second', () => {
    expect([ADD_FILE, TIGHTEN_FILE].slice().sort()).toEqual([ADD_FILE, TIGHTEN_FILE])
  })

  it('the add step creates the function and changes no policy', () => {
    expect(ADD_SQL).not.toMatch(/(create|drop) policy/)
    expect(ADD_SQL).toMatch(/create or replace function public\.join_trip\(p_code text\)/)
  })

  it('the tighten step carries no join function', () => {
    expect(TIGHTEN_SQL).not.toMatch(/function public\.join_trip/)
    expect(TIGHTEN_SQL).toMatch(/drop policy if exists "members insert" on public\.trip_members;/)
  })

  it('the old combined file is gone', () => {
    const files = readdirSync(MIGRATIONS)
    expect(files).not.toContain('20261012_member_join_guard.sql')
    expect(files).toContain(ADD_FILE)
    expect(files).toContain(TIGHTEN_FILE)
  })
})

describe('join_trip (add step)', () => {
  const fn = joinTripDefinition(ADD_SQL)

  it('is a security definer function with a pinned search_path', () => {
    const header = fn.slice(0, fn.indexOf('as $$'))
    expect(header).toMatch(/security definer/)
    expect(header).toMatch(/set search_path = public/)
  })

  it('takes the invite code as p_code, and never a trip id', () => {
    expect(fn.slice(0, fn.indexOf('as $$'))).toMatch(/join_trip\(p_code text\)/)
    expect(fn).toMatch(/upper\(t\.invite_code\) = v_key/)
    expect(fn).not.toMatch(/\[0-9A-F\]\{8\}|::uuid|v_as_uuid|public\.is_member|t\.visibility|premium_price_inr/)
  })

  it('adds a new joiner as editor, the trip owner as owner, and keeps an existing row', () => {
    expect(fn).toMatch(/insert into public\.trip_members[\s\S]*?'editor'/)
    expect(fn).toMatch(/case when v_is_owner then 'owner' else 'editor' end/)
    expect(fn).toMatch(/on conflict \(trip_id, user_id\) do nothing/)
  })

  it('drops the old join_trip signature before it creates the new one', () => {
    const drop = ADD_SQL.indexOf('drop function if exists public.join_trip(text);')
    const create = ADD_SQL.indexOf('create or replace function public.join_trip(')
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
  })

  it('revokes from public, anon and authenticated, then grants execute to authenticated', () => {
    const revoke = ADD_SQL.search(/revoke all on function public\.join_trip\(text\) from public, anon, authenticated;/)
    const grant = ADD_SQL.search(/grant execute on function public\.join_trip\(text\) to authenticated;/)
    expect(revoke).toBeGreaterThan(-1)
    expect(grant).toBeGreaterThan(revoke)
  })

  it('keeps the disabled-account block and the not-trashed filter', () => {
    expect(fn).toMatch(/public\.is_disabled\(\)/)
    expect(fn).toMatch(/t\.deleted_at is null/)
  })
})

describe('get_invite_trip withholds the invite code (tighten step)', () => {
  const start = TIGHTEN_SQL.indexOf('create or replace function public.get_invite_trip(')

  it('is redefined with the same signature and the same grants', () => {
    expect(start).toBeGreaterThan(-1)
    expect(TIGHTEN_SQL).toMatch(/grant execute on function public\.get_invite_trip\(uuid\) to anon, authenticated;/)
  })

  it('clears the code before the row leaves the function', () => {
    expect(TIGHTEN_SQL.slice(start)).toMatch(/v_trip\.invite_code := null;/)
  })

  it('keeps the visibility and paywall guard and the not-trashed filter', () => {
    const body = TIGHTEN_SQL.slice(start)
    expect(body).toMatch(/premium_price_inr/)
    expect(body).toMatch(/t\.deleted_at is null/)
  })
})

describe('members insert policy (tighten step)', () => {
  it('drops the old policy before it creates the new one', () => {
    const drop = TIGHTEN_SQL.indexOf('drop policy if exists "members insert" on public.trip_members;')
    const create = TIGHTEN_SQL.indexOf('create policy "members insert" on public.trip_members')
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
  })

  it('recreates the policy with the owner branch only', () => {
    const policy = membersPolicy(TIGHTEN_SQL, 'members insert')
    expect(policy).toMatch(/owner_id = auth\.uid\(\)/)
    expect(policy).not.toMatch(/user_id = auth\.uid\(\)/)
  })

  it('schema.sql carries the same owner-only policy shape', () => {
    const policy = membersPolicy(SCHEMA, 'members insert')
    expect(policy).toMatch(/owner_id = auth\.uid\(\)/)
    expect(policy).not.toMatch(/user_id = auth\.uid\(\)/)
  })

  it('no migration re-adds a self-join branch to the insert policy', () => {
    for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql'))) {
      const sql = read(`../supabase/migrations/${file}`)
      if (!sql.includes('create policy "members insert" on public.trip_members')) continue
      expect(membersPolicy(sql, 'members insert'), `${file} re-adds a self-join branch`).not.toMatch(/user_id = auth\.uid\(\)/)
    }
  })
})

describe('schema.sql mirror of join_trip', () => {
  it('defines the same function text as the add step', () => {
    expect(joinTripDefinition(SCHEMA)).toBe(joinTripDefinition(ADD_SQL))
  })

  it('carries the same revoke and grant lines', () => {
    expect(SCHEMA).toMatch(/revoke all on function public\.join_trip\(text\) from public, anon, authenticated;/)
    expect(SCHEMA).toMatch(/grant execute on function public\.join_trip\(text\) to authenticated;/)
  })
})

describe('joinViaInvite client path', () => {
  const body = functionBody(STORE, 'export async function joinViaInvite(')

  it('joins through the join_trip RPC, sending the invite code', () => {
    expect(body).toMatch(/\.rpc\('join_trip', \{ p_code: inviteCode \}\)/)
  })

  it('no longer writes the membership row itself', () => {
    expect(body).not.toContain(".from('trip_members').insert({ trip_id: tripId, user_id: userId, role")
    expect(body).not.toMatch(/\.from\('trip_members'\)\.insert/)
  })

  it('takes the invite code and no role argument', () => {
    expect(STORE).toMatch(/export async function joinViaInvite\(tripId: ID, userId: ID, inviteCode: string\): Promise<boolean>/)
  })

  it('fails closed on a null answer or an answer naming another trip', () => {
    expect(body).toMatch(/if \(!joinedTripId \|\| String\(joinedTripId\)\.toLowerCase\(\) !== tripId\.toLowerCase\(\)\) return false/)
  })
})

describe('viewerIsMemberOf reads only the viewer membership', () => {
  const body = functionBody(STORE, 'export async function viewerIsMemberOf(')

  it('reads trip_members and never the invite code', () => {
    expect(body).toMatch(/from\('trip_members'\)/)
    expect(body).not.toMatch(/invite_code|inviteCode/)
  })
})

describe('the invite screens never join by trip id', () => {
  it('InviteGate refuses a trip-id link for a non-member and joins by code', () => {
    expect(APP).toMatch(/if \(isTripIdLink\) \{/)
    expect(APP).toMatch(/This link no longer adds people/)
    expect(APP).toMatch(/joinViaInvite\(trip\.id, me\.id, trip\.inviteCode \?\? linkTarget\)/)
  })

  it('ShareTab never falls back to a trip-id link', () => {
    expect(SHARE_TAB).not.toMatch(/\/invite\/\$\{trip\.id\}/)
    expect(SHARE_TAB).toMatch(/Try again/)
  })
})
