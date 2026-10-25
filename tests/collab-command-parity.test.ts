import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const normalizeLines = (value: string) => value.replace(/\r\n/g, '\n')
const sqlFunction = (sql: string, name: string) => {
  const start = sql.indexOf(`create function public.${name}`)
  if (start < 0) return ''
  const end = sql.indexOf('$$;', start)
  return end < 0 ? '' : sql.slice(start, end + 3).trim()
}

describe('collaboration command schema parity', () => {
  const schema = normalizeLines(read('supabase/schema.sql'))
  const latest = normalizeLines(read('supabase/migrations/20261024_suggestion_place_identity.sql'))

  it.each([
    'submit_collab_command',
    'guard_collab_contribution_columns',
    'restore_trip_contributions',
  ])('%s matches the latest migration definition', name => {
    const expected = sqlFunction(latest, name)
    expect(expected).not.toBe('')
    expect(sqlFunction(schema, name)).toBe(expected)
  })

  it('schema carries the stable-day and place identity constraints', () => {
    expect(schema).toContain('constraint suggestions_day_id_shape')
    expect(schema).toContain('constraint suggestions_place_identity_shape')
  })
})
