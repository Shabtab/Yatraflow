// ============ Invite codes: generation + normalisation ============
// The short, human-usable invite code ("GOA-K7QFH3WT") that replaces the raw
// 36-char trip UUID in invite links. Pins the shape contract: readable head
// from the trip name, one separator, an 8-char unambiguous tail. Older 4-char
// tails still parse and match. Casual input (lowercase, spaces, stray dashes)
// normalises to the canonical form.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { makeInviteCode, normalizeInviteCode, looksLikeInviteCode, inviteRoute, INVITE_SEPARATOR } from '../src/lib/inviteCode'

describe('makeInviteCode', () => {
  it('builds a code from the trip name: HEAD-TAIL', () => {
    const code = makeInviteCode({ name: 'Goa Beach Week', startLocation: 'Mumbai' })
    const [head, tail] = code.split(INVITE_SEPARATOR)
    expect(head).toBe('GOABEACHWE')          // slug + 10-char cap
    expect(tail).toMatch(/^[ABCDEFGHJKLMNPQRTUVWXY346789]{8}$/)   // unambiguous alphabet, 8 chars
    expect(code).toBe('GOABEACHWE' + INVITE_SEPARATOR + tail)
  })

  it('falls back to the start location when the name is empty', () => {
    const code = makeInviteCode({ name: '', startLocation: 'Kochi' })
    expect(code.startsWith('KOCHI' + INVITE_SEPARATOR)).toBe(true)
  })

  it('falls back to YATRA when name and city are both unusable', () => {
    expect(makeInviteCode({ name: '!!!', startLocation: '' }).startsWith('YATRA' + INVITE_SEPARATOR)).toBe(true)
  })

  it('mints different tails across calls (collision retry space)', () => {
    const trip = { name: 'Rajasthan Royal', startLocation: 'Jaipur' }
    const codes = new Set(Array.from({ length: 25 }, () => makeInviteCode(trip)))
    expect(codes.size).toBeGreaterThan(1)
  })

  it('gives every new code an eight-character tail from the alphabet', () => {
    const trip = { name: 'Spiti Circuit', startLocation: '' }
    for (let i = 0; i < 25; i++) {
      const tail = makeInviteCode(trip).split(INVITE_SEPARATOR)[1]
      expect(tail).toMatch(/^[ABCDEFGHJKLMNPQRTUVWXY346789]{8}$/)
    }
  })

  it('caps the head at 10 chars and strips non-alphanumerics', () => {
    const code = makeInviteCode({ name: 'Meghalaya — Living Root Bridges!', startLocation: '' })
    const head = code.split(INVITE_SEPARATOR)[0]
    expect(head).toMatch(/^[A-Z0-9]{1,10}$/)
    expect(head).toBe('MEGHALAYAL')
  })

  it('draws the tail from the platform CSPRNG, never Math.random (audit 2026-09-22)', () => {
    // A join credential's generator is a security property (the presence.ts
    // fix class). Comments may MENTION the weak generator — strip them.
    const source = readFileSync(new URL('../src/lib/inviteCode.ts', import.meta.url), 'utf8')
    const code = source.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code).not.toMatch(/Math\s*\.\s*random\s*\(/)
    expect(code).toContain('getRandomValues')
  })
})

describe('normalizeInviteCode', () => {
  it('uppercases and trims', () => {
    expect(normalizeInviteCode('  goa-k7qf ')).toBe('GOA-K7QF')
  })

  it('collapses inner whitespace to the separator', () => {
    expect(normalizeInviteCode('goa k7qf')).toBe('GOA-K7QF')
  })

  it('collapses repeated separators and trims dangling ones', () => {
    expect(normalizeInviteCode('--goa--k7qf--')).toBe('GOA-K7QF')
  })

  it('round-trips its own generator output unchanged', () => {
    const code = makeInviteCode({ name: 'Spiti Circuit', startLocation: '' })
    expect(normalizeInviteCode(code.toLowerCase())).toBe(code)
  })

  it('keeps a legacy four-character tail and an eight-character tail canonical', () => {
    expect(normalizeInviteCode(' goa-k7qf ')).toBe('GOA-K7QF')
    expect(normalizeInviteCode('goa-k7qfh3wt')).toBe('GOA-K7QFH3WT')
  })
})

describe('looksLikeInviteCode', () => {
  it('accepts a legacy four-character tail', () => {
    expect(looksLikeInviteCode('goa-k7qf')).toBe(true)
  })

  it('accepts an eight-character tail', () => {
    expect(looksLikeInviteCode('goa-k7qfh3wt')).toBe(true)
  })

  it('rejects a raw trip UUID (legacy links carry those)', () => {
    expect(looksLikeInviteCode('11111111-1111-4111-8111-111111111111')).toBe(false)
  })

  it('rejects missing or wrong-length parts', () => {
    expect(looksLikeInviteCode('GOA')).toBe(false)
    expect(looksLikeInviteCode('GOA-K7')).toBe(false)
    expect(looksLikeInviteCode('A-B-C')).toBe(false)
  })

  it('rejects a tail of any length other than four or eight', () => {
    expect(looksLikeInviteCode('GOA-K7QFH')).toBe(false)     // 5 characters
    expect(looksLikeInviteCode('GOA-K7QFH3W')).toBe(false)   // 7 characters
    expect(looksLikeInviteCode('GOA-K7QFH3WTX')).toBe(false) // 9 characters
  })

  it('rejects a character outside the alphabet in either tail length', () => {
    expect(looksLikeInviteCode('GOA-K7Q2')).toBe(false)      // 2 is excluded
    expect(looksLikeInviteCode('GOA-K7QFH3W2')).toBe(false)
  })
})

describe('inviteRoute', () => {
  it('builds the #/join route from casual input', () => {
    expect(inviteRoute(' goa k7qf ')).toBe('/join/GOA-K7QF')
  })
})

describe('legacy codes still match', () => {
  const readSource = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  it('the client looks a code up by its normalised value, whatever its length', () => {
    const store = readSource('../src/store/store.ts')
    const lookup = store.slice(store.indexOf('export async function fetchTripByInviteCode('))
    expect(lookup).toMatch(/const normalized = normalizeInviteCode\(code\)/)
    expect(lookup).toMatch(/cache\.trips\.find\(t => t\.inviteCode === normalized\)/)
    expect(lookup).toMatch(/'get_trip_by_invite_code', \{ p_code: normalized \}/)
  })

  it('the SQL compares the stored code by value, never by length', () => {
    const paywall = readSource('../supabase/migrations/20260926_paywall_invite_code_leak.sql')
    const join = readSource('../supabase/migrations/20261012a_join_trip_function.sql')
    expect(paywall).toMatch(/where upper\(t\.invite_code\) = upper\(trim\(p_code\)\)/)
    expect(join).toMatch(/where upper\(t\.invite_code\) = v_key/)
    expect(paywall + join).not.toMatch(/(char_)?length\(\s*(t\.)?invite_code\s*\)/)
  })
})
