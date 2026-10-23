import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const normalizeLines = (value: string) => value.replace(/\r\n/g, '\n')

describe('collaboration command schema parity', () => {
  const schema = normalizeLines(read('supabase/schema.sql'))

  it.each([
    'supabase/migrations/20261023a_collab_commands.sql',
    'supabase/migrations/20261023b_collab_cutover.sql',
  ])('%s is mirrored in schema.sql', path => {
    expect(schema).toContain(normalizeLines(read(path)).trim())
  })
})
