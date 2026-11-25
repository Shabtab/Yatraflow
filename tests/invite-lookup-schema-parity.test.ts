// ============ #1020 — the invite lookup in schema.sql answers like the live one ============
//
// `supabase/schema.sql` is the second build path: a fresh database can be built
// from that file alone. It held the pre-paywall `select t.*` body of
// get_trip_by_invite_code long after the live function grew its paywall, its
// trash filter and its approved projection, so a fresh install resolved a priced
// plan for anyone who held the invite code.
//
// Two copies exist on purpose. The live one (the newest migration) is
// `language sql`, and a sql body is validated at CREATE time. schema.sql
// deliberately never creates the payments rail (see the DEFERRED table in
// tests/trip-owner-delete-guards.test.ts), so a verbatim sql copy fails the
// whole bootstrap with "relation does not exist". So the schema copy is
// plpgsql, and it guards the one rail table with to_regclass, the same pattern
// trip_has_publication_money uses. The parity this file pins is the meaning:
// the same projection, the same gates, the same grants.
//
// The second half runs the function on a schema-only PGlite database. A source
// scan cannot prove what an anon caller receives.
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const NAME = 'get_trip_by_invite_code'
const MIGRATION = '20261124c_invite_preview_write_version.sql'
const migration = read(`supabase/migrations/${MIGRATION}`)
const schema = read('supabase/schema.sql')

/** The definition of the function in a source file, comments included. */
function definition(source: string): string {
  const start = source.indexOf(`create or replace function public.${NAME}(`)
  if (start < 0) return ''
  const end = source.indexOf('$$;', start)
  return end < 0 ? '' : source.slice(start, end + 3)
}

/** Code only, with every whitespace run collapsed, so a fragment is found whatever the indentation. */
const flat = (sql: string) => sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The approved projection: the column names the caller receives, left to right.
 *
 * This list is what an anon caller may receive, so an added, dropped or
 * reordered column is a disclosure change and not a style change.
 */
function projection(sql: string): string[] {
  const body = flat(sql)
  const start = body.indexOf('jsonb_build_object(')
  const end = body.indexOf(') as projected', start)
  if (start < 0 || end < 0) return []
  return [...body.slice(start, end).matchAll(/'([a-z_]+)', (?:t|v_row)\.[a-z_]+/g)].map(match => match[1])
}

const liveBody = definition(migration)
const schemaBody = definition(schema)

describe('#1020 schema.sql invite lookup matches the live definition', () => {
  it('the newest migration that defines the function is the one this test reads', () => {
    const defining = readdirSync('supabase/migrations')
      .filter(name => name.endsWith('.sql'))
      .sort()
      .filter(name => read(`supabase/migrations/${name}`).includes(`function public.${NAME}(`))
    expect(defining.at(-1), 'a newer migration redefines the function: update MIGRATION and this test').toBe(MIGRATION)
  })

  it('both copies exist and declare the same signature and safety', () => {
    expect(liveBody).not.toBe('')
    expect(schemaBody).not.toBe('')
    for (const [label, body] of [['the migration', liveBody], ['schema.sql', schemaBody]] as const) {
      const text = flat(body)
      expect(text, label).toContain('returns setof public.trips')
      expect(text, label).toContain('security definer')
      expect(text, label).toContain('set search_path = public')
      expect(text, label).toContain(' stable ')
    }
  })

  it('both copies project the same 33 columns in the same order', () => {
    const live = projection(migration)
    expect(live).toHaveLength(33)
    expect(new Set(live).size).toBe(33)
    expect(projection(schema)).toEqual(live)
  })

  it('both copies hold the same gates', () => {
    const gates = [
      'upper(t.invite_code) = upper(trim(p_code))',
      't.deleted_at is null',
      'owner_id = auth.uid()',
      'public.is_member(',
      'public.is_admin()',
      "visibility = 'private'",
      'coalesce(p.premium_price_inr, 0) > 0',
      'p.creator_id = auth.uid()',
      'public.entitlements',
      'e.user_id = auth.uid()',
    ]
    for (const gate of gates) {
      expect(flat(liveBody), `the migration must keep: ${gate}`).toContain(gate)
      expect(flat(schemaBody), `schema.sql must keep: ${gate}`).toContain(gate)
    }
  })

  it('schema.sql drops the unfiltered body, and defers the rail table from a plpgsql body', () => {
    const text = flat(schemaBody)
    expect(text).not.toContain('select t.*')
    expect(text).toContain('language plpgsql')
    expect(flat(liveBody)).toContain('language sql')
    // A deferred relation is legal only inside plpgsql, and only behind a guard
    // that keeps a schema-only build valid.
    const guard = text.indexOf("to_regclass('public.entitlements') is not null")
    const readOfTable = text.indexOf('from public.entitlements e')
    expect(guard).toBeGreaterThan(-1)
    expect(readOfTable, 'the entitlements read must sit after its guard').toBeGreaterThan(guard)
  })

  it('both copies carry the same grants and revokes', () => {
    for (const [label, source] of [['the migration', migration], ['schema.sql', schema]] as const) {
      expect(source, label).toContain(`revoke all on function public.${NAME}(text) from public;`)
      expect(source, label).toContain(`grant execute on function public.${NAME}(text) to anon, authenticated;`)
    }
  })
})

