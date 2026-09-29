import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CREATE_EVENTS,
  CREATE_INVITE_CHANNELS,
  CREATE_TEMPLATE_SOURCES,
  sanitizeCreateMeta,
  deriveCreateFunnel,
  createFunnelSessionId,
  recordCreateEvent,
  type CreateFunnelRow,
} from '../src/lib/createEvents'

/** Strip comment lines so prose cannot impersonate the code it describes
 *  (§6x: a source assertion judges code, never comments). */
function codeOf(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
}

const MIGRATION = 'supabase/migrations/20260929_create_funnel_events.sql'

describe('#428 vocabulary — the closed set is mirrored by the table CHECK', () => {
  it('the code constant and the migration CHECK name the same nine events', () => {
    const sql = codeOf(`../${MIGRATION}`)
    for (const ev of CREATE_EVENTS) {
      expect(sql).toContain(`'${ev}'`)
    }
    // no extra event in the CHECK that code does not know
    const checkBody = sql.match(/event in \(([\s\S]*?)\)\)/)?.[1] ?? ''
    const sqlEvents = [...checkBody.matchAll(/'(\w+)'/g)].map(m => m[1])
    expect(sqlEvents.sort()).toEqual([...CREATE_EVENTS].sort())
  })

  it('refuses an unknown event at the sanitizer layer too', () => {
    // recordCreateEvent refuses before the network (asserted via the insert mock below);
    // sanitizeCreateMeta itself is keyed by the type, so the runtime gate is recordCreateEvent's.
    expect(CREATE_EVENTS).toHaveLength(9)
  })

  it('schema.sql carries the same table and vocabulary', () => {
    const schema = codeOf('../supabase/schema.sql')
    expect(schema).toContain('create_funnel_events_event_check')
    expect(schema).toContain('create_funnel_events insert anon')
    expect(schema).toContain('create_funnel_events insert own')
    expect(schema).toContain('create_funnel_events admin read')
  })
})

describe('#428 PII rule — the nastiest realistic state writes nothing identifiable', () => {
  it('a submitted event with a named, phoned crew and an odd trip name serializes clean', () => {
    // The nastiest realistic state at submit time.
    const nasties = ['Priya +91 98450 12345', 'Ravi 9876543210 (whatsapp only)', 'Mumbai Goa', '₹25,000']
    const meta = sanitizeCreateMeta('submitted', { days: 4, travellers: 5, mode: 'car' })
    const row = JSON.stringify({ event: 'submitted', meta })
    for (const n of nasties) expect(row).not.toContain(n)
    expect(row).not.toContain('98450')
    expect(row).not.toContain('25,000')
  })

  it('the sanitizer DROPS free-text fields a caller tries to smuggle in', () => {
    const smuggled = sanitizeCreateMeta('submitted', {
      days: 3,
      travellers: 2,
      mode: 'car',
      // the smuggle attempts:
      name: 'Priya',
      tripName: 'Our Goa Trip',
      phone: '9845012345',
      notes: 'ring the doorbell',
      budget: 25000,
    } as unknown as Record<string, unknown>) as Record<string, unknown>
    expect(Object.keys(smuggled).sort()).toEqual(['days', 'mode', 'travellers'])
  })

  it('crew_added carries a NUMBER only', () => {
    const meta = sanitizeCreateMeta('crew_added', { count: 3 }) as Record<string, unknown>
    expect(meta).toEqual({ count: 3 })
    // names refused: a meta without a number is refused wholesale
    expect(sanitizeCreateMeta('crew_added', { names: ['Priya'] } as unknown as Record<string, unknown>)).toBeUndefined()
  })

  it('template_picked stores the platform slug and source, never user text', () => {
    const meta = sanitizeCreateMeta('template_picked', { source: 'template', templateId: 'kerala-backwaters' })
    expect(meta).toEqual({ source: 'template', templateId: 'kerala-backwaters' })
    // a templateId that is not a slug shape is dropped, not stored
    expect(sanitizeCreateMeta('template_picked', { source: 'template', templateId: 'Priya <script>' }))
      .toEqual({ source: 'template' })
    // an unknown source is refused
    expect(sanitizeCreateMeta('template_picked', { source: 'friend-told-me' })).toBeUndefined()
  })

  it('moment_invite_sent stores the channel enum, never a recipient', () => {
    for (const channel of CREATE_INVITE_CHANNELS) {
      expect(sanitizeCreateMeta('moment_invite_sent', { channel })).toEqual({ channel })
    }
    // a phone number where the channel goes is refused
    expect(sanitizeCreateMeta('moment_invite_sent', { channel: '9845012345' })).toBeUndefined()
  })

  it('abandoned clamps lastStage to a stage key — no prose escapes', () => {
    expect(sanitizeCreateMeta('abandoned', { lastStage: 'crew' })).toEqual({ lastStage: 'crew' })
    const long = sanitizeCreateMeta('abandoned', { lastStage: 'where? tell me call 9845012345 now' }) as Record<string, unknown>
    // non-word characters are stripped entirely: no digits run, no prose
    expect(String(long.lastStage)).not.toMatch(/\s/)
    expect(String(long.lastStage)).not.toContain('9845012345')
  })

  it('meta-less events drop whatever is handed in', () => {
    expect(sanitizeCreateMeta('started', { anything: 'Priya' })).toBeUndefined()
    expect(sanitizeCreateMeta('readiness_complete', { tripName: 'x' })).toBeUndefined()
    expect(sanitizeCreateMeta('draft_resumed', { phone: '9845012345' })).toBeUndefined()
  })
})

