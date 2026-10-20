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
const INVITE_LIB = read('../src/lib/inviteCode.ts')

/** The first capture group of a pattern. A missing match fails the test. */
function captured(src: string, pattern: RegExp): string {
  const found = pattern.exec(src)
  expect(found, `${pattern} must match`).not.toBeNull()
  return found?.[1] ?? ''
}

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

  it('the add step changes no trip row and carries no preview', () => {
    expect(ADD_SQL).not.toMatch(/update\s+public\.trips/)
    expect(ADD_SQL).not.toMatch(/get_invite_trip/)
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

describe('invite codes re-issued for published trips (tighten step)', () => {
  const start = TIGHTEN_SQL.indexOf('do $$')
  const body = TIGHTEN_SQL.slice(start)
  const TAIL = captured(INVITE_LIB, /TAIL_ALPHABET = '([A-Z0-9]+)'/)

  it('runs as one DO block after get_invite_trip is redefined', () => {
    expect(start).toBeGreaterThan(-1)
    expect(start).toBeGreaterThan(TIGHTEN_SQL.indexOf('create or replace function public.get_invite_trip('))
  })

  it('targets trips with a code that back a publication, by query', () => {
    expect(body).toMatch(/where t\.invite_code is not null\s+and t\.id in \(select p\.trip_id from public\.published_itineraries p\)/)
  })

  it('draws the tail from the client alphabet, the client length and the client bias limit', () => {
    expect(captured(body, /v_alphabet text := '([A-Z0-9]+)'/)).toBe(TAIL)
    expect(INVITE_LIB).toMatch(/const TAIL_LENGTH = 8$/m)
    expect(body).toMatch(/length\(v_tail\) < 8/)
    expect(Number(captured(body, /v_limit\s+int := (\d+);/))).toBe(Math.floor(256 / TAIL.length) * TAIL.length)
  })

  it('builds the head the way slugifyHead does, with the same fallbacks', () => {
    expect(INVITE_LIB).toMatch(/\.replace\(\/\[\^A-Z0-9\]\+\/g, ''\)/)
    expect(body).toMatch(/regexp_replace\(upper\(v_trip\.name\), '\[\^A-Z0-9\]\+', '', 'g'\), 10\)/)
    expect(body).toMatch(/'YATRA'/)
  })

  it('draws bytes from gen_random_uuid(), never from random()', () => {
    expect(body).toMatch(/gen_random_uuid\(\)/)
    expect(body).not.toMatch(/\brandom\(\)/)
  })

  it('retries a unique clash, and writes each trip at most once per attempt', () => {
    expect(body).toMatch(/exception when unique_violation then/)
    expect(body.match(/update public\.trips set invite_code/g)).toHaveLength(1)
  })

  it('touches no membership row', () => {
    expect(TIGHTEN_SQL).not.toMatch(/(update|delete\s+from|insert\s+into)\s+public\.trip_members/)
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
    // #804 — an optional 4th argument carries the preview name for the owner
    // notification. The preview is no longer cached, so the store cannot read
    // the name itself. The role is still server-decided and never a parameter.
    expect(STORE).toMatch(/export async function joinViaInvite\([\s\S]{0,80}inviteCode: string,[\s\S]{0,40}previewName\?: string/)
    expect(STORE).not.toMatch(/joinViaInvite\([^)]*role:\s*TripMember\['role'\]/)
  })

  it('fails closed on a null answer or an answer naming another trip', () => {
    // #804 — the function now returns 'joined' | 'joined-unloaded' | 'failed', so
    // a refusal is the distinct 'failed' state rather than a bare false.
    expect(body).toMatch(/if \(!joinedTripId \|\| String\(joinedTripId\)\.toLowerCase\(\) !== tripId\.toLowerCase\(\)\) return 'failed'/)
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
    // #804 — the trip-id branch is now its own identity-guarded effect rather
    // than an inline `if (isTripIdLink)` inside the join effect. It still never
    // joins: it checks membership and either opens the trip or says the link is
    // retired.
    expect(APP).toMatch(/if \(!me \|\| !trip \|\| !isTripIdLink\) return/)
    expect(APP).toMatch(/viewerIsMemberOf\(trip\.id, me\.id\)/)
    expect(APP).toMatch(/This link no longer adds people/)
    // The join path still passes the code, never the trip id.
    expect(APP).toMatch(/joinViaInvite\(tripId, userId, inviteCode \?\? ''/)
  })

  it('ShareTab never falls back to a trip-id link', () => {
    expect(SHARE_TAB).not.toMatch(/\/invite\/\$\{trip\.id\}/)
    expect(SHARE_TAB).toMatch(/Try again/)
  })
})