describe('#1020 the invite lookup answers with the live gates on a schema-only build', () => {
  const OWNER = '10000000-0000-4000-8000-000000000001'
  const BUYER = '10000000-0000-4000-8000-000000000002'
  const STRANGER = '10000000-0000-4000-8000-000000000003'
  const PRIVATE_TRIP = '20000000-0000-4000-8000-000000000001'
  const PRICED_TRIP = '20000000-0000-4000-8000-000000000002'
  const PUB = 'pub_invite_1020'
  const codes: Record<string, string> = {}
  let db: PGlite

  /** Runs one statement as a caller, so RLS and the JWT subject behave as they do in the app. */
  async function asCaller<T>(role: 'anon' | 'authenticated', actor: string, sql: string, args: unknown[] = []) {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor])
    await db.exec(`set role ${role}`)
    try {
      return await db.query<T>(sql, args)
    } finally {
      await db.exec('reset role')
    }
  }

  /** The rows the function returns to this caller, as PostgREST sends them. */
  async function rowsFor(actor: string, code: string): Promise<Array<Record<string, unknown>>> {
    const result = await asCaller<{ row: string }>(
      'anon',
      actor,
      'select row_to_json(r)::text as row from public.get_trip_by_invite_code($1) r',
      [code],
    )
    return result.rows.map(row => JSON.parse(row.row) as Record<string, unknown>)
  }

  beforeAll(async () => {
    db = new PGlite()
    // Only the hosted pieces are stubbed: the roles, the auth schema and its
    // helpers, and the realtime publication. The file itself builds the rest.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema auth;
      create table auth.users(
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb,
        raw_app_meta_data jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
      $$;
      create publication supabase_realtime;
    `)
    await db.exec(schema)
    // Supabase's default privileges are not part of schema.sql.
    await db.exec(`
      grant usage on schema public to anon, authenticated, service_role;
      grant all on all tables in schema public to anon, authenticated, service_role;
      grant all on all sequences in schema public to anon, authenticated, service_role;
      grant all on all functions in schema public to anon, authenticated, service_role;
    `)
    for (const id of [OWNER, BUYER, STRANGER]) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@synthetic.invalid`])
    }
    await db.query('insert into public.trips(id,owner_id,name,visibility) values($1,$2,$3,$4)', [PRIVATE_TRIP, OWNER, 'Code trip', 'private'])
    await db.query('insert into public.trips(id,owner_id,name,visibility) values($1,$2,$3,$4)', [PRICED_TRIP, OWNER, 'Priced trip', 'public'])
    await db.query(
      `insert into public.published_itineraries(id,trip_id,creator_id,title,premium_price_inr,free_day_indexes)
       values($1,$2,$3,$4,$5,$6::jsonb)`,
      [PUB, PRICED_TRIP, OWNER, 'Priced trip', 499, '[0]'],
    )
    // A direct write cannot set an invite code (guard_trip_invite nulls it on
    // insert), so each code is minted through the access command, as the app does.
    for (const trip of [PRIVATE_TRIP, PRICED_TRIP]) {
      for (const action of ['bootstrap', 'invite']) {
        await asCaller('authenticated', OWNER, 'select public.change_trip_access($1,$2,null,null,null) as result', [trip, action])
      }
      const state = await asCaller<{ state: { inviteCode: string } }>(
        'authenticated',
        OWNER,
        'select public.trip_access_state($1) as state',
        [trip],
      )
      codes[trip] = state.rows[0].state.inviteCode
    }
  }, 60_000)

  afterAll(async () => db?.close())

  it('a private trip resolves by code, and the row carries write_version', async () => {
    const rows = await rowsFor('', codes[PRIVATE_TRIP])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Code trip')
    const stored = await db.query<{ write_version: number }>(
      'select write_version from public.trips where id=$1',
      [PRIVATE_TRIP],
    )
    // A JSON number, because the client checks it before it renders a preview.
    expect(typeof rows[0].write_version).toBe('number')
    expect(rows[0].write_version).toBe(stored.rows[0].write_version)
  })

  it('a trashed trip resolves for nobody', async () => {
    await db.query('update public.trips set deleted_at=now() where id=$1', [PRIVATE_TRIP])
    expect(await rowsFor('', codes[PRIVATE_TRIP])).toEqual([])
    await db.query('update public.trips set deleted_at=null where id=$1', [PRIVATE_TRIP])
    expect(await rowsFor('', codes[PRIVATE_TRIP])).toHaveLength(1)
  })

  it('a priced publication hides the trip from a caller who cannot be a buyer', async () => {
    // No payments rail exists in this build, so no entitlement row can exist.
    expect(await rowsFor(STRANGER, codes[PRICED_TRIP])).toEqual([])
    // The owner and the publication's creator still resolve it.
    expect(await rowsFor(OWNER, codes[PRICED_TRIP])).toHaveLength(1)
  })

  it('a buyer resolves it once the payments rail exists, and a stranger still does not', async () => {
    // The rail arrives after the bootstrap, as a migration would. This is the
    // branch the to_regclass guard defers, so it must work once it is reached.
    await db.exec('create table public.entitlements(pub_id text, user_id uuid)')
    await db.query('insert into public.entitlements(pub_id,user_id) values($1,$2)', [PUB, BUYER])
    expect(await rowsFor(BUYER, codes[PRICED_TRIP])).toHaveLength(1)
    expect(await rowsFor(STRANGER, codes[PRICED_TRIP])).toEqual([])
  })
})
