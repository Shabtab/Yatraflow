#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

if (process.argv.length !== 2) throw new Error('This harness accepts no database URL or other arguments.')

const container = `yatraflow-write-version-${randomUUID()}`
const database = 'yatraflow_write_version_test'
const dockerEnv = { ...process.env }
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[key]

function docker(args, input, allowFailure = false) {
  const result = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    env: dockerEnv, input, encoding: 'utf8', timeout: 60000,
  })
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(result.error?.message ?? result.stderr ?? `Docker exited ${result.status}`)
  }
  return result
}

function sql(input) {
  return docker(['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], input).stdout
}

const migration = readFileSync(new URL('../../supabase/migrations/20261017_trip_write_version.sql', import.meta.url), 'utf8')
const checks = readFileSync(new URL('../../supabase/tests/trip_write_version.test.sql', import.meta.url), 'utf8')
let started = false
try {
  docker(['info', '--format', '{{.ServerVersion}}'])
  docker(['run', '--detach', '--rm', '--network', 'none', '--name', container,
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', `POSTGRES_DB=${database}`, 'postgres:17-alpine'])
  started = true
  let ready = false
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const check = docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', database], undefined, true)
    if (check.status === 0) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (!ready) throw new Error('The isolated database did not become ready.')

  sql(`
    create role authenticated nologin;
    create role anon nologin;
    create role service_role nologin;
    create table public.trips (id uuid primary key, name text not null);
    grant select, insert, update, delete on public.trips to authenticated;
    insert into public.trips values ('10000000-0000-0000-0000-000000000001', 'Existing local fixture');
  `)
  sql(migration)
  sql(migration)
  process.stdout.write(sql(checks))
  sql(`create table public.version_fixture as select id, write_version from public.trips;`)
  sql(migration)
  sql(`
    do $$
    begin
      if exists (select 1 from public.version_fixture f join public.trips t using (id) where t.write_version <> f.write_version) then
        raise exception 'Re-running the migration reset a version';
      end if;
      if (select count(*) from pg_trigger where tgrelid = 'public.trips'::regclass
          and tgname = 'trips_advance_write_version' and not tgisinternal) <> 1 then
        raise exception 'Re-running the migration must keep one version trigger';
      end if;
    end;
    $$;
  `)
  sql(`
    alter table public.trips disable trigger trips_advance_write_version;
    update public.trips set write_version = 100000 where id = '10000000-0000-0000-0000-000000000001';
    alter table public.trips enable trigger trips_advance_write_version;
  `)
  sql(migration)
  sql(`
    set role authenticated;
    do $$
    declare v_version bigint;
    begin
      update public.trips set name = 'Restored database update'
      where id = '10000000-0000-0000-0000-000000000001' and write_version = 100000
      returning write_version into v_version;
      if v_version <= 100000 then raise exception 'Sequence must advance beyond restored revisions'; end if;
    end;
    $$;
    reset role;
    create table public.sequence_fixture as select nextval('public.trip_write_version_seq') as reserved;
  `)
  sql(migration)
  sql(`
    do $$
    begin
      if nextval('public.trip_write_version_seq') <= (select reserved from public.sequence_fixture) then
        raise exception 'Migration must never lower the sequence';
      end if;
    end;
    $$;
  `)
  process.stdout.write('PASS: migration reruns preserve versions and keep one trigger.\n')
  process.stdout.write('PASS: sequence survives restored revisions and never resets downward.\n')
} finally {
  if (started) docker(['rm', '--force', container])
}
