import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

// #936 member consent boundary, file 1 (20261124a). The fixture follows
// tests/member-access-boundary.test.ts, with one difference: it also rebuilds
// the trip_members policies that were live before file 1. Without them, a
// check that the policies are gone would pass without testing anything.
const schema = readFileSync('supabase/schema.sql', 'utf8')
const base = readFileSync('supabase/migrations/20261115_member_access_boundary.sql', 'utf8')
const consent = readFileSync('supabase/migrations/20261124a_member_consent_boundary.sql', 'utf8')
const owner = '10000000-0000-4000-8000-000000000001'
const member = '10000000-0000-4000-8000-000000000002'
const stranger = '10000000-0000-4000-8000-000000000003'
const extra = '10000000-0000-4000-8000-000000000004'
const trip = '20000000-0000-4000-8000-000000000001' // owner plus an active member, from the fixture
const tripB = '20000000-0000-4000-8000-000000000002' // hand-over
const tripC = '20000000-0000-4000-8000-000000000003' // deleted, then the same id reused
const tripD = '20000000-0000-4000-8000-000000000004' // operator path

type State = {
  version: number
  planVersion: number
  inviteCode: string | null
  members: Array<{ userId: string; role: string; revision: number }>
  removed: Array<{ userId: string; revision: number }>
}

function table(name: string): string {
  const start = schema.indexOf(`create table if not exists public.${name} (`)
  const end = start < 0 ? -1 : schema.indexOf('\n);', start)
  if (start < 0 || end < 0) throw new Error(`Missing table ${name}`)
  return schema.slice(start, end + 3)
}

