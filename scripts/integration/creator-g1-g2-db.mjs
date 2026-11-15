// Local PostgreSQL proof. No URL, credentials or network calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../../', import.meta.url)
const sql = path => readFileSync(new URL(path, root), 'utf8')
const owner = '15110000-0000-4000-8000-000000000001'
const other = '15110000-0000-4000-8000-000000000002'
const disabled = '15110000-0000-4000-8000-000000000003'
const traveller = '15110000-0000-4000-8000-000000000004'
const absent = '15110000-0000-4000-8000-000000000005'
const migrations = [
  'supabase/migrations/20261115_creator_share_sources.sql',
  'supabase/migrations/20261115_creator_page_views.sql',
]
const db = new PGlite()
const as = async (role, sub = '') => {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role))
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sub])
  await db.exec(`set role ${role}`)
}
const count = async () => {
  await db.exec('reset role')
  return (await db.query('select count(*)::int as n from public.creator_page_events')).rows[0].n
}

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    create table public.profiles (id uuid primary key, is_creator boolean not null, is_disabled boolean not null);
    create table public.published_itineraries (id text primary key, creator_id uuid not null references public.profiles(id));
    create table public.pub_events (pub_id text references public.published_itineraries(id),
      kind text not null, at timestamptz not null default now(), source text);
    create function public.is_disabled() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.profiles where id = auth.uid() and is_disabled)
    $$;
    -- Match Supabase's direct default grants. The migrations must remove these.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    insert into public.profiles values
      ('${owner}', true, false), ('${other}', true, false),
      ('${disabled}', true, true), ('${traveller}', false, false);
    insert into public.published_itineraries values ('g1-owner', '${owner}'), ('g1-foreign', '${disabled}');
    insert into public.pub_events (pub_id, kind, source) values
      ('g1-owner', 'view', null), ('g1-owner', 'view', 'wa'), ('g1-owner', 'fork', 'wa'),
      ('g1-foreign', 'view', 'copy');
  `)
  for (let run = 0; run < 2; run++) {
    for (const migration of migrations) await db.exec(sql(migration))
  }
  await db.exec(`insert into public.creator_page_events (creator_id, source) values
    ('${owner}', null), ('${owner}', 'ig'), ('${disabled}', 'post');`)
  const contract = sql('supabase/tests/rls_contract.test.sql')
  const start = contract.indexOf('-- ============================================================ G1. creator share sources')
  const end = contract.indexOf('-- ------------------------------------------------------------------------ done', start)
  assert.ok(start >= 0 && end > start)
  await db.exec(`begin; set local yatraflow.creator_contract_fixture = 'on';
    ${contract.slice(start, end)} rollback;`)
  console.log('PASS: G1/G2 SQL contracts, anon, other creator, disabled owner, own rows and direct table denial')

  for (const migration of migrations) assert.ok(sql(migration).includes('begin;'))
  const functions = await db.query(`select proname, count(*)::int as n from pg_proc
    where pronamespace = 'public'::regnamespace and proname in
    ('get_creator_share_sources', 'get_creator_page_views', 'bump_creator_page_view', 'prune_creator_page_events')
    group by proname`)
  assert.equal(functions.rows.length, 4)
  assert.ok(functions.rows.every(row => row.n === 1))
  console.log('PASS: both migrations rerun without duplicate signatures')

  const sources = [null, 'copy', 'buyer', 'explore', 'creator', 'purchases', 'wa', 'community', 'ig', 'yt', 'threads', 'post']
  let before = await count()
  await as('anon')
  for (const source of sources) await db.query('select public.bump_creator_page_view($1, $2)', [owner, source])
  assert.equal(await count(), before + sources.length)
  before = await count()
  await as('anon')
  for (const target of [disabled, traveller, absent, null]) {
    await db.query('select public.bump_creator_page_view($1, $2)', [target, 'ig'])
  }
  for (const source of ['', 'unknown', 'IG', 'x'.repeat(1000)]) {
    await db.query('select public.bump_creator_page_view($1, $2)', [owner, source])
  }
  await as('authenticated', disabled)
  await db.query('select public.bump_creator_page_view($1, $2)', [owner, 'ig'])
  assert.equal(await count(), before)
  await as('authenticated', other)
  await db.query('select public.bump_creator_page_view($1, $2)', [owner, 'yt'])
  assert.equal(await count(), before + 1)
  console.log('PASS: all source tags, anonymous bump, invalid targets and sources, disabled caller')

  // Prove RLS still denies clients if a later grant and permissive policy appear.
  await db.exec(`grant select, insert on public.creator_page_events to anon, authenticated;
    create policy fixture_allow on public.creator_page_events for all to anon, authenticated using (true) with check (true);`)
  for (const [role, sub] of [['anon', ''], ['authenticated', owner]]) {
    await as(role, sub)
    assert.equal((await db.query('select * from public.creator_page_events')).rows.length, 0)
    await assert.rejects(db.query('insert into public.creator_page_events(creator_id) values ($1)', [owner]), error => error.code === '42501')
  }
  await db.exec(`reset role; drop policy fixture_allow on public.creator_page_events;
    revoke select, insert on public.creator_page_events from anon, authenticated;`)
  console.log('PASS: RESTRICTIVE denial survives permissive policy and table grants')

  await db.exec(`delete from public.pub_events; delete from public.creator_page_events;
    insert into public.pub_events(pub_id, kind, source, at)
      select 'g1-owner', 'view', 'wa', now() - make_interval(days => age) from unnest(array[0,2,31,729,731]) age;
    insert into public.creator_page_events(creator_id, source, at)
      select '${owner}', 'ig', now() - make_interval(days => age) from unnest(array[0,2,31,729,731]) age;`)
  await as('authenticated', owner)
  for (const [days, expected] of [[null, 2], [30, 2], [0, 1], [-99, 1], [1, 1], [730, 4], [10000, 4]]) {
    const share = await db.query('select coalesce(sum(views),0)::int as n from public.get_creator_share_sources($1)', [days])
    const page = await db.query('select coalesce(sum(visits),0)::int as n from public.get_creator_page_views($1)', [days])
    assert.equal(share.rows[0].n, expected)
    assert.equal(page.rows[0].n, expected)
  }
  await db.exec("set timezone = 'Pacific/Kiritimati'")
  const day = await db.query(`select day::text as day from public.get_creator_page_views(1)`)
  await db.exec('reset role')
  const utc = await db.query("select (now() at time zone 'utc')::date::text as day")
  assert.equal(day.rows[0].day, utc.rows[0].day)
  console.log('PASS: default, null, lower and upper date clamps; UTC day buckets')

  for (const role of ['anon', 'authenticated']) {
    await as(role, owner)
    await assert.rejects(db.query('select public.prune_creator_page_events()'), error => error.code === '42501')
  }
  await as('service_role')
  assert.equal((await db.query('select public.prune_creator_page_events() as n')).rows[0].n, 1)
  assert.equal(await count(), 4)
  console.log('PASS: 730-day retention removes only expired events; only service_role can prune')
  console.log(`PASS: local PGlite proof from ${fileURLToPath(root)}`)
} finally {
  await db.close()
}
