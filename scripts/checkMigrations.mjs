#!/usr/bin/env node
// ============================================================================
// YatraFlow migration status — is every migration in this repo actually live?
// ============================================================================
// Usage:   npm run check:migrations
//          npm run check:migrations -- --json
//          npm run check:migrations -- --list          (no network: what would be probed)
//          npm run check:migrations -- --only covers   (just the matching files)
//
// What this is:
//   One read-only pass over `supabase/migrations/*.sql`. For each file it
//   derives the artifacts that migration is responsible for — a table, a
//   column, a Storage bucket — asks the live project whether each one is
//   really there, and prints applied / MISSING per file, with the artifacts
//   it could not check named rather than silently passed over.
//
// Why it exists:
//   The database half of a release is the one part no local gate can see.
//   `npm run verify` typechecks, tests and builds; it says nothing about SQL
//   that has never run, so a release can merge, deploy, pass CI and Vercel
//   while its migration was never applied. That is not hypothetical: v0.63.0's
//   covers work made a *saved* cover mandatory to publish, so an unapplied
//   `trips.cover_image_url` would have blocked every creator the moment the
//   code went live — and silently, because the client's own degradation probe
//   (`probeOptionalColumn`) is designed to hide exactly that failure. Run this
//   before promoting a release; the CHANGELOG entry for a new migration is the
//   reminder to run it.
//
// Safety by construction:
//   - **GET only.** Nothing here writes, calls an RPC, or touches a row. That
//     is also why RPC existence is NOT probed: PostgREST answers 404 PGRST202
//     for a function called without its parameters *whether or not it exists*
//     (checked live 2026-09-21 — `admin_delete_user` and a nonsense name
//     returned the same body), so the only way to probe a function is to
//     execute it. `tests/migration-status.test.ts` pins the absence of any
//     mutating verb so that stays a decision rather than an accident.
//   - The anon key is enough — the same key the app already ships with.
//   - `.env.local` is read like the app does (process.env overrides it), and
//     only the project host is ever printed.
//
// Exit codes: 0 every probed artifact is present · 1 something is missing,
//   undeclared, or could not be checked · 2 no credentials
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', OFF = '\x1b[0m'
const useColour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const paint = (text, code) => (useColour ? code + text + OFF : text)

/** Migrations sit beside this script rather than beside the caller's cwd, so
 *  the same question gets the same answer from a shell, a test, or a scheduled
 *  task — a path relative to cwd would silently find zero migrations. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))

// ------------------------------------------------------------------ env loading
function loadEnv() {
  // One Map, no dynamic property access anywhere: .env.local is parsed in
  // first, then defined process.env entries override it (the `env[name]`
  // read/write form is also what Codacy's object-injection rule flags).
  const env = new Map()
  try {
    for (const line of readFileSync(resolve('.env.local'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      env.set(m[1], v)
    }
  } catch { /* no .env.local — process.env only */ }
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env.set(k, v)
  }
  return env
}

// ------------------------------------------------------- artifact derivation
//
// Each migration declares its own artifacts, and a checker that has to be told
// about them one by one rots the first time someone forgets. So the probes are
// read back out of the SQL instead: the statements below are the forms this
// repo actually writes (checked against all 19 migrations, 2026-09-21):
//
//   create table if not exists public.admin_audit (
//   alter table public.published_itineraries
//     add column if not exists refreshed_at bigint;      -- wraps onto its own line
//   insert into storage.buckets (id, name, public, ...)
//   values ('covers', ...);
//
// A migration that creates none of these — a function, a policy, a trigger —
// must be declared in NO_PROBE_SURFACE with its reason, or this check fails
// with "undeclared" instead of quietly reporting nothing. That is the ratchet
// that keeps a new migration from shipping unexamined.

/** SQL with comments blanked out. A commented-out statement must not read as a
 *  claim about the database — `20260906_published_refreshed_at.sql` mentions
 *  `add column` in prose, and `-- alter table … add column x` is how a
 *  migration is staged. Line comments are matched anywhere on the line, which
 *  would also eat a `--` inside a string literal; no migration here has one,
 *  and the failure mode is a missed probe rather than a false one. */
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

const TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi
// The keyword guard is load-bearing, not decoration: with a column name this
// checker cannot probe (`add column if not exists "quoted-col" text`), the
// optional `if not exists` group backtracks away and the capture otherwise
// grabs the word `if`, inventing a probe for `trips.if` and reporting it MISSING
// against the database. Caught by the fixture suite on the first run.
const COLUMN_RE = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?public\.([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(?!(?:if|not|exists)\b)([a-z_][a-z0-9_]*)/gi
const BUCKET_STMT_RE = /insert\s+into\s+storage\.buckets[^;]*/gi

/** Artifacts a single migration file is responsible for, in source order. */
export function deriveProbes(sql) {
  const body = stripSqlComments(sql)
  const probes = []
  const seen = new Set()
  const add = (probe) => {
    if (seen.has(probe.label)) return
    seen.add(probe.label)
    probes.push(probe)
  }

  for (const m of body.matchAll(TABLE_RE)) {
    add({ kind: 'table', target: m[1].toLowerCase(), label: `table public.${m[1].toLowerCase()}` })
  }
  for (const m of body.matchAll(COLUMN_RE)) {
    const table = m[1].toLowerCase(), column = m[2].toLowerCase()
    add({ kind: 'column', table, target: column, label: `public.${table}.${column}` })
  }
  for (const stmt of body.matchAll(BUCKET_STMT_RE)) {
    // The bucket id is the first literal of the VALUES tuple; `on conflict (id)
    // do update` keeps the statement idempotent, so one bucket per statement.
    const values = stmt[0].match(/values\s*\(\s*'([^']+)'/i)
    if (values) add({ kind: 'bucket', target: values[1], label: `Storage bucket '${values[1]}'` })
  }
  return probes
}

/** Migrations whose artifacts no read-only probe can answer for, with the
 *  reason. Only these may have zero derived probes; anything else is
 *  "undeclared" and fails the check until someone adds it here.
 *
 *  The bar for landing here: the migration's absence must be LOUD (the app
 *  errors at call time) or covered by another live suite. A silent failure to
 *  apply is the one thing this check refuses to wave through. */
export const NO_PROBE_SURFACE = {
  '20260906_bump_published_stats_text.sql': {
    reason: 'function only — a missing RPC fails at call time with PGRST202, not silently',
  },
  '20260907_shared_trip_reads.sql': {
    reason: 'function only — a missing RPC fails at call time with PGRST202, not silently',
  },
  '20260921_admin_revenue.sql': {
    reason: 'function only (`admin_revenue`) — a missing RPC fails at call time with PGRST202, not silently',
  },
  '20260921_purchase_share_card.sql': {
    reason: 'functions only (`owns_publication` and kin) — a missing RPC fails at call time with PGRST202, not silently',
  },
  '20260922_pub_events_retention.sql': {
    reason: 'function only (`prune_pub_events`) — a missing RPC fails at call time with PGRST202, not silently',
  },
  '20260910_schedule_purge.sql': {
    optional: true,
    reason: 'schedules pg_cron, which is opt-in and needs the extension enabled by hand — optional by design, never expect it',
  },
  '20260910_trip_trash_rpc.sql': {
    reason: 'functions only — `trips.deleted_at`, the column they act on, is probed by 20260910_trip_trash.sql',
  },
  '20260916_admin_delete_user.sql': {
    reason: 'function only — a missing RPC fails at call time with PGRST202, not silently',
  },
  '20260917_pin_trashed_read.sql': {
    reason: 'policy only — the policy the RLS contract suite exercises (`npm run test:integration`)',
  },
  '20260918_payments_security.sql': {
    reason: 'functions + a policy — a missing paywall RPC fails loudly; the policy is covered by the RLS contract suite',
  },
  '20260919_trip_touch_updated_at.sql': {
    reason: 'trigger only — needs a write to observe, and its table is probed by the migration that created it',
  },
  '20260925_decision_resolved_option_text.sql': {
    // A type change is the one shape presence cannot answer for: the derived
    // probe (`public.decisions.resolved_option_id`) reads PRESENT before the
    // migration too, so a green run would be a lie in the worst direction.
    // What makes this loud instead of silent is the call itself — an
    // unapplied column answers 22P02/400 on every resolveDecision — plus
    // tests/decision-resolve.test.ts pinning schema, migration and payload.
    reason: 'alter column TYPE only — presence proves nothing here (the column exists before and after), so it is pinned by tests/decision-resolve.test.ts; unapplied, it fails loudly at call time with 22P02 on every resolveDecision',
  },
  '20260926_paywall_invite_code_leak.sql': {
    // Same shape of problem as the entry above: it REDEFINES two functions and
    // creates nothing, so both exist before and after and no presence probe can
    // tell the fixed body from the leaking one. What an unapplied copy costs is
    // a live paywall bypass, so the fix is pinned at the source instead —
    // tests/paywall-invite-code-leak.test.ts asserts the column list with
    // `invite_code` nulled, the premium clause on the code path and the
    // migration ordering that keeps both — and the behaviour itself belongs to
    // the opt-in RLS contract suite.
    reason: 'functions only — both are redefined rather than created, so presence answers nothing; pinned by tests/paywall-invite-code-leak.test.ts, with the paywall behaviour covered by the RLS contract suite (`npm run test:integration`)',
  },
  '20260927_prune_pub_events_lockdown.sql': {
    // Grants only: the pruner is re-granted, not created, so it exists before
    // and after and no read-only probe can tell the two states apart. The live
    // grant is asserted by the RLS contract suite (aclexplode against the real
    // role list — the only place a grant can actually be observed) and the
    // schema.sql mirror by tests/prune-pub-events-lockdown.test.ts.
    reason: 'grants only — `prune_pub_events` is re-granted rather than created, so presence answers nothing; the live role list is asserted by the RLS contract suite and the mirror by tests/prune-pub-events-lockdown.test.ts',
  },
  '20260928_public_trip_fail_closed.sql': {
    // Redefines a function that already exists: presence answers nothing about
    // whether the guards are in the body a fresh apply leaves behind. That is
    // pinned by tests/public-trip-fail-closed.test.ts, which reads the newest
    // definition and asserts #350/#351 survive alongside #352/#353.
    reason: 'redefines `get_public_trip` — the function exists before and after, so presence answers nothing; the body is pinned by tests/public-trip-fail-closed.test.ts and its behaviour by the RLS contract suite',
  },
  '20260929_trash_purge_audit.sql': {
    // Redefines `purge_trashed_trip` to log the user-triggered purge (#387):
    // the function exists before and after, so presence answers nothing about
    // whether the audit INSERT is in the body a fresh apply leaves behind.
    // Pinned by tests/trips-trash-honest-failure.test.ts (audit INSERT, owner
    // + tombstone predicates, unchanged grants, scheduled sweep untouched).
    reason: 'redefines `purge_trashed_trip` — the function exists before and after, so presence answers nothing; the audit body is pinned by tests/trips-trash-honest-failure.test.ts',
  },
  '20260929_admin_rpc_grant_lockdown.sql': {
    // Grants only (#366): the admin RPCs are re-granted, not created, so
    // presence answers nothing about who can REACH them. The live role list is
    // asserted by the RLS contract suite (aclexplode against all eight admin
    // RPCs) and the migration's own shape by tests/admin-rpc-grants.test.ts.
    reason: 'grants only — the admin RPCs are re-granted rather than created, so presence answers nothing; the live role list is asserted by the RLS contract suite and the migration shape by tests/admin-rpc-grants.test.ts',
  },
}

/** The plan: one entry per migration file, with its probes and the reason none
 *  can answer for it (when that is the case). Pure and offline — `--list` and
 *  the coverage test both read this without a network. */
export function planMigrations({ dir = MIGRATIONS_DIR, only = '' } = {}) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !only || f.includes(only))
    .sort()
  return files.map((file) => {
    const sql = readFileSync(resolve(dir, file), 'utf8')
    const probes = deriveProbes(sql)
    // A declared optional migration is never expected live, so it is listed
    // apart from the ones that must be applied.
    const declared = NO_PROBE_SURFACE[file] ?? null
    return {
      file,
      probes,
      noProbeSurface: declared ? declared.reason : null,
      optional: Boolean(declared?.optional),
    }
  })
}

