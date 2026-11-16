// Local PostgreSQL proof. No URL, credentials or network calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../../', import.meta.url)
const sql = path => readFileSync(new URL(path, root), 'utf8')
const owner = '17110000-0000-4000-8000-000000000001'
const other = '17110000-0000-4000-8000-000000000002'
const disabled = '17110000-0000-4000-8000-000000000003'
const ownerPost = '17110000-0000-4000-8000-0000000000a1'
const otherPost = '17110000-0000-4000-8000-0000000000b1'
const migration = 'supabase/migrations/20261117_creator_post_links.sql'
const db = new PGlite()
const as = async (role, sub = '') => {
  assert.ok(['anon', 'authenticated'].includes(role))
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sub])
  await db.exec(`set role ${role}`)
}
const value = async (query, params = []) => (await db.query(query, params)).rows[0].v
const visits = async days => (await db.query('select post_id, visits::int from public.get_creator_post_visits($1)', [days])).rows

try {
  const schema = sql('supabase/schema.sql')
  const profileTable = schema.match(/create table if not exists public\.profiles \([\s\S]*?\n\);/)?.[0]
  assert.ok(profileTable, 'missing prerequisite profiles table')
  const policy = name => {
    const start = schema.indexOf(`create policy "${name}"`)
    const end = start < 0 ? -1 : schema.indexOf(';', start)
    const statement = end < 0 ? undefined : schema.slice(start, end + 1)
    assert.ok(statement, `missing prerequisite policy: ${name}`)
    return statement
  }
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    ${profileTable}
    create table public.published_itineraries (
      id text primary key, creator_id uuid not null references public.profiles(id),
      unpublished_at bigint, duration_days integer not null default 3
    );
    create table public.pub_events (pub_id text references public.published_itineraries(id),
      kind text not null, at timestamptz not null default now(), source text);
    create function public.is_disabled() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.profiles where id = auth.uid() and is_disabled)
    $$;
    alter table public.profiles enable row level security;
    alter table public.published_itineraries enable row level security;
    ${policy('profiles update self')}
    ${policy('published read')}
    ${policy('published write')}
    create policy "deny disabled" on public.profiles as restrictive for all to authenticated
      using (not public.is_disabled()) with check (not public.is_disabled());
    create policy "deny disabled" on public.published_itineraries as restrictive for all to authenticated
      using (not public.is_disabled()) with check (not public.is_disabled());
    insert into auth.users values ('${owner}'), ('${other}'), ('${disabled}');
    insert into public.profiles(id, email, is_creator, is_disabled) values
      ('${owner}', 'owner@example.invalid', true, false), ('${other}', 'other@example.invalid', true, false),
      ('${disabled}', 'disabled@example.invalid', true, true);
    insert into public.published_itineraries(id, creator_id) values
      ('g8-pub-live', '${owner}'), ('g8-pub-down', '${owner}'),
      ('g8-pub-other', '${other}'), ('g8-pub-other-down', '${other}');
  `)
  // Use the same prerequisite boundary slice as the G3/G4 runner.
  const boundary = sql('supabase/migrations/20261025_profile_public_boundary.sql')
  const boundaryEnd = boundary.indexOf('-- --------------------------------------------------------- 6. Realtime moves')
  assert.ok(boundaryEnd > 0)
  await db.exec(`${boundary.slice(0, boundaryEnd)} commit;`)
  for (const prior of [
    '20261115_creator_share_sources.sql', '20261115_creator_page_views.sql',
    '20261116_creator_publication_facts.sql', '20261116_creator_yatraflow_follows.sql',
  ]) await db.exec(sql(`supabase/migrations/${prior}`))
  await db.exec(sql(migration))
  await db.exec(`
    insert into public.creator_posts(id, creator, url, kind, pub_id, day_index) values
      ('${ownerPost}', '${owner}', 'https://youtu.be/owner-live', 'youtube', 'g8-pub-live', 2),
      ('17110000-0000-4000-8000-0000000000a2', '${owner}', 'https://youtu.be/owner-down', 'youtube', 'g8-pub-down', 1),
      ('${otherPost}', '${other}', 'https://youtu.be/other-live', 'youtube', 'g8-pub-other', 2),
      ('17110000-0000-4000-8000-0000000000b2', '${other}', 'https://youtu.be/other-down', 'youtube', 'g8-pub-other-down', 1);
    update public.published_itineraries set unpublished_at = 1 where id in ('g8-pub-down', 'g8-pub-other-down');
  `)
  const seeded = (await db.query('select * from public.creator_posts order by id')).rows
  await db.exec(sql(migration))
  assert.deepEqual((await db.query('select * from public.creator_posts order by id')).rows, seeded)
  console.log('PASS: prior creator migrations applied; G8 applied twice and preserves all four posts')

  const contract = sql('supabase/tests/rls_contract.test.sql')
  const start = contract.indexOf('-- ============================================================ G8. creator post links')
  assert.ok(start >= 0)
  await db.exec(`begin; set local yatraflow.creator_g8_fixture = 'on'; ${contract.slice(start)} rollback;`)
  console.log('PASS: G8 fixture contract runs; real foreign attribution, role writes, invalid posts and 12-post cap')

  await as('anon')
  await db.query('select public.bump_creator_page_view($1, $2, $3)', [owner, 'post', otherPost])
  await db.query('select public.bump_creator_page_view($1, $2, $3)', [owner, 'post', ownerPost])
  await db.exec('reset role')
  assert.equal(await value('select count(*)::int as v from public.creator_page_events where creator_id = $1', [owner]), 2)
  assert.equal(await value('select count(*)::int as v from public.creator_page_events where post_id is null'), 1)
  assert.equal(await value('select count(*)::int as v from public.creator_page_events where post_id = $1', [ownerPost]), 1)
  console.log('PASS (a): real foreign post stores NULL; own post stores its id')

  await as('authenticated', owner)
  await db.query(`insert into public.creator_posts(creator, url, kind, pub_id, day_index)
    values ($1, 'https://youtu.be/valid-day', 'youtube', 'g8-pub-live', 1)`, [owner])
  await db.exec("update public.published_itineraries set duration_days = 2 where id = 'g8-pub-live'")
  assert.equal(await value('select day_index as v from public.creator_posts where id = $1', [ownerPost]), null)
  assert.equal(await value("select day_index as v from public.creator_posts where url = 'https://youtu.be/valid-day'"), 1)
  assert.equal(await value("select day_index as v from public.creator_posts where pub_id = 'g8-pub-down'"), 1)
  console.log('PASS (b): shorter republish clears only out-of-range days on that route')

  for (const [oldId, newId] of [['g8-pub-live', 'g8-renamed-live'], ['g8-pub-down', 'g8-renamed-down']]) {
    await db.query('update public.published_itineraries set id = $1 where id = $2', [newId, oldId])
    assert.equal(await value('select count(*)::int as v from public.creator_posts where pub_id = $1', [oldId]), 0)
    assert.equal(await value('select count(*)::int as v from public.creator_posts where pub_id = $1', [newId]), oldId === 'g8-pub-live' ? 2 : 1)
  }
  console.log('PASS (c): live and unpublished publication id changes cascade to posts')

  await db.exec('reset role')
  await db.query('update public.profiles set is_disabled = true where id = $1', [other])
  for (const [role, sub] of [['anon', ''], ['authenticated', owner]]) {
    await as(role, sub)
    assert.equal(await value('select count(*)::int as v from public.creator_posts where creator = $1', [other]), 0)
    assert.equal(await value("select count(*)::int as v from public.creator_posts where pub_id = 'g8-renamed-live'"), 2)
  }
  await db.exec('reset role')
  await db.query('update public.profiles set is_disabled = false where id = $1', [other])
  for (const [role, sub] of [['anon', ''], ['authenticated', owner]]) {
    await as(role, sub)
    assert.equal(await value('select count(*)::int as v from public.creator_posts where creator = $1', [other]), 1)
    assert.equal(await value("select count(*)::int as v from public.creator_posts where pub_id = 'g8-pub-other-down'"), 0)
  }
  console.log('PASS (d): anon and other creators cannot read disabled-creator or unpublished-route posts')

  await db.exec('reset role; delete from public.creator_page_events')
  for (const age of [0.5, 1.5, 29.5, 30.5, 729.5, 730.5]) {
    await db.query(`insert into public.creator_page_events(creator_id, post_id, at)
      values ($1, $2, now() - $3::double precision * interval '1 day')`, [owner, ownerPost, age])
  }
  await db.query('insert into public.creator_page_events(creator_id, post_id) values ($1, $2)', [other, otherPost])
  await as('authenticated', owner)
  for (const [days, expected] of [[-100, 1], [0, 1], [1, 1], [30, 3], [730, 5], [731, 5], [2147483647, 5], [null, 3]]) {
    assert.deepEqual(await visits(days), [{ post_id: ownerPost, visits: expected }])
  }
  assert.deepEqual((await db.query('select post_id, visits::int from public.get_creator_post_visits()')).rows,
    [{ post_id: ownerPost, visits: 3 }])
  await as('authenticated', other)
  assert.deepEqual(await visits(730), [{ post_id: otherPost, visits: 1 }])
  console.log('PASS (e): p_days clamps to 1..730, NULL/default uses 30; each owner reads only own posts')

  await as('authenticated', owner)
  for (const [field, replacement] of [['url', 'https://youtu.be/changed'], ['pub_id', 'g8-pub-other'], ['day_index', 0]]) {
    await assert.rejects(db.query(`update public.creator_posts set ${field} = $1 where id = $2`, [replacement, ownerPost]),
      error => error.code === '42501')
  }
  console.log('PASS (f): contract denies foreign insert/update/delete, foreign/dead route attachment and post 13; URL/pub/day updates denied')

  await db.exec('reset role')
  const before = await value('select count(*)::int as v from public.creator_page_events')
  await as('anon')
  await db.query('select public.bump_creator_page_view(p_creator => $1, p_source => $2)', [owner, 'post'])
  await db.exec('reset role')
  assert.equal(await value('select count(*)::int as v from public.creator_page_events'), before + 1)
  assert.equal(await value('select count(*)::int as v from public.creator_page_events where post_id is null'), 1)
  console.log('PASS (g): old two-argument bump records one visit without post attribution')
  console.log(`PASS: local PGlite proof from ${fileURLToPath(root)}`)
} catch (error) {
  console.error(`FAIL: ${error.code ?? ''} ${error.message}\n${error.where ?? error.stack}`)
  process.exitCode = 1
} finally {
  await db.close()
}
