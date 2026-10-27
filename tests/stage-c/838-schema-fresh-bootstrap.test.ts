import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readSql = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const owner = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const trip = '20000000-0000-4000-8000-000000000001'

// A fresh bootstrap of supabase/schema.sql on a bare Postgres. The file is the
// documented no-CLI install path, so this harness runs it end to end instead
// of trusting a structural grep: %rowtype and trigger bodies only compile when
// the tables they reference exist. Only the hosted-environment pieces are
// stubbed (roles, the auth schema + uid() helper, the realtime publication).
describe('stage-c/838 schema.sql fresh bootstrap (F2)', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
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
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.role',true),'')
      $$;
      create function auth.email() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.email',true),'')
      $$;
      create publication supabase_realtime;
    `)
    await db.exec(readSql('supabase/schema.sql'))
    // Supabase's default privileges (not part of schema.sql) grant table and
    // routine access to the JWT roles; a fresh install gets these implicitly.
    await db.exec(`
      grant usage on schema public to anon, authenticated, service_role;
      grant all on all tables in schema public to anon, authenticated, service_role;
      grant all on all sequences in schema public to anon, authenticated, service_role;
      grant all on all functions in schema public to anon, authenticated, service_role;
    `)
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',
      [owner, 'owner@example.com', other, 'crew@example.com'])
  }, 60_000)

  afterAll(async () => db?.close())

  it('builds the restored Stage A cutover surface (table, prune, delete guards)', async () => {
    const surface = await db.query<{ rel: string; kind: string }>(`
      select 'table' as kind, to_regclass('public.trip_contribution_restore_events')::text as rel
      union all
      select 'function', to_regprocedure('public.prune_trip_contribution_restore_events()')::text
      union all
      select 'function', to_regprocedure('public.record_trip_contribution_delete()')::text
      union all
      select 'function', to_regprocedure('public.prune_collab_restore_for_profile()')::text
      union all
      select 'function', to_regprocedure('public.restore_trip_contributions(text)')::text`)
    for (const row of surface.rows) expect(row.rel, `${row.kind} missing`).toBeTruthy()
    const triggers = await db.query<{ tgname: string }>(`
      select tgname from pg_trigger where not tgisinternal
        and tgname in ('trips_record_contribution_delete','profiles_prune_collab_restore')
      order by tgname`)
    expect(triggers.rows.map(r => r.tgname)).toEqual(['profiles_prune_collab_restore', 'trips_record_contribution_delete'])
  })

  it('keeps the collab transition surface executable on the fresh install', async () => {
    // The on_auth_user_created trigger already made the profile rows when the
    // auth.users seed was inserted; seed the trip as the owner before the
    // role switch so RLS is exercised by the RPC calls themselves.
    await db.query('insert into public.trips(id,owner_id,name,days) values($1,$2,$3,$4::jsonb)',
      [trip, owner, 'Fresh trip', JSON.stringify([{ id: 'day-a', index: 0, title: 'Day 1', stops: [] }])])
    await db.query('insert into public.trip_members(trip_id,user_id,role) values($1,$2,$3)', [trip, owner, 'owner'])
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`)
    const created = await db.query<{ receipt: { status: string } }>(
      'select public.submit_collab_command($1,$2,$3::jsonb) as receipt',
      ['50000000-0000-4000-8000-000000000001', trip, JSON.stringify({
        type: 'suggestion.create', suggestionId: '30000000-0000-4000-8000-000000000001',
        suggestion: {
          dayIndex: 0, dayId: 'day-a', title: 'Museum', category: 'sightseeing', locationName: 'City Museum',
          lat: 12.9, lng: 77.6, description: '', visitMinutes: 45, estimatedEntryFeeInr: 0, estimatedTransportInr: 0,
          place: { source: 'google', placeId: 'fresh-museum', exposure: 'unknown' },
        },
      })])
    expect(created.rows[0].receipt.status).toBe('applied')
    const revision = await db.query<{ write_version: number }>('select write_version from public.trips where id=$1', [trip])
    const accepted = await db.query<{ receipt: { status: string; stopId?: string } }>(
      'select public.submit_collab_command($1,$2,$3::jsonb) as receipt',
      ['50000000-0000-4000-8000-000000000002', trip, JSON.stringify({
        type: 'suggestion.accept', suggestionId: '30000000-0000-4000-8000-000000000001',
        expectedRevision: revision.rows[0].write_version,
      })])
    expect(accepted.rows[0].receipt.status).toBe('applied')
    expect(typeof accepted.rows[0].receipt.stopId).toBe('string')
    await db.exec('reset role')
  })

  it('hard delete without pg_cron refuses loudly, not silently', async () => {
    // The SQL editor runs as the table owner with the user's claim set — that
    // is the documented direct-delete path the trigger must guard.
    await db.exec('reset role')
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`)
    await expect(db.query('delete from public.trips where id=$1', [trip]))
      .rejects.toThrow(/pg_cron|55000|Trash/)
    await db.exec('reset role')
    const alive = await db.query<{ n: number }>('select count(*)::int as n from public.trips where id=$1', [trip])
    expect(alive.rows[0].n).toBe(1)
  })
})

// The cutover policy contract (supabase/migrations/20261023b, mirrored in
// schema.sql and asserted by supabase/tests/rls_contract.test.sql §3, which no
// script runs). The fresh bootstrap must end in that same shape: no FOR ALL
// and no admin escape hatch on the collab tables, editor-scoped workflow
// updates, author-or-owner deletes, and an append-only activity trail.
describe('stage-c/838 fresh-bootstrap policy contract (F-1)', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
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
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.role',true),'')
      $$;
      create function auth.email() returns text language sql stable as $$
        select nullif(current_setting('request.jwt.claim.email',true),'')
      $$;
      create publication supabase_realtime;
    `)
    await db.exec(readSql('supabase/schema.sql'))
    await db.exec(`
      grant usage on schema public to anon, authenticated, service_role;
      grant all on all tables in schema public to anon, authenticated, service_role;
      grant all on all sequences in schema public to anon, authenticated, service_role;
      grant all on all functions in schema public to anon, authenticated, service_role;
    `)
  }, 60_000)

  afterAll(async () => db?.close())

  it('leaves no permissive FOR ALL and no admin write on suggestions, decisions or activity', async () => {
    // The RESTRICTIVE "deny disabled" FOR ALL is part of the base contract and
    // stays; rls_contract §3 only bans a PERMISSIVE FOR ALL here.
    const wrong = await db.query<{ tablename: string; policyname: string; cmd: string }>(`
      select tablename, policyname, cmd from pg_policies
      where schemaname = 'public'
        and tablename in ('suggestions', 'decisions', 'activity')
        and ((cmd = 'ALL' and permissive = 'PERMISSIVE') or policyname = 'admin write')`)
    expect(wrong.rows).toEqual([])
  })

  it('keeps activity append-only: no permissive write policy exists', async () => {
    const writes = await db.query<{ cmd: string; policyname: string }>(`
      select cmd, policyname from pg_policies
      where schemaname = 'public' and tablename = 'activity'
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and permissive = 'PERMISSIVE'`)
    expect(writes.rows).toEqual([])
    const reads = await db.query<{ policyname: string }>(`
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'activity' and cmd = 'SELECT'
      order by policyname`)
    expect(reads.rows.map(r => r.policyname)).toEqual(['activity read', 'admin read'])
  })

  it('scopes suggestions and decisions UPDATE to editors and DELETE to author or owner', async () => {
    for (const [table, author] of [['suggestions', 'proposed_by'], ['decisions', 'raised_by']] as const) {
      const updates = await db.query<{ qual: string; with_check: string }>(`
        select qual, with_check from pg_policies
        where schemaname = 'public' and tablename = $1 and cmd = 'UPDATE'`, [table])
      expect(updates.rows.length, `${table} UPDATE policy`).toBe(1)
      expect(updates.rows[0].qual).toContain('is_editor')
      expect(updates.rows[0].with_check).toContain('is_editor')
      const deletes = await db.query<{ qual: string; permissive: string }>(`
        select qual, permissive from pg_policies
        where schemaname = 'public' and tablename = $1 and cmd = 'DELETE'`, [table])
      expect(deletes.rows.length, `${table} DELETE policy`).toBe(1)
      expect(deletes.rows[0].permissive).toBe('PERMISSIVE')
      expect(deletes.rows[0].qual).toContain('is_editor')
      expect(deletes.rows[0].qual).toContain('auth.uid()')
      expect(deletes.rows[0].qual).toContain('owner_id')
      expect(deletes.rows[0].qual).toContain(author)
    }
  })

  it('blocks a non-owner editor peer delete in the live role, and allows author and owner', async () => {
    // Two editors and one author suggestion, seeded as the table owner. The
    // policy runs under set local role authenticated with each user's claim,
    // so this exercises the real predicate, not token presence.
    const authorId = '10000000-0000-4000-8000-000000000003'
    const editorId = '10000000-0000-4000-8000-000000000004'
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)',
      [owner, 'owner@example.com', authorId, 'author@example.com', editorId, 'editor@example.com'])
    // The on_auth_user_created trigger created the profiles; the trip insert
    // needs the owner profile for its foreign key.
    await db.query('insert into public.trips(id,owner_id,name,days) values($1,$2,$3,$4::jsonb)',
      [trip, owner, 'Policy trip', JSON.stringify([{ id: 'day-a', index: 0, title: 'Day 1', stops: [] }])])
    await db.query(`insert into public.trip_members(trip_id,user_id,role) values
      ($1,$2,'owner'),($1,$3,'editor'),($1,$4,'editor')`, [trip, owner, authorId, editorId])
    await db.query(`insert into public.suggestions(id,trip_id,proposed_by,title,category,location_name,
      lat,lng,description,visit_minutes,estimated_entry_fee_inr,estimated_transport_inr,status)
      values('30000000-0000-4000-8000-000000000010',$1,$2,'Peer spot','food','Cafe',
      12.9,77.6,'',30,0,0,'open')`, [trip, authorId])
    const asRole = async (uid: string, statement: string) => {
      await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${uid}',true);`)
      try { return (await db.query<{ id: string }>(statement)).rows } finally { await db.exec('rollback') }
    }
    // RLS blocks a peer delete silently, so the returned rows are the proof:
    // a blocked delete returns none, an allowed one returns its row.
    const peerDelete = 'delete from public.suggestions where id = \'30000000-0000-4000-8000-000000000010\' returning id'
    expect(await asRole(editorId, peerDelete)).toEqual([])
    expect((await asRole(authorId, peerDelete)).map(r => r.id))
      .toEqual(['30000000-0000-4000-8000-000000000010'])
    // The trip owner deletes a peer's suggestion: allowed by the owner branch.
    await db.query(`insert into public.suggestions(id,trip_id,proposed_by,title,category,location_name,
      lat,lng,description,visit_minutes,estimated_entry_fee_inr,estimated_transport_inr,status)
      values('30000000-0000-4000-8000-000000000011',$1,$2,'Second spot','food','Diner',
      12.91,77.61,'',30,0,0,'open')`, [trip, authorId])
    expect((await asRole(owner, 'delete from public.suggestions where id = \'30000000-0000-4000-8000-000000000011\' returning id')).map(r => r.id))
      .toEqual(['30000000-0000-4000-8000-000000000011'])
  })

  it('denies editor writes on the activity audit trail under the live role', async () => {
    const editorId = '10000000-0000-4000-8000-000000000004'
    await db.query(`insert into public.activity(id,trip_id,actor_id,verb,target) values
      ('60000000-0000-4000-8000-000000000001',$1,$2,'tested','suggestion')`,
      [trip, editorId])
    await db.exec(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${editorId}',true);`)
    // No permissive write policy exists, so the DML reaches no rows and the
    // audit row survives; a direct INSERT is refused because no write policy
    // exists to satisfy its WITH CHECK.
    expect((await db.query(`delete from public.activity where id='60000000-0000-4000-8000-000000000001' returning id`)).rows).toEqual([])
    expect((await db.query(`update public.activity set verb='rewritten' where id='60000000-0000-4000-8000-000000000001' returning id`)).rows).toEqual([])
    await expect(db.query(`insert into public.activity(id,trip_id,actor_id,verb)
      values('60000000-0000-4000-8000-000000000002',$1,$2,'forged')`, [trip, editorId]))
      .rejects.toThrow(/row-level security|violates/)
    await db.exec('rollback')
    await db.exec('reset role')
    const left = await db.query<{ n: number }>(`select count(*)::int as n from public.activity where id='60000000-0000-4000-8000-000000000001'`)
    expect(left.rows[0].n).toBe(1)
  })
})
