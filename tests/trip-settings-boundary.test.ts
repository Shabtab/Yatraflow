import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const migration = readFileSync('supabase/migrations/20261116_trip_settings_boundary.sql', 'utf8')
const owner = '10000000-0000-4000-8000-000000000001'
const editor = '10000000-0000-4000-8000-000000000002'
const viewer = '10000000-0000-4000-8000-000000000003'
const outsider = '10000000-0000-4000-8000-000000000004'
const trip = '20000000-0000-4000-8000-000000000001'
function definition(name: string, table = false) {
  const expression = table
    ? new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`)
    : new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`)
  const result = schema.match(expression)
  if (!result) throw Error(name)
  return result[0]
}
describe('owner-only trip settings through actual SQL', () => {
  let db: PGlite
  async function actor(id: string, sql: string, admin = false, role = 'authenticated') {
    await db.query("select set_config('test.uid',$1,false),set_config('test.admin',$2,false)", [id, String(admin)])
    await db.exec(`set role ${role}`)
    try { return await db.query(sql) } finally { await db.exec('reset role') }
  }
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role authenticated; create role anon; create role service_role bypassrls;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('app_metadata',jsonb_build_object('role',case when current_setting('test.admin',true)='true' then 'masteradmin' else 'user' end)) $$;
      grant usage on schema public,auth to authenticated,anon,service_role;`)
    for (const name of ['profiles','trips','trip_members','suggestions','decisions','activity']) await db.exec(definition(name, true))
    for (const name of ['is_member','is_editor','is_admin','is_disabled']) await db.exec(definition(name))
    await db.exec(`alter table public.trips enable row level security;
      grant select,update on public.trips to authenticated,anon,service_role;
      create policy crew_read on public.trips for select to authenticated using(public.is_member(id) or public.is_admin());
      create policy crew_update on public.trips for update to authenticated using(public.is_editor(id) or public.is_admin()) with check(public.is_editor(id) or public.is_admin());
      create policy disabled on public.trips as restrictive to authenticated using(not public.is_disabled()) with check(not public.is_disabled());`)
    for (const name of ['suggestions','decisions','activity']) {
      await db.exec(`alter table public.${name} enable row level security;
        grant select on public.${name} to authenticated,anon;
        create policy disabled on public.${name} as restrictive to authenticated using(not public.is_disabled());`)
      const policy = schema.match(new RegExp(`create policy "${name} read" on public\\.${name}[\\s\\S]*?;`))
      if (!policy) throw Error(name)
      await db.exec(policy[0])
    }
    for (const id of [owner,editor,viewer,outsider]) {
      await db.query('insert into auth.users values($1)', [id])
      await db.query('insert into public.profiles(id,email) values($1,$2)', [id, id+'@synthetic.invalid'])
    }
    await db.query("insert into public.trips(id,owner_id,name) values($1,$2,'Original')", [trip,owner])
    await db.query("insert into public.trip_members(trip_id,user_id,role) values($1,$2,'owner'),($1,$3,'editor'),($1,$4,'viewer')", [trip,owner,editor,viewer])
    await db.query("insert into public.suggestions(trip_id,proposed_by) values($1,$2)", [trip,editor])
    await db.query("insert into public.decisions(trip_id,raised_by) values($1,$2)", [trip,editor])
    await db.query("insert into public.activity(trip_id,actor_id) values($1,$2)", [trip,editor])
    await actor(editor, "update public.trips set visibility='public',deleted_at=now()")
    expect((await db.query<{visibility: string}>('select visibility from public.trips')).rows[0].visibility).toBe('public')
    await db.exec("update public.trips set visibility='private',deleted_at=null")
    await db.exec(migration)
  })
  afterAll(async () => { await db?.close() })
  it('refuses both protected changes atomically while preserving ordinary edits and unchanged echoes', async () => {
    for (const setting of ["visibility='public'", 'deleted_at=now()']) {
      await expect(actor(editor, `update public.trips set name='Refused',${setting}`)).rejects.toMatchObject({code:'42501'})
      expect((await db.query<{name:string}>('select name from public.trips')).rows[0].name).toBe('Original')
    }
    await actor(editor, "update public.trips set name='Edited',visibility='private',deleted_at=null")
    expect((await db.query<{name:string}>('select name from public.trips')).rows[0].name).toBe('Edited')
  })
  it('preserves owner, admin and trusted service settings writes and denies disabled admins', async () => {
    await actor(owner, "update public.trips set visibility='public',deleted_at=now()")
    await actor(owner, "update public.trips set visibility='private',deleted_at=null")
    await actor(outsider, "update public.trips set visibility='public'", true)
    await actor('', "update public.trips set visibility='private'", false, 'service_role')
    await db.query('update public.profiles set is_disabled=true where id=$1', [outsider])
    expect((await actor(outsider, "update public.trips set visibility='public' returning id", true)).rows).toHaveLength(0)
    await db.query('update public.profiles set is_disabled=false where id=$1', [outsider])
  })
  it('does not mistake an anonymous UID for service authority even with a future broad policy', async () => {
    await db.exec('create policy future_read on public.trips for select using(true); create policy future_write on public.trips for update using(true) with check(true)')
    try {
      await expect(actor('', "update public.trips set visibility='public'", false, 'anon')).rejects.toMatchObject({code:'42501'})
      for (const table of ['suggestions','decisions','activity']) {
        expect((await actor(outsider, `select * from public.${table}`)).rows).toHaveLength(0)
        expect((await actor('', `select * from public.${table}`, false, 'anon')).rows).toHaveLength(0)
        expect((await actor(viewer, `select * from public.${table}`)).rows).toHaveLength(1)
        expect((await actor(outsider, `select * from public.${table}`, true)).rows).toHaveLength(1)
      }
    } finally { await db.exec('drop policy future_read on public.trips; drop policy future_write on public.trips') }
  })
  it('is safe to apply again', async () => { await db.exec(migration) })
})
