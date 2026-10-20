import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const migration = read('../supabase/migrations/20261017_trip_write_version.sql')
const schema = read('../supabase/schema.sql')

describe('server trip write versions', () => {
  it('uses the exact migration in the fresh schema', () => {
    expect(schema).toContain(migration.trim())
  })

  it('keeps the write-version block inside a transaction in both files', () => {
    // The lock below is transaction-scoped in PostgreSQL. Outside a
    // transaction block it is taken and released at once, so the sequence
    // would align without the write window the lock exists to close. The
    // schema copy must carry the wrapper, not only the migration.
    for (const [name, source] of [['the migration', migration], ['the fresh schema', schema]] as const) {
      // The block runs from the transaction opener to the transaction closer.
      // The trigger sits inside it, so the closer comes after the trigger.
      const start = source.indexOf('begin;')
      const trigger = source.indexOf('create trigger trips_advance_write_version')
      const end = source.indexOf('commit;', trigger)
      expect(start, `${name} must open a transaction`).toBeGreaterThan(-1)
      expect(end, `${name} must close the transaction`).toBeGreaterThan(-1)
      // The lock must sit BETWEEN the opener and the closer, or it is not
      // held at all.
      const lock = source.indexOf('lock table public.trips')
      expect(lock, `${name} must take the lock`).toBeGreaterThan(-1)
      expect(start).toBeLessThan(lock)
      expect(lock).toBeLessThan(end)
    }
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
