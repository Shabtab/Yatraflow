// ============ #799 / #807 — trip ownership and direct-DELETE guards ============
//
// Two P0 RLS holes in `trips`, both confirmed by the tracker:
//
//   #799  `trips update` checked only is_editor(), so an editor could set
//         owner_id to themself. Membership authority follows trips.owner_id, so
//         the attacker then promoted their own membership and removed the real
//         owner.
//   #807  `trips delete` allowed is_editor(), so an editor could delete a trip
//         directly. published_itineraries cascades from trips, and
//         purchase_orders / entitlements cascade from the publication — a
//         direct DELETE erased a buyer's purchase. purge_trashed_trip refuses
//         that trip; a direct table DELETE never runs the RPC.
//
// These are PIN tests. They assert the shape the database must have: the policy
// KIND (RESTRICTIVE vs PERMISSIVE), the ORDER of drop-then-create, and the
// guards. Token presence is not behaviour — the opt-in harness
// (supabase/tests/rls_contract.test.sql) runs the actual statements against a
// real database, and that is the only place behaviour is proven.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Code only: the file's own header discusses the tokens it pins. */
const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

const MIGRATION = '20261020_trip_owner_and_delete_guards.sql'
const migration = read(`../supabase/migrations/${MIGRATION}`)
const migrationCode = codeOf(migration)
const schema = read('../supabase/schema.sql')

/**
 * The LAST definition of a policy in a source file. A later migration may
 * redefine a policy, so reading the first match would pin a superseded body.
 */
function lastPolicy(source: string, name: string) {
  const code = codeOf(source)
  const re = new RegExp(
    `create\\s+policy\\s+"${name}"\\s+on\\s+public\\.trips\\s+([\\s\\S]*?);`,
    'gi',
  )
  const all = [...code.matchAll(re)]
  return all.length ? all[all.length - 1][1].replace(/\s+/g, ' ').trim() : null
}

