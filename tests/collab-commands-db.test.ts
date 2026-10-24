import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readSql = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const owner = '10000000-0000-4000-8000-000000000001'
const editorA = '10000000-0000-4000-8000-000000000002'
const editorB = '10000000-0000-4000-8000-000000000003'
const viewer = '10000000-0000-4000-8000-000000000004'
const outsider = '10000000-0000-4000-8000-000000000005'
const trip = '20000000-0000-4000-8000-000000000001'
const suggestion = '30000000-0000-4000-8000-000000000001'
const decision = '40000000-0000-4000-8000-000000000001'

describe('collaboration command SQL behavior', () => {
  let db: PGlite
  let currentActor = owner

  const actor = async (id: string) => {
    currentActor = id
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`)
  }
  const call = async (commandId: string, command: unknown, tripId = trip) => {
    const result = await db.query<{ receipt: Record<string, unknown> }>(
      'select public.submit_collab_command($1,$2,$3::jsonb) as receipt',
      [commandId, tripId, JSON.stringify(command)],
    )
    return result.rows[0].receipt
  }
  const count = async (table: string) => {
    await db.exec('reset role')
    const result = await db.query<{ count: number }>(`select count(*)::int as count from public.${table}`)
    await actor(currentActor)
    return result.rows[0].count
  }

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema cron;
      create table cron.job(
        jobid serial primary key, jobname text not null, active boolean not null default true,
        database text not null default current_database(), schedule text not null, command text not null
      );
      create function cron.unschedule(p_job integer) returns boolean language plpgsql as $$
        begin delete from cron.job where jobid=p_job; return found; end
      $$;
      create function cron.schedule(p_name text,p_schedule text,p_command text) returns integer language plpgsql as $$
        declare v_job integer; begin insert into cron.job(jobname,schedule,command) values(p_name,p_schedule,p_command) returning jobid into v_job; return v_job; end
      $$;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create table public.profiles(id uuid primary key);
      create table public.trips(id uuid primary key, owner_id uuid not null, write_version bigint not null default 7, deleted_at timestamptz);
      create table public.trip_members(trip_id uuid not null references public.trips(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, role text not null, primary key(trip_id,user_id));
      create table public.suggestions(
        id uuid primary key,
        trip_id uuid not null references public.trips(id) on delete cascade,
        day_index integer not null default 0,
        proposed_by uuid not null,
        title text not null default '', category text, location_name text, lat double precision, lng double precision,
        description text, visit_minutes integer not null default 60, estimated_entry_fee_inr integer not null default 0,
        estimated_transport_inr integer not null default 0, votes jsonb not null default '[]', comments jsonb not null default '[]',
        status text not null default 'open', created_at bigint not null default 1
      );
      create table public.decisions(
        id uuid primary key, trip_id uuid not null references public.trips(id) on delete cascade, question text not null default '', context text,
        options jsonb not null default '[]', votes_by_user_id jsonb not null default '{}', comments jsonb not null default '[]',
        status text not null default 'open', resolved_option_id text, raised_by uuid not null,
        created_at bigint not null default 1, resolved_at bigint
      );
      create table public.activity(id uuid primary key, trip_id uuid not null references public.trips(id) on delete cascade, actor_id uuid not null, verb text not null, target text, at bigint not null default 1);
      create table public.notifications(id uuid primary key, user_id uuid not null, trip_id uuid references public.trips(id) on delete cascade, text text not null, read boolean not null default false, at bigint not null default 1);
      create function public.is_disabled() returns boolean language sql stable as $$ select false $$;
      create function public.is_admin() returns boolean language sql stable as $$ select false $$;
      create function public.is_editor(p_trip uuid) returns boolean language sql stable security definer set search_path=public as $$
        select exists(select 1 from public.trip_members where trip_id=p_trip and user_id=auth.uid() and role in ('owner','editor'))
      $$;
      insert into public.profiles values ('${owner}'),('${editorA}'),('${editorB}'),('${viewer}'),('${outsider}');
      insert into public.trips(id,owner_id) values ('${trip}','${owner}');
      insert into public.trip_members values
        ('${trip}','${owner}','owner'),('${trip}','${editorA}','editor'),('${trip}','${editorB}','editor'),('${trip}','${viewer}','viewer');
      insert into public.suggestions(id,trip_id,proposed_by,title) values ('${suggestion}','${trip}','${owner}','Existing');
      alter table public.suggestions enable row level security;
      alter table public.decisions enable row level security;
      alter table public.activity enable row level security;
      alter table public.notifications enable row level security;
      create policy "deny disabled" on public.suggestions as restrictive for all to authenticated using(not public.is_disabled()) with check(not public.is_disabled());
      create policy "deny disabled" on public.decisions as restrictive for all to authenticated using(not public.is_disabled()) with check(not public.is_disabled());
      create policy "deny disabled" on public.activity as restrictive for all to authenticated using(not public.is_disabled()) with check(not public.is_disabled());
      create policy "deny disabled" on public.notifications as restrictive for all to authenticated using(not public.is_disabled()) with check(not public.is_disabled());
      create policy "suggestions write" on public.suggestions for all using(public.is_editor(trip_id)) with check(public.is_editor(trip_id));
      create policy "decisions write" on public.decisions for all using(public.is_editor(trip_id)) with check(public.is_editor(trip_id));
      create policy "activity write" on public.activity for all using(public.is_editor(trip_id)) with check(public.is_editor(trip_id));
      create policy "suggestions read" on public.suggestions for select using(public.is_editor(trip_id));
      create policy "decisions read" on public.decisions for select using(public.is_editor(trip_id));
      create policy "activity read" on public.activity for select using(public.is_editor(trip_id));
      create policy "notifications read" on public.notifications for select using(auth.uid()=user_id);
      create policy "notifications write" on public.notifications for all using(auth.uid()=user_id or public.is_editor(trip_id)) with check(auth.uid()=user_id or public.is_editor(trip_id));
      create policy "admin read" on public.notifications for select using(public.is_admin());
      create policy "admin write" on public.suggestions for all using(public.is_admin()) with check(public.is_admin());
      create policy "admin write" on public.decisions for all using(public.is_admin()) with check(public.is_admin());
      create policy "admin write" on public.activity for all using(public.is_admin()) with check(public.is_admin());
      grant usage on schema public, auth to authenticated;
      grant select,insert,update,delete on all tables in schema public to authenticated;
      grant execute on all functions in schema public to authenticated;
    `)
    await db.exec(readSql('supabase/migrations/20261017_trip_write_version.sql'))
    await db.exec(readSql('supabase/migrations/20261023a_collab_commands.sql'))
    await db.exec(readSql('supabase/migrations/20261023b_collab_cutover.sql'))
    // Both files must be safe to re-run after an interrupted rollout.
    await db.exec(readSql('supabase/migrations/20261023a_collab_commands.sql'))
    await db.exec(readSql('supabase/migrations/20261023b_collab_cutover.sql'))
    await db.exec(`do $$ begin
      if exists(select 1 from pg_policies where schemaname='public' and tablename in ('suggestions','decisions','activity','notifications') and cmd='ALL' and permissive='PERMISSIVE') then raise exception 'permissive FOR ALL write policy remains'; end if;
      if not exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and cmd='ALL' and permissive='RESTRICTIVE' and policyname='deny disabled') then raise exception 'restrictive disabled-account guard was removed'; end if;
    end $$`)
  }, 30_000)

  afterAll(async () => db?.close())

  it('applies, retries, conflicts, rejects malformed commands, and denies outsiders', async () => {
    await actor(editorA)
    const commandId = '50000000-0000-4000-8000-000000000001'
    const command = {
      type: 'suggestion.create', suggestionId: '30000000-0000-4000-8000-000000000002',
      suggestion: { dayIndex: 0, title: 'River walk', visitMinutes: 45, estimatedEntryFeeInr: 0, estimatedTransportInr: 0 },
    }
    const first = await call(commandId, command)
    expect(first.status).toBe('applied')
    expect(first.tripRevision).toBe(7)
    expect(first.suggestion).toMatchObject({ proposed_by: editorA, votes: [], comments: [] })
    expect(first.notificationIds).toHaveLength(3)
    const beforeRetry = { activity: await count('activity'), notifications: await count('notifications') }
    const retry = await call(commandId, command)
    expect(retry.status).toBe('alreadyApplied')
    expect(retry.suggestion).toMatchObject({ id: command.suggestionId, proposed_by: editorA })
    expect(await count('activity')).toBe(beforeRetry.activity)
    expect(await count('notifications')).toBe(beforeRetry.notifications)
    expect((await call(commandId, { ...command, suggestion: { ...command.suggestion, title: 'Changed' } })).status).toBe('conflict')
    expect((await call('50000000-0000-4000-8000-000000000002', { ...command, authorId: owner })).status).toBe('invalid')
    await actor(viewer)
    expect((await call('50000000-0000-4000-8000-000000000003', command)).status).toBe('forbidden')
    await actor(outsider)
    expect((await call('50000000-0000-4000-8000-000000000004', command)).status).toBe('forbidden')
    await db.exec('reset role')
    await db.query('delete from public.suggestions where id=$1', [command.suggestionId])
    await actor(editorA)
    const deletedRetry = await call(commandId, command)
    expect(deletedRetry.status).toBe('alreadyApplied')
    expect(deletedRetry).toHaveProperty('suggestion', null)
  })

  it('merges explicit ballots and stable comments into current JSON without losing peers', async () => {
    await actor(editorA)
    expect((await call('50000000-0000-4000-8000-000000000010', { type: 'suggestion.ballot', suggestionId: suggestion, value: 1 })).status).toBe('applied')
    await actor(editorB)
    expect((await call('50000000-0000-4000-8000-000000000011', { type: 'suggestion.ballot', suggestionId: suggestion, value: -1 })).status).toBe('applied')
    await actor(editorA)
    const remove = await call('50000000-0000-4000-8000-000000000012', { type: 'suggestion.ballot', suggestionId: suggestion, value: null })
    expect(remove.suggestion).toMatchObject({ votes: [{ userId: editorB, value: -1 }] })
    const comment = { type: 'suggestion.comment', suggestionId: suggestion, commentId: 'cm_A_1', text: 'Looks good' }
    expect((await call('50000000-0000-4000-8000-000000000013', comment)).status).toBe('applied')
    const beforeRetry = { activity: await count('activity'), notifications: await count('notifications') }
    expect((await call('50000000-0000-4000-8000-000000000013', comment)).status).toBe('alreadyApplied')
    expect(await count('activity')).toBe(beforeRetry.activity)
    expect(await count('notifications')).toBe(beforeRetry.notifications)
    await actor(editorB)
    const commentB = await call('50000000-0000-4000-8000-000000000014', { ...comment, commentId: 'cm_B_1', text: 'Also good' })
    expect(commentB.suggestion).toMatchObject({ comments: [{ authorId: editorA }, { authorId: editorB }] })
  })

  it('keeps decision option payloads, binds authors, and makes failed inserts atomic', async () => {
    await actor(editorA)
    const create = {
      type: 'decision.create', decisionId: decision,
      decision: { question: 'Choose a place', options: [
        { id: 'place-a', label: 'A', place: { title: 'A', dayIndex: 1, lat: 1.2 } },
        { id: 'place-b', label: 'B', costImpactInr: 100 },
      ] },
    }
    const before = { activity: await count('activity'), notifications: await count('notifications') }
    const createResult = await call('50000000-0000-4000-8000-000000000020', create)
    expect(createResult).toMatchObject({ status: 'applied' })
    const afterCreate = { activity: await count('activity'), notifications: await count('notifications') }
    expect(afterCreate.activity).toBe(before.activity + 1)
    expect(afterCreate.notifications).toBeGreaterThan(before.notifications)
    const duplicate = await call('50000000-0000-4000-8000-000000000021', { ...create, decision: { ...create.decision, question: 'Duplicate' } })
    expect(duplicate.status).toBe('conflict')
    expect(await count('activity')).toBe(afterCreate.activity)
    expect(await count('notifications')).toBe(afterCreate.notifications)
    const forged = await call('50000000-0000-4000-8000-000000000022', { type: 'decision.comment', decisionId: decision, commentId: 'cm_bad', text: 'x', authorId: owner })
    expect(forged.status).toBe('invalid')
    expect((await call('50000000-0000-4000-8000-000000000044', { type: 'decision.comment', decisionId: decision, text: 'missing id' })).status).toBe('invalid')
    expect((await call('50000000-0000-4000-8000-000000000045', { type: 'decision.comment', decisionId: decision, commentId: 'cm_null', text: null })).status).toBe('invalid')
    expect((await call('50000000-0000-4000-8000-000000000046', { type: 'decision.ballot', decisionId: decision })).status).toBe('invalid')
    const comment = await call('50000000-0000-4000-8000-000000000023', { type: 'decision.comment', decisionId: decision, commentId: 'cm_decision_A', text: 'x' })
    expect(comment.decision).toMatchObject({ comments: [{ authorId: editorA, id: 'cm_decision_A' }] })
    const beforeRetry = await count('activity')
    expect((await call('50000000-0000-4000-8000-000000000023', { type: 'decision.comment', decisionId: decision, commentId: 'cm_decision_A', text: 'x' })).status).toBe('alreadyApplied')
    expect(await count('activity')).toBe(beforeRetry)
    await actor(editorB)
    const voteB = await call('50000000-0000-4000-8000-000000000024', { type: 'decision.ballot', decisionId: decision, optionId: 'place-b' })
    expect(voteB.decision).toMatchObject({ votes_by_user_id: { [editorB]: 'place-b' } })
    await actor(editorA)
    const voteA = await call('50000000-0000-4000-8000-000000000025', { type: 'decision.ballot', decisionId: decision, optionId: 'place-a' })
    expect(voteA.decision).toMatchObject({ votes_by_user_id: { [editorA]: 'place-a', [editorB]: 'place-b' } })
    const removedA = await call('50000000-0000-4000-8000-000000000026', { type: 'decision.ballot', decisionId: decision, optionId: null })
    expect(removedA.decision).toMatchObject({ votes_by_user_id: { [editorB]: 'place-b' } })
    await actor(editorB)
    const commentB = await call('50000000-0000-4000-8000-000000000027', { type: 'decision.comment', decisionId: decision, commentId: 'cm_decision_B', text: 'y' })
    expect(commentB.decision).toMatchObject({ comments: [{ authorId: editorA }, { authorId: editorB }] })
    expect((await call('50000000-0000-4000-8000-000000000047', { type: 'decision.ballot', decisionId: decision, optionId: '' })).status).toBe('invalid')
    const activity = await call('50000000-0000-4000-8000-000000000028', { type: 'activity.append', activityId: '60000000-0000-4000-8000-000000000028', verb: 'added a note' })
    expect(activity.status).toBe('applied')
    await expect(call('50000000-0000-4000-8000-000000000029', { type: 'activity.append', activityId: '60000000-0000-4000-8000-000000000029', verb: null })).resolves.toMatchObject({ status: 'invalid' })
  })

  it('blocks direct JSON and activity writes but keeps authorized workflow edits', async () => {
    await actor(editorA)
    await expect(db.query(`update public.suggestions set votes='[]' where id='${suggestion}'`)).rejects.toThrow(/submit_collab_command/)
    await expect(db.query(`update public.suggestions set id=gen_random_uuid() where id='${suggestion}'`)).rejects.toThrow(/submit_collab_command/)
    await expect(db.query(`update public.decisions set id=gen_random_uuid() where id='${decision}'`)).rejects.toThrow(/submit_collab_command/)
    await expect(db.query(`insert into public.activity(id,trip_id,actor_id,verb) values(gen_random_uuid(),'${trip}','${editorA}','forged')`)).rejects.toThrow(/row-level security/)
    expect((await db.query(`update public.suggestions set title='Shared edit' where id='${suggestion}'`)).rowCount).toBe(1)
    await db.query(`update public.suggestions set status='declined' where id='${suggestion}'`)
    await actor(editorB)
    const ownNotifications = await db.query('select user_id from public.notifications')
    expect(ownNotifications.rows.every(row => row.user_id === editorB)).toBe(true)
    expect((await db.query(`update public.notifications set read=true where user_id='${owner}'`)).rowCount).toBe(0)
    expect((await db.query(`delete from public.notifications where user_id='${owner}'`)).rowCount).toBe(0)
    await actor(viewer)
    expect((await db.query(`update public.suggestions set title='viewer edit' where id='${suggestion}'`)).rowCount).toBe(0)
    await actor(outsider)
    expect((await db.query(`update public.suggestions set title='outsider edit' where id='${suggestion}'`)).rowCount).toBe(0)
  })

  it('rejects malformed persisted JSON without erasing a peer contribution', async () => {
    await db.exec('reset role')
    const original = await db.query<{ votes: unknown; comments: unknown }>('select votes,comments from public.suggestions where id=$1', [suggestion])
    const originalDecision = await db.query<{ votes_by_user_id: unknown }>('select votes_by_user_id from public.decisions where id=$1', [decision])
    await db.exec(`reset role; update public.suggestions set votes='[{"value":1}]', comments='[{"id":"legacy-no-author","text":"kept"}]' where id='${suggestion}'`)
    await actor(editorA)
    expect((await call('50000000-0000-4000-8000-000000000040', { type: 'suggestion.comment', suggestionId: suggestion, commentId: 'cm_invalid', text: 'x' })).status).toBe('invalid')
    expect((await call('50000000-0000-4000-8000-000000000041', { type: 'suggestion.ballot', suggestionId: suggestion, value: 1 })).status).toBe('invalid')
    expect((await call('50000000-0000-4000-8000-000000000042', { type: 'suggestion.comment', suggestionId: suggestion, text: 'missing id' })).status).toBe('invalid')
    expect((await call('50000000-0000-4000-8000-000000000043', { type: 'suggestion.ballot', suggestionId: suggestion })).status).toBe('invalid')
    expect((await call('50000000-0000-4000-8000-000000000048', { type: 'suggestion.comment', suggestionId: suggestion, commentId: 'cm_null_text', text: null })).status).toBe('invalid')
    await db.exec('reset role')
    await db.query("update public.decisions set votes_by_user_id=jsonb_build_object($1::text,null) where id=$2", [editorB, decision])
    await actor(editorA)
    expect((await call('50000000-0000-4000-8000-000000000049', { type: 'decision.ballot', decisionId: decision, optionId: 'place-a' })).status).toBe('invalid')
    await db.exec('reset role')
    await db.query('update public.suggestions set votes=$1::jsonb,comments=$2::jsonb where id=$3', [JSON.stringify(original.rows[0].votes), JSON.stringify(original.rows[0].comments), suggestion])
    await db.query('update public.decisions set votes_by_user_id=$1::jsonb where id=$2', [JSON.stringify(originalDecision.rows[0].votes_by_user_id), decision])
    await actor(editorA)
  })

  it('keeps trip CAS revisions separate from contribution commands', async () => {
    await db.exec('reset role')
    const baseline = await db.query<{ write_version: number }>('select write_version from public.trips where id=$1', [trip])
    const startingRevision = baseline.rows[0].write_version
    await actor(editorA)
    const contribution = await call('50000000-0000-4000-8000-000000000050', {
      type: 'activity.append', activityId: '60000000-0000-4000-8000-000000000050', verb: 'checked revision ordering',
    })
    expect(contribution.tripRevision).toBe(startingRevision)
    await db.exec('reset role')
    const accepted = await db.query<{ write_version: number }>(
      'update public.trips set write_version=write_version where id=$1 and write_version=$2 returning write_version',
      [trip, startingRevision],
    )
    expect(accepted.rowCount).toBe(1)
    expect(accepted.rows[0].write_version).toBeGreaterThan(startingRevision)
    const stale = await db.query(
      'update public.trips set write_version=write_version where id=$1 and write_version=$2 returning write_version',
      [trip, startingRevision],
    )
    expect(stale.rowCount).toBe(0)
  })

  it('clears an Undo archive when the recreated trip is permanently purged', async () => {
    const secondTrip = '20000000-0000-4000-8000-000000000002'
    const secondSuggestion = '30000000-0000-4000-8000-000000000020'
    await db.exec(`reset role; insert into public.trips(id,owner_id) values('${secondTrip}','${owner}'); insert into public.trip_members values('${secondTrip}','${owner}','owner'); insert into public.suggestions(id,trip_id,proposed_by,title) values('${secondSuggestion}','${secondTrip}','${owner}','Archived row')`)
    await actor(owner)
    await db.query('delete from public.trips where id=$1', [secondTrip])
    await db.exec('reset role')
    const archive = await db.query<{ count: number }>('select count(*)::int as count from public.trip_contribution_restore_events where trip_id=$1', [secondTrip])
    expect(archive.rows[0].count).toBe(1)
    await db.exec(`insert into public.trips(id,owner_id) values('${secondTrip}','${owner}'); insert into public.trip_members values('${secondTrip}','${owner}','owner'); update public.trips set deleted_at=clock_timestamp() where id='${secondTrip}'; delete from public.trips where id='${secondTrip}'; insert into public.trips(id,owner_id) values('${secondTrip}','${owner}'); insert into public.trip_members values('${secondTrip}','${owner}','owner')`)
    await actor(owner)
    const staleUndo = await db.query<{ receipt: Record<string, unknown> }>('select public.restore_trip_contributions($1) as receipt', [secondTrip])
    expect(staleUndo.rows[0].receipt.status).toBe('forbidden')
    await db.exec('reset role')
    expect((await db.query('select id from public.suggestions where id=$1', [secondSuggestion])).rowCount).toBe(0)
  })

  it('archives original contributions before delete and restores only the server snapshot', async () => {
    await actor(owner)
    await db.exec(`reset role; delete from public.trips where id='${trip}'; insert into public.trips(id,owner_id) values('${trip}','${owner}'); insert into public.trip_members values('${trip}','${owner}','owner'),('${trip}','${editorA}','editor'),('${trip}','${editorB}','editor'),('${trip}','${viewer}','viewer');`)
    await actor(owner)
    const restored = await db.query<{ receipt: Record<string, unknown> }>('select public.restore_trip_contributions($1) as receipt', [trip])
    expect(restored.rows[0].receipt.status).toBe('applied')
    expect(restored.rows[0].receipt.restoredRows).toBeGreaterThan(0)
    await db.exec('reset role')
    const row = await db.query<{ proposed_by: string; votes: unknown; comments: unknown }>('select proposed_by,votes,comments from public.suggestions where id=$1', [suggestion])
    expect(row.rows[0]).toMatchObject({
      proposed_by: owner,
      votes: [{ userId: editorB, value: -1 }],
      comments: [{ authorId: editorA, id: 'cm_A_1' }, { authorId: editorB, id: 'cm_B_1' }],
    })
    await actor(owner)
    const retry = await db.query<{ receipt: Record<string, unknown> }>('select public.restore_trip_contributions($1) as receipt', [trip])
    expect(retry.rows[0].receipt.status).toBe('alreadyApplied')
    await db.exec(`reset role; insert into public.trip_contribution_restore_events(trip_id,owner_id,suggestions,decisions,activity,notifications) values('${trip}','${owner}','[{"proposed_by":"${editorB}"}]','[]','[]','[]'); delete from public.profiles where id='${editorB}'`)
    const retainedActorArchive = await db.query<{ count: number }>(`select count(*)::int as count from public.trip_contribution_restore_events where position('${editorB}' in suggestions::text)>0`)
    expect(retainedActorArchive.rows[0].count).toBe(0)
    await db.exec('drop schema cron cascade')
    await actor(owner)
    await expect(db.query(`delete from public.trips where id='${trip}'`)).rejects.toThrow(/Enable pg_cron before hard delete/)
    await db.exec('reset role')
    expect((await db.query(`select id from public.trips where id='${trip}'`)).rowCount).toBe(1)
    expect((await db.query(`select id from public.suggestions where id='${suggestion}'`)).rowCount).toBe(1)
  })

  it('rolls back content, activity, notices, and command receipt after a late database failure', async () => {
    await db.exec("reset role; alter table public.notifications add constraint reject_synthetic_notice check (text <> 'A crew member suggested “Forced failure”.')")
    await actor(editorA)
    const before = { suggestions: await count('suggestions'), activity: await count('activity'), notifications: await count('notifications') }
    const failed = await call('50000000-0000-4000-8000-000000000030', {
      type: 'suggestion.create', suggestionId: '30000000-0000-4000-8000-000000000030',
      suggestion: { dayIndex: 0, title: 'Forced failure', visitMinutes: 30, estimatedEntryFeeInr: 0, estimatedTransportInr: 0 },
    })
    expect(failed.status).toBe('unavailable')
    expect(await count('suggestions')).toBe(before.suggestions)
    expect(await count('activity')).toBe(before.activity)
    expect(await count('notifications')).toBe(before.notifications)
    await db.exec('reset role; alter table public.notifications drop constraint reject_synthetic_notice')
  })

  it('lets only the author or the trip owner delete a contribution', async () => {
    await db.exec(`reset role; insert into public.profiles(id) values('${editorB}') on conflict do nothing; insert into public.trip_members(trip_id,user_id,role) values('${trip}','${editorB}','editor') on conflict do nothing;`)
    await actor(editorB)
    const peerId = '30000000-0000-4000-8000-000000000060'
    const probeReceipt = await call('50000000-0000-4000-8000-000000000060', {
      type: 'suggestion.create', suggestionId: peerId,
      suggestion: { dayIndex: 0, title: 'Peer delete probe', visitMinutes: 10, estimatedEntryFeeInr: 0, estimatedTransportInr: 0 },
    })
    expect(probeReceipt.status).toBe('applied')
    await actor(editorA)
    expect((await db.query(`delete from public.suggestions where id='${peerId}'`)).rowCount).toBe(0)
    await actor(editorB)
    expect((await db.query(`delete from public.suggestions where id='${peerId}'`)).rowCount).toBe(1)

    const ownerDeleteId = '30000000-0000-4000-8000-000000000061'
    await call('50000000-0000-4000-8000-000000000061', {
      type: 'suggestion.create', suggestionId: ownerDeleteId,
      suggestion: { dayIndex: 0, title: 'Owner delete probe', visitMinutes: 10, estimatedEntryFeeInr: 0, estimatedTransportInr: 0 },
    })
    await actor(owner)
    expect((await db.query(`delete from public.suggestions where id='${ownerDeleteId}'`)).rowCount).toBe(1)

    const decisionId = '40000000-0000-4000-8000-000000000060'
    await actor(editorB)
    await call('50000000-0000-4000-8000-000000000062', {
      type: 'decision.create', decisionId,
      decision: { question: 'Peer delete probe', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    })
    await actor(editorA)
    expect((await db.query(`delete from public.decisions where id='${decisionId}'`)).rowCount).toBe(0)
    await actor(owner)
    expect((await db.query(`delete from public.decisions where id='${decisionId}'`)).rowCount).toBe(1)
  })
})
