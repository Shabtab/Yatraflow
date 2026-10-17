// ============ An invite code the server holds is never replaced ============
// A cached trip without an invite code does not prove the server has none, so
// the mint path reads the server first. The write only lands while the server
// still holds no code. These pins read the source: the store needs the live
// Supabase client, which the node test environment does not provide.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** Normalised: this repo checks out CRLF on Windows (`core.autocrlf=true`). */
const readSource = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const STORE = readSource('../src/store/store.ts')

/** The source of one top-level function, from its header through the closing brace. */
function functionBody(src: string, header: string): string {
  const start = src.indexOf(header)
  expect(start, `${header} must exist`).toBeGreaterThan(-1)
  return src.slice(start, src.indexOf('\n}\n', start) + 3)
}

const MINT = functionBody(STORE, 'export async function ensureInviteCode(')
const READ = functionBody(STORE, 'async function readServerInviteCode(')
const PATCH = functionBody(STORE, 'async function persistTripMetadata(')

describe('ensureInviteCode reads the server before it mints', () => {
  it('reads the stored code before the first write', () => {
    const read = MINT.indexOf('readServerInviteCode(tripId, token)')
    const write = MINT.indexOf('persistTripMetadata(tripId, { invite_code: code }')
    expect(read).toBeGreaterThan(-1)
    expect(read).toBeLessThan(write)
  })

  it('caches a code the server holds and returns it without a write', () => {
    expect(MINT).toMatch(/if \(held\) \{\s*mutateTrip\(tripId, draft => \{ draft\.inviteCode = held \}, \{ touch: false \}\)\s*return held\s*\}/)
  })

  it('mints nothing when the read fails', () => {
    expect(MINT).toMatch(/if \(held === undefined \|\| !live\(\)\) return null/)
    expect(READ).toMatch(/if \(error\) \{\s*console\.error\('\[yatraflow\] invite-code read failed', error\)\s*return undefined\s*\}/)
  })

  it('reads the code of one trip by id', () => {
    expect(READ).toMatch(/from\('trips'\)\.select\('invite_code'\)\.eq\('id', tripId\)\.maybeSingle\(\)/)
  })
})

describe('the write only lands while the server holds no code', () => {
  it('filters the update on a null invite_code and asks for the row back', () => {
    expect(MINT).toContain("{ inviteCode: code }, 'invite_code'")
    expect(PATCH).toContain(".update(payload).eq('id', tripId)")
    expect(PATCH).toContain('query.is(nullColumn, null)')
    expect(PATCH).toContain("query.select('id, updated_at, write_version')")
  })

  it('writes once in the loop, and a lost race re-reads without a second write', () => {
    expect(MINT.match(/await persistTripMetadata\(/g)).toHaveLength(1)
    expect(MINT).toMatch(/const again = await readServerInviteCode\(tripId, token\)[\s\S]*?if \(!uniqueClash\) return null/)
  })
})

describe('the mint keeps its retry and its honest failure', () => {
  it('retries a unique clash a bounded number of times', () => {
    expect(MINT).toMatch(/\(let \w+ = 0; \w+ < 5; \w+\+\+\)/)
    expect(MINT).toContain('duplicate key|unique')
  })

  it('reports any other write failure and returns null', () => {
    expect(MINT).toContain("console.error('[yatraflow] invite-code mint failed')")
  })
})