describe('#799 — owner_id is immutable except for the current owner', () => {
  it('the migration creates a BEFORE UPDATE OF owner_id trigger', () => {
    expect(migrationCode).toMatch(/create\s+trigger\s+trips_owner_id_immutable/i)
    expect(migrationCode).toMatch(/before\s+update\s+of\s+owner_id\s+on\s+public\.trips/i)
    expect(migrationCode).toMatch(/execute\s+function\s+public\.trips_owner_id_immutable\(\)/i)
  })

  it('the trigger is dropped before it is created, so a re-run is safe', () => {
    const drop = migrationCode.search(/drop\s+trigger\s+if\s+exists\s+trips_owner_id_immutable/i)
    const create = migrationCode.search(/create\s+trigger\s+trips_owner_id_immutable/i)
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
  })

  it('the guard compares null-safely, so a null owner cannot slip through', () => {
    // `new.owner_id <> old.owner_id` is NULL when either side is null, which is
    // not TRUE, so a null-owner row would pass. IS DISTINCT FROM is the
    // fail-closed form and treats null as a value on both sides.
    expect(migrationCode).toMatch(/new\.owner_id\s+is\s+not\s+distinct\s+from\s+old\.owner_id/i)
    // The unsafe shape must not appear as the guard.
    expect(migrationCode).not.toMatch(/if\s+new\.owner_id\s*<>\s*old\.owner_id/i)
    expect(migrationCode).not.toMatch(/if\s+new\.owner_id\s*!=\s*old\.owner_id/i)
  })

  it('allows exactly three callers and refuses everything else with 42501', () => {
    // No authenticated user (service role / SQL editor / migration).
    expect(migrationCode).toMatch(/if\s+auth\.uid\(\)\s+is\s+null\s+then/i)
    // The current owner.
    expect(migrationCode).toMatch(/if\s+old\.owner_id\s*=\s*auth\.uid\(\)\s+then/i)
    // The admin console.
    expect(migrationCode).toMatch(/if\s+public\.is_admin\(\)\s+then/i)
    // Fail closed, and loudly.
    expect(migrationCode).toMatch(/raise\s+exception/i)
    expect(migrationCode).toMatch(/errcode\s*=\s*'42501'/i)
  })

  it('the guard runs as the invoker, not the definer', () => {
    // A definer trigger would read rows the caller cannot see, and it needs
    // privileges it does not need to compare two columns of the same row.
    // Scoped to the TRIGGER body: the money helper below is deliberately
    // definer, and a file-wide "no definer" assertion would be wrong.
    const triggerFn = migrationCode.slice(
      migrationCode.indexOf('create or replace function public.trips_owner_id_immutable'),
      migrationCode.indexOf('drop trigger if exists trips_owner_id_immutable'),
    )
    expect(triggerFn).toMatch(/security\s+invoker/i)
    expect(triggerFn).not.toMatch(/security\s+definer/i)
  })

  it('schema.sql carries the same trigger (the second build path)', () => {
    expect(schema).toMatch(/create\s+or\s+replace\s+function\s+public\.trips_owner_id_immutable\(\)/i)
    expect(schema).toMatch(/before\s+update\s+of\s+owner_id\s+on\s+public\.trips/i)
    expect(schema).toMatch(/new\.owner_id\s+is\s+not\s+distinct\s+from\s+old\.owner_id/i)
  })

  it('the trigger function is revoked from the API roles by name', () => {
    // `revoke ... from public` does not revoke from anon/authenticated on
    // Supabase, so every role must be named.
    const revoke = /revoke\s+all\s+on\s+function\s+public\.trips_owner_id_immutable\(\)\s+from\s+([a-z_,\s]+);/i
    const m = migrationCode.match(revoke)
    expect(m).not.toBeNull()
    const roles = m![1].split(',').map((r) => r.trim().toLowerCase())
    expect(roles).toEqual(expect.arrayContaining(['public', 'anon', 'authenticated']))
  })
})

