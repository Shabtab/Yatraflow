import type { ID } from '../data/types'

export interface Owner {
  userId: ID
  sessionId: string
  incarnation: number
  authorityEpoch: number
}

export interface Credentials {
  owner: Owner
  bearer: string
}

type AuthState =
  | { kind: 'anonymous' }
  | { kind: 'unavailable'; failure: 'missing-token' | 'malformed-token' | 'session-mismatch' }
  | { kind: 'active'; owner: Owner; credentials: Credentials }

export interface ReadTicket {
  owner: Owner
  credentials: Credentials
}

export interface ObservedSession {
  user?: { id?: string | null } | null
  access_token?: string | null
}

let incarnationSeq = 0
let operationSeq = 0
export function nextIncarnation(): number { return ++incarnationSeq }
export function nextOperationId(): number { return ++operationSeq }

/** JWT decoding correlates SDK session lifetimes. It does not verify identity or grant permission. */
function sessionClaims(token: string): { sessionId: string; subject: string } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const value: unknown = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    if (!('session_id' in value) || typeof value.session_id !== 'string') return null
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.session_id)) return null
    if (!('sub' in value) || typeof value.sub !== 'string' || !value.sub) return null
    return { sessionId: value.session_id, subject: value.sub }
  } catch {
    return null
  }
}

export function correlateSession(session: ObservedSession | null | undefined, current: Owner | null, incarnation: number): AuthState {
  if (!session?.user?.id) return { kind: 'anonymous' }
  if (!session.access_token) return { kind: 'unavailable', failure: 'missing-token' }
  const claims = sessionClaims(session.access_token)
  if (!claims) return { kind: 'unavailable', failure: 'malformed-token' }
  if (claims.subject !== session.user.id) return { kind: 'unavailable', failure: 'session-mismatch' }
  const owner = current && current.userId === claims.subject && current.sessionId === claims.sessionId
    ? current
    : { userId: claims.subject, sessionId: claims.sessionId, incarnation, authorityEpoch: 0 }
  return { kind: 'active', owner, credentials: { owner, bearer: session.access_token } }
}

export function sameSession(a: Owner | null | undefined, b: Owner | null | undefined): boolean {
  return !!a && !!b && a.userId === b.userId && a.sessionId === b.sessionId && a.incarnation === b.incarnation
}
