import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readSql = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const owner = '10000000-0000-4000-8000-000000000001'
const editorA = '10000000-0000-4000-8000-000000000002'
const editorB = '10000000-0000-4000-8000-000000000003'
const viewer = '10000000-0000-4000-8000-000000000004'
const trip = '20000000-0000-4000-8000-000000000001'
const suggestion = '30000000-0000-4000-8000-000000000001'
const decision = '40000000-0000-4000-8000-000000000001'
const command = (id: number) => `50000000-0000-4000-8000-${String(id).padStart(12, '0')}`

describe('stage-c/838 atomic collaboration transitions', () => {
  let db: PGlite
  let currentActor = owner

  const actor = async (id: string) => {
    currentActor = id
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`)
  }
  const call = async (commandId: string, payload: unknown, tripId = trip) => {
    const result = await db.query<{ receipt: Record<string, unknown> }>(
      'select public.submit_collab_command($1,$2,$3::jsonb) as receipt',
      [commandId, tripId, JSON.stringify(payload)],
    )
    return result.rows[0].receipt
  }
  const tripState = async (tripId = trip) => {
    await db.exec('reset role')
    const result = await db.query<{ days: Array<{ id: string; index: number; stops: Array<Record<string, unknown>> }>; write_version: number }>(
      'select days, write_version from public.trips where id=$1', [tripId],
    )
    await actor(currentActor)
    return result.rows[0]
  }
  const count = async (table: 'activity' | 'suggestions' | 'decisions' | 'notifications') => {
    await db.exec('reset role')
    const result = await db.query<{ count: number }>(`select count(*)::int as count from public.${table}`)
    await actor(currentActor)
    return result.rows[0].count
  }
  const seedTrip = async (id: string, days: unknown) => {
    await db.exec('reset role')
    await db.query('insert into public.trips(id,owner_id,days) values($1,$2,$3::jsonb)', [id, owner, JSON.stringify(days)])
    await db.query('insert into public.trip_members(trip_id,user_id,role) values($1,$2,\'owner\'),($1,$3,\'editor\'),($1,$4,\'editor\'),($1,$5,\'viewer\')', [id, owner, editorA, editorB, viewer])
    await actor(currentActor)
  }

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create table public.profiles(id uuid primary key);
      create table public.trips(id uuid primary key, owner_id uuid not null, days jsonb not null default '[]', write_version bigint not null default 7, deleted_at timestamptz);
      create table public.trip_members(trip_id uuid not null references public.trips(id), user_id uuid not null references public.profiles(id), role text not null, primary key(trip_id,user_id));
      create table public.suggestions(
        id uuid primary key, trip_id uuid not null references public.trips(id), day_index integer not null default 0,
        day_id text, place jsonb, accepted_stop_id text, proposed_by uuid not null references public.profiles(id),
        title text not null default '', category text, location_name text, lat double precision, lng double precision,
        description text, visit_minutes integer not null default 60, estimated_entry_fee_inr integer not null default 0,
        estimated_transport_inr integer not null default 0, votes jsonb not null default '[]', comments jsonb not null default '[]',
        status text not null default 'open', created_at bigint not null default 1
      );
      create table public.decisions(
        id uuid primary key, trip_id uuid not null references public.trips(id), question text not null default '', context text,
        options jsonb not null default '[]', votes_by_user_id jsonb not null default '{}', comments jsonb not null default '[]',
        status text not null default 'open', resolved_option_id text, resolved_stop_id text, raised_by uuid not null,
        created_at bigint not null default 1, resolved_at bigint
      );
      create table public.activity(id uuid primary key, trip_id uuid not null references public.trips(id), actor_id uuid not null, verb text not null, target text, at bigint not null default 1);
      create table public.notifications(id uuid primary key, user_id uuid not null, trip_id uuid references public.trips(id), text text not null, read boolean not null default false, at bigint not null default 1);
      create table public.collab_commands(command_id uuid primary key, trip_id uuid not null, actor_id uuid not null, command_hash text not null, receipt jsonb not null, created_at timestamptz not null default now());
      create function public.advance_trip_write_version() returns trigger language plpgsql as $$
        begin new.write_version:=old.write_version+1; return new; end
      $$;
      create trigger trips_advance_write_version before update on public.trips for each row execute function public.advance_trip_write_version();
      create function public.is_disabled() returns boolean language sql stable as $$ select false $$;
      create function public.is_admin() returns boolean language sql stable as $$ select false $$;
      create function public.is_editor(p_trip uuid) returns boolean language sql stable security definer set search_path=public as $$
        select exists(select 1 from public.trip_members where trip_id=p_trip and user_id=auth.uid() and role in ('owner','editor'))
      $$;
      insert into public.profiles values ('${owner}'),('${editorA}'),('${editorB}'),('${viewer}');
      create function public.guard_collab_contribution_columns() returns trigger language plpgsql set search_path='' as $$
      begin
        if current_user in ('postgres','service_role') then return new; end if;
        if tg_table_name='suggestions' and (to_jsonb(new)->'votes' is distinct from to_jsonb(old)->'votes' or to_jsonb(new)->'comments' is distinct from to_jsonb(old)->'comments') then
          raise exception 'use submit_collab_command' using errcode='42501';
        end if;
        if tg_table_name='decisions' and (to_jsonb(new)->'votes_by_user_id' is distinct from to_jsonb(old)->'votes_by_user_id' or to_jsonb(new)->'comments' is distinct from to_jsonb(old)->'comments') then
          raise exception 'use submit_collab_command' using errcode='42501';
        end if;
        return new;
      end $$;
      create trigger suggestions_guard_contributions before update on public.suggestions for each row execute function public.guard_collab_contribution_columns();
      create trigger decisions_guard_contributions before update on public.decisions for each row execute function public.guard_collab_contribution_columns();
      alter table public.suggestions enable row level security;
      alter table public.decisions enable row level security;
      alter table public.activity enable row level security;
      alter table public.notifications enable row level security;
      create policy suggestions_write on public.suggestions for all using(public.is_editor(trip_id)) with check(public.is_editor(trip_id));
      create policy decisions_write on public.decisions for all using(public.is_editor(trip_id)) with check(public.is_editor(trip_id));
      create policy activity_write on public.activity for all using(public.is_editor(trip_id)) with check(public.is_editor(trip_id));
      create policy notifications_write on public.notifications for all using(public.is_editor(trip_id)) with check(public.is_editor(trip_id));
      grant usage on schema public, auth to authenticated;
      grant select,insert,update,delete on all tables in schema public to authenticated;
      grant execute on all functions in schema public to authenticated;
    `)
    await db.exec(readSql('supabase/migrations/20261025a_collab_transitions.sql'))
    await db.exec(readSql('supabase/migrations/20261025c_place_exposure.sql'))
    await db.exec(readSql('supabase/migrations/20261025b_collab_transition_cutover.sql'))
    await db.exec(readSql('supabase/migrations/20261025a_collab_transitions.sql'))
    await db.exec(readSql('supabase/migrations/20261025c_place_exposure.sql'))
    await db.exec(readSql('supabase/migrations/20261025b_collab_transition_cutover.sql'))
    await seedTrip(trip, [
      { id: 'day-a', index: 0, title: 'First day', stops: [] },
      { id: 'day-b', index: 1, title: 'Second day', stops: [] },
    ])
    await db.exec('reset role')
    await db.query(`insert into public.suggestions(id,trip_id,day_index,day_id,proposed_by,title,category,location_name,lat,lng,place,status)
      values($1,$2,0,'day-a',$3,'Museum','sightseeing','City Museum',12.9,77.6,'{"exposure":"unknown","placeId":"place-museum","source":"google"}','open')`, [suggestion, trip, owner])
    await db.query(`insert into public.decisions(id,trip_id,question,options,votes_by_user_id,comments,status,raised_by)
      values($1,$2,'Pick a stop',$3::jsonb,'{}','[]','open',$4)`, [decision, trip, JSON.stringify([
        { id: 'slot:lunch:place-a', label: 'Cafe A', place: { title: 'Cafe A', category: 'food', locationName: 'Cafe A', lat: 12.91, lng: 77.61, visitMinutes: 45, dayId: 'day-missing', dayIndex: 0 } },
        { id: 'plain', label: 'No place' },
      ]), owner])
    await actor(owner)
  }, 30_000)

  afterAll(async () => db?.close())

  it('acknowledges sequential second-client acceptance with the same stop and one event', async () => {
    const beforeEvents = await count('activity')
    await actor(editorA)
    const first = await call(command(1), { type: 'suggestion.accept', suggestionId: suggestion, expectedRevision: 7 })
    await actor(editorB)
    const second = await call(command(2), { type: 'suggestion.accept', suggestionId: suggestion, expectedRevision: 7 })
    expect(first).toMatchObject({ status: 'applied', stopId: expect.any(String) })
    expect(second).toMatchObject({ status: 'alreadyApplied', stopId: first.stopId })
    const saved = await tripState()
    expect(saved.days.flatMap(day => day.stops)).toHaveLength(1)
    expect(saved.write_version).toBe(8)
    expect(await count('activity')).toBe(beforeEvents + 1)
  })

  it('keeps a deleted-day suggestion open and leaves the trip unchanged', async () => {
    const otherTrip = '20000000-0000-4000-8000-000000000002'
    const otherSuggestion = '30000000-0000-4000-8000-000000000002'
    await seedTrip(otherTrip, [{ id: 'current', index: 1, title: 'Only day', stops: [] }])
    await db.exec('reset role')
    await db.query(`insert into public.suggestions(id,trip_id,day_index,day_id,proposed_by,title,category,location_name,lat,lng,status)
      values($1,$2,0,'deleted-day',$3,'Museum','sightseeing','City Museum',12.9,77.6,'open')`, [otherSuggestion, otherTrip, owner])
    await actor(editorA)
    const before = await tripState(otherTrip)
    const outcome = await call(command(3), { type: 'suggestion.accept', suggestionId: otherSuggestion, expectedRevision: 7 }, otherTrip)
    expect(outcome).toMatchObject({ status: 'needsDay', availableDays: [{ id: 'current', index: 1 }] })
    await db.exec('reset role')
    const row = await db.query<{ status: string }>('select status from public.suggestions where id=$1', [otherSuggestion])
    await actor(editorA)
    expect(row.rows[0].status).toBe('open')
    expect(await tripState(otherTrip)).toEqual(before)
  })

  it('returns forbidden for viewers and makes repeated decline a no-op', async () => {
    const otherTrip = '20000000-0000-4000-8000-000000000006'
    const otherSuggestion = '30000000-0000-4000-8000-000000000006'
    await seedTrip(otherTrip, [{ id: 'day', index: 0, title: 'Day', stops: [] }])
    await db.exec('reset role')
    await db.query(`insert into public.suggestions(id,trip_id,day_index,day_id,proposed_by,title,category,location_name,lat,lng,status)
      values($1,$2,0,'day',$3,'Museum','sightseeing','City Museum',12.9,77.6,'open')`, [otherSuggestion, otherTrip, owner])
    const beforeEvents = await count('activity')
    await actor(viewer)
    expect(await call(command(11), { type: 'suggestion.decline', suggestionId: otherSuggestion }, otherTrip)).toMatchObject({ status: 'forbidden' })
    await actor(editorA)
    expect(await call(command(12), { type: 'suggestion.decline', suggestionId: otherSuggestion }, otherTrip)).toMatchObject({ status: 'applied' })
    expect(await call(command(13), { type: 'suggestion.decline', suggestionId: otherSuggestion }, otherTrip)).toMatchObject({ status: 'alreadyApplied' })
    await db.exec('reset role')
    const row = await db.query<{ status: string }>('select status from public.suggestions where id=$1', [otherSuggestion])
    await actor(editorA)
    expect(row.rows[0].status).toBe('declined')
    expect(await count('activity')).toBe(beforeEvents + 1)
  })

  it('rolls back the stop and status after a late activity constraint failure', async () => {
    const otherTrip = '20000000-0000-4000-8000-000000000003'
    const otherSuggestion = '30000000-0000-4000-8000-000000000003'
    await seedTrip(otherTrip, [{ id: 'day', index: 0, title: 'Day', stops: [] }])
    await db.exec('reset role')
    await db.query(`insert into public.suggestions(id,trip_id,day_index,day_id,place,proposed_by,title,category,location_name,lat,lng,status)
      values($1,$2,0,'day','{"source":"google","placeId":"rollback-museum","exposure":"outdoor"}',$3,'Museum','sightseeing','City Museum',12.9,77.6,'open')`, [otherSuggestion, otherTrip, owner])
    await db.exec("alter table public.activity add constraint reject_accept_activity check (verb <> 'accepted suggestion into timeline') not valid")
    try {
      const beforeEvents = await count('activity')
      await actor(editorA)
      const beforeTrip = await tripState(otherTrip)
      expect(await call(command(4), { type: 'suggestion.accept', suggestionId: otherSuggestion, expectedRevision: 7 }, otherTrip)).toMatchObject({ status: 'unavailable' })
      await db.exec('reset role')
      const row = await db.query<{ status: string }>('select status from public.suggestions where id=$1', [otherSuggestion])
      await actor(editorA)
      expect(row.rows[0].status).toBe('open')
      expect(await tripState(otherTrip)).toEqual(beforeTrip)
      expect(await count('activity')).toBe(beforeEvents)
    } finally {
      // The constraint must not poison accepts in later tests. Drop as the
      // table owner — the body leaves the session as an authenticated actor.
      await db.exec('reset role')
      await db.exec('alter table public.activity drop constraint if exists reject_accept_activity')
    }
  })

  it('freezes terminal ballots, keeps comments open, and rejects accepted-to-declined', async () => {
    const otherTrip = '20000000-0000-4000-8000-000000000004'
    const otherSuggestion = '30000000-0000-4000-8000-000000000004'
    await seedTrip(otherTrip, [{ id: 'day', index: 0, title: 'Day', stops: [] }])
    await db.exec('reset role')
    await db.query(`insert into public.suggestions(id,trip_id,day_index,day_id,proposed_by,title,category,location_name,lat,lng,status)
      values($1,$2,0,'day',$3,'Museum','sightseeing','City Museum',12.9,77.6,'open')`, [otherSuggestion, otherTrip, owner])
    await actor(editorA)
    const accepted = await call(command(5), { type: 'suggestion.accept', suggestionId: otherSuggestion, expectedRevision: 7 }, otherTrip)
    expect(accepted.status).toBe('applied')
    expect((await call(command(6), { type: 'suggestion.ballot', suggestionId: otherSuggestion, value: 1 }, otherTrip)).status).toBe('invalid')
    expect((await call(command(7), { type: 'suggestion.comment', suggestionId: otherSuggestion, commentId: 'cm_closed', text: 'Still useful' }, otherTrip)).status).toBe('applied')
    expect((await call(command(8), { type: 'suggestion.decline', suggestionId: otherSuggestion }, otherTrip)).status).toBe('conflict')
    await actor(editorA)
    await expect(db.query(`update public.suggestions set status='declined' where id='${otherSuggestion}'`)).rejects.toThrow(/submit_collab_command/)
  })

  it('keeps a stale-day winner and places it later on the chosen stable day', async () => {
    const otherTrip = '20000000-0000-4000-8000-000000000005'
    const otherDecision = '40000000-0000-4000-8000-000000000005'
    await seedTrip(otherTrip, [{ id: 'current', index: 0, title: 'Current day', stops: [] }])
    await db.exec('reset role')
    await db.query(`insert into public.decisions(id,trip_id,question,options,votes_by_user_id,comments,status,raised_by)
      values($1,$2,'Where?',$3::jsonb,'{}','[]','open',$4)`, [otherDecision, otherTrip, JSON.stringify([
        { id: 'slot:lunch:cafe', label: 'Cafe', place: { title: 'Cafe', category: 'food', locationName: 'Cafe', lat: 12.9, lng: 77.6, visitMinutes: 45, dayId: 'deleted-day', dayIndex: 0 } },
      ]), owner])
    const beforeEvents = await count('activity')
    const beforeNotices = await count('notifications')
    await actor(editorA)
    const first = await call(command(9), { type: 'decision.resolve', decisionId: otherDecision, optionId: 'slot:lunch:cafe', expectedRevision: 7 }, otherTrip)
    expect(first).toMatchObject({ status: 'applied', winnerId: 'slot:lunch:cafe', placementStatus: 'needsDay' })
    await db.exec('reset role')
    const resolved = await db.query<{ status: string; resolved_option_id: string; resolved_stop_id: string | null }>(
      'select status,resolved_option_id,resolved_stop_id from public.decisions where id=$1', [otherDecision],
    )
    await actor(editorB)
    const retry = await call(command(10), { type: 'decision.resolve', decisionId: otherDecision, optionId: 'slot:lunch:cafe', expectedRevision: 7, dayId: 'current' }, otherTrip)
    // The resolve must persist the decision row on the first command — a
    // notification id clobbering the decision id here would leave it open.
    expect(resolved.rows[0]).toEqual({ status: 'resolved', resolved_option_id: 'slot:lunch:cafe', resolved_stop_id: null })
    expect(retry).toMatchObject({ status: 'alreadyApplied', winnerId: 'slot:lunch:cafe', placementStatus: 'applied', stopId: expect.any(String) })
    const saved = await tripState(otherTrip)
    expect(saved.days[0].stops).toHaveLength(1)
    expect(saved.days[0].stops[0]).toMatchObject({ slotKey: 'lunch', title: 'Cafe' })
    await db.exec('reset role')
    const settled = await db.query<{ status: string; resolved_stop_id: string | null }>(
      'select status,resolved_stop_id from public.decisions where id=$1', [otherDecision],
    )
    await actor(editorB)
    expect(settled.rows[0].status).toBe('resolved')
    expect(settled.rows[0].resolved_stop_id).toBe(retry.stopId)
    expect(await count('activity')).toBe(beforeEvents + 1)
    // One notice per other member on the first resolve; the retry adds none.
    expect(await count('notifications')).toBe(beforeNotices + 3)
  })

  it('persists and lands each explicit exposure through suggestion and decision RPC paths', async () => {
    const exposures = ['indoor', 'outdoor', 'unknown'] as const
    let sequence = 20
    for (const exposure of exposures) {
      const suggestionId = `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
      const created = await call(command(sequence++), {
        type: 'suggestion.create', suggestionId,
        suggestion: {
          dayIndex: 0, dayId: 'day-a', title: `Suggestion ${exposure}`, category: 'sightseeing',
          locationName: `Museum ${exposure}`, lat: 12.91, lng: 77.61, description: '', visitMinutes: 45,
          estimatedEntryFeeInr: 0, estimatedTransportInr: 0,
          place: { source: 'google', placeId: `place-${exposure}`, exposure },
        },
      })
      expect(created).toMatchObject({ status: 'applied', suggestion: { place: { exposure } } })
      const beforeAccept = await tripState()
      const accepted = await call(command(sequence++), {
        type: 'suggestion.accept', suggestionId, expectedRevision: beforeAccept.write_version, dayId: 'day-a',
      })
      expect(accepted).toMatchObject({ status: 'applied', stopId: expect.any(String) })
      expect((await tripState()).days[0].stops.at(-1)).toMatchObject({ placeId: `place-${exposure}`, placeSource: 'google', exposure })

      const decisionId = `40000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
      const optionId = `slot:lunch:${exposure}`
      const decisionCreated = await call(command(sequence++), {
        type: 'decision.create', decisionId,
        decision: {
          question: `Visit ${exposure} museum?`, options: [
            { id: optionId, label: `Museum ${exposure}`, place: {
              title: `Museum ${exposure}`, category: 'sightseeing', locationName: `Museum ${exposure}`,
              lat: 12.92, lng: 77.62, visitMinutes: 45, dayId: 'day-a', dayIndex: 0,
              slotKey: 'lunch', place: { source: 'google', placeId: `poll-${exposure}`, exposure },
            } },
            { id: `plain:${exposure}`, label: 'Skip' },
          ],
        },
      })
      // options is an array of every authored option; match the poll option
      // by element so identity, count and exposure all stay verified.
      expect(decisionCreated).toMatchObject({ status: 'applied', decision: { options: [
        { id: optionId, label: `Museum ${exposure}`, place: { place: { placeId: `poll-${exposure}`, source: 'google', exposure } } },
        { id: `plain:${exposure}`, label: 'Skip' },
      ] } })
      const beforeResolve = await tripState()
      const resolved = await call(command(sequence++), {
        type: 'decision.resolve', decisionId, optionId, expectedRevision: beforeResolve.write_version, dayId: 'day-a',
      })
      expect(resolved).toMatchObject({ status: 'applied', placementStatus: 'applied', winnerId: optionId })
      expect((await tripState()).days[0].stops.at(-1)).toMatchObject({ placeId: `poll-${exposure}`, placeSource: 'google', exposure, slotKey: 'lunch' })
    }
  })

  it('defaults omitted exposure to unknown and rejects malformed suggestion and poll identities', async () => {
    const omittedSuggestion = '30000000-0000-4000-8000-000000000030'
    const created = await call(command(40), {
      type: 'suggestion.create', suggestionId: omittedSuggestion,
      suggestion: {
        dayIndex: 0, dayId: 'day-a', title: 'No exposure evidence', category: 'sightseeing',
        locationName: 'Museum', lat: 12.9, lng: 77.6, description: '', visitMinutes: 45,
        estimatedEntryFeeInr: 0, estimatedTransportInr: 0,
        place: { source: 'google', placeId: 'no-evidence' },
      },
    })
    expect(created).toMatchObject({ status: 'applied', suggestion: { place: { exposure: 'unknown' } } })

    const omittedPoll = await call(command(51), {
      type: 'decision.create', decisionId: '40000000-0000-4000-8000-000000000031',
      decision: { question: 'No poll exposure evidence', options: [
        { id: 'omitted', label: 'Museum', place: {
          title: 'Museum', category: 'sightseeing', locationName: 'Museum', lat: 12.9, lng: 77.6,
          dayId: 'day-a', dayIndex: 0, slotKey: 'lunch', place: { source: 'google', placeId: 'poll-no-evidence' },
        } },
        { id: 'skip', label: 'Skip' },
      ] },
    })
    expect(omittedPoll).toMatchObject({ status: 'applied', decision: { options: [
      { id: 'omitted', label: 'Museum', place: { place: { placeId: 'poll-no-evidence', source: 'google', exposure: 'unknown' } } },
      { id: 'skip', label: 'Skip' },
    ] } })

    const invalidPlaces = [
      { source: 'weather-api', placeId: 'bad-source', exposure: 'indoor' },
      { source: 'google', placeId: 'bad-exposure', exposure: 'inside' },
      { source: 'google', placeId: 'bad-key', exposure: 'outdoor', extra: true },
    ]
    for (const [index, place] of invalidPlaces.entries()) {
      const result = await call(command(41 + index), {
        type: 'suggestion.create', suggestionId: `30000000-0000-4000-8000-${String(31 + index).padStart(12, '0')}`,
        suggestion: {
          dayIndex: 0, title: 'Malformed metadata', category: 'sightseeing', locationName: 'Museum',
          lat: 12.9, lng: 77.6, description: '', visitMinutes: 45,
          estimatedEntryFeeInr: 0, estimatedTransportInr: 0, place,
        },
      })
      expect(result.status).toBe('invalid')
    }

    const malformedPoll = await call(command(50), {
      type: 'decision.create', decisionId: '40000000-0000-4000-8000-000000000030',
      decision: { question: 'Malformed poll identity', options: [
        { id: 'bad', label: 'Bad', place: {
          title: 'Museum', category: 'sightseeing', locationName: 'Museum', lat: 12.9, lng: 77.6,
          dayId: 'day-a', dayIndex: 0, slotKey: 'lunch',
          place: { source: 'google', placeId: 'bad', exposure: 'inside' },
        } },
        { id: 'good', label: 'Other' },
      ] },
    })
    expect(malformedPoll.status).toBe('invalid')
  })

  it('refuses a legacy poll with malformed nested exposure without landing a stop', async () => {
    const otherTrip = '20000000-0000-4000-8000-000000000007'
    const legacyDecision = '40000000-0000-4000-8000-000000000007'
    await seedTrip(otherTrip, [{ id: 'current', index: 0, title: 'Current day', stops: [] }])
    await db.exec('reset role')
    await db.query(`insert into public.decisions(id,trip_id,question,options,votes_by_user_id,comments,status,raised_by)
      values($1,$2,'Legacy malformed place',$3::jsonb,'{}','[]','open',$4)`, [legacyDecision, otherTrip, JSON.stringify([
        { id: 'legacy', label: 'Legacy', place: {
          title: 'Museum', category: 'sightseeing', locationName: 'Museum', lat: 12.9, lng: 77.6,
          dayId: 'current', dayIndex: 0, slotKey: 'lunch', place: { source: 'google', placeId: 'legacy', exposure: 'inside' },
        } },
      ]), owner])
    await actor(editorA)
    const result = await call(command(60), {
      type: 'decision.resolve', decisionId: legacyDecision, optionId: 'legacy', expectedRevision: 7, dayId: 'current',
    }, otherTrip)
    expect(result).toMatchObject({ status: 'applied', winnerId: 'legacy', placementStatus: 'needsPlace' })
    expect((await tripState(otherTrip)).days[0].stops).toHaveLength(0)
  })

  it('re-asks with the trip days when the matched day carries no slot index (#839, F4)', async () => {
    const otherTrip = '20000000-0000-4000-8000-000000000008'
    const otherDecision = '40000000-0000-4000-8000-000000000008'
    await seedTrip(otherTrip, [{ id: 'idx-less', title: 'No index day', stops: [] }])
    await db.exec('reset role')
    await db.query(`insert into public.decisions(id,trip_id,question,options,votes_by_user_id,comments,status,raised_by)
      values($1,$2,'Where?',$3::jsonb,'{}','[]','open',$4)`, [otherDecision, otherTrip, JSON.stringify([
        { id: 'slot:lunch:m', label: 'Museum', place: { title: 'Museum', category: 'sightseeing', locationName: 'Museum', lat: 12.9, lng: 77.6, visitMinutes: 45, dayId: 'idx-less' } },
        { id: 'skip', label: 'Skip' },
      ]), owner])
    await actor(editorA)
    const beforeEvents = await count('activity')
    const resolved = await call(command(61), { type: 'decision.resolve', decisionId: otherDecision, optionId: 'slot:lunch:m', expectedRevision: 7 }, otherTrip)
    expect(resolved).toMatchObject({ status: 'applied', winnerId: 'slot:lunch:m', placementStatus: 'needsDay' })
    // A needsDay receipt must always name the days the user can pick from.
    expect(Array.isArray(resolved.availableDays)).toBe(true)
    expect(resolved.availableDays).toEqual([{ id: 'idx-less', title: 'No index day' }])
    expect((await tripState(otherTrip)).days[0].stops).toHaveLength(0)
    await db.exec('reset role')
    const row = await db.query<{ status: string }>('select status from public.decisions where id=$1', [otherDecision])
    await actor(editorA)
    expect(row.rows[0].status).toBe('resolved')
    expect(await count('activity')).toBe(beforeEvents + 1)
  })

  it('a dayIndex naming no day is resolved needsDay, never clamped onto an existing day (#336)', async () => {
    const otherTrip = '20000000-0000-4000-8000-000000000009'
    const otherDecision = '40000000-0000-4000-8000-000000000009'
    await seedTrip(otherTrip, [{ id: 'current', index: 0, title: 'Only day', stops: [] }])
    await db.exec('reset role')
    await db.query(`insert into public.decisions(id,trip_id,question,options,votes_by_user_id,comments,status,raised_by)
      values($1,$2,'Where?',$3::jsonb,'{}','[]','open',$4)`, [otherDecision, otherTrip, JSON.stringify([
        { id: 'slot:lunch:f', label: 'Far cafe', place: { title: 'Far cafe', category: 'food', locationName: 'Far cafe', lat: 12.9, lng: 77.6, visitMinutes: 45, dayIndex: 5 } },
        { id: 'skip', label: 'Skip' },
      ]), owner])
    await actor(editorA)
    const resolved = await call(command(62), { type: 'decision.resolve', decisionId: otherDecision, optionId: 'slot:lunch:f', expectedRevision: 7 }, otherTrip)
    expect(resolved).toMatchObject({ status: 'applied', winnerId: 'slot:lunch:f', placementStatus: 'needsDay' })
    expect(resolved.availableDays).toEqual([{ id: 'current', index: 0, title: 'Only day' }])
    expect((await tripState(otherTrip)).days[0].stops).toHaveLength(0)
  })

  it('a retried accept whose stop was removed from the timeline answers alreadyApplied without a stop (#839/F5)', async () => {
    const otherTrip = '20000000-0000-4000-8000-000000000010'
    const otherSuggestion = '30000000-0000-4000-8000-000000000010'
    await seedTrip(otherTrip, [{ id: 'current', index: 0, title: 'Day', stops: [] }])
    await db.exec('reset role')
    await db.query(`insert into public.suggestions(id,trip_id,day_index,day_id,proposed_by,title,category,location_name,lat,lng,status)
      values($1,$2,0,'current',$3,'Museum','sightseeing','City Museum',12.9,77.6,'open')`, [otherSuggestion, otherTrip, owner])
    await actor(editorA)
    const first = await call(command(63), { type: 'suggestion.accept', suggestionId: otherSuggestion, expectedRevision: 7 }, otherTrip)
    expect(first).toMatchObject({ status: 'applied', stopId: expect.any(String) })
    await db.exec('reset role')
    await db.query(`update public.trips set days='[{"id":"current","index":0,"title":"Day","stops":[]}]'::jsonb where id=$1`, [otherTrip])
    await actor(editorA)
    const retry = await call(command(64), { type: 'suggestion.accept', suggestionId: otherSuggestion, expectedRevision: 9 }, otherTrip)
    expect(retry).toMatchObject({ status: 'alreadyApplied' })
    expect(retry.stopId).toBeUndefined()
    await db.exec('reset role')
    const row = await db.query<{ status: string; accepted_stop_id: string | null }>(
      'select status,accepted_stop_id from public.suggestions where id=$1', [otherSuggestion],
    )
    await actor(editorA)
    expect(row.rows[0].status).toBe('accepted')
  })

  it('pins place identity: unparseable coordinates never over-match a same-named stop (F6)', async () => {
    await db.exec('reset role')
    const sameNameBadCoords = await db.query<{ ok: boolean }>(
      `select public.collab_same_visit_place(
        '{"title":"Museum","location_name":"City Museum","lat":"abc","lng":"12.9","place":{"source":"google","placeId":"p1"}}'::jsonb,
        '{"title":"Museum","location_name":"City Museum","lat":"12.9","lng":"77.6"}'::jsonb) as ok`)
    const zeroCoords = await db.query<{ ok: boolean }>(
      `select public.collab_same_visit_place(
        '{"title":"Museum","location_name":"City Museum","lat":"0","lng":"0","place":{"source":"google","placeId":"p1"}}'::jsonb,
        '{"title":"Museum","location_name":"City Museum","lat":"12.9","lng":"77.6"}'::jsonb) as ok`)
    const providerKeyDisagreement = await db.query<{ ok: boolean }>(
      `select public.collab_same_visit_place(
        '{"title":"Museum","location_name":"City Museum","place":{"source":"google","placeId":"p1"}}'::jsonb,
        '{"title":"Museum","location_name":"City Museum","place":{"source":"google","placeId":"p2"}}'::jsonb) as ok`)
    await actor(editorA)
    expect(sameNameBadCoords.rows[0].ok).toBe(false)
    expect(zeroCoords.rows[0].ok).toBe(false)
    expect(providerKeyDisagreement.rows[0].ok).toBe(false)
  })
})
