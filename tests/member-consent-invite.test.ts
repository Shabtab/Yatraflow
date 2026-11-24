import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

// #1012 invite role and reset link, file 2 (20261124b). The fixture follows
// tests/member-consent-936.test.ts: it applies 20261115, then file 1, then file 2.
// Design section 6, tests 5 to 12, plus a run-twice check.
const schema = readFileSync('supabase/schema.sql', 'utf8')
const base = readFileSync('supabase/migrations/20261115_member_access_boundary.sql', 'utf8')
const consent = readFileSync('supabase/migrations/20261124a_member_consent_boundary.sql', 'utf8')
const invite = readFileSync('supabase/migrations/20261124b_invite_role_and_reset.sql', 'utf8')
const owner = '10000000-0000-4000-8000-000000000001'
const member = '10000000-0000-4000-8000-000000000002'
const stranger = '10000000-0000-4000-8000-000000000003'
const extra = '10000000-0000-4000-8000-000000000004'
const trip = '20000000-0000-4000-8000-000000000001' // the fixture trip with an owner and a member

// Each test makes its own trip, so the tests do not depend on each other.
const tripIn = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`

type State = {
  version: number
  planVersion: number
  inviteCode: string | null
  inviteRole: string
  members: Array<{ userId: string; role: string; revision: number }>
  removed: Array<{ userId: string; revision: number }>
}

function table(name: string): string {
  const match = schema.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))
  if (!match) throw new Error(`Missing table ${name}`)
  return match[0]
}

describe('invite role and reset link through actual SQL (#1012, file 2)', () => {
  let db: PGlite

  // Runs SQL as the authenticated role. An empty actor means no JWT subject.
  const asUser = async <T>(actor: string, sql: string, args: unknown[] = []) => {
    await db.query("select set_config('test.uid',$1,false)", [actor])
    await db.exec('set role authenticated')
    try { return await db.query<T>(sql, args) } finally { await db.exec('reset role') }
  }
  const stateOf = async (actor: string, tripId: string) =>
    (await asUser<{ state: State }>(actor, 'select public.trip_access_state($1) as state', [tripId])).rows[0].state
  const change = (actor: string, tripId: string, action: string, role: string | null = null, userId: string | null = null, revision: number | null = null) =>
    asUser<{ result: { status: string } }>(actor, 'select public.change_trip_access($1,$2,$3,$4,$5) as result', [tripId, action, userId, role, revision])
  const join = (actor: string, code: string) => asUser(actor, 'select public.join_trip($1)', [code])
  const roleOf = async (tripId: string, userId: string) =>
    (await stateOf(owner, tripId)).members.find(m => m.userId === userId)?.role
  const revisionOf = async (tripId: string, userId: string) =>
    (await db.query<{ revision: number }>('select revision from public.trip_member_access where trip_id=$1 and user_id=$2', [tripId, userId])).rows[0].revision
  // Creates a trip as the owner, bootstraps it and makes a link. The default link role is editor.
  const seedTrip = async (tripId: string): Promise<string> => {
    await asUser(owner, 'insert into public.trips(id,owner_id,name) values($1,$2,$3)', [tripId, owner, 'Invite trip'])
    await change(owner, tripId, 'bootstrap')
    await change(owner, tripId, 'invite')
    return (await stateOf(owner, tripId)).inviteCode as string
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
    await db.exec(invite)
  })
  afterAll(async () => { await db?.close() })

  it('the default link admits editors, and a viewer link admits viewers', async () => {
    const id = tripIn(5)
    const code = await seedTrip(id)
    expect((await stateOf(owner, id)).inviteRole).toBe('editor')
    await join(member, code)
    expect(await roleOf(id, member)).toBe('editor')
    expect((await change(owner, id, 'invite_role', 'viewer')).rows[0].result.status).toBe('applied')
    expect((await stateOf(owner, id)).inviteRole).toBe('viewer')
    await join(extra, code)
    expect(await roleOf(id, extra)).toBe('viewer')
  })

  it('raising the link role replaces the code, and the old code admits nobody', async () => {
    const id = tripIn(6)
    const code = await seedTrip(id)
    await change(owner, id, 'invite_role', 'viewer')
    expect((await stateOf(owner, id)).inviteCode).toBe(code)
    await change(owner, id, 'invite_role', 'editor')
    const next = (await stateOf(owner, id)).inviteCode as string
    expect(next).not.toBe(code)
    await expect(join(stranger, code)).rejects.toMatchObject({ code: '42501' })
    await join(extra, next)
    expect(await roleOf(id, extra)).toBe('editor')
  })

  it('lowering the link role keeps the code, and planVersion does not change', async () => {
    const id = tripIn(7)
    const code = await seedTrip(id)
    const before = await stateOf(owner, id)
    await change(owner, id, 'invite_role', 'viewer')
    const after = await stateOf(owner, id)
    expect(after.inviteCode).toBe(code)
    expect(after.planVersion).toBe(before.planVersion)
    expect(after.inviteRole).toBe('viewer')
  })

  it('a member who left comes back with the lower of their last role and the link role', async () => {
    const id = tripIn(8)
    await seedTrip(id)
    await join(member, (await stateOf(owner, id)).inviteCode as string)
    // Demotion rotates the code, so the next join uses the new code.
    await change(owner, id, 'role', 'commenter', member, await revisionOf(id, member))
    await change(member, id, 'leave', null, member, await revisionOf(id, member))
    await join(member, (await stateOf(owner, id)).inviteCode as string)
    expect(await roleOf(id, member)).toBe('commenter')
    // The link drops to viewer. The lower role is commenter, so the rejoin is viewer.
    await change(member, id, 'leave', null, member, await revisionOf(id, member))
    await change(owner, id, 'invite_role', 'viewer')
    await join(member, (await stateOf(owner, id)).inviteCode as string)
    expect(await roleOf(id, member)).toBe('viewer')
  })

  it('an editor, a viewer and a stranger cannot set the role or reset the link', async () => {
    const id = tripIn(9)
    const code = await seedTrip(id)
    await join(member, code) // editor
    await change(owner, id, 'invite_role', 'viewer')
    await join(extra, code) // viewer
    const before = await stateOf(owner, id)
    for (const actor of [member, extra, stranger]) {
      await expect(change(actor, id, 'invite_role', 'editor')).rejects.toMatchObject({ code: '42501' })
      await expect(change(actor, id, 'invite_reset')).rejects.toMatchObject({ code: '42501' })
    }
    const after = await stateOf(owner, id)
    expect(after.inviteCode).toBe(before.inviteCode)
    expect(after.inviteRole).toBe('viewer')
  })

  it('a reset replaces the code; members keep their roles; planVersion stays and version goes up by 1', async () => {
    const id = tripIn(10)
    await seedTrip(id)
    const code = (await stateOf(owner, id)).inviteCode as string
    await join(member, code) // editor
    await change(owner, id, 'invite_role', 'viewer')
    await join(extra, code) // viewer, the code is kept
    const before = await stateOf(owner, id)
    await change(owner, id, 'invite_reset')
    const after = await stateOf(owner, id)
    expect(after.inviteCode).not.toBe(before.inviteCode)
    expect(after.version).toBe(before.version + 1)
    expect(after.planVersion).toBe(before.planVersion)
    expect(after.members.map(m => [m.userId, m.role])).toEqual(before.members.map(m => [m.userId, m.role]))
    await expect(join(stranger, before.inviteCode as string)).rejects.toMatchObject({ code: '42501' })
  })

  it('bad shapes fail closed with 22023 and change nothing', async () => {
    const id = tripIn(11)
    await seedTrip(id)
    const before = await stateOf(owner, id)
    const shapes: Array<[string, string | null, string | null, number | null]> = [
      ['invite_role', 'owner', null, null],
      ['invite_role', 'commenter', null, null],
      ['invite_role', null, null, null],
      ['invite_role', 'viewer', member, null],
      ['invite_role', 'viewer', null, 1],
      ['invite_reset', 'viewer', null, null],
      ['invite_reset', null, member, null],
      ['invite_reset', null, null, 1],
    ]
    for (const [action, role, userId, revision] of shapes) {
      await expect(change(owner, id, action, role, userId, revision)).rejects.toMatchObject({ code: '22023' })
    }
    const after = await stateOf(owner, id)
    expect(after.inviteCode).toBe(before.inviteCode)
    expect(after.version).toBe(before.version)
    expect(after.inviteRole).toBe('editor')
  })

  it('anon, authenticated and service_role cannot read or write trip_invite_role', async () => {
    const id = tripIn(12)
    await seedTrip(id)
    await change(owner, id, 'invite_role', 'viewer') // writes the row
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec(`set role ${role}`)
      try {
        await expect(db.query('select * from public.trip_invite_role')).rejects.toMatchObject({ code: '42501' })
        await expect(db.query("insert into public.trip_invite_role(trip_id,role,changed_at) values($1,'editor',1)", [id])).rejects.toMatchObject({ code: '42501' })
      } finally {
        await db.exec('reset role')
      }
    }
    // Second lock: a grant that comes back still sees no rows, and a write is refused by RLS.
    await db.exec('grant select, insert on public.trip_invite_role to authenticated')
    try {
      expect((await asUser<{ n: number }>(owner, 'select count(*)::int as n from public.trip_invite_role')).rows[0].n).toBe(0)
      await expect(asUser(owner, "insert into public.trip_invite_role(trip_id,role,changed_at) values($1,'viewer',1)", [id])).rejects.toMatchObject({ code: '42501' })
    } finally {
      await db.exec('revoke select, insert on public.trip_invite_role from authenticated')
    }
  })

  it('file 2 runs a second time without error, and the link role still holds', async () => {
    const id = tripIn(13)
    const code = await seedTrip(id)
    await change(owner, id, 'invite_role', 'viewer')
    await db.exec(invite)
    expect((await stateOf(owner, id)).inviteRole).toBe('viewer')
    expect((await stateOf(owner, id)).inviteCode).toBe(code)
  })
})
