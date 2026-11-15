import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const migration = readFileSync('supabase/migrations/20261115_member_access_boundary.sql', 'utf8')
const owner = '10000000-0000-4000-8000-000000000001'
const member = '10000000-0000-4000-8000-000000000002'
const fresh = '10000000-0000-4000-8000-000000000003'
const trip = '20000000-0000-4000-8000-000000000001'
const originalCode = 'GOA-ABCDEFGH'

function table(name: string): string {
  const match = schema.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))
  if (!match) throw new Error(`Missing table ${name}`)
  return match[0]
}

describe('durable member access through actual SQL', () => {
  let db: PGlite
  const call = async <T>(actor: string, sql: string, args: unknown[] = []) => {
    await db.query("select set_config('test.uid',$1,false)", [actor])
    await db.exec('set role authenticated')
    try { return await db.query<T>(sql, args) } finally { await db.exec('reset role') }
  }
  const state = async () => (await call<{ state: { version: number; planVersion: number; inviteCode: string | null; members: Array<{ userId: string; role: string; revision: number }>; removed: Array<{ userId: string; revision: number }> } }>(
    owner, 'select public.trip_access_state($1) as state', [trip],
  )).rows[0].state
  const change = async (actor: string, action: string, userId: string | null = null, role: string | null = null, revision: number | null = null) =>
    call<{ result: { status: string } }>(actor, 'select public.change_trip_access($1,$2,$3,$4,$5) as result',
      [trip, action, userId, role, action === 'invite' ? (await state()).planVersion : revision])
  const revision = async () => (await state()).members.find(m => m.userId === member)!.revision

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
      grant select,update on public.trips to authenticated;`)
    for (const id of [owner, member, fresh]) {
      await db.query('insert into auth.users values($1)', [id])
      await db.query('insert into public.profiles(id,email) values($1,$2)', [id, `${id}@synthetic.invalid`])
    }
    await db.query('insert into public.trips(id,owner_id,name,invite_code) values($1,$2,$3,$4)', [trip, owner, 'Synthetic trip', originalCode])
    await db.query("insert into public.trip_members(trip_id,user_id,role) values($1,$2,'owner'),($1,$3,'viewer')", [trip, owner, member])
    await db.exec(readFileSync('supabase/migrations/20261017_trip_write_version.sql', 'utf8'))
    await db.exec(migration)
  })
  afterAll(async () => { await db?.close() })

  it('expires links once, preserving roles; rerunning does not rotate a replacement', async () => {
    expect((await state()).inviteCode).toBeNull()
    expect((await state()).members.find(m => m.userId === member)?.role).toBe('viewer')
    await expect(call(fresh, 'select public.join_trip($1)', [originalCode])).rejects.toMatchObject({ code: '42501' })
    await change(owner, 'invite')
    const held = await state()
    await db.exec(migration)
    expect((await state()).inviteCode).toBe(held.inviteCode)
    expect((await state()).version).toBe(held.version)
  })

  it('refuses direct owner, admin and service membership writes and invite rewrites', async () => {
    for (const role of ['authenticated', 'service_role', 'anon']) {
      for (const sql of ["delete from public.trip_members", "update public.trip_members set role='editor'", `insert into public.trip_members(trip_id,user_id,role) values('${trip}','${fresh}','editor')`]) {
        await db.exec(`set role ${role}`)
        try { await expect(db.exec(sql)).rejects.toMatchObject({ code: '42501' }) } finally { await db.exec('reset role') }
      }
    }
    await expect(call(owner, "update public.trips set invite_code='OLD-ABCDEFGH' where id=$1", [trip])).rejects.toMatchObject({ code: '42501' })
  })

  it('preserves a viewer after leaving and rejoining; unrestricted first joins are editors', async () => {
    await change(member, 'leave', member, null, await revision())
    await call(member, 'select public.join_trip($1)', [(await state()).inviteCode])
    expect((await state()).members.find(m => m.userId === member)?.role).toBe('viewer')
    await call(fresh, 'select public.join_trip($1)', [(await state()).inviteCode])
    expect((await state()).members.find(m => m.userId === fresh)?.role).toBe('editor')
  })

  it('rotates on demotion and preserves commenter permission after leave and rejoin', async () => {
    await change(owner, 'role', member, 'editor', await revision())
    const old = (await state()).inviteCode
    await change(owner, 'role', member, 'commenter', await revision())
    expect((await state()).inviteCode).not.toBe(old)
    await expect(call(fresh, 'select public.join_trip($1)', [old])).rejects.toMatchObject({ code: '42501' })
    await change(member, 'leave', member, null, await revision())
    await call(member, 'select public.join_trip($1)', [(await state()).inviteCode])
    expect((await state()).members.find(m => m.userId === member)?.role).toBe('commenter')
  })

  it('blocks removed identities with new links, requires owner restore, and rejects stale Undo', async () => {
    const before = (await state()).inviteCode
    await change(owner, 'remove', member, null, await revision())
    const removal = (await state()).removed.find(m => m.userId === member)!
    expect((await state()).inviteCode).not.toBe(before)
    await expect(call(member, 'select public.join_trip($1)', [(await state()).inviteCode])).rejects.toMatchObject({ code: '42501' })
    await expect(change(fresh, 'restore', member, null, removal.revision)).rejects.toMatchObject({ code: '42501' })
    await change(owner, 'restore', member, null, removal.revision)
    expect((await state()).members.find(m => m.userId === member)?.role).toBe('commenter')
    await change(owner, 'remove', member, null, await revision())
    expect((await change(owner, 'restore', member, null, removal.revision)).rows[0].result.status).toBe('stale')
    expect((await state()).members.some(m => m.userId === member)).toBe(false)
  })

  it('restores only authorized historical memberships during same-ID recovery', async () => {
    const oldCode = (await state()).inviteCode
    await db.query('delete from public.trip_members where trip_id=$1', [trip])
    await change(owner, 'bootstrap')
    expect((await state()).members.some(m => m.userId === owner)).toBe(true)
    expect((await state()).members.some(m => m.userId === fresh)).toBe(true)
    expect((await state()).members.some(m => m.userId === member)).toBe(false)
    await expect(call(member, 'select public.join_trip($1)', [oldCode])).rejects.toMatchObject({ code: '42501' })
  })

  it('preserves enabled audited admin removal, canonical owner and disabled boundaries', async () => {
    await expect(change(owner, 'remove', owner, null, 1)).rejects.toMatchObject({ code: '42501' })
    await db.exec("select set_config('test.admin','true',false)")
    await call(fresh, 'select public.admin_remove_member($1,$2)', [trip, fresh])
    expect((await db.query('select * from public.admin_audit')).rows).toHaveLength(1)
    await db.query('update public.profiles set is_disabled=true where id=$1', [fresh])
    await expect(call(fresh, 'select public.join_trip($1)', [(await state()).inviteCode])).rejects.toMatchObject({ code: '42501' })
    await db.exec("select set_config('test.admin','false',false)")
  })
})
