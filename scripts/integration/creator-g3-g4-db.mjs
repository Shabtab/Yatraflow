// Local PostgreSQL proof. No URL, credentials or network calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../../', import.meta.url)
const sql = path => readFileSync(new URL(path, root), 'utf8')
const owner = '16110000-0000-4000-8000-000000000001'
const other = '16110000-0000-4000-8000-000000000002'
const disabled = '16110000-0000-4000-8000-000000000003'
const traveller = '16110000-0000-4000-8000-000000000004'
const absent = '16110000-0000-4000-8000-000000000005'
const migrations = [
  'supabase/migrations/20261116_creator_publication_facts.sql',
  'supabase/migrations/20261116_creator_yatraflow_follows.sql',
]
const db = new PGlite()
const as = async (role, sub = '') => {
  assert.ok(['anon', 'authenticated'].includes(role))
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sub])
  await db.exec(`set role ${role}`)
}
const reject = async (query, params, code) => {
  await assert.rejects(db.query(query, params), error => error.code === code)
}
const value = async (query, params = []) => (await db.query(query, params)).rows[0].v
const card = async () => (await db.query('select * from public.get_public_profile_cards($1)', [[owner]])).rows[0]

try {
  const schema = sql('supabase/schema.sql')
  const profileTable = schema.match(/create table if not exists public\.profiles \([\s\S]*?\n\);/)[0]
  const policy = name => {
    const marker = `create policy "${name}"`
    const markerStart = schema.indexOf(marker)
    assert.ok(markerStart >= 0, `missing prerequisite policy: ${name}`)
    const statementEnd = schema.indexOf(';', markerStart)
    assert.ok(statementEnd > markerStart, `missing prerequisite policy: ${name}`)
    return schema.slice(markerStart, statementEnd + 1)
  }
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
    ${profileTable}
    create table public.published_itineraries (
      id text primary key, creator_id uuid not null references public.profiles(id), unpublished_at bigint
    );
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
    insert into auth.users values ('${owner}'), ('${other}'), ('${disabled}'), ('${traveller}');
    insert into public.profiles(id, email, is_creator, is_disabled) values
      ('${owner}', 'owner@example.invalid', true, false), ('${other}', 'other@example.invalid', true, false),
      ('${disabled}', 'disabled@example.invalid', true, true), ('${traveller}', 'traveller@example.invalid', false, false);
    insert into public.published_itineraries values ('g3-owner', '${owner}', null),
      ('g3-other', '${other}', null), ('g3-dead', '${owner}', 1);
  `)
  // Execute the real projection, reader and ACL predecessor. Omit only its unrelated Realtime and audit sections.
  const boundary = sql('supabase/migrations/20261025_profile_public_boundary.sql')
  const boundaryEnd = boundary.indexOf('-- --------------------------------------------------------- 6. Realtime moves')
  assert.ok(boundaryEnd > 0)
  await db.exec(`${boundary.slice(0, boundaryEnd)} commit;`)
  // G4 is standalone. It also runs before G3 here to prove no hidden dependency.
  await db.exec(sql(migrations[1]))
  await db.exec(sql(migrations[0]))
  await db.exec(`update public.profiles set featured_pub_id = 'g3-owner', planning_notes = '["Start early"]' where id = '${owner}';
    update public.profiles set planning_notes = '["Other note"]' where id = '${other}';
    insert into public.creator_follows(follower, creator) values
      ('${owner}', '${other}'), ('${other}', '${owner}'), ('${disabled}', '${owner}');`)
  for (const migration of migrations) await db.exec(sql(migration))
  assert.equal((await card()).featured_pub_id, 'g3-owner')
  assert.deepEqual((await card()).planning_notes, ['Start early'])
  assert.equal(await value('select count(*)::int as v from public.creator_follows'), 3)
  const contract = sql('supabase/tests/rls_contract.test.sql')
  const start = contract.indexOf('-- ============================================================ G3. publication facts and creator picks')
  // G8 has its own migration, so the slice stops before its section.
  const end = contract.indexOf('-- ============================================================ G8. creator post links', start)
  assert.ok(start >= 0 && end > start)
  await db.exec(`begin; set local yatraflow.creator_g3_g4_fixture = 'on'; ${contract.slice(start, end)} rollback;`)
  console.log('PASS: G3/G4 SQL contracts; anon, other seeded user, disabled caller and exact owner scope')
  console.log('PASS: both migrations run twice, preserve data, and G4 needs no G3 objects')

  await as('authenticated', owner)
  for (const notes of [null, [], ['a', 'b', 'c'], ['🛣'.repeat(140)]]) {
    await db.query('update public.profiles set planning_notes = $1::jsonb where id = $2',
      [notes === null ? null : JSON.stringify(notes), owner])
  }
  for (const notes of ['null', '{}', 'true', '1', '"note"', '[null]', '[1]', '[{}]', '[[]]', '[""]', '["   "]', '["\\t"]', '["\\n"]',
    '["a","b","c","d"]', JSON.stringify(['🛣'.repeat(141)])]) {
    await reject('update public.profiles set planning_notes = $1::jsonb where id = $2', [notes, owner], '23514')
  }
  for (const [field, valid, invalid] of [
    ['planned_km', [null, '0', '19999.99'], ['-0.01', '20000', 'NaN', 'Infinity']],
    ['best_months', [null, 0, 4095], [-1, 4096]],
    ['reviewed_scope', [null, '', 'x'.repeat(140)], ['x'.repeat(141)]],
  ]) {
    for (const item of valid) await db.query(`update public.published_itineraries set ${field} = $1 where id = 'g3-owner'`, [item])
    for (const item of invalid) await reject(`update public.published_itineraries set ${field} = $1 where id = 'g3-owner'`, [item], '23514')
  }
  await db.exec(`begin;
    update public.published_itineraries set reviewed_at = '2099-01-01' where id = 'g3-owner';`)
  assert.equal(await value("select reviewed_at = now() as v from public.published_itineraries where id = 'g3-owner'"), true)
  await db.exec(`insert into public.published_itineraries(id, creator_id, reviewed_at)
    values ('g3-review-insert', '${owner}', '2099-01-01');`)
  assert.equal(await value("select reviewed_at = now() as v from public.published_itineraries where id = 'g3-review-insert'"), true)
  await db.exec("delete from public.published_itineraries where id = 'g3-review-insert'; commit;")
  const reviewedAt = await value("select reviewed_at::text as v from public.published_itineraries where id = 'g3-owner'")
  await db.exec("update public.published_itineraries set planned_km = 100 where id = 'g3-owner'")
  assert.equal(await value("select reviewed_at::text as v from public.published_itineraries where id = 'g3-owner'"), reviewedAt)
  console.log('PASS: client future review dates become server now() on insert and update; unrelated edits preserve stamps')
  for (const pick of ['g3-other', 'g3-dead', 'missing']) {
    await reject('update public.profiles set featured_pub_id = $1 where id = $2', [pick, owner], '23514')
  }
  await reject("update public.profile_cards set planning_notes = '[]'", [], '42501')
  console.log('PASS: nullable facts, numeric bounds, month mask, scope cap and fail-closed note shapes')

  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', '', false)")
  await db.exec(`update public.profiles set is_creator = false where id = '${owner}';`)
  await as('authenticated', owner)
  await db.query('update public.profiles set planning_notes = null, featured_pub_id = featured_pub_id where id = $1', [owner])
  assert.equal((await card()).featured_pub_id, null)
  await db.exec('reset role')
  await db.exec(`update public.profiles set is_creator = true where id = '${owner}';`)
  await as('authenticated', owner)
  await db.exec("update public.published_itineraries set id = 'g3-renamed' where id = 'g3-owner'")
  assert.equal((await card()).featured_pub_id, 'g3-renamed')
  assert.equal(await value('select featured_pub_id as v from public.profiles where id = $1', [owner]), 'g3-renamed')
  await db.exec("update public.published_itineraries set id = 'g3-owner' where id = 'g3-renamed'")
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', '', false)")
  console.log('PASS: unchanged picks allow note cleanup; publication renames cascade to private and public picks')
  for (const change of ["unpublished_at = 1", `creator_id = '${other}'`]) {
    await db.exec(`update public.published_itineraries set creator_id = '${owner}', unpublished_at = null where id = 'g3-owner';
      update public.profiles set featured_pub_id = 'g3-owner' where id = '${owner}';
      update public.published_itineraries set ${change} where id = 'g3-owner';`)
    assert.equal((await card()).featured_pub_id, null)
    assert.equal(await value('select featured_pub_id as v from public.profiles where id = $1', [owner]), null)
  }
  await db.exec(`update public.published_itineraries set creator_id = '${owner}' where id = 'g3-owner';
    update public.profiles set featured_pub_id = 'g3-owner' where id = '${owner}';
    delete from public.published_itineraries where id = 'g3-owner';`)
  assert.equal((await card()).featured_pub_id, null)
  await db.exec(`insert into public.published_itineraries values ('g3-new', '${owner}', null, null, null, null, null);
    update public.profiles set featured_pub_id = 'g3-new' where id = '${owner}';
    update public.profiles set is_disabled = true where id = '${owner}';`)
  assert.equal((await card()).featured_pub_id, null)
  assert.equal((await card()).planning_notes, null)
  await db.exec(`update public.published_itineraries set unpublished_at = 1 where id = 'g3-new';
    update public.profiles set is_disabled = false where id = '${owner}';`)
  await as('authenticated', traveller)
  await reject("update public.profiles set planning_notes = '[\"Not a creator\"]' where id = $1", [traveller], '23514')
  console.log('PASS: foreign and dead picks rejected; unpublish, transfer, delete and disabled creator clear public picks')

  await as('authenticated', traveller)
  for (const target of [disabled, traveller, absent]) {
    await reject('insert into public.creator_follows(follower, creator) values ($1, $2)', [traveller, target], '23514')
  }
  await db.query('insert into public.creator_follows(follower, creator) values ($1, $2)', [traveller, owner])
  await reject('insert into public.creator_follows(follower, creator) values ($1, $2)', [traveller, owner], '23505')
  await reject('update public.creator_follows set creator = $1', [other], '42501')
  await db.query('delete from public.creator_follows where follower = $1', [traveller])
  await as('authenticated', owner)
  await reject('insert into public.creator_follows(follower, creator) values ($1, $1)', [owner], '23514')
  await as('authenticated', disabled)
  await reject('insert into public.creator_follows(follower, creator) values ($1, $2)', [disabled, other], '42501')
  await as('anon')
  for (const target of [disabled, traveller, absent, null]) {
    assert.equal(await value('select public.get_creator_follower_count($1)::int as v', [target]), 0)
  }
  assert.equal(await value('select public.get_creator_follower_count($1)::int as v', [owner]), 1)
  await db.exec('reset role')
  await db.query('update public.profiles set is_disabled = true where id = $1', [other])
  await as('anon')
  assert.equal(await value('select public.get_creator_follower_count($1)::int as v', [owner]), 0)
  await db.exec('reset role')
  await db.query('update public.profiles set is_disabled = false where id = $1', [other])
  await as('anon')
  assert.equal(await value('select public.get_creator_follower_count($1)::int as v', [owner]), 1)
  console.log('PASS: disabling a follower removes their count; enabling restores it without a public follower list')
  console.log('PASS: own follow and unfollow, duplicate and self denial, active targets and public count-only reads')

  await db.exec(`reset role; create policy fixture_allow on public.creator_follows for all to authenticated using (true) with check (true);`)
  await as('authenticated', disabled)
  assert.equal(await value('select count(*)::int as v from public.creator_follows'), 0)
  await reject('insert into public.creator_follows(follower, creator) values ($1, $2)', [disabled, other], '42501')
  await db.exec('reset role; drop policy fixture_allow on public.creator_follows')
  const functions = await db.query(`select proname, count(*)::int as n from pg_proc
    where pronamespace = 'public'::regnamespace and proname in ('get_public_profile_cards', 'get_creator_follower_count') group by proname`)
  assert.equal(functions.rows.length, 2)
  assert.ok(functions.rows.every(row => row.n === 1))
  console.log('PASS: RESTRICTIVE disabled denial survives a permissive policy; RPC overloads remain singular')
  console.log(`PASS: local PGlite proof from ${fileURLToPath(root)}`)
} catch (error) {
  console.error(`FAIL: ${error.code ?? ''} ${error.message}\n${error.where ?? error.stack}`)
  process.exitCode = 1
} finally {
  await db.close()
}
