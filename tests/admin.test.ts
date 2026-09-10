// ============ Masteradmin console stats ============
// Pure derivations over the hydrated cache (node-testable). Fresh apps with
// zero users/trips render 0s, never NaN — every denominator is guarded.
import { describe, it, expect } from 'vitest'
import {
  weekBucket, computeAdminOverview, computeGrowthSeries, computeFunnel, recentJoins,
} from '../src/lib/adminStats'
import type { Trip, User } from '../src/data/types'

function user(id: string, createdAt: number, extra: Partial<User['profile']> = {}): User {
  return {
    id, email: `${id}@x.com`, createdAt,
    profile: { name: id, languages: ['en'], travelStyles: ['balanced'], isCreator: false, ...extra },
  }
}

function trip(id: string, owner: string, createdAt: number, visibility: Trip['visibility'] = 'private', members = 1): Trip {
  return {
    id, name: id, startLocation: 'A', destinations: ['B'], startDate: '', endDate: '',
    travellers: members, transportMode: 'car', budgetPerPersonInr: 0, travelStyle: 'balanced',
    fixedCommitments: [], days: [], expenses: [],
    members: Array.from({ length: members }, (_, i) => ({
      userId: i === 0 ? owner : `${id}-m${i}`, role: i === 0 ? 'owner' : 'editor', joinedAt: createdAt,
    })),
    coverEmoji: '🧭', visibility, createdAt, updatedAt: createdAt,
  }
}

describe('weekBucket', () => {
  it('buckets a whole week to Monday 00:00 UTC', () => {
    // 2026-09-09 is a Wednesday; Monday 2026-09-07 00:00 UTC is the bucket.
    const expected = Date.UTC(2026, 8, 7)
    expect(weekBucket(Date.UTC(2026, 8, 9, 15, 30))).toBe(expected)
    expect(weekBucket(Date.UTC(2026, 8, 7))).toBe(expected)
    expect(weekBucket(Date.UTC(2026, 8, 13, 23, 59))).toBe(expected)
    expect(weekBucket(Date.UTC(2026, 8, 14))).toBe(Date.UTC(2026, 8, 14))
  })
})

describe('computeAdminOverview', () => {
  it('returns zeros on an empty app, never NaN', () => {
    const o = computeAdminOverview([], [], [], [], [], [])
    expect(o.totalUsers).toBe(0)
    expect(o.avgMembersPerTrip).toBe(0)
    expect(o.privateTrips).toBe(0)
    expect(Number.isNaN(o.avgMembersPerTrip)).toBe(false)
  })
  it('splits visibility, counts members, slices activity weeks', () => {
    const now = Date.UTC(2026, 8, 9, 12)
    const users = [user('a', now - 1000), user('b', now - 2000, { isCreator: true, isDisabled: true })]
    const trips = [trip('t1', 'a', now - 1000, 'private', 2), trip('t2', 'b', now - 1000, 'public', 1)]
    const suggestions = [{ status: 'open' }, { status: 'accepted' }]
    const decisions = [{ status: 'resolved' }] as never[]
    const activity = [
      { id: 'x', tripId: 't1', actorId: 'a', verb: 'v', at: now - 86400000 },
      { id: 'y', tripId: 't1', actorId: 'a', verb: 'v', at: now - 10 * 86400000 },
    ] as never[]
    const o = computeAdminOverview(users, trips, suggestions, decisions, [], activity, now)
    expect(o.totalUsers).toBe(2)
    expect(o.disabledUsers).toBe(1)
    expect(o.creators).toBe(1)
    expect(o.privateTrips).toBe(1)
    expect(o.publicTrips).toBe(1)
    expect(o.totalMembers).toBe(3)
    expect(o.avgMembersPerTrip).toBeCloseTo(1.5)
    expect(o.openSuggestions).toBe(1)
    expect(o.resolvedSuggestions).toBe(1)
    expect(o.openDecisions).toBe(0)
    expect(o.resolvedDecisions).toBe(1)
    expect(o.activityLast7d).toBe(1)
    expect(o.activityPrev7d).toBe(1)
  })
})

describe('parseAdminRole', () => {
  it('accepts only the exact masteradmin role', async () => {
    const { parseAdminRole } = await import('../src/lib/admin')
    expect(parseAdminRole({ role: 'masteradmin' })).toBe(true)
    expect(parseAdminRole({ role: 'admin' })).toBe(false)
    expect(parseAdminRole({ role: 'masteradmin ' })).toBe(false)
    expect(parseAdminRole(null)).toBe(false)
    expect(parseAdminRole(undefined)).toBe(false)
    expect(parseAdminRole([])).toBe(false)
    expect(parseAdminRole({})).toBe(false)
    expect(parseAdminRole('masteradmin')).toBe(false)
  })
})

describe('computeGrowthSeries', () => {
  it('buckets signups and trips into trailing weeks', () => {
    const now = Date.UTC(2026, 8, 9, 12) // Wed
    const thisWeek = weekBucket(now)
    const users = [user('a', thisWeek + 1000), user('b', thisWeek - 7 * 86400000 + 1000)]
    const trips = [trip('t1', 'a', thisWeek + 2000, 'private')]
    const series = computeGrowthSeries(users, trips, 4, now)
    expect(series).toHaveLength(4)
    expect(series[3]).toMatchObject({ week: thisWeek, signups: 1, trips: 1 })
    expect(series[2]).toMatchObject({ signups: 1, trips: 0 })
    expect(series[0]).toMatchObject({ signups: 0, trips: 0 })
  })
  it('ignores future-dated rows', () => {
    const now = Date.UTC(2026, 8, 9, 12)
    const series = computeGrowthSeries([user('a', now + 30 * 86400000)], [], 4, now)
    expect(series.reduce((s, p) => s + p.signups, 0)).toBe(0)
  })
})

describe('computeFunnel', () => {
  it('guards every denominator on empty input', () => {
    const f = computeFunnel([], [], [])
    expect(f).toMatchObject({ activationPct: 0, collabPct: 0, publishPct: 0, viewToCopyPct: 0 })
  })
  it('computes activation, collab, publish and view-to-copy rates', () => {
    const users = [user('a', 1), user('b', 1), user('c', 1)]
    const trips = [trip('t1', 'a', 1, 'public', 2), trip('t2', 'b', 1, 'private', 1)]
    const pubs = [{ tripId: 't1', views: 100, copies: 10 }] as never[]
    const f = computeFunnel(users, trips, pubs)
    expect(f.usersWithTrips).toBe(2)
    expect(f.activationPct).toBeCloseTo((2 / 3) * 100)
    expect(f.collabPct).toBe(50)
    expect(f.publishPct).toBe(50)
    expect(f.viewToCopyPct).toBe(10)
  })
})

describe('recentJoins', () => {
  it('counts only joins within 30 days', () => {
    const now = 1000000000000
    const members = [
      { userId: 'a', role: 'owner', joinedAt: now - 1000 },
      { userId: 'b', role: 'editor', joinedAt: now - 31 * 86400000 },
    ] as never[]
    expect(recentJoins(members, now)).toBe(1)
    expect(recentJoins([], now)).toBe(0)
  })
})
