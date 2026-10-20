import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = read('../supabase/migrations/20261017_trip_write_version.sql')
const schema = read('../supabase/schema.sql')

describe('server trip write versions', () => {
  it('uses the exact migration in the fresh schema', () => {
    expect(schema).toContain(migration.trim())
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
