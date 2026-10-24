// Run only against a new, network-isolated local container. No remote database URL is accepted.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('../../', import.meta.url))
const name = `yatraflow-growth-${process.pid}`
const endpoint = ['--host=unix:///var/run/docker.sock']
const dockerEnv = { ...process.env }
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[key]
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function docker(args, input) {
  const result = spawnSync('docker', [...endpoint, ...args], { cwd: root, env: dockerEnv, input, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout)
  return result.stdout
}
const sql = input => docker(['exec', '-i', name, 'psql', '-X', '-U', 'postgres', '-d', 'yatraflow_growth_test', '-qAt', '-v', 'ON_ERROR_STOP=1'], input)
const schema = read('supabase/schema.sql')
function policy(name, table) {
  const anchor = `create policy "${name}" on public.${table}`
  assert.equal(schema.split(anchor).length - 1, 1)
  const start = schema.indexOf(anchor)
  return schema.slice(start, schema.indexOf(';', start) + 1)
}

let started = false
try {
  docker(['info', '--format', '{{.ServerVersion}}'])
  docker(['run', '-d', '--rm', '--name', name, '--network', 'none',
    '-e', 'POSTGRES_DB=yatraflow_growth_test', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'])
  started = true
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const probe = spawnSync('docker', [...endpoint, 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'yatraflow_growth_test'], { env: dockerEnv, stdio: 'ignore' })
    if (probe.status === 0) { ready = true; break }
    await delay(500)
  }
  assert(ready, 'The isolated PostgreSQL container did not become ready.')
  sql(read('supabase/tests/growth_measurement_fixture.sql'))
  sql([
    policy('trips insert', 'trips'), policy('trips update', 'trips'),
    policy('members read', 'trip_members'), policy('members insert', 'trip_members'),
    policy('pub_events read own publications', 'pub_events'),
    read('supabase/migrations/20260929_create_funnel_events.sql'),
    read('supabase/migrations/20260929_pub_events_share_source.sql'),
    read('supabase/migrations/20260930_pub_events_share_source_allowlist.sql'),
    read('supabase/migrations/20261012a_join_trip_function.sql'),
  ].join('\n'))
  for (let repeat = 0; repeat < 2; repeat++) {
    sql(read('supabase/migrations/20261015a_growth_attribution.sql'))
    sql(read('supabase/migrations/20261015b_create_event_guards.sql'))
  }
  console.log(sql(read('supabase/tests/growth_measurement.test.sql')).split('\n').filter(line => line.startsWith('PASS:')).join('\n'))
  const score = JSON.parse(sql(read('supabase/reports/distribution_scorecard.sql')).trim())
  const first = score.campaigns.find(row => row.code === 'p_a7c1d9e4b206')
  assert.equal(first.forked_trips, 1)
  assert.equal(first.cohort_trips_with_second_member, 1)
  assert.equal(first.cohort_trips_with_member_proposal, 1)
  assert.equal(first.cohort_member_proposal_authors, 1)
  assert.equal(score.group_activity.persisted_member_proposals, 2)
  assert.equal(score.group_activity.first_known_organizers_after_participation, 1)
  assert.equal(score.group_activity.returning_member_proposal_authors, 1)
  assert.equal(score.team_exclusions_confirmed, false)
  assert.equal(score.engine_activations.find(row => row.engine === 'creator').activated_organizers, 1)
  assert.equal(score.engine_activations.find(row => row.engine === 'creator').activated_trips, 2)
  assert.equal(score.activated_organizers_total, 3)
  assert.equal(score.orphan_trip_rows, 1)
  assert.equal(score.campaign_publications.filter(row => row.forked_trips === 1).length, 2)
  assert(score.trip_origins.demo >= 1)
  assert(score.trip_origins.unknown >= 1)
  assert(!JSON.stringify(score).includes('private fixture title'))
  console.log('PASS: scorecard cohort joins, proposal return, expansion, unknown origins, and aggregate privacy')
  console.log('PASS: both migrations applied twice without errors')
} finally {
  if (started) docker(['rm', '-f', name])
}
