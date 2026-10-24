import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const previousMigrations = readdirSync('supabase/migrations')
  .filter(name => name.endsWith('.sql') && name < '20261019_trip_drives_part.sql')
  .sort()
  .map(name => readFileSync(`supabase/migrations/${name}`, 'utf8'))
const migration = readFileSync('supabase/migrations/20261019_trip_drives_part.sql', 'utf8')
const schema = readFileSync('supabase/schema.sql', 'utf8')
const readers = ['get_public_trip', 'get_trip_by_invite_code'] as const
type ReaderName = (typeof readers)[number]

function reader(sql: string, name: ReaderName): string {
  const opener = name === 'get_public_trip'
    ? 'create or replace function public.get_public_trip('
    : 'create or replace function public.get_trip_by_invite_code('
  const start = sql.toLowerCase().indexOf(opener)
  if (start < 0) return ''
  const close = sql.indexOf('$$;', start)
  return close < 0 ? '' : sql.slice(start, close + 3)
}

function priorReader(name: ReaderName): string {
  return previousMigrations.map(sql => reader(sql, name)).filter(Boolean).at(-1) ?? ''
}

function withoutComments(sql: string): string {
  return sql.replace(/--[^\r\n]*/g, '')
}

function normal(sql: string): string {
  return withoutComments(sql).replace(/\s+/g, ' ').trim()
}

describe('Mixed transport schema contract', () => {
  it('adds an unanswered nullable choice without changing existing rows', () => {
    expect(schema).toMatch(/drives_part\s+boolean\s*,/)
    expect(migration).toMatch(/alter table public\.trips add column if not exists drives_part boolean;/)
    expect(migration).not.toMatch(/\b(?:update|delete|drop)\b/i)
    expect(migration).not.toMatch(/drives_part\s+boolean\s+(?:not null|default)/i)
    expect(migration.trim()).toMatch(/commit;$/)
  })

  for (const name of readers) {
    it(`${name} keeps its access gates and content filtering`, () => {
      const oldReader = priorReader(name)
      const newReader = reader(migration, name)
      expect(oldReader).not.toBe('')
      expect(newReader).not.toBe('')
      const oldBody = oldReader.replace(/select\s*\n\s*t\.id[\s\S]*?\n\s*(?:into v_trip\s*\n\s*)?from public\.trips t/i, 'APPROVED_PROJECTION')
      const newBody = newReader.replace(/select projected\.\*[\s\S]*?as projected/i, 'APPROVED_PROJECTION')
      expect(normal(newBody)).toBe(normal(oldBody))
    })

    it(`${name} selects approved fields by name into the current row type`, () => {
      const body = reader(migration, name)
      expect(body).toContain('select projected.*')
      expect(body).toContain('cross join lateral jsonb_populate_record(')
      expect(body).toMatch(/null::public\.trips,\s*jsonb_build_object\(/)
      expect(body).toContain("'drives_part', t.drives_part")
      expect(body).not.toContain('select t.*')
      const keys = [...body.matchAll(/'([a-z_]+)', (?:t\.[a-z_]+|null::text)/g)].map(match => match[1])
      expect(keys).toHaveLength(32)
      expect(new Set(keys).size).toBe(32)
      const priorColumns = [...priorReader(name).matchAll(/\bt\.([a-z_]+)/g)].map(match => match[1])
      for (const key of keys) {
        expect(key === 'drives_part' || key === 'invite_code' || priorColumns.includes(key)).toBe(true)
      }
      expect(migration).toContain(`revoke all on function public.${name}(text) from public;`)
      expect(migration).toContain(`grant execute on function public.${name}(text) to anon, authenticated;`)
    })
  }

  it('withholds the public invite secret while preserving code lookup', () => {
    expect(reader(migration, 'get_public_trip')).toContain("'invite_code', null::text")
    expect(reader(migration, 'get_public_trip')).not.toContain('t.invite_code')
    expect(reader(migration, 'get_trip_by_invite_code')).toContain("'invite_code', t.invite_code")
  })
})