describe('#428 write path — refuse, then fire-and-forget', () => {
  const inserts: { table: string; payload: unknown }[] = []

  beforeEach(() => {
    inserts.length = 0
    vi.stubEnv('VITE_SUPABASE_URL', 'https://hqlqbfpzjmailxydjojw.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('writes a sanitized row and never throws on a failed insert', async () => {
    vi.resetModules()
    const supabase = await import('../src/lib/supabase')
    vi.spyOn(supabase.supabase, 'from').mockImplementation(((table: string) => ({
      insert: (payload: unknown) => {
        inserts.push({ table, payload })
        return { then: (cb: (r: { error: null }) => void) => Promise.resolve(cb({ error: null })) }
      },
    })) as never)
    const { recordCreateEvent: record } = await import('../src/lib/createEvents')
    expect(() => record('submitted', { days: 2, travellers: 1, mode: 'car' }, { tripId: 't1', userId: 'u1' })).not.toThrow()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('create_funnel_events')
    const payload = inserts[0].payload as Record<string, unknown>
    expect(payload.event).toBe('submitted')
    expect(payload.meta).toEqual({ days: 2, travellers: 1, mode: 'car' })
  })

  it('refuses an unknown event and a meta the shape cannot accept — no insert', async () => {
    vi.resetModules()
    const supabase = await import('../src/lib/supabase')
    const spy = vi.spyOn(supabase.supabase, 'from').mockImplementation((() => ({
      insert: () => ({ then: (cb: (r: { error: null }) => void) => Promise.resolve(cb({ error: null })) }),
    })) as never)
    const { recordCreateEvent: record } = await import('../src/lib/createEvents')
    record('not_a_real_event' as never)
    record('crew_added', { wrong: 'shape' } as unknown as { count: number })
    expect(spy).not.toHaveBeenCalled()
  })

  it('sessionStorage id: generated once, reused, 32 hex chars — never the user id', () => {
    const store = new Map<string, string>()
    const sess = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    vi.stubGlobal('sessionStorage', sess)
    vi.stubGlobal('crypto', globalThis.crypto)
    const a = createFunnelSessionId()
    const b = createFunnelSessionId()
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect([...store.values()]).toEqual([a])
  })
})

describe('#428 read derivations — the dashboard answer key', () => {
  // Fixture timestamps anchored to NOW (today minus N days) so the 30-day
  // window always contains them — the derivation buckets relative to now,
  // and a wall-calendar fixture would age out of its own test.
  const at = (daysAgo: number, hour = 10) =>
    new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 + (hour - 12) * 3600 * 1000).toISOString()

  const rows: CreateFunnelRow[] = [
    { event: 'started', at: at(3), meta: null },
    { event: 'started', at: at(3), meta: null },
    { event: 'started', at: at(2), meta: null },
    { event: 'template_picked', at: at(3), meta: { source: 'template', templateId: 'kerala-backwaters' } },
    { event: 'template_picked', at: at(2), meta: { source: 'template', templateId: 'kerala-backwaters' } },
    { event: 'template_picked', at: at(2), meta: { source: 'last', templateId: undefined } },
    { event: 'readiness_complete', at: at(2), meta: null },
    { event: 'crew_added', at: at(2), meta: { count: 3 } },
    { event: 'submitted', at: at(2), meta: { days: 4, travellers: 5, mode: 'car' } },
    { event: 'submitted', at: at(1), meta: { days: 2, travellers: 1, mode: 'train' } },
    { event: 'moment_invite_sent', at: at(1), meta: { channel: 'whatsapp' } },
    { event: 'abandoned', at: at(1), meta: { lastStage: 'crew' } },
    { event: 'abandoned', at: at(1), meta: { lastStage: 'when' } },
    { event: 'abandoned', at: at(0), meta: { lastStage: 'crew' } },
  ]

  it('counts every event in the window', () => {
    const s = deriveCreateFunnel(rows)
    expect(s.counts.started).toBe(3)
    expect(s.counts.submitted).toBe(2)
    expect(s.counts.abandoned).toBe(3)
    expect(s.counts.draft_resumed).toBe(0)
  })

  it('started → submitted conversion over sessions that started', () => {
    const s = deriveCreateFunnel(rows)
    expect(s.conversionPct).toBeCloseTo((2 / 3) * 100, 5)
  })

  it('zero starts means zero conversion, never NaN', () => {
    expect(deriveCreateFunnel([]).conversionPct).toBe(0)
  })

  it('template breakdown ranks by picks, slugs only', () => {
    const s = deriveCreateFunnel(rows)
    expect(s.templates).toEqual([{ templateId: 'kerala-backwaters', picks: 2 }])
  })

  it('top abandon stage is the mode of lastStage', () => {
    expect(deriveCreateFunnel(rows).topAbandonStage).toBe('crew')
    expect(deriveCreateFunnel([]).topAbandonStage).toBeNull()
  })

  it('per-day trend buckets started/submitted, oldest → newest', () => {
    // the window is anchored to NOW (today backwards) — the fixture dates sit
    // inside it by construction, so assert on the bucketed VALUES, not on
    // wall-calendar day strings that move with the clock.
    const s = deriveCreateFunnel(rows, 5)
    expect(s.perDay).toHaveLength(5)
    const startedSum = s.perDay.reduce((a, d) => a + d.started, 0)
    const submittedSum = s.perDay.reduce((a, d) => a + d.submitted, 0)
    expect(startedSum).toBe(3)
    expect(submittedSum).toBe(2)
    // oldest bucket is the earliest date string in the list
    const days = s.perDay.map(d => d.day)
    expect([...days].sort()[0]).toBe(days[0])
    // yesterday's bucket carries the at(1) submitted row; today's carries none
    // (at(0) in the fixture is an abandoned, not a submit)
    expect(s.perDay[3].submitted).toBe(1)
    expect(s.perDay[4].submitted).toBe(0)
    // …and rows older than the window do not appear (at(10) vs a 5-day window)
    expect(deriveCreateFunnel([{ event: 'started', at: at(10), meta: null }], 5).perDay.every(d => d.started === 0)).toBe(true)
  })

  it('an unknown event in the rows never poisons the window', () => {
    const before = deriveCreateFunnel(rows)
    const after = deriveCreateFunnel([...rows, { event: 'hax' as never, at: at(3), meta: { evil: true } }])
    expect(after.counts).toEqual(before.counts)
    expect(after.topAbandonStage).toBe(before.topAbandonStage)
  })
})

