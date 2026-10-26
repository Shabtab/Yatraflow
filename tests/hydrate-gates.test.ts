// ============ The post-hydrate gates (issue #759) ============
// hydrate() settles its fetch, then runs four follow-up steps. Each step must
// stay behind ALL THREE conditions:
//
//   hydrationSucceeded                    a failed or absent fetch runs nothing
//   gen === hydrateGen                    a superseded hydrate touches nothing
//   cache.sessionUserId === userId         a sign-out or account switch is not acted on
//
// Every step is fire-and-forget, so a deleted condition does not fail a
// behavioural test. It hands a stale account live realtime, DNA or queued
// writes instead.
//
// The file holds two halves. The first reads the source, so all three
// conditions stay pinned. The second drives the real store and watches what
// each step DOES, so the gate is pinned by behaviour too.
//
// resumeSync repeats two of the four. The issue names both ranges, so both
// functions are scanned and both runs are driven below.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { profileSession } from './helpers/profileSession'
import { readFileSync } from 'node:fs'

// ------------------------------------------------------------------
// Half 1 — the source scan
// ------------------------------------------------------------------

// The store is CRLF on Windows checkouts, so the scan runs on LF text. A
// missing normalise would match one platform and miss the other.
const SOURCE = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const LINES = SOURCE.split('\n')

/** The three conditions every follow-up step must carry. */
const GATES = ['hydrationSucceeded', 'gen === hydrateGen', 'cache.sessionUserId === userId']

/** Four steps remain after removal of the unsupported anonymous event backfill. */
const STEPS = [
  'enforceDisabledCheck',
  'connectRealtime',
  'attachDnaAccount',
  'replayQueuedWrites',
]

/** The three steps resumeSync repeats after its refetch. Root needs the
 *  authoritative caller-disabled check on a RESUME as well as on auth and on a
 *  reconnect: a frozen process or a dead socket can hide a disablement that
 *  landed while it was down, and every read that came back still says enabled. */
const RESUME_STEPS = ['enforceDisabledCheck', 'connectRealtime', 'replayQueuedWrites']

/** Characters that may precede a call of a seam we scan for. A hit that
 *  starts after one of these is part of a longer name, not a call. */
const NOT_A_BOUNDARY = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$.'

/** True when `line` contains `token` with a boundary in front of it. String
 *  work, not a built RegExp: the token comes from a variable. */
function hasCall(line: string, token: string): boolean {
  for (let at = line.indexOf(token); at !== -1; at = line.indexOf(token, at + 1)) {
    const before = at === 0 ? '' : line[at - 1]
    if (before === '' || !NOT_A_BOUNDARY.includes(before)) return true
  }
  return false
}

/** True for a line that holds no code: blank, or a comment-only line. A doc
 *  comment that names a declaration must never be read AS that declaration,
 *  so the declaration search and the call scan both skip these lines. */
function isNonCode(line: string): boolean {
  return line.trim() === '' || /^\s*(\/\/|\*|\/\*)/.test(line)
}

/** The body of a declared function, found by the indentation of its own
 *  declaration. hydrate() is an arrow inside init(), so both forms are read.
 *  The search reads code lines only: store.ts explains its gates in prose, so
 *  a comment that quotes a declaration must not move the slice. */
function bodyOf(name: string): string {
  const decl = LINES.findIndex(
    (line) => !isNonCode(line)
      && (line.includes(`function ${name}(`) || line.includes(`const ${name} = async`)),
  )
  if (decl === -1) throw new Error(`${name}() is not declared in src/store/store.ts. The pin is stale.`)
  const indent = /^\s*/.exec(LINES[decl])![0].length
  const end = LINES.findIndex((line, i) => i > decl && line.trim() === '}' && /^\s*/.exec(line)![0].length <= indent)
  if (end === -1) throw new Error(`The end of ${name}() was not found. The pin cannot read the file.`)
  return LINES.slice(decl, end + 1).join('\n')
}

/** The lines of a body that hold code, with comments and blanks removed. */
function codeLines(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.replace(/\s\/\/.*$/, ''))
    .filter((line) => !isNonCode(line))
}

/** Every call of a step, as the line that makes it. */
function callsOf(body: string, step: string): string[] {
  return codeLines(body).filter((line) => hasCall(line, `${step}(`))
}

