// Group input phase 2 (#972): the migration, run for real on PGlite.
// Covers the closing-time lock, add-an-option, crew_preferences and the
// member-delete trigger. The source pins in group-input-phase2-sql-pin.test.ts
// read the SQL as text; this file runs it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readSql = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const owner = '10000000-0000-4000-8000-000000000001'
const editor = '10000000-0000-4000-8000-000000000002'
const viewer = '10000000-0000-4000-8000-000000000003'
const outsider = '10000000-0000-4000-8000-000000000004'
const command = (id: number) => `50000000-0000-4000-8000-${String(id).padStart(12, '0')}`
const trip = (id: number) => `20000000-0000-4000-8000-${String(id).padStart(12, '0')}`
const decision = (id: number) => `40000000-0000-4000-8000-${String(id).padStart(12, '0')}`

type Receipt = Record<string, any>

describe('group input phase 2 migration (#972)', () => {
  let db: PGlite
  let sequence = 0
  let commandSeq = 100

  const actor = async (id: string) => {
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`)
  }
  const send = async (tripId: string, payload: unknown): Promise<Receipt> => {
    commandSeq += 1
    const result = await db.query<{ receipt: Receipt }>(
      'select public.submit_collab_command($1,$2,$3::jsonb) as receipt',
      [command(commandSeq), tripId, JSON.stringify(payload)],
    )
    return result.rows[0].receipt
  }
  const ballot = (tripId: string, decisionId: string, optionId: string | null) =>
    send(tripId, { type: 'decision.ballot', decisionId, optionId })
  const addOption = (tripId: string, decisionId: string, option: Record<string, unknown>) =>
    send(tripId, { type: 'decision.option.add', decisionId, option })
  const decisionRow = async (decisionId: string) => {
    await db.exec('reset role')
    const result = await db.query<{ options: Array<Record<string, unknown>>; votes_by_user_id: Record<string, string> }>(
      'select options, votes_by_user_id from public.decisions where id=$1', [decisionId])
    await actor(editor)
    return result.rows[0]
  }
  // A trip with owner, editor and viewer members and one open decision.
  const fresh = async (opts: { closesAt?: number | null; options?: Array<Record<string, unknown>> } = {}) => {
    sequence += 1
    const tripId = trip(sequence)
    const decisionId = decision(sequence)
    await db.exec('reset role')
    await db.query('insert into public.trips(id,owner_id) values($1,$2)', [tripId, owner])
    await db.query(`insert into public.trip_members(trip_id,user_id,role) values($1,$2,'owner'),($1,$3,'editor'),($1,$4,'viewer')`,
      [tripId, owner, editor, viewer])
    await db.query(
      `insert into public.decisions(id,trip_id,question,options,votes_by_user_id,comments,status,raised_by,closes_at)
       values($1,$2,'Pick one',$3::jsonb,'{}','[]','open',$4,$5)`,
      [decisionId, tripId, JSON.stringify(opts.options ?? [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]), owner, opts.closesAt ?? null])
    await actor(editor)
    return { tripId, decisionId }
  }
  const setPrefs = async (tripId: string, interests: unknown): Promise<Receipt> => {
    const result = await db.query<{ receipt: Receipt }>(
      'select public.set_my_crew_preferences($1,$2::jsonb) as receipt', [tripId, JSON.stringify(interests)])
    return result.rows[0].receipt
  }
  const prefCount = async (tripId: string) => {
    const result = await db.query<{ count: number }>(
      'select count(*)::int as count from public.crew_preferences where trip_id=$1', [tripId])
    return result.rows[0].count
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
      create table public.suggestions(id uuid primary key, trip_id uuid not null, day_index integer not null default 0, day_id text, place jsonb, accepted_stop_id text, proposed_by uuid not null, title text not null default '', category text, location_name text, lat double precision, lng double precision, description text, visit_minutes integer not null default 60, estimated_entry_fee_inr integer not null default 0, estimated_transport_inr integer not null default 0, votes jsonb not null default '[]', comments jsonb not null default '[]', status text not null default 'open', created_at bigint not null default 1);
      create table public.decisions(id uuid primary key, trip_id uuid not null, question text not null default '', context text, options jsonb not null default '[]', votes_by_user_id jsonb not null default '{}', comments jsonb not null default '[]', status text not null default 'open', resolved_option_id text, resolved_stop_id text, raised_by uuid not null, created_at bigint not null default 1, resolved_at bigint);
      create table public.activity(id uuid primary key, trip_id uuid not null, actor_id uuid not null, verb text not null, target text, at bigint not null default 1);
      create table public.notifications(id uuid primary key, user_id uuid not null, trip_id uuid, text text not null, read boolean not null default false, at bigint not null default 1);
      create table public.collab_commands(command_id uuid primary key, trip_id uuid not null, actor_id uuid not null, command_hash text not null, receipt jsonb not null, created_at timestamptz not null default now());
      create table public.trip_contribution_restore_events(id uuid primary key);
      create function public.advance_trip_write_version() returns trigger language plpgsql as $$
        begin new.write_version:=old.write_version+1; return new; end
      $$;
      create trigger trips_advance_write_version before update on public.trips for each row execute function public.advance_trip_write_version();
      create function public.is_disabled() returns boolean language sql stable as $$ select false $$;
      create function public.is_admin() returns boolean language sql stable as $$ select false $$;
      create function public.is_editor(p_trip uuid) returns boolean language sql stable security definer set search_path=public as $$
        select exists(select 1 from public.trip_members where trip_id=p_trip and user_id=auth.uid() and role in ('owner','editor'))
      $$;
      create function public.is_member(p_trip uuid) returns boolean language sql stable security definer set search_path=public as $$
        select exists(select 1 from public.trip_members where trip_id=p_trip and user_id=auth.uid())
      $$;
      create function public.guard_collab_contribution_columns() returns trigger language plpgsql set search_path='' as $$
      begin
        return new;
      end $$;
      create trigger suggestions_guard_contributions before update on public.suggestions for each row execute function public.guard_collab_contribution_columns();
      create trigger decisions_guard_contributions before update on public.decisions for each row execute function public.guard_collab_contribution_columns();
      insert into public.profiles values ('${owner}'),('${editor}'),('${viewer}'),('${outsider}');
      grant usage on schema public, auth to authenticated;
      grant select,insert,update,delete on all tables in schema public to authenticated;
      grant execute on all functions in schema public to authenticated;
    `)
    await db.exec(readSql('supabase/migrations/20261025a_collab_transitions.sql'))
    await db.exec(readSql('supabase/migrations/20261025c_place_exposure.sql'))
    await db.exec(readSql('supabase/migrations/20261026a_resolved_vote_order.sql'))
    await db.exec(readSql('supabase/migrations/20261117_group_input_phase2.sql'))
    // The migration is idempotent: a second run changes nothing and does not fail.
    await db.exec(readSql('supabase/migrations/20261117_group_input_phase2.sql'))
    await actor(editor)
  }, 60_000)

  afterAll(async () => db?.close())

  describe('the closing-time lock', () => {
    it('takes a ballot before the closing time, and a change of vote', async () => {
      const { tripId, decisionId } = await fresh({ closesAt: Date.now() + 3_600_000 })
      expect(await ballot(tripId, decisionId, 'a')).toMatchObject({ status: 'applied' })
      expect(await ballot(tripId, decisionId, 'b')).toMatchObject({ status: 'applied' })
      expect((await decisionRow(decisionId)).votes_by_user_id).toEqual({ [editor]: 'b' })
    })

    it('takes a ballot when the decision has no closing time', async () => {
      const { tripId, decisionId } = await fresh({ closesAt: null })
      expect(await ballot(tripId, decisionId, 'a')).toMatchObject({ status: 'applied' })
    })

    it('refuses a new ballot, a change and a removal once the closing time has passed', async () => {
      const { tripId, decisionId } = await fresh({ closesAt: 1 })
      const refused = await ballot(tripId, decisionId, 'a')
      expect(refused).toMatchObject({ status: 'invalid', reason: 'voting is closed' })
      expect(await ballot(tripId, decisionId, null)).toMatchObject({ status: 'invalid', reason: 'voting is closed' })
      expect((await decisionRow(decisionId)).votes_by_user_id).toEqual({})
    })

    it('keeps the votes cast before the closing time when it passes', async () => {
      const { tripId, decisionId } = await fresh({ closesAt: Date.now() + 3_600_000 })
      expect(await ballot(tripId, decisionId, 'a')).toMatchObject({ status: 'applied' })
      await db.exec('reset role')
      await db.query('update public.decisions set closes_at=1 where id=$1', [decisionId])
      await actor(editor)
      expect(await ballot(tripId, decisionId, 'b')).toMatchObject({ status: 'invalid', reason: 'voting is closed' })
      expect((await decisionRow(decisionId)).votes_by_user_id).toEqual({ [editor]: 'a' })
    })

    it('refuses a client that moves closes_at with a direct update', async () => {
      const { decisionId } = await fresh({ closesAt: Date.now() + 3_600_000 })
      await db.exec('reset role')
      // The stub guard above is a no-op; the migration replaced it, so the real one runs.
      await actor(owner)
      await expect(db.query('update public.decisions set closes_at=null where id=$1', [decisionId])).rejects.toThrow()
      await actor(editor)
    })
  })

  describe('decision.option.add', () => {
    it('adds an option before the closing time and records who added it', async () => {
      const { tripId, decisionId } = await fresh({ closesAt: Date.now() + 3_600_000 })
      const receipt = await addOption(tripId, decisionId, { id: 'c', label: '  Gamma ', costImpactInr: 120 })
      expect(receipt).toMatchObject({ status: 'applied' })
      const options = (await decisionRow(decisionId)).options
      expect(options).toHaveLength(3)
      expect(options[2]).toEqual({ id: 'c', label: 'Gamma', costImpactInr: 120, addedBy: editor })
    })

    it('adds an option to a decision with no closing time', async () => {
      const { tripId, decisionId } = await fresh({ closesAt: null })
      expect(await addOption(tripId, decisionId, { id: 'c', label: 'Gamma' })).toMatchObject({ status: 'applied' })
    })

    it('refuses an option once the closing time has passed', async () => {
      const { tripId, decisionId } = await fresh({ closesAt: 1 })
      expect(await addOption(tripId, decisionId, { id: 'c', label: 'Gamma' }))
        .toMatchObject({ status: 'invalid', reason: 'voting is closed' })
      expect((await decisionRow(decisionId)).options).toHaveLength(2)
    })

    it('refuses an option on a resolved decision', async () => {
      const { tripId, decisionId } = await fresh()
      await db.exec('reset role')
      await db.query(`update public.decisions set status='resolved', resolved_option_id='a', resolved_at=1 where id=$1`, [decisionId])
      await actor(editor)
      expect(await addOption(tripId, decisionId, { id: 'c', label: 'Gamma' }))
        .toMatchObject({ status: 'invalid', reason: 'decision is not open' })
    })

    it('refuses a duplicate label, ignoring case and spaces', async () => {
      const { tripId, decisionId } = await fresh()
      expect(await addOption(tripId, decisionId, { id: 'c', label: '  ALPHA ' }))
        .toMatchObject({ status: 'invalid', reason: 'duplicate option' })
      expect((await decisionRow(decisionId)).options).toHaveLength(2)
    })

    it('refuses a duplicate option id', async () => {
      const { tripId, decisionId } = await fresh()
      expect(await addOption(tripId, decisionId, { id: 'a', label: 'Something else' }))
        .toMatchObject({ status: 'invalid', reason: 'duplicate option id' })
    })

    it('refuses the 21st option and accepts the 20th', async () => {
      const nineteen = Array.from({ length: 19 }, (_, i) => ({ id: `o${i}`, label: `Option ${i}` }))
      const { tripId, decisionId } = await fresh({ options: nineteen })
      expect(await addOption(tripId, decisionId, { id: 'o19', label: 'Option 19' })).toMatchObject({ status: 'applied' })
      expect(await addOption(tripId, decisionId, { id: 'o20', label: 'Option 20' }))
        .toMatchObject({ status: 'invalid', reason: 'too many options' })
      expect((await decisionRow(decisionId)).options).toHaveLength(20)
    })

    it('refuses a viewer', async () => {
      const { tripId, decisionId } = await fresh()
      await actor(viewer)
      expect(await addOption(tripId, decisionId, { id: 'c', label: 'Gamma' })).toMatchObject({ status: 'forbidden' })
      expect((await decisionRow(decisionId)).options).toHaveLength(2)
    })

    it('refuses an outsider', async () => {
      const { tripId, decisionId } = await fresh()
      await actor(outsider)
      expect(await addOption(tripId, decisionId, { id: 'c', label: 'Gamma' })).toMatchObject({ status: 'forbidden' })
    })

    it('refuses a forged addedBy and any other extra key', async () => {
      const { tripId, decisionId } = await fresh()
      expect(await addOption(tripId, decisionId, { id: 'c', label: 'Gamma', addedBy: owner })).toMatchObject({ status: 'invalid' })
      expect(await addOption(tripId, decisionId, { id: 'd', label: 'Delta', place: { source: 'osm' } })).toMatchObject({ status: 'invalid' })
      expect((await decisionRow(decisionId)).options).toHaveLength(2)
    })

    it('refuses a bad id, an empty label and a non-numeric impact', async () => {
      const { tripId, decisionId } = await fresh()
      expect(await addOption(tripId, decisionId, { id: 'bad id!', label: 'Gamma' })).toMatchObject({ status: 'invalid' })
      expect(await addOption(tripId, decisionId, { id: 'c', label: '   ' })).toMatchObject({ status: 'invalid' })
      expect(await addOption(tripId, decisionId, { id: 'c', label: 'Gamma', costImpactInr: '5' })).toMatchObject({ status: 'invalid' })
    })
  })

  describe('crew_preferences', () => {
    it('lets a member write their own row, sorted by name', async () => {
      const { tripId } = await fresh()
      const receipt = await setPrefs(tripId, ['temple', 'food'])
      expect(receipt).toMatchObject({ status: 'applied', preference: { trip_id: tripId, user_id: editor, interests: ['food', 'temple'] } })
      // A second write replaces the row and does not add one.
      expect(await setPrefs(tripId, [])).toMatchObject({ status: 'applied', preference: { interests: [] } })
      expect(await prefCount(tripId)).toBe(1)
    })

    it('lets a viewer answer too, because every member is in the crew', async () => {
      const { tripId } = await fresh()
      await actor(viewer)
      expect(await setPrefs(tripId, ['rest'])).toMatchObject({ status: 'applied', preference: { user_id: viewer } })
    })

    it('has no path to write another member\'s row', async () => {
      const { tripId } = await fresh()
      await setPrefs(tripId, ['food'])
      await actor(viewer)
      await setPrefs(tripId, ['rest'])
      await actor(editor)
      await expect(db.query(`update public.crew_preferences set interests='{beach}' where trip_id=$1 and user_id=$2`, [tripId, viewer])).rejects.toThrow()
      await expect(db.query(`insert into public.crew_preferences(trip_id,user_id,interests) values($1,$2,'{}')`, [tripId, owner])).rejects.toThrow()
      await expect(db.query('delete from public.crew_preferences where trip_id=$1', [tripId])).rejects.toThrow()
      const rows = await db.query<{ user_id: string; interests: string[] }>(
        'select user_id, interests from public.crew_preferences where trip_id=$1 order by user_id', [tripId])
      expect(rows.rows).toEqual([{ user_id: editor, interests: ['food'] }, { user_id: viewer, interests: ['rest'] }])
    })

    it('refuses an outsider to write', async () => {
      const { tripId } = await fresh()
      await actor(outsider)
      expect(await setPrefs(tripId, ['food'])).toMatchObject({ status: 'forbidden' })
    })

    it('refuses a write to a deleted trip', async () => {
      const { tripId } = await fresh()
      await db.exec('reset role')
      await db.query('update public.trips set deleted_at=now() where id=$1', [tripId])
      await actor(editor)
      expect(await setPrefs(tripId, ['food'])).toMatchObject({ status: 'forbidden' })
    })

    it('shows members every row of their trip, and an outsider none', async () => {
      const { tripId } = await fresh()
      await setPrefs(tripId, ['food'])
      await actor(viewer)
      await setPrefs(tripId, ['rest'])
      expect(await prefCount(tripId)).toBe(2)
      await actor(owner)
      expect(await prefCount(tripId)).toBe(2)
      await actor(outsider)
      expect(await prefCount(tripId)).toBe(0)
    })

    it('does not show a member the rows of another trip', async () => {
      const first = await fresh()
      const second = await fresh()
      await setPrefs(first.tripId, ['food'])
      await db.exec('reset role')
      await db.query(`insert into public.trip_members(trip_id,user_id,role) values($1,$2,'editor')`, [second.tripId, outsider])
      await actor(outsider)
      expect(await prefCount(first.tripId)).toBe(0)
      expect(await prefCount(second.tripId)).toBe(0)
    })

    it('refuses every bad shape as invalid and stores nothing', async () => {
      const { tripId } = await fresh()
      const bad: unknown[] = [
        ['nonsense'],
        ['food', 'food'],
        'food',
        null,
        { food: true },
        [1],
        [null],
        ['sightseeing', 'food', 'nature', 'beach', 'temple', 'adventure', 'shopping', 'museum', 'travel', 'hotel', 'rest', 'event', 'transport-hub', 'food'],
      ]
      for (const shape of bad) {
        expect(await setPrefs(tripId, shape), JSON.stringify(shape)).toMatchObject({ status: 'invalid' })
      }
      expect(await setPrefs('not-a-uuid', ['food'])).toMatchObject({ status: 'invalid' })
      expect(await prefCount(tripId)).toBe(0)
    })

    it('refuses the anonymous role the table and the writer', async () => {
      const { tripId } = await fresh()
      await db.exec('reset role; set role anon')
      await expect(db.query('select * from public.crew_preferences where trip_id=$1', [tripId])).rejects.toThrow()
      await expect(db.query('select public.set_my_crew_preferences($1,$2::jsonb)', [tripId, '["food"]'])).rejects.toThrow()
      await actor(editor)
    })

    it('deletes a member\'s row when the member leaves the trip, and only theirs', async () => {
      const { tripId } = await fresh()
      await setPrefs(tripId, ['food'])
      await actor(viewer)
      await setPrefs(tripId, ['rest'])
      await db.exec('reset role')
      await db.query('delete from public.trip_members where trip_id=$1 and user_id=$2', [tripId, viewer])
      const rows = await db.query<{ user_id: string }>('select user_id from public.crew_preferences where trip_id=$1', [tripId])
      expect(rows.rows.map(r => r.user_id)).toEqual([editor])
      await actor(editor)
    })

    it('does not let a client call the trigger function', async () => {
      await actor(editor)
      await expect(db.query('select public.crew_preferences_on_member_delete()')).rejects.toThrow()
    })
  })
})