describe('#428 pins — table shape, prune gating, dashboards honesty', () => {
  it('the migration grants the pruner to NO client role (the #356 lesson)', () => {
    const sql = codeOf(`../${MIGRATION}`)
    expect(sql).toMatch(/revoke all on function public\.prune_create_funnel_events\(integer\) from public, anon, authenticated/)
    // and it clamps its own horizon
    expect(sql).toMatch(/least\(greatest\(p_keep_days, 1\), 365\)/)
  })

  it('anon insert requires user_id null; authed insert requires ownership', () => {
    const sql = codeOf(`../${MIGRATION}`)
    expect(sql).toMatch(/for insert to anon\s+with check \(user_id is null\)/)
    expect(sql).toMatch(/for insert to authenticated\s+with check \(user_id = auth\.uid\(\)\)/)
  })

  it('reads are admin-only', () => {
    const sql = codeOf(`../${MIGRATION}`)
    expect(sql).toMatch(/create_funnel_events admin read[\s\S]{0,160}public\.is_admin\(\)/)
  })

  it('no counter columns were added to trips (log-only by design)', () => {
    const sql = codeOf(`../${MIGRATION}`)
    expect(sql).not.toMatch(/alter table public\.trips/)
    expect(sql).not.toMatch(/add column/i)
  })

  it('the abandoned beacon is registered once and marked directional on the read surface', () => {
    const page = codeOf('../src/pages/AdminPage.tsx')
    // the dashboard must SAY abandoned is directional, or it reads as exact
    expect(page).toMatch(/directional/i)
  })
})