describe('member consent boundary through actual SQL (#936, file 1)', () => {
  let db: PGlite

  // Runs SQL as the authenticated role. An empty actor means no JWT subject.
  const asUser = async <T>(actor: string, sql: string, args: unknown[] = []) => {
    await db.query("select set_config('test.uid',$1,false)", [actor])
    await db.exec('set role authenticated')
    try { return await db.query<T>(sql, args) } finally { await db.exec('reset role') }
  }
  const stateOf = async (actor: string, tripId: string) =>
    (await asUser<{ state: State }>(actor, 'select public.trip_access_state($1) as state', [tripId])).rows[0].state
  const command = (actor: string, tripId: string, action: string, userId: string | null = null, revision: number | null = null) =>
    asUser<{ result: { status: string } }>(actor, 'select public.change_trip_access($1,$2,$3,null,$4) as result', [tripId, action, userId, revision])
  const revisionOf = async (tripId: string, userId: string) =>
    (await db.query<{ revision: number }>('select revision from public.trip_member_access where trip_id=$1 and user_id=$2', [tripId, userId])).rows[0].revision
  const seedTrip = async (tripId: string) => {
    await asUser(owner, 'insert into public.trips(id,owner_id,name) values($1,$2,$3)', [tripId, owner, 'Synthetic trip'])
    await command(owner, tripId, 'bootstrap')
  }
  const joinTrip = async (tripId: string, actor: string) => {
    await command(owner, tripId, 'invite')
    await asUser(actor, 'select public.join_trip($1)', [(await stateOf(owner, tripId)).inviteCode])
  }

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated,anon;`)
    for (const name of ['profiles', 'trips', 'trip_members']) await db.exec(table(name))
    await db.exec(`create function public.is_disabled() returns boolean language sql stable security definer as $$ select coalesce((select is_disabled from public.profiles where id=auth.uid()),false) $$;
      create function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin',true),'false')='true' $$;
      create function public.is_member(p uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.trip_members where trip_id=p and user_id=auth.uid()) $$;
      create table public.admin_audit(actor_id uuid,action text,target_type text,target_id text,detail jsonb);
      grant select,insert,update,delete,truncate,references,trigger on public.trip_members to authenticated,anon,service_role;
      grant select,insert,update,delete on public.trips to authenticated;
      alter table public.trips enable row level security;
      create policy fixture_trips_read on public.trips for select to authenticated using(owner_id=auth.uid() or public.is_member(id));
      create policy fixture_trips_admin_read on public.trips for select to authenticated using(public.is_admin());
      create policy fixture_trips_insert on public.trips for insert to authenticated with check(owner_id=auth.uid());
      create policy fixture_trips_update on public.trips for update to authenticated using(owner_id=auth.uid()) with check(true);
      create policy fixture_trips_admin_update on public.trips for update to authenticated using(public.is_admin()) with check(true);
      create policy fixture_trips_delete on public.trips for delete to authenticated using(owner_id=auth.uid());`)
    // The trip_members policies that were live before file 1, copied from schema.sql.
    await db.exec(`alter table public.trip_members enable row level security;
      create policy "deny disabled" on public.trip_members as restrictive for all to authenticated using (not public.is_disabled());
      create policy "members read" on public.trip_members for select using (user_id = auth.uid() or public.is_member(trip_members.trip_id));
      create policy "admin read" on public.trip_members for select to authenticated using (public.is_admin());
      create policy "admin write" on public.trip_members for all to authenticated using (public.is_admin()) with check (public.is_admin());
      create policy "members insert" on public.trip_members for insert with check (exists (select 1 from public.trips t where t.id = trip_members.trip_id and t.owner_id = auth.uid()));
      create policy "members update" on public.trip_members for update using (exists (select 1 from public.trips t where t.id = trip_members.trip_id and t.owner_id = auth.uid()));
      create policy "members delete" on public.trip_members for delete using (exists (select 1 from public.trips t where t.id = trip_members.trip_id and t.owner_id = auth.uid()) or user_id = auth.uid());`)
    for (const id of [owner, member, stranger, extra]) {
      await db.query('insert into auth.users values($1)', [id])
      await db.query('insert into public.profiles(id,email) values($1,$2)', [id, `${id}@synthetic.invalid`])
    }
    await db.query('insert into public.trips(id,owner_id,name,invite_code) values($1,$2,$3,$4)', [trip, owner, 'Synthetic trip', 'GOA-ABCDEFGH'])
    await db.query("insert into public.trip_members(trip_id,user_id,role) values($1,$2,'owner'),($1,$3,'viewer')", [trip, owner, member])
    await db.exec(readFileSync('supabase/migrations/20261017_trip_write_version.sql', 'utf8'))
    await db.exec(readFileSync('supabase/migrations/20260919_trip_touch_updated_at.sql', 'utf8'))
    await db.exec(base)
    await db.exec(consent)
    for (const id of [tripB, tripC, tripD]) await seedTrip(id)
    await joinTrip(tripB, member)
    await joinTrip(tripB, extra)
    await joinTrip(tripC, member)
    await joinTrip(tripD, member)
  })
  afterAll(async () => { await db?.close() })

  it('a stranger cannot be made owner by an owner_id update', async () => {
    await expect(asUser(owner, 'update public.trips set owner_id=$1 where id=$2', [stranger, tripB])).rejects.toMatchObject({ code: '42501' })
    expect((await stateOf(owner, tripB)).members.some(m => m.userId === stranger)).toBe(false)
  })

  it('a member who left cannot be handed the trip, an admin is held to the same rule, and an active member can be handed it', async () => {
    await command(member, tripB, 'leave', member, await revisionOf(tripB, member))
    await expect(asUser(owner, 'update public.trips set owner_id=$1 where id=$2', [member, tripB])).rejects.toMatchObject({ code: '42501' })
    await db.exec("select set_config('test.admin','true',false)")
    try {
      await expect(asUser(stranger, 'update public.trips set owner_id=$1 where id=$2', [member, tripB])).rejects.toMatchObject({ code: '42501' })
    } finally {
      await db.exec("select set_config('test.admin','false',false)")
    }
    await asUser(owner, 'update public.trips set owner_id=$1 where id=$2', [extra, tripB])
    const after = await stateOf(extra, tripB)
    expect(after.members.find(m => m.userId === extra)?.role).toBe('owner')
    expect(after.members.find(m => m.userId === owner)?.role).toBe('editor')
  })

  it('a member who left cannot be removed and then restored: both return stale and nothing changes', async () => {
    await command(member, trip, 'leave', member, await revisionOf(trip, member))
    const leftRevision = await revisionOf(trip, member)
    const before = await stateOf(owner, trip)
    expect((await command(owner, trip, 'remove', member, leftRevision)).rows[0].result.status).toBe('stale')
    expect((await command(owner, trip, 'restore', member, leftRevision)).rows[0].result.status).toBe('stale')
    const after = await stateOf(owner, trip)
    expect(after.version).toBe(before.version)
    expect(after.inviteCode).toBe(before.inviteCode)
    expect(after.members.some(m => m.userId === member)).toBe(false)
    expect(after.removed.some(m => m.userId === member)).toBe(false)
  })

  it('the four write policies are gone, deny disabled stays RESTRICTIVE, and no permissive write policy remains', async () => {
    const rows = (await db.query<{ policyname: string; cmd: string; permissive: string }>(
      "select policyname, cmd, permissive from pg_policies where schemaname = 'public' and tablename = 'trip_members'")).rows
    const names = rows.map(r => r.policyname)
    for (const gone of ['members insert', 'members update', 'members delete', 'admin write']) expect(names).not.toContain(gone)
    expect(rows.find(r => r.policyname === 'deny disabled')?.permissive).toBe('RESTRICTIVE')
    expect(names).toContain('members read')
    expect(rows.filter(r => r.permissive === 'PERMISSIVE' && ['INSERT', 'UPDATE', 'DELETE', 'ALL'].includes(r.cmd))).toEqual([])
  })

  it('a write grant that comes back does not let the owner add a stranger', async () => {
    await db.exec('grant insert on public.trip_members to authenticated')
    try {
      await expect(asUser(owner, 'insert into public.trip_members(trip_id,user_id,role) values($1,$2,$3)', [trip, stranger, 'editor'])).rejects.toMatchObject({ code: '42501' })
    } finally {
      await db.exec('revoke insert on public.trip_members from authenticated')
    }
  })

  it('deleting a trip deletes its history, and a reused trip id starts with only its new owner', async () => {
    await asUser(owner, 'delete from public.trips where id=$1', [tripC])
    const orphans = (await db.query<{ n: number }>('select count(*)::int as n from public.trip_member_access where trip_id=$1', [tripC])).rows[0].n
    expect(orphans).toBe(0)
    const fk = (await db.query<{ confdeltype: string }>(
      "select confdeltype from pg_constraint where conname = 'trip_member_access_trip_id_fkey' and contype = 'f'")).rows
    expect(fk.map(r => r.confdeltype)).toEqual(['c'])
    await asUser(owner, 'insert into public.trips(id,owner_id,name) values($1,$2,$3)', [tripC, owner, 'Reused id'])
    await command(owner, tripC, 'bootstrap')
    expect((await stateOf(owner, tripC)).members.map(m => m.userId)).toEqual([owner])
  })

  it('the operator path with no JWT still hands the trip over, and still refuses a removed member', async () => {
    await command(owner, tripD, 'remove', member, await revisionOf(tripD, member))
    expect((await stateOf(owner, tripD)).removed.some(m => m.userId === member)).toBe(true)
    await db.query("select set_config('test.uid','',false)")
    await expect(db.query('update public.trips set owner_id=$1 where id=$2', [member, tripD])).rejects.toMatchObject({ code: '42501' })
    await db.query('update public.trips set owner_id=$1 where id=$2', [stranger, tripD])
    expect((await db.query<{ owner_id: string }>('select owner_id from public.trips where id=$1', [tripD])).rows[0].owner_id).toBe(stranger)
  })

  it('the owner guard refuses an anon caller with no JWT subject, and the service role still hands the trip over', async () => {
    const tripE = '20000000-0000-4000-8000-000000000005'
    await seedTrip(tripE)
    await joinTrip(tripE, member)
    // The 20261020 trigger, with the guard body from file 1. The anon and
    // service_role policies let the update reach the trigger, so only the
    // guard can refuse it. On the old guard, the anon update passes.
    await db.exec(`create trigger trips_owner_id_immutable before update of owner_id on public.trips
        for each row execute function public.trips_owner_id_immutable();
      grant select, update on public.trips to anon, service_role;
      create policy fixture_trips_anon_read on public.trips for select to anon using(true);
      create policy fixture_trips_anon_update on public.trips for update to anon using(true) with check(true);
      create policy fixture_trips_service on public.trips for all to service_role using(true) with check(true);`)
    await db.query("select set_config('test.uid','',false)")
    await db.exec('set role anon')
    try {
      await expect(db.query('update public.trips set owner_id=$1 where id=$2', [stranger, tripE])).rejects.toMatchObject({ code: '42501' })
    } finally {
      await db.exec('reset role')
    }
    await db.exec('set role service_role')
    try {
      await db.query('update public.trips set owner_id=$1 where id=$2', [member, tripE])
    } finally {
      await db.exec('reset role')
    }
    expect((await db.query<{ owner_id: string }>('select owner_id from public.trips where id=$1', [tripE])).rows[0].owner_id).toBe(member)
  })

  it('file 1 runs a second time without error and leaves the policies gone', async () => {
    await db.exec(consent)
    const left = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_policies where tablename = 'trip_members' and policyname in ('members insert','members update','members delete','admin write')")
    expect(left.rows[0].n).toBe(0)
  })
})