// ------------------------------------------------------------- classification
//
// Every verdict comes from a response this checker has actually seen against
// the live project — the codes below are recorded, not guessed:
//
//   table present    GET /rest/v1/trips?select=id&limit=1        200  []
//   table absent     GET /rest/v1/nope?select=*&limit=1          404  PGRST205
//   column present   GET /rest/v1/trips?select=cover_image_url   200  []
//   column absent    GET /rest/v1/trips?select=not_a_col         400  42703
//   bucket present   GET /storage/v1/object/public/covers/x      400  NoSuchKey
//   bucket absent    GET /storage/v1/object/public/nope/x        400  NoSuchBucket
//
// Three readings are deliberate and worth stating:
//   * `200 []` means the artifact EXISTS and RLS withholds the rows — `user_dna`
//     answers exactly this from an anon caller. Emptiness is not absence.
//   * 401/403 means it exists and this key may not see it. A missing table
//     always answers 404 PGRST205, so authorization cannot masquerade as
//     absence.
//   * Anything else is `unknown`, which FAILS the check rather than passing: a
//     probe that could not answer has proved nothing about the database.
export function classify(kind, status, body) {
  const code = typeof body?.code === 'string' ? body.code : ''
  const message = String(body?.message ?? body?.error ?? '')
  if (status === 0) return 'unknown'

  if (kind === 'bucket') {
    if (code === 'NoSuchBucket' || /bucket not found/i.test(message)) return 'missing'
    if (code === 'NoSuchKey' || status === 200) return 'present'
    // A private bucket answers the /public/ path with its own error rather than
    // NoSuchBucket. It exists; `covers` is public by design, so this only ever
    // saves a future non-public bucket from a false MISSING.
    if (/not public/i.test(message)) return 'present'
    return 'unknown'
  }

  if (status === 401 || status === 403) return 'present'
  if (status === 200 || status === 204) return 'present'

  if (kind === 'table') {
    if (status === 404 && (code === 'PGRST205' || /could not find the table/i.test(message))) return 'missing'
    return 'unknown'
  }

  // column
  if (status === 400 && (code === '42703' || /column .* does not exist/i.test(message))) return 'missing'
  // The parent table is absent too, so the column cannot exist — reporting the
  // column's own absence is what the file-by-file answer needs.
  if (status === 404 && (code === 'PGRST205' || /could not find the table/i.test(message))) return 'missing'
  return 'unknown'
}

