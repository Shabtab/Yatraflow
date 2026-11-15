import type { TripMember } from '../data/types'

export type AccessMember = TripMember & { revision: number }
export interface MemberAccessState {
  version: number
  inviteCode: string | null
  planVersion?: number
  mintBaseVersion?: number
  members: AccessMember[]
  removed: AccessMember[]
}
export type MemberChange =
  | { action: 'role'; userId: string; role: 'editor' | 'commenter' | 'viewer'; revision?: number }
  | { action: 'remove' | 'leave'; userId: string; revision?: number }
  | { action: 'restore'; member: AccessMember }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMembers(value: unknown): AccessMember[] | null {
  if (!Array.isArray(value)) return null
  const members: AccessMember[] = []
  for (const entry of value) {
    if (!record(entry) || typeof entry.userId !== 'string' || !entry.userId
      || (entry.role !== 'owner' && entry.role !== 'editor' && entry.role !== 'commenter' && entry.role !== 'viewer')
      || typeof entry.joinedAt !== 'number' || !Number.isSafeInteger(entry.joinedAt)
      || typeof entry.revision !== 'number' || !Number.isSafeInteger(entry.revision) || entry.revision < 1
      || members.some(m => m.userId === entry.userId)) return null
    members.push({ userId: entry.userId, role: entry.role, joinedAt: entry.joinedAt, revision: entry.revision })
  }
  return members
}

export function parseMemberAccess(value: unknown): MemberAccessState | null {
  if (!record(value) || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 0
    || (value.inviteCode !== null && (typeof value.inviteCode !== 'string' || !value.inviteCode))) return null
  const members = parseMembers(value.members)
  const removed = parseMembers(value.removed)
  if (!members || !removed || removed.some(r => members.some(m => m.userId === r.userId))) return null
  if (value.planVersion !== undefined && value.planVersion !== null
    && (typeof value.planVersion !== 'number' || !Number.isSafeInteger(value.planVersion) || value.planVersion < 0)) return null
  if (value.mintBaseVersion !== undefined
    && (typeof value.mintBaseVersion !== 'number' || !Number.isSafeInteger(value.mintBaseVersion) || value.mintBaseVersion < 0)) return null
  return { version: value.version, inviteCode: value.inviteCode, members, removed,
    ...(typeof value.planVersion === 'number' ? { planVersion: value.planVersion } : {}),
    ...(typeof value.mintBaseVersion === 'number' ? { mintBaseVersion: value.mintBaseVersion } : {}) }
}

export function memberChangeReceipt(value: unknown): { status: 'applied' | 'stale'; state: MemberAccessState | null } | null {
  if (!record(value) || (value.status !== 'applied' && value.status !== 'stale')) return null
  if (value.state === undefined && value.status === 'applied') return { status: value.status, state: null }
  const state = parseMemberAccess(value.state)
  return state ? { status: value.status, state } : null
}
