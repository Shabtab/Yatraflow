import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = read('../supabase/migrations/20261017_trip_write_version.sql')
const schema = read('../supabase/schema.sql')

/** The definitions, without the transaction wrapper or the comments. */
function definitions(source: string): string {
  return source
    .replace(/--[^\n]*/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && line !== 'begin;' && line !== 'commit;')
    .join('\n')
}

describe('server trip write versions', () => {
  it('carries the same definitions in the fresh schema as in the migration', () => {
    expect(definitions(schema)).toContain(definitions(migration))
  })

  it('wraps the migration in a transaction and leaves the fresh schema unwrapped', () => {
    expect(migration).toMatch(/^\s*begin;/m)
    expect(migration).toMatch(/^\s*commit;\s*$/m)
    // The fresh schema runs as one script, so a nested transaction is not needed.
    const block = schema.slice(schema.indexOf('alter table public.trips add column if not exists write_version'))
    expect(block.slice(0, block.indexOf('create trigger trips_advance_write_version'))).not.toMatch(/^\s*begin;/m)
  })

  it('keeps table authorization intact and restricts sequence access', () => {
    const code = migration.replace(/--[^\n]*/g, '')
    expect(code).not.toMatch(/\b(?:grant|policy|row\s+level\s+security)\b/i)
    expect(code).toMatch(/security definer/i)
    expect(code).toContain('revoke all on sequence public.trip_write_version_seq from public, anon, authenticated, service_role')
    expect(code).toContain('set search_path = \'\'')
  })

  it('adds the non-null counter and replaces the version trigger', () => {
    expect(migration).toContain('write_version bigint not null default 0')
    expect(migration).toContain("new.write_version := pg_catalog.nextval('public.trip_write_version_seq'::regclass)")
    expect(migration).toContain('lock table public.trips in share row exclusive mode')
    expect(migration).toContain('before insert or update on public.trips')
    expect(migration).toContain('drop trigger if exists trips_advance_write_version')
  })
})
