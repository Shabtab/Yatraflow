// ============ Invite codes: generation + normalisation ============
// The short, human-usable invite code ("GOA-K7QF") that replaces the raw
// 36-char trip UUID in invite links. Pins the shape contract: readable head
// from the trip name, one separator, a 4-char unambiguous tail; casual input
// (lowercase, spaces, stray dashes) normalises to the canonical form.
import { describe, it, expect } from 'vitest'
import { makeInviteCode, normalizeInviteCode, looksLikeInviteCode, inviteRoute, INVITE_SEPARATOR } from '../src/lib/inviteCode'

describe('makeInviteCode', () => {
  it('builds a code from the trip name: HEAD-TAIL', () => {
    const code = makeInviteCode({ name: 'Goa Beach Week', startLocation: 'Mumbai' })
    const [head, tail] = code.split(INVITE_SEPARATOR)
    expect(head).toBe('GOABEACHWE')          // slug + 10-char cap
    expect(tail).toMatch(/^[A-Z34-9]{4}$/)   // unambiguous alphabet, 4 chars
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

  it('caps the head at 10 chars and strips non-alphanumerics', () => {
    const code = makeInviteCode({ name: 'Meghalaya — Living Root Bridges!', startLocation: '' })
    const head = code.split(INVITE_SEPARATOR)[0]
    expect(head).toMatch(/^[A-Z0-9]{1,10}$/)
    expect(head).toBe('MEGHALAYAL')
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
})

describe('looksLikeInviteCode', () => {
  it('accepts a well-formed code', () => {
    expect(looksLikeInviteCode('goa-k7qf')).toBe(true)
  })

  it('rejects a raw trip UUID (legacy links carry those)', () => {
    expect(looksLikeInviteCode('11111111-1111-4111-8111-111111111111')).toBe(false)
  })

  it('rejects missing or wrong-length parts', () => {
    expect(looksLikeInviteCode('GOA')).toBe(false)
    expect(looksLikeInviteCode('GOA-K7')).toBe(false)
    expect(looksLikeInviteCode('A-B-C')).toBe(false)
  })
})

describe('inviteRoute', () => {
  it('builds the #/join route from casual input', () => {
    expect(inviteRoute(' goa k7qf ')).toBe('/join/GOA-K7QF')
  })
})