/** The condition of the `if (...)` that guards a call, or null for a bare call. */
function gateOn(line: string): string | null {
  const match = /^\s*if \((.*)\)\s+(?:await\s+|void\s+)?\w+(?:\.\w+)*\(/.exec(line)
  return match ? match[1] : null
}

/** A step must run at least once here, and each run must carry every gate. */
function expectGated(calls: string[], step: string, where: string) {
  expect(calls.length, `${step}() must run in ${where}; if it moved, this pin is stale`).toBeGreaterThan(0)
  for (const line of calls) {
    const gate = gateOn(line)
    expect(gate, `${step}() in ${where} sits behind no condition at all`).not.toBeNull()
    for (const condition of GATES) {
      expect(gate!, `${step}() in ${where} dropped the ${condition} gate`).toContain(condition)
    }
  }
}

describe('the post-hydrate gates (#759)', () => {
  const hydrate = bodyOf('hydrate')
  const resume = bodyOf('resumeSync')

  it('reads the hydrate body it means to scan', () => {
    // A wrong slice would make every later assertion vacuous. The body must
    // hold the fetch verdict and the last of the four steps.
    expect(hydrate).toContain('hydrateFromSupabase(userId, gen)')
    expect(hydrate).toContain('replayQueuedWrites()')
  })

  it('guards each remaining step with all three conditions', () => {
    for (const step of STEPS) expectGated(callsOf(hydrate, step), step, 'hydrate()')
  })

  it('guards the steps resumeSync repeats', () => {
    for (const step of RESUME_STEPS) expectGated(callsOf(resume, step), step, 'resumeSync()')
  })

  it('takes the verdict from the awaited fetch, so a failure runs none of them', () => {
    const code = codeLines(hydrate).join('\n')
    expect(code).toContain('const hydrationSucceeded = await hydrateFromSupabase(userId, gen)')
    expect(code).toContain('activeHydrate = { userId, owner, authorityEpoch, promise }')
  })
})

// ------------------------------------------------------------------
// Half 2 — the behaviour
// ------------------------------------------------------------------
// One instrument per step, taken where the step first touches the outside
// world, so "the gate said no" is observable and cannot pass vacuously:
//
//   1 enforceDisabledCheck        -> auth.signOut()      (a DISABLED account)
//   2 connectRealtime             -> supabase.channel()
//   3 attachDnaAccount            -> the mocked module
//   4 replayQueuedWrites          -> the mocked pendingWrites()
//
// Instrument 1 needs the cache to hold a disabled account of this user, or it
// is silent whatever the gate says. The mocked snapshot below does that: a
// cold boot whose cached account was disabled server-side while offline.
//
// Condition 3 (cache.sessionUserId === userId) has no behaviour that isolates
// it. Any path that changes that id also supersedes the generation, and a
// same-user event keeps both, so the generation gate always answers first.
// Half 1 is what holds condition 3.

const { state } = vi.hoisted(() => {
  return {
    state: {
      session: null as null | { user: { id: string; app_metadata: Record<string, unknown> } },
      tables: {} as Record<string, unknown[]>,
      throws: {} as Record<string, unknown>,
      snapshot: null as null | Record<string, unknown>,
      authHandler: null as null | ((event: string, session: unknown) => void),
      writes: 0,
      signOuts: 0,
      channels: [] as string[],
      attachDna: 0,
      pending: 0,
      readGate: Promise.resolve(),
      writeGate: Promise.resolve(),
      releaseWrite: () => {},
    },
  }
})

vi.mock('../src/lib/offlineCache', () => ({
  loadSnapshot: async () => state.snapshot,
  saveSnapshot: async () => undefined,
  clearSnapshot: async () => undefined,
}))

vi.mock('../src/lib/tripDna', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/tripDna')>()),
  attachDnaAccount: async () => { state.attachDna += 1 },
}))

