// Collaboration commenters (#935): the commenter gate, run for real on PGlite.
// The schema and the migration chain follow tests/group-input-phase2-db.test.ts.
// The chain ends with 20261120_collab_commenter_commands.sql, so the gate under
// test is the shipped one. is_disabled reads a table here, so a test can disable
// one account.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readSql = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const owner = '10000000-0000-4000-8000-000000000001'
const editor = '10000000-0000-4000-8000-000000000002'
const commenter = '10000000-0000-4000-8000-000000000003'
const viewer = '10000000-0000-4000-8000-000000000004'
const disabledCommenter = '10000000-0000-4000-8000-000000000005'
const trip = '20000000-0000-4000-8000-000000000935'
const suggestion = '30000000-0000-4000-8000-000000000935'
const command = (id: number) => `50000000-0000-4000-8000-${String(id).padStart(12, '0')}`
const commentId = 'cm-935-commenter'

type Receipt = Record<string, any>

describe('collaboration commenter gate (#935)', () => {
  let db: PGlite
  let commandSeq = 0

  const actor = async (id: string) => {
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`)
  }
  const send = async (payload: unknown): Promise<Receipt> => {
    commandSeq += 1
    const result = await db.query<{ receipt: Receipt }>(
      'select public.submit_collab_command($1,$2,$3::jsonb) as receipt',
      [command(commandSeq), trip, JSON.stringify(payload)],
    )
    return result.rows[0].receipt
  }
  const suggestionComment = () => send({ type: 'suggestion.comment', suggestionId: suggestion, commentId: `${commentId}-${commandSeq + 1}`, text: 'Looks good' })
  const suggestionCreate = () => send({
    type: 'suggestion.create', suggestionId: '30000000-0000-4000-8000-000000009351',
    suggestion: { dayIndex: 0, title: 'River walk', visitMinutes: 45, estimatedEntryFeeInr: 0, estimatedTransportInr: 0 },
  })
  const commentsOnSuggestion = async () => {
    await db.exec('reset role')
    const result = await db.query<{ comments: unknown[] }>('select comments from public.suggestions where id=$1', [suggestion])
    await actor(owner)
    return result.rows[0].comments
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
      create table public.disabled_accounts(id uuid primary key);
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
      create function public.is_disabled() returns boolean language sql stable security definer set search_path=public as $$
        select exists(select 1 from public.disabled_accounts d where d.id=auth.uid())
      $$;
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
      insert into public.profiles values ('${owner}'),('${editor}'),('${commenter}'),('${viewer}'),('${disabledCommenter}');
      insert into public.trips(id,owner_id) values ('${trip}','${owner}');
      insert into public.trip_members(trip_id,user_id,role) values
        ('${trip}','${owner}','owner'),('${trip}','${editor}','editor'),
        ('${trip}','${commenter}','commenter'),('${trip}','${viewer}','viewer'),
        ('${trip}','${disabledCommenter}','commenter');
      insert into public.suggestions(id,trip_id,proposed_by,title) values ('${suggestion}','${trip}','${owner}','Existing');
      grant usage on schema public, auth to authenticated;
      grant select,insert,update,delete on all tables in schema public to authenticated;
      grant execute on all functions in schema public to authenticated;
    `)
    await db.exec(readSql('supabase/migrations/20261025a_collab_transitions.sql'))
    await db.exec(readSql('supabase/migrations/20261025c_place_exposure.sql'))
    await db.exec(readSql('supabase/migrations/20261026a_resolved_vote_order.sql'))
    await db.exec(readSql('supabase/migrations/20261117_group_input_phase2.sql'))
    await db.exec(readSql('supabase/migrations/20261120_collab_commenter_commands.sql'))
    // The commenter migration is idempotent: a second run changes nothing and does not fail.
    await db.exec(readSql('supabase/migrations/20261120_collab_commenter_commands.sql'))
    await actor(owner)
  }, 60_000)

  afterAll(async () => db?.close())

  it('applies a commenter suggestion comment', async () => {
    await actor(commenter)
    const receipt = await suggestionComment()
    expect(receipt).toMatchObject({ status: 'applied' })
    expect(await commentsOnSuggestion()).toHaveLength(1)
  })

  it('refuses a commenter who sends a command outside the four comment and ballot kinds', async () => {
    await actor(commenter)
    expect(await suggestionCreate()).toMatchObject({ status: 'forbidden' })
    await actor(owner)
    const rows = await db.query<{ count: number }>('select count(*)::int as count from public.suggestions where id=$1', ['30000000-0000-4000-8000-000000009351'])
    expect(rows.rows[0].count).toBe(0)
  })

  it('refuses a viewer who sends a suggestion comment', async () => {
    const before = (await commentsOnSuggestion()).length
    await actor(viewer)
    expect(await suggestionComment()).toMatchObject({ status: 'forbidden' })
    expect(await commentsOnSuggestion()).toHaveLength(before)
  })

  it('refuses a disabled commenter', async () => {
    const before = (await commentsOnSuggestion()).length
    await db.exec(`reset role; insert into public.disabled_accounts(id) values ('${disabledCommenter}');`)
    await actor(disabledCommenter)
    expect(await suggestionComment()).toMatchObject({ status: 'forbidden' })
    await db.exec('reset role; delete from public.disabled_accounts;')
    await actor(owner)
    expect(await commentsOnSuggestion()).toHaveLength(before)
  })
})
