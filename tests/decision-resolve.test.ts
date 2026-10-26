// ============ #432 — a decision's resolution must be able to persist ============
//
// The bug this pins: `decisions.resolved_option_id` was declared **uuid** while
// option ids have always been text — `o_<uid()>` from `addDecision`, and
// `slot:<key>:<placeId>` from the Map rail's slot votes (load-bearing:
// `resolveDecision` parses the part back with `/^slot:([a-z]+):/`). So every
// resolve sent text into a uuid column, PostgREST answered 400 / 22P02, and
// `fire()` only console.error'd it: the UI said Resolved from the cache, the
// row stayed open, and the resolution vanished on the next load. Nothing in
// `tsc`, the node suite or the build ever sent the payload anywhere, which is
// why the whole gate stayed green.
//
// This file holds the three layers to each other — the column type, the
// migration that fixes a live database, and the payload the store writes — plus
// the reason no probe can answer for a type change (see NO_PROBE_SURFACE).
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const schema = read('../supabase/schema.sql')
const store = read('../src/store/store.ts')
const check = read('../scripts/checkMigrations.mjs')
const MIGRATION = '../supabase/migrations/20260925_decision_resolved_option_text.sql'

/** The `public.decisions` DDL, from its CREATE to its closing paren. */
function decisionsBlock(sql: string): string {
  const start = sql.indexOf('create table if not exists public.decisions')
  expect(start, 'schema.sql must declare public.decisions').toBeGreaterThan(-1)
  const end = sql.indexOf(');', start)
  expect(end, 'the decisions DDL must terminate').toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('#432 — decisions.resolved_option_id is text, and every layer agrees', () => {
  it('schema.sql types the column as text, never uuid', () => {
    const block = decisionsBlock(schema)
    expect(block).toMatch(/^\s*resolved_option_id text,/m)
    expect(block).not.toMatch(/resolved_option_id\s+uuid/)
  })

  it('a migration exists that widens the live column', () => {
    expect(existsSync(new URL(MIGRATION, import.meta.url))).toBe(true)
    const sql = read(MIGRATION)
    // The statement itself, and only the statement — a migration that also
    // dropped or re-created the column would take the data with it.
    expect(sql).toMatch(/alter\s+column\s+resolved_option_id\s+type\s+text\s+using\s+resolved_option_id::text/i)
    expect(sql).not.toMatch(/\bdrop\s+column\b/i)
  })

  it('is declared unprobeable, because presence cannot prove a type', () => {
    // `deriveProbes` only reads create table / add column / bucket inserts, so
    // a type change derives no probe — and even a hand-written one would read
    // PRESENT before the migration (the column exists either way). The
    // coverage ratchet in checkMigrations therefore demands a declared reason;
    // this asserts the declaration names THIS migration, so the check cannot
    // go back to "undeclared" behind our back.
    const entry = /'20260925_decision_resolved_option_text\.sql':\s*\{[\s\S]*?reason:\s*'([^']*)'/
    const found = check.match(entry)
    expect(found, 'checkMigrations must declare this migration in NO_PROBE_SURFACE').not.toBeNull()
    expect(found?.[1]).toMatch(/TYPE only/)
    expect(found?.[1]).toMatch(/22P02/)
  })

  it('the store writes that column with the ids it actually mints', () => {
    // The payload side of the pairing: if either end changes shape alone, this
    // fails rather than the bug returning silently in production.
    //
    // #838 stage C moved the write itself into the atomic
    // `submit_collab_command` RPC (`update … set status='resolved',
    // resolved_option_id=v_choice`), so the store no longer names the column;
    // the agreement it must still hold is: the store sends the minted id in
    // the command (`optionId`) and the SQL writes THAT id into the column.
    expect(store).toMatch(/type: 'decision\.resolve' as const/)
    expect(store).toMatch(/optionId,$/m)
    // …and the shapes it sends are not uuids — which is the whole point.
    // (`uid('o')` is the mint; what happens to a caller-supplied id is #335's
    // own assertion, deliberately not asserted here so this file passes on
    // either side of that change.)
    expect(store).toMatch(/uid\('o'\)/)
    // The slot part is parsed back where the stop lands now — the RPC.
    expect(schema).toMatch(/\^slot:\(\[a-z\]\+\):/)
  })
})