vi.mock('../src/lib/writeQueue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/writeQueue')>()),
  pendingWrites: async () => {
    // Snapshot and hydrate read the queue too. Only replay reads count as sends.
    if (new Error().stack?.includes('replayQueuedWrites')) state.pending += 1
    return []
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let isWrite = false
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    Object.assign(builder, {
      select: chain, eq: chain, is: chain, in: chain, limit: chain, order: chain,
      setHeader: chain,
      maybeSingle: () => { builder.singleUsed = true; return builder },
      single: () => { builder.singleUsed = true; return builder },
      insert: () => { isWrite = true; state.writes += 1; return builder },
      update: () => { isWrite = true; state.writes += 1; return builder },
      upsert: () => { isWrite = true; state.writes += 1; return builder },
      delete: () => { isWrite = true; state.writes += 1; return builder },
      // A write waits on writeGate and a read on readGate, so a test can park a
      // run at a named point instead of racing it.
      then: (
        res: (v: { data: unknown; error: unknown; count: number }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => {
        const gate = isWrite ? state.writeGate : state.readGate
        return gate.then(() => {
          const thrown = state.throws[table]
          if (thrown) throw thrown
          // A `.maybeSingle()` / `.single()` read asks for ONE row, and the code
          // it feeds maps that row directly. Handing it the whole array made
          // `rowToPrivateUser` read `id` off an array and produce `undefined`, so
          // the account was never found and the disabled check fell through to a
          // server call the mock could not answer. Unwrap only when the chain
          // asked for a single row; every other read still sees the array.
          const rows = state.tables[table] ?? []
          const data = builder.singleUsed === true ? (rows[0] ?? null) : rows
          return { data, error: null, count: 1 }
        }).then(res, reject)
      },
    })
    return builder
  }
  const channel: Record<string, unknown> = { on: () => channel, subscribe: () => ({}) }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (table: string) => makeBuilder(table),
      channel: (name: string) => { state.channels.push(name); return channel },
      removeChannel: async () => undefined,
      auth: {
        getSession: async () => ({ data: { session: state.session ? profileSession(state.session) : null } }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          state.authHandler = (event, session) => cb(event, session && typeof session === 'object' && 'user' in session ? profileSession(session as { user: { id: string } }) : session)
          return { data: { subscription: {} } }
        },
        signOut: async () => { state.signOuts += 1; return { error: null } },
      },
      rpc: (name: string) => {
        const result = Promise.resolve({ data: name === 'is_disabled' ? state.tables.profiles?.some(row => row.is_disabled === true) : [], error: null })
        return { setHeader() { return this }, then: result.then.bind(result) }
      },
    },
  }
})

/** The account the offline snapshot belongs to, disabled server-side. */
const DISABLED_A = {
  id: 'userA',
  email: 'a@example.test',
  createdAt: 1,
  profile: { name: 'A', languages: ['en'], travelStyles: ['balanced'], isCreator: false, isDisabled: true },
}

function snapshotForDisabledA() {
  return {
    version: 1, savedAt: 1,
    trips: [], trashedTrips: [], users: [DISABLED_A],
    published: [], suggestions: [], decisions: [], activity: [],
  }
}

function tripRow(id: string, ownerId: string) {
  return {
    id, owner_id: ownerId, name: `Trip ${id}`, start_location: 'Kochi',
    start_location_coords: null, destinations: ['Kochi'], destination_coords: null,
    start_date: '2026-10-01', end_date: '2026-10-03', travellers: 2, transport_mode: 'car',
    budget_per_person_inr: 5000, travel_style: 'balanced', fixed_commitments: [],
    days: [], expenses: [], cover_emoji: '🧭', visibility: 'private',
    created_at: 1, updated_at: 1,
  }
}

/** One owned trip, so the seed branch (which parks the run) cannot fire. A
 *  successful fetch replaces the cache's users with these rows, so a disabled
 *  flag here is what keeps instrument 1 live in the control. */
function loadedAccount(disabled = false) {
  return {
    profiles: [{
      id: 'userA', email: 'a@example.test', created_at: 1, name: 'A',
      languages: ['en'], travel_styles: ['balanced'], is_creator: false,
      is_disabled: disabled,
    }],
    published_itineraries: [],
    trip_members: [{ trip_id: 'tripA', user_id: 'userA', role: 'owner', joined_at: 1 }],
    trips: [tripRow('tripA', 'userA')],
  }
}

function instruments() {
  return {
    enforceDisabledCheck: state.signOuts,
    connectRealtime: state.channels.length,
    attachDnaAccount: state.attachDna,
    replayQueuedWrites: state.pending,
  }
}

const SILENT = {
  enforceDisabledCheck: 0, connectRealtime: 0, attachDnaAccount: 0,
  replayQueuedWrites: 0,
}

const IGNORED_ERRORS = [/hydration failed/, /Could not load your data/, /Could not connect/]

let loggedErrors: unknown[][] = []
let errorSpy: ReturnType<typeof vi.spyOn>

function noteErrors() {
  loggedErrors = []
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { loggedErrors.push(args) })
}

