import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const normalizeLines = (value: string) => value.replace(/\r\n/g, '\n').replace(/^[ \t]+$/gm, '')
const sqlFunction = (sql: string, name: string) => {
  const start = sql.indexOf(`create function public.${name}`)
  const orReplace = sql.indexOf(`create or replace function public.${name}`)
  const at = orReplace >= 0 && (start < 0 || orReplace < start) ? orReplace : start
  if (at < 0) return ''
  const end = sql.indexOf('$$;', at)
  return end < 0 ? '' : sql.slice(at, end + 3).trim()
}

// The latest definition of a function lives in the LAST migration (filename
// order) that creates or replaces it. The schema mirror must match it.
const latestDefinition = (name: string) => {
  const files = readdirSync(resolve(process.cwd(), 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()
  let found = ''
  for (const f of files) {
    const def = sqlFunction(normalizeLines(read(resolve(process.cwd(), 'supabase/migrations', f))), name)
    if (def) found = def
  }
  return found
}

describe('collaboration command schema parity', () => {
  const schema = normalizeLines(read('supabase/schema.sql'))

  it.each([
    'submit_collab_command',
    'guard_collab_contribution_columns',
    'restore_trip_contributions',
  ])('%s matches the latest migration definition', name => {
    const expected = latestDefinition(name)
    expect(expected).not.toBe('')
    expect(sqlFunction(schema, name)).toBe(expected)
  })

  it('schema carries the stable-day and place identity constraints', () => {
    expect(schema).toContain('constraint suggestions_day_id_shape')
    expect(schema).toContain('constraint suggestions_place_identity_shape')
  })

  it('normalization is blank-line-only: a real SQL difference still fails', () => {
    // The guard for the guard: normalization erases nothing but whitespace-only
    // lines, so this negative control must fail if that ever widens.
    const mirror = sqlFunction(schema, 'guard_collab_contribution_columns')
    expect(mirror).not.toBe('')
    expect(sqlFunction(normalizeLines(mirror.replace('raise exception', 'raise warning')), 'guard_collab_contribution_columns'))
      .not.toBe(mirror)
  })
})