// ------------------------------------------------------------------- probing
/** Identifiers that reach a URL come from this repo's own migrations, but they
 *  are validated before being interpolated anyway: the file could be edited to
 *  contain anything, and a checker must not be a request-sending primitive. */
function assertSafeIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`refusing to probe unsafe identifier: ${JSON.stringify(value)}`)
  }
  return value
}

function probeUrl(base, probe) {
  const target = assertSafeIdentifier(probe.target)
  if (probe.kind === 'table') return `${base}/rest/v1/${target}?select=*&limit=1`
  if (probe.kind === 'column') return `${base}/rest/v1/${assertSafeIdentifier(probe.table)}?select=${target}&limit=1`
  return `${base}/storage/v1/object/public/${target}/__probe_absent__`
}

async function httpGet(url, key, timeoutMs) {
  try {
    const res = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    let body = null
    try { body = await res.json() } catch { body = null }
    return { status: res.status, body, error: null }
  } catch (err) {
    return { status: 0, body: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Bounded concurrency: the live project rate-limits, and a 19-file sweep does
 *  not need to open 40 sockets to answer in a second. */
async function mapConcurrent(items, limit, worker) {
  const out = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return out
}

async function checkMigration(base, key, migration, timeoutMs) {
  const probes = await mapConcurrent(migration.probes, 4, async (probe) => {
    const res = await httpGet(probeUrl(base, probe), key, timeoutMs)
    return {
      label: probe.label,
      verdict: classify(probe.kind, res.status, res.body),
      status: res.status,
      detail: res.error ?? (typeof res.body?.code === 'string' ? res.body.code : ''),
    }
  })
  let verdict
  if (probes.some((p) => p.verdict === 'missing')) verdict = 'missing'
  else if (probes.some((p) => p.verdict === 'unknown')) verdict = 'unknown'
  else if (probes.length > 0) verdict = 'applied'
  else if (migration.noProbeSurface) verdict = 'no-probe-surface'
  else verdict = 'undeclared'
  return { ...migration, probes, verdict }
}

// -------------------------------------------------------------------- output
const pad = (text, width) => (text.length >= width ? text : text + ' '.repeat(width - text.length))

function render(report, { quiet, only }) {
  const lines = []
  lines.push(`${DIM}YatraFlow — live migration status${OFF}`)
  lines.push(`${DIM}project${OFF}  ${report.project}  ${DIM}(anon key · read-only GET probes)${OFF}`)
  if (only) lines.push(`${DIM}filter${OFF}   --only ${only}`)
  lines.push('')

  for (const m of report.migrations) {
    const shown = m.verdict !== 'applied' && !(quiet && m.verdict === 'no-probe-surface')
    if (quiet && !shown) continue
    if (m.verdict === 'applied') {
      const n = m.probes.length === 1 ? '1 artifact' : `${m.probes.length} artifacts`
      lines.push(`  ${paint('ok  ', GREEN)} ${pad(m.file, 44)} ${DIM}${n} present${OFF}`)
    } else if (m.verdict === 'missing') {
      const gone = m.probes.filter((p) => p.verdict === 'missing').map((p) => p.label).join(', ')
      lines.push(`  ${paint('MISS', RED)} ${pad(m.file, 44)} ${paint(gone, RED)}`)
    } else if (m.verdict === 'unknown') {
      const bad = m.probes.filter((p) => p.verdict === 'unknown')
        .map((p) => `${p.label} (${p.status === 0 ? p.detail : `HTTP ${p.status}${p.detail ? ` ${p.detail}` : ''}`})`)
        .join(', ')
      lines.push(`  ${paint('??  ', YELLOW)} ${pad(m.file, 44)} ${paint(`could not check: ${bad}`, YELLOW)}`)
    } else if (m.verdict === 'undeclared') {
      lines.push(`  ${paint('!!  ', YELLOW)} ${pad(m.file, 44)} ${paint('no probe surface and no reason declared', YELLOW)}`)
    } else {
      const tag = m.optional ? 'n/a ' : '--  '
      lines.push(`  ${paint(tag, DIM)} ${pad(m.file, 44)} ${DIM}no probe surface — ${m.noProbeSurface}${OFF}`)
    }
  }

  const s = report.summary
  // The optional entry is counted once, inside `noProbeSurface` — the first
  // draft added the two and reported 20 migrations out of 19.
  const optional = s.optional > 0 ? ` (${s.optional} optional)` : ''
  lines.push('')
  lines.push(
    `${s.migrations} migrations · ${paint(`${s.applied} applied`, GREEN)} · ` +
    `${s.missing ? paint(`${s.missing} missing`, RED) : '0 missing'} · ` +
    `${s.noProbeSurface} no probe surface${optional} · ${s.unknown ? paint(`${s.unknown} unchecked`, YELLOW) : '0 unchecked'}` +
    (s.undeclared ? ` · ${paint(`${s.undeclared} undeclared`, YELLOW)}` : ''),
  )

  if (s.missing > 0) {
    lines.push('')
    lines.push(paint('Apply these before promoting, in the Supabase SQL editor:', RED))
    for (const m of report.migrations.filter((x) => x.verdict === 'missing')) {
      const gone = m.probes.filter((p) => p.verdict === 'missing').map((p) => p.label).join(', ')
      lines.push(`  supabase/migrations/${m.file} — ${gone}`)
    }
  }
  if (s.undeclared > 0) {
    lines.push('')
    lines.push(paint('Declare these in NO_PROBE_SURFACE with the reason no probe can answer for them:', YELLOW))
    for (const m of report.migrations.filter((x) => x.verdict === 'undeclared')) {
      lines.push(`  supabase/migrations/${m.file}`)
    }
  }
  if (s.missing === 0 && s.unknown === 0 && s.undeclared === 0) {
    lines.push('')
    lines.push(`${GREEN}Every migration this check can probe is live.${OFF}`)
  }
  const noSurface = report.migrations.filter((m) => m.verdict === 'no-probe-surface')
  if (noSurface.length > 0) {
    lines.push('')
    lines.push(`${DIM}No probe surface = function/policy/trigger-only migrations. Their absence is loud`)
    lines.push(`(a missing RPC fails with PGRST202 at call time) or covered by the RLS contract`)
    lines.push(`suite (\`npm run test:integration\`); neither is silent, which is the failure this`)
    lines.push(`check exists to catch.${OFF}`)
  }
  return lines.join('\n')
}

function help() {
  return `YatraFlow migration status — probes the live project for every migration's artifacts.

  node scripts/checkMigrations.mjs [options]

  --list           print the plan (derived artifacts + no-probe-surface reasons), no network
  --json           machine-readable report on stdout
  --quiet          only the migrations that are not applied
  --only <text>    restrict to files whose name contains <text>
  --allow-missing  exit 0 even when something is missing (report only, no gate)
  --timeout <ms>   per-request timeout (default 15000)
  --help

Credentials come from .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY),
overridden by SUPABASE_URL / SUPABASE_ANON_KEY or any process.env entry.`
}

// ---------------------------------------------------------------------- main
async function main(argv) {
  const opts = { json: false, list: false, quiet: false, allowMissing: false, only: '', timeoutMs: 15000, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--list') opts.list = true
    else if (arg === '--quiet') opts.quiet = true
    else if (arg === '--allow-missing') opts.allowMissing = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--only') opts.only = argv[++i] ?? ''
    else if (arg.startsWith('--only=')) opts.only = arg.slice('--only='.length)
    else if (arg === '--timeout') opts.timeoutMs = Number(argv[++i]) || 15000
    else if (arg.startsWith('--timeout=')) opts.timeoutMs = Number(arg.slice('--timeout='.length)) || 15000
    else if (!arg.startsWith('--')) opts.only = arg
    else {
      console.error(`${RED}unknown option: ${arg}${OFF}\n\n${help()}`)
      return 2
    }
  }
  if (opts.help) {
    console.log(help())
    return 0
  }

  const migrations = planMigrations({ only: opts.only })

  if (opts.list) {
    const plan = migrations.map((m) => ({
      file: m.file,
      probes: m.probes.map((p) => p.label),
      noProbeSurface: m.noProbeSurface,
      optional: m.optional,
    }))
    console.log(opts.json ? JSON.stringify({ migrations: plan }, null, 2)
      : plan.map((m) => `  ${pad(m.file, 44)} ${m.probes.length > 0 ? m.probes.join(', ') : `no probe surface — ${m.noProbeSurface ?? 'UNDECLARED'}`}`).join('\n'))
    return 0
  }

  const env = loadEnv()
  const get = (a, b) => env.get(a) || env.get(b) || ''
  const base = (get('SUPABASE_URL', 'VITE_SUPABASE_URL')).replace(/\/+$/, '')
  const key = get('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
  if (!base || !key) {
    console.error(`${RED}missing credentials${OFF} — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local,`)
    console.error('or export SUPABASE_URL and SUPABASE_ANON_KEY. The anon key is enough; this check only reads.')
    return 2
  }

  const checked = await mapConcurrent(migrations, 4, (m) => checkMigration(base, key, m, opts.timeoutMs))
  const tally = (v) => checked.filter((m) => m.verdict === v).length
  const report = {
    project: base,
    checkedAt: new Date().toISOString(),
    summary: {
      migrations: checked.length,
      applied: tally('applied'),
      missing: tally('missing'),
      unknown: tally('unknown'),
      noProbeSurface: tally('no-probe-surface'),
      optional: checked.filter((m) => m.verdict === 'no-probe-surface' && m.optional).length,
      undeclared: tally('undeclared'),
    },
    migrations: checked,
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(render(report, opts))
  }

  const blocking = report.summary.missing + report.summary.unknown + report.summary.undeclared
  if (blocking > 0 && !opts.allowMissing) return 1
  return 0
}

// Importable for its pure parts (the coverage test reads `--list` through the
// CLI, so this guard exists for anything that wants the derivation directly).
// pathToFileURL, not a hand-built `file://` string: on Windows `process.argv[1]`
// is `C:\…`, and `file://C:\…` never equals `file:///C:/…` — the script would
// import cleanly and then do nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