/** Let every queued microtask and timer turn drain. */
async function drain(turns = 8) {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Wait for a condition, so a test never races the run it parked. */
async function until(what: string, ok: () => boolean, turns = 40) {
  for (let i = 0; i < turns; i++) {
    if (ok()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`waited for ${what} and never saw it`)
}

async function freshStore() {
  vi.resetModules()
  return await import('../src/store/store')
}

beforeEach(() => {
  state.session = null
  state.tables = {}
  state.throws = {}
  state.snapshot = null
  state.authHandler = null
  state.writes = 0
  state.signOuts = 0
  state.channels = []
  state.attachDna = 0
  state.pending = 0
  state.readGate = Promise.resolve()
  state.writeGate = Promise.resolve()
  errorSpy?.mockRestore()
  noteErrors()
})

describe('the four steps act only when the gates say yes (#759)', () => {
  it('control: a successful hydrate runs all four', async () => {
    state.session = { user: { id: 'userA', app_metadata: {} } }
    state.snapshot = snapshotForDisabledA()
    state.tables = loadedAccount(true)

    const store = await freshStore()
    store.init()
    await until('the run to finish', () => instruments().replayQueuedWrites > 0)

    // Every instrument is live. Without this control the two cases below
    // would pass on a mock that simply never calls anything.
    expect(instruments()).toEqual({
      enforceDisabledCheck: 1, connectRealtime: 1, attachDnaAccount: 1,
      replayQueuedWrites: 1,
    })
  })

  it('a failed fetch runs none of the four', async () => {
    state.session = { user: { id: 'userA', app_metadata: {} } }
    state.snapshot = snapshotForDisabledA()
    state.tables = loadedAccount()
    // A stage-1 read that is NOT wrapped in its own try/catch throws, so
    // hydrateFromSupabase catches and its verdict stays unpublished:
    // hydrationSucceeded === false. (`profiles` cannot be the one — the self
    // read catches its own error and reports it as a slice verdict, which is a
    // partial hydrate, not a failed one.)
    state.throws = { published_itineraries: new Error('offline') }

    const store = await freshStore()
    store.init()
    await drain()

    // The other two conditions hold — the cache still belongs to this account
    // and the run is the newest generation — so the fetch VERDICT is the only
    // reason the steps stayed put. That is what makes them non-vacuous: every
    // gate except the first is satisfied and the steps still did not run.
    //
    // (The old guard looked for a private row in the cache and cannot any more:
    // an offline snapshot carries public cards only — #800's boundary — and the
    // public read succeeds with an empty catalogue, so a failed self read has
    // nothing to fall back to.)
    expect(store.getSnapshot().sessionUserId).toBe('userA')
    expect(store.getSnapshot().sliceReads.profiles).toBe('failed')
    expect(instruments()).toEqual(SILENT)
  })

  it('a superseded run runs none of its own four', async () => {
    state.session = { user: { id: 'userA', app_metadata: {} } }
    state.snapshot = snapshotForDisabledA()
    // The profile is loaded and disabled, so a stale run that acted would sign
    // this account out. No trips, so the run parks in the demo seed instead of
    // finishing, and its verdict is already published when it resumes.
    state.tables = { profiles: loadedAccount(true).profiles }

    const hold = new Promise<void>((resolve) => { state.releaseWrite = resolve })
    state.writeGate = hold

    const store = await freshStore()
    store.init()
    await until('the run to park in the seed', () => state.writes > 0)
    // The verdict is published, so hydrationSucceeded is true.
    expect(store.getSnapshot().sliceReads.trips).toBe('ok')

    // A resume takes the newest generation while the cache still belongs to
    // this account. Only the generation gate can hold the run back now.
    state.writeGate = Promise.resolve()
    await store.resumeSync()
    expect(store.getSnapshot().sessionUserId).toBe('userA')

    state.releaseWrite()
    await drain()

    // resumeSync's own steps ran once each — the authoritative disabled check
    // signs this disabled account out, which is the point of running it on a
    // resume. The superseded run added nothing beyond that: its two exclusive
    // steps never fired.
    expect(instruments()).toEqual({
      enforceDisabledCheck: 1, connectRealtime: 1, attachDnaAccount: 0,
      replayQueuedWrites: 1,
    })
  })

  it('keeps the remaining step names aligned with their instruments', () => {
    // The instrument names are the source scan's step names. A rename in the
    // store fails half 1; a rename here would silently drop a step from this
    // file, so the two lists are held together.
    expect(Object.keys(instruments()).sort()).toEqual([...STEPS].sort())
    expect(Object.keys(SILENT).sort()).toEqual([...STEPS].sort())
    expect(loggedErrors.every((args) => IGNORED_ERRORS.some((re) => re.test(String(args[0]))))).toBe(true)
  })
})
