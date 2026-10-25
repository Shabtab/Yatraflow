// ============ #704 — "Profile saved" only after the server accepts the write ============
// updateProfile used to return nothing and fire its UPDATE without a result, so
// the Profile page said "Profile saved" whatever the server answered. These
// tests drive the real store against a Supabase mock whose profiles UPDATE
// answers with the outcome each test sets, then pin the Profile page to that
// result.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

const { state } = vi.hoisted(() => ({
  state: {
    updates: [] as Array<{ payload: unknown; eq: Record<string, unknown> }>,
    refuse: null as null | { message: string },
    reject: false,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let method: string | undefined
    let payload: unknown
    const eqs: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}
    const chain = (m: string, p?: unknown) => { method = m; payload = p; return builder }
    builder.update = (p: unknown) => chain('update', p)
    builder.insert = (p: unknown) => chain('insert', p)
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => { eqs[col] = val; return builder }
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (method === 'update' && table === 'profiles') {
        state.updates.push({ payload, eq: { ...eqs } })
        if (state.reject) {
          state.reject = false
          return Promise.reject(new Error('network down')).then(res, rej)
        }
        return Promise.resolve({ data: null, error: state.refuse }).then(res, rej)
      }
      return Promise.resolve({ data: null, error: null }).then(res, rej)
    }
    return builder
  }
  return { isSupabaseConfigured: false, supabase: { from: (t: string) => makeBuilder(t) } }
})

import { getSnapshot, updateProfile, PROFILE_NOT_SAVED, _installUsersForTest } from '../src/store/store'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const savedName = () => getSnapshot().users.find(u => u.id === 'amelia')?.profile.name

beforeEach(() => {
  // The fixture installs through the store's own gate, so it describes a state
  // the real store can reach: a private self row under the current authority.
  getSnapshot().sessionUserId = 'amelia'
  _installUsersForTest([{
    id: 'amelia', kind: 'private', email: 'amelia@example.test', createdAt: 1,
    profile: { name: 'Amelia', homeCity: 'Kochi', languages: ['en'], travelStyles: [], isCreator: false },
  }])
  state.updates.length = 0
  state.refuse = null
  state.reject = false
})

describe('#704 — updateProfile answers with the server verdict', () => {
  it('answers ok once the server accepts the write', async () => {
    const r = await updateProfile({ name: 'Amelia R' })
    expect(r).toEqual({ ok: true })
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].eq).toEqual({ id: 'amelia' })
    expect(state.updates[0].payload).toMatchObject({ name: 'Amelia R' })
    expect(savedName()).toBe('Amelia R')
  })

  it('answers not saved and restores the saved name when the server refuses', async () => {
    state.refuse = { message: 'new row violates row-level security policy' }
    const r = await updateProfile({ name: 'Amelia R' })
    expect(r).toEqual({ ok: false, error: PROFILE_NOT_SAVED })
    expect(savedName()).toBe('Amelia')
  })

  it('treats a request that never answers as not saved and restores the name', async () => {
    state.reject = true
    const r = await updateProfile({ name: 'Amelia R' })
    expect(r).toEqual({ ok: false, error: PROFILE_NOT_SAVED })
    expect(savedName()).toBe('Amelia')
  })

  it('answers not saved without a write when nobody is signed in', async () => {
    getSnapshot().sessionUserId = null
    const r = await updateProfile({ name: 'Nobody' })
    expect(r).toEqual({ ok: false, error: PROFILE_NOT_SAVED })
    expect(state.updates).toHaveLength(0)
  })
})

describe('#704 — the Profile page says "saved" only on success', () => {
  const src = read('../src/pages/Profile.tsx')

  it('waits for the write before it says "Profile saved"', () => {
    expect(src).toMatch(/const r = await updateProfile\(\{/)
    expect(src).toMatch(/if \(r\.ok\) \{ toast\('Profile saved'\); return \}/)
  })

  it('disables the save button while the write is in flight', () => {
    expect(src).toMatch(/<button className="btn btn-primary" disabled=\{saving\} onClick=\{async \(\) => \{/)
    expect(src).toMatch(/setSaving\(true\)/)
    expect(src).toMatch(/setSaving\(false\)/)
  })

  it('shows a refused save beside the button and keeps the typed values', () => {
    expect(src).toMatch(/setSaveErr\(r\.error \?\? PROFILE_NOT_SAVED\)/)
    expect(src).toMatch(/\{saveErr && <p className="err-text" role="alert">\{saveErr\}<\/p>\}/)
    // The draft is never reseeded from the cache on a failed save.
    expect(src).not.toMatch(/setF\(formFrom/)
  })
})

describe('instant saves: a refused write is said, and the chip reverts', () => {
  const src = read('../src/pages/Profile.tsx')

  it('awaits the answer of every profile write on the page', () => {
    // Each write is an instant save or the Save button. None may fire and forget.
    const writes = src.match(/updateProfile\(/g) ?? []
    const awaited = src.match(/const r = await updateProfile\(/g) ?? []
    expect(writes.length).toBeGreaterThan(0)
    expect(awaited).toHaveLength(writes.length)
  })

  it('says a refused travel-style save, after the server has answered', () => {
    expect(src).toMatch(/async function toggleStyle\(s: TravelStyle\) \{[\s\S]*?if \(!r\.ok\) toast\(r\.error \?\? PROFILE_NOT_SAVED, 'err'\)/)
  })

  it('says "Creator mode enabled" only after the server accepts the write', () => {
    expect(src).toMatch(/if \(r\.ok\) toast\('Creator mode enabled/)
    expect(src).toMatch(/else toast\(r\.error \?\? PROFILE_NOT_SAVED, 'err'\)/)
  })
})