describe('#807 — a direct DELETE cannot erase a publication or its purchases', () => {
  it('the delete guard is RESTRICTIVE, not permissive', () => {
    // Load-bearing: a permissive policy ORs with the editor gate and changes
    // nothing. This is the Sep-14 regression shape in this repo.
    expect(lastPolicy(migration, 'trips delete guard')).toMatch(/^as\s+restrictive\s+for\s+delete/i)
  })

  it('it requires the caller to be the owner or an admin', () => {
    const body = lastPolicy(migration, 'trips delete guard')!
    expect(body).toMatch(/auth\.uid\(\)\s*=\s*owner_id/i)
    expect(body).toMatch(/public\.is_admin\(\)/i)
  })

  it('it refuses a trip with any publication, order or entitlement', () => {
    // The money check is a SECURITY DEFINER helper, not an inline subquery:
    // purchase_orders and entitlements are buyer-only under RLS, so a policy
    // expression (which runs as the caller) would see no rows for the owner and
    // fail OPEN. The helper is where the three conditions must live.
    const body = lastPolicy(migration, 'trips delete guard')!
    expect(body).toMatch(/public\.trip_has_publication_money\(trips\.id\)/i)
    // The policy itself must NOT carry an inline subquery on a money table.
    expect(body).not.toMatch(/from\s+public\.purchase_orders/i)
    expect(body).not.toMatch(/from\s+public\.entitlements/i)

    const helper = codeOf(migration)
    expect(helper).toMatch(/create\s+or\s+replace\s+function\s+public\.trip_has_publication_money\(p_trip uuid\)/i)
    expect(helper).toMatch(/security\s+definer/i)
    expect(helper).toMatch(/set\s+search_path\s*=\s*public/i)
    expect(helper).toMatch(/from\s+public\.published_itineraries/i)
    expect(helper).toMatch(/from\s+public\.purchase_orders/i)
    expect(helper).toMatch(/from\s+public\.entitlements/i)
  })

  it('the money helper fails closed on a null trip id', () => {
    // A null id cannot be deleted safely, so it must report "has money".
    const helper = codeOf(migration)
    expect(helper).toMatch(/p_trip\s+is\s+null\s*\n?\s*or\s+exists/i)
  })

  it('the money helper names every role in its revoke and grants authenticated', () => {
    const revoke = /revoke\s+all\s+on\s+function\s+public\.trip_has_publication_money\(uuid\)\s+from\s+([a-z_,\s]+);/i
    const m = codeOf(migration).match(revoke)
    expect(m).not.toBeNull()
    const roles = m![1].split(',').map((r) => r.trim().toLowerCase())
    expect(roles).toEqual(expect.arrayContaining(['public', 'anon', 'authenticated']))
    // A policy expression runs as the caller, so authenticated needs EXECUTE.
    expect(codeOf(migration)).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.trip_has_publication_money\(uuid\)\s+to\s+authenticated/i,
    )
  })

  it('the permissive editor gate is kept, so the guard ANDs rather than replaces', () => {
    const gate = lastPolicy(migration, 'trips delete')!
    expect(gate).not.toMatch(/^as\s+restrictive/i)
    expect(gate).toMatch(/public\.is_editor\(trips\.id\)/i)
  })

  it('every policy is dropped before it is created (safe to re-run)', () => {
    for (const name of ['trips delete guard', 'trips delete', 'trips update']) {
      const drop = migrationCode.search(
        new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"${name}"\\s+on\\s+public\\.trips`, 'i'),
      )
      const create = migrationCode.search(
        new RegExp(`create\\s+policy\\s+"${name}"\\s+on\\s+public\\.trips`, 'i'),
      )
      expect(drop, `${name} must have a drop guard`).toBeGreaterThan(-1)
      expect(create, `${name} must be created`).toBeGreaterThan(drop)
    }
  })

  it('the migration names no wildcard and deletes no data', () => {
    // Additive: this file must not destroy anything on apply.
    expect(migrationCode).not.toMatch(/\bdelete\s+from\b/i)
    expect(migrationCode).not.toMatch(/\btruncate\b/i)
    expect(migrationCode).not.toMatch(/\bdrop\s+table\b/i)
    expect(migrationCode).not.toMatch(/\bdrop\s+column\b/i)
  })

  it('schema.sql mirrors the restrictive guard and the editor gate', () => {
    expect(lastPolicy(schema, 'trips delete guard')).toMatch(/^as\s+restrictive\s+for\s+delete/i)
    expect(lastPolicy(schema, 'trips delete')).toMatch(/public\.is_editor\(trips\.id\)/i)
  })
})

describe('the migration series', () => {
  it('this migration is numbered after the invite-code worker’s file', () => {
    // The other worker owns 20261019_invite_code_lookup_columns.sql; this file
    // must sort after it so a fresh apply runs the invite fix first.
    const names = readdirSync(new URL('../supabase/migrations', import.meta.url))
      .filter((f) => f.endsWith('.sql'))
      .sort()
    const mine = names.indexOf(MIGRATION)
    expect(mine).toBeGreaterThan(-1)
    const invite = names.findIndex((f) => f.startsWith('20261019_'))
    if (invite > -1) expect(mine).toBeGreaterThan(invite)
  })

  it('no earlier migration already defines these policies, so this one owns them', () => {
    // If an older file also created "trips delete guard", the LAST definition
    // wins and these pins would read the wrong body.
    const names = readdirSync(new URL('../supabase/migrations', import.meta.url))
      .filter((f) => f.endsWith('.sql'))
      .sort()
    const earlier = names.filter((f) => f < MIGRATION)
    for (const f of earlier) {
      const src = read(`../supabase/migrations/${f}`)
      expect(codeOf(src), `${f} must not define "trips delete guard"`).not.toMatch(
        /create\s+policy\s+"trips delete guard"/i,
      )
    }
  })
})

// ============ the schema.sql copy must build on its own ============
// schema.sql is a SECOND build path: a fresh database can be built from it alone,
// without the migrations. A `language sql` body is validated at CREATE time, so a
// sql copy that reads a table this file never creates fails the whole build with
// "relation does not exist". plpgsql defers relation resolution to call time, so
// a deferred relation is legal only inside a plpgsql body, and only when it is
// named here with a reason.
describe('schema.sql builds without the payments rail', () => {
  const DEFERRED: Record<string, string> = {
    purchase_orders: 'created by migrations/20260918_payments_rail.sql; schema.sql has no payments rail',
    entitlements: 'created by migrations/20260918_payments_rail.sql; schema.sql has no payments rail',
  }

  /** The helper's body as schema.sql defines it. */
  function schemaHelperBody(src: string): string {
    const code = codeOf(src)
    const start = code.search(/create or replace function public\.trip_has_publication_money/i)
    expect(start, 'schema.sql must define trip_has_publication_money').toBeGreaterThan(-1)
    const end = code.indexOf('$$;', start)
    return code.slice(start, end === -1 ? undefined : end + 3)
  }

  it('the schema.sql copy is plpgsql, so its body is not checked at create time', () => {
    expect(schemaHelperBody(schema)).toMatch(/language\s+plpgsql/i)
  })

  it('it guards the payments tables with to_regclass, so a schema-only build is valid', () => {
    const body = schemaHelperBody(schema)
    expect(body).toMatch(/to_regclass\('public\.purchase_orders'\)/i)
    expect(body).toMatch(/to_regclass\('public\.entitlements'\)/i)
  })

  it('it fails closed when the payments tables are absent', () => {
    // A publication row alone must still report true, and it is checked BEFORE
    // the guarded branches, so its answer never depends on the missing tables.
    const body = schemaHelperBody(schema)
    const pubCheck = body.search(/from public\.published_itineraries p where p\.trip_id = p_trip/i)
    const orderGuard = body.search(/to_regclass\('public\.purchase_orders'\)/i)
    expect(pubCheck).toBeGreaterThan(-1)
    expect(pubCheck, 'the publication check must run before the guarded payments checks').toBeLessThan(orderGuard)
    // A null trip id is still "has money".
    expect(body).toMatch(/if p_trip is null then\s+return true/i)
  })

  it('schema.sql creates every relation the helper reads, or defers it with a reason', () => {
    const body = schemaHelperBody(schema)
    const created = new Set(
      [...codeOf(schema).matchAll(/create table if not exists public\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]),
    )
    const reads = [...new Set([...body.matchAll(/\b(?:from|join)\s+public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))]
    const language = body.match(/language\s+(\w+)/i)?.[1]?.toLowerCase()
    for (const rel of reads) {
      if (created.has(rel)) continue
      expect(DEFERRED[rel], `${rel} is read by the helper but schema.sql does not create it`).toBeDefined()
      expect(language, `${rel} may only be deferred from a plpgsql body`).toBe('plpgsql')
    }
    // A stale entry would let a future gap hide behind an old reason.
    expect(Object.keys(DEFERRED).filter((rel) => !reads.includes(rel)), 'stale DEFERRED entries').toEqual([])
  })

  it('the migration copy stays semantically identical to the schema copy', () => {
    // Both must check the same three things and fail closed the same way. The
    // migration may be `language sql` (the payments rail runs first there).
    const migrationBody = codeOf(migration)
    expect(migrationBody).toMatch(/from public\.published_itineraries/i)
    expect(migrationBody).toMatch(/from public\.purchase_orders/i)
    expect(migrationBody).toMatch(/from public\.entitlements/i)
    expect(migrationBody).toMatch(/p_trip\s+is\s+null/i)
  })
})
