// Group input phase 2: the client and the SQL agree (node env, source text only).
// The migration is run by hand, so these checks read it as text. They cannot run
// the SQL: supabase/tests/rls_contract.test.sql (section G9) checks a live database.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STOP_CATEGORIES } from '../src/data/types'
import { MAX_DECISION_OPTIONS, MAX_OPTION_LABEL_LENGTH } from '../src/lib/decisionOptions'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = read('supabase/migrations/20261117_group_input_phase2.sql')
const schema = read('supabase/schema.sql')
const store = read('src/store/store.ts')

const quotedList = (text: string): string[] => [...text.matchAll(/'([a-z-]+)'/g)].map(m => m[1])

describe('crew interests: the SQL list equals STOP_CATEGORIES', () => {
  it('in the table check', () => {
    const check = /interests <@ array\[([^\]]*)\]::text\[\]/.exec(migration)
    expect(check).not.toBeNull()
    expect(quotedList(check![1])).toEqual([...STOP_CATEGORIES])
  })
  it('in the writer RPC', () => {
    const allowed = /v_allowed text\[\] := array\[([^\]]*)\];/.exec(migration)
    expect(allowed).not.toBeNull()
    expect(quotedList(allowed![1])).toEqual([...STOP_CATEGORIES])
  })
  it('caps the list at the size of the set', () => {
    expect(migration).toContain(`cardinality(interests) <= ${STOP_CATEGORIES.length}`)
    expect(migration).toContain(`jsonb_array_length(p_interests) > ${STOP_CATEGORIES.length}`)
  })
})

describe('add-option limits: the SQL equals the client', () => {
  it('uses the same option and label limits', () => {
    expect(migration).toContain(`jsonb_array_length(v_row->'options')>=${MAX_DECISION_OPTIONS}`)
    expect(migration).toContain(`length(btrim(v_option->>'label')) not between 1 and ${MAX_OPTION_LABEL_LENGTH}`)
  })
  it('compares labels the way the client does: trimmed and lower-case', () => {
    expect(migration).toContain("lower(btrim(o->>'label'))=lower(btrim(v_option->>'label'))")
  })
  it('never takes addedBy from the client and sets it from the signed-in account', () => {
    expect(migration).toContain("array['id','label','costImpactInr','timeImpactMin']")
    expect(migration).toContain("jsonb_build_object('addedBy',v_actor)")
  })
})

describe('the closing-time lock is server side', () => {
  it('refuses a ballot after closes_at, and the add-option command shares the rule', () => {
    const locks = migration.match(/'reason','voting is closed'/g) ?? []
    expect(locks.length).toBe(2)
    expect(migration).toContain("(v_row->>'closes_at')::numeric <= floor(extract(epoch from clock_timestamp())*1000)")
  })
  it('has no branch for an unreadable closing time, because closes_at is a bigint column', () => {
    expect(migration).not.toContain('closing time is unreadable')
    expect(schema).not.toContain('closing time is unreadable')
    expect(migration).toContain('alter table public.decisions add column if not exists closes_at bigint;')
  })
  it('does not resolve a decision by itself', () => {
    const lock = migration.slice(migration.indexOf("elsif v_kind='decision.option.add'"), migration.indexOf("elsif v_kind='decision.resolve'"))
    expect(lock).not.toContain("status='resolved'")
    expect(migration).not.toMatch(/pg_cron|cron\.schedule/)
  })
  it('freezes the columns against a direct editor update', () => {
    expect(migration).toContain("to_jsonb(new)->'closes_at' is distinct from to_jsonb(old)->'closes_at'")
    expect(migration).toContain("to_jsonb(new)->'day_id' is distinct from to_jsonb(old)->'day_id'")
  })
  it('keeps the columns through a trash restore', () => {
    expect(migration).toContain('resolved_at,closes_at,day_id)')
  })
})

describe('repo conventions', () => {
  it('guards every policy and function re-run', () => {
    expect(migration).toContain('drop policy if exists "crew preferences member read" on public.crew_preferences;')
    expect(migration).toContain('drop policy if exists "deny disabled" on public.crew_preferences;')
    expect(migration).toContain('drop function if exists public.set_my_crew_preferences(text,jsonb);')
    expect(migration).toContain('drop function if exists public.submit_collab_command(text,text,jsonb);')
  })
  it('revokes PUBLIC and anon, and grants only authenticated', () => {
    expect(migration).toContain('revoke all on function public.set_my_crew_preferences(text,jsonb) from public, anon;')
    expect(migration).toContain('grant execute on function public.set_my_crew_preferences(text,jsonb) to authenticated;')
    expect(migration).toContain('revoke all on table public.crew_preferences from public, anon, authenticated;')
    expect(migration).toContain('grant select on public.crew_preferences to authenticated;')
    expect(migration).not.toMatch(/grant (insert|update|delete)[^;]*on public\.crew_preferences/)
  })
  it('turns RLS on and keeps the restrictive deny-disabled policy', () => {
    expect(migration).toContain('alter table public.crew_preferences enable row level security;')
    expect(migration).toMatch(/create policy "deny disabled" on public\.crew_preferences\s+as restrictive for all to authenticated/)
  })
  it('pins the search path of the security definer writer', () => {
    expect(migration).toMatch(/create function public\.set_my_crew_preferences[\s\S]*?security definer set search_path = ''/)
  })
})

describe('mirrors', () => {
  it('schema.sql carries the new table, writer and columns', () => {
    expect(schema).toContain('create table if not exists public.crew_preferences')
    expect(schema).toContain('create function public.set_my_crew_preferences')
    expect(schema).toContain('closes_at          bigint')
    expect(schema).toContain('day_id             text')
  })
  it('the store keeps crew_preferences off the shared channel and gives it its own', () => {
    expect(store).not.toMatch(/const RESYNC_TABLES = \[[^\]]*'crew_preferences'/)
    expect(store).toContain("supabase.channel('yatraflow-crew')")
    expect(store).toContain("case 'crew_preferences': {")
    expect(store).not.toContain("await step('crew_preferences'")
    expect(store).toContain('async function resyncCrewPreferences')
  })
  it('a member\'s answer is deleted with the member, in the migration and in schema.sql', () => {
    for (const sql of [migration, schema]) {
      expect(sql).toMatch(/create or replace function public\.crew_preferences_on_member_delete\(\)[\s\S]*?security definer set search_path = ''/)
      expect(sql).toContain('drop trigger if exists crew_preferences_member_delete on public.trip_members;')
      expect(sql).toMatch(/create trigger crew_preferences_member_delete\s+after delete on public\.trip_members\s+for each row/)
      expect(sql).toContain('revoke all on function public.crew_preferences_on_member_delete() from public, anon, authenticated;')
    }
  })
  it('the migration header names the publication check the user runs afterwards', () => {
    expect(migration).toContain("from pg_publication_tables")
    expect(migration).toContain("tablename='crew_preferences'")
  })
  it('the stale test-file name is gone', () => {
    expect(migration).not.toContain('crew-preferences-sql-pin')
    expect(schema).not.toContain('crew-preferences-sql-pin')
  })
})
