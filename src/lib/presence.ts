// ============ Trip presence (M6 · B1) ============
// Who is viewing a trip right now. Pure state first (node-tested), the
// Supabase presence channel second (integration-tested — a presence
// round-trip needs a second live session, which the mocked tests cannot
// pretend to be).
//
// Deliberately a SEPARATE channel from the store's `yatraflow-live`
// postgres_changes subscription: presence re-syncs on every join/leave and
// heartbeat, while row changes are comparatively rare. Sharing one channel
// would route the noisy stream through the store's event dispatch, and the
// store must stay lean (plan doc B1).
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

// ---------------- pure state ----------------

/** One live viewing session of the trip, as presence reports it. Presence
 *  keys SESSIONS, not users — one signed-in user in two tabs is two sessions,
 *  and the dedupe below collapses them to one avatar per user. */
export interface PresencePeer {
  /** Opaque per-session identity (presenceKey()) — the join/leave unit. */
  sessionKey: string
  userId: string
  /** Best display name available at broadcast time (profile name > email). */
  name: string
  /** Millisecond timestamp of when this session (re)joined — drives the
   *  "longest-standing viewer first" avatar order, so a re-sync never
   *  reshuffles the row. */
  joinedAt: number
}

/** The pure presence state a trip's UI renders. */
export interface PresenceState {
  peers: PresencePeer[]
}

export const EMPTY_PRESENCE: PresenceState = { peers: [] }

/**
 * Add/replace one session's presence. Replace = a session re-joins (refresh,
 * reconnect) in place. Ordering is stable: by joinedAt asc, ties broken by
 * userId, so re-syncs never reshuffle.
 */
export function reducePresence(state: PresenceState, sessionKey: string, peer: { userId: string; name: string }, joinedAt: number): PresenceState {
  if (!sessionKey || !peer.userId) return state
  const peers = state.peers.filter(p => p.sessionKey !== sessionKey)
  peers.push({ sessionKey, userId: peer.userId, name: peer.name, joinedAt })
  return { peers: dedupeByUser(peers) }
}

/** Remove one session's presence (leave/refresh/untrack). */
export function removePresence(state: PresenceState, sessionKey: string): PresenceState {
  if (!sessionKey) return state
  return { peers: dedupeByUser(state.peers.filter(p => p.sessionKey !== sessionKey)) }
}

/**
 * One user, one avatar: a user with two live sessions (two tabs) appears once,
 * keeping their OLDEST session's join position so the row stays stable when a
 * second tab opens.
 */
function dedupeByUser(peers: PresencePeer[]): PresencePeer[] {
  const byUser = new Map<string, PresencePeer>()
  for (const p of peers) {
    const held = byUser.get(p.userId)
    if (!held || p.joinedAt < held.joinedAt) byUser.set(p.userId, p)
  }
  return [...byUser.values()].sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId))
}

/**
 * Build the presence state from a full sync snapshot (the authoritative shape
 * on every 'sync' event — replaces local state wholesale).
 *
 * supabase-js declares the snapshot as a map of session key to a LIST of
 * records (`RealtimePresenceState<T>` = `{ [key]: Presence<T>[] }`), so one
 * key can carry several records; the parser reads every record under every
 * key, keeping the map key as the session identity (the key the caller mints
 * and filters itself out by).
 *
 * The snapshot comes off the wire, so it is not ours to trust: a value that
 * is not a list, an empty key, and a record without a usable userId are all
 * skipped instead of crashing (same rule as the store's postgres_changes
 * dispatch).
 */
export function presenceFromSync(snap: unknown): PresenceState {
  if (!isRecord(snap)) return EMPTY_PRESENCE
  const peers: PresencePeer[] = []
  for (const [sessionKey, records] of Object.entries(snap)) {
    if (!sessionKey || !Array.isArray(records)) continue
    for (const record of records) {
      const peer = peerFromRecord(sessionKey, record)
      if (peer) peers.push(peer)
    }
  }
  return { peers: dedupeByUser(peers) }
}

/** A non-null, non-array object — the only shape a presence record may have. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One wire record as a peer, or null when it carries no usable userId. */
function peerFromRecord(sessionKey: string, record: unknown): PresencePeer | null {
  if (!isRecord(record)) return null
  const userId = typeof record.userId === 'string' ? record.userId : ''
  if (!userId) return null
  const name = typeof record.name === 'string' && record.name ? record.name : userId
  const raw = record.joinedAt
  // A number or a numeric string only: coercing a hostile JSON object can throw.
  const joined = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return { sessionKey, userId, name, joinedAt: Number.isFinite(joined) ? joined : 0 }
}

/** The peers the UI shows: everyone except the caller's own session. */
export function visiblePeers(state: PresenceState, selfSessionKey: string): PresencePeer[] {
  return state.peers.filter(p => p.sessionKey !== selfSessionKey)
}

/**
 * What the trip header's presence row renders. Three states, and the third is
 * the point: a room with nobody else in it is an ANSWER ("just you"), not the
 * same thing as presence being off. The old render gate
 * (`peers.length > 0`) collapsed both into "render nothing", so a solo viewer
 * could not tell an empty room from a broken feature — the first thing the
 * owner asked on the two-browser pass (see docs/PLAN-TOGETHER-M6.md).
 *   hidden — presence is not running (anon/public view, no trip, no backend)
 *   solo   — connected, and nobody else is in the room
 *   peers  — connected, with one entry per other viewer
 */
export type PresenceView =
  | { kind: 'hidden' }
  | { kind: 'solo' }
  | { kind: 'peers'; peers: PresencePeer[] }

export function presenceView(peers: PresencePeer[], connected: boolean): PresenceView {
  if (!connected) return { kind: 'hidden' }
  return peers.length > 0 ? { kind: 'peers', peers } : { kind: 'solo' }
}

// ---------------- channel wrapper ----------------

/** The channel name for one trip's presence room. */
export function presenceChannelName(tripId: string): string {
  return `presence:${tripId}`
}

/** Opaque per-session identity that survives across join/leave/untrack.
 *
 *  The token comes from the platform CSPRNG rather than `Math.random()`. The
 *  key is broadcast into the room, so it is not a secret — but it IS the
 *  identity every peer keys this tab by, and a weak source collides two tabs
 *  into one avatar. `getRandomValues` (unlike `randomUUID`) also resolves in an
 *  insecure context, so a plain-http LAN session keeps its own identity. */
export function presenceKey(userId: string): string {
  return `${userId}:${randomToken()}`
}

const TOKEN_BYTES = 8
let lastResortSeq = 0

/** 16 hex characters from the platform CSPRNG, with a no-crypto last resort. */
function randomToken(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(TOKEN_BYTES)
    c.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Unreachable on every platform this app ships on: a per-document counter
  // plus a high-resolution clock, which only has to differ between tabs.
  lastResortSeq += 1
  const clock = typeof performance === 'undefined' ? Date.now() : performance.now()
  return `${Date.now().toString(36)}${Math.trunc(clock * 1000).toString(36)}${lastResortSeq.toString(36)}`
}

/** The fields this client broadcasts about itself on join. */
export interface PresencePayload {
  userId: string
  name: string
  joinedAt: number
}

/** What this client broadcasts about itself on join. */
export function presencePayload(userId: string, name: string): PresencePayload {
  return { userId, name, joinedAt: Date.now() }
}

export interface PresenceSession {
  /** Live channel, null when presence is not running (anon view, no trip). */
  channel: RealtimeChannel | null
  /** This session's own presence key (to filter self out of the UI). */
  selfKey: string
  /** Latest peer state, replaced on every remote sync event. */
  get: () => PresenceState
  /** Graceful leave: untrack + remove channel. Safe to call twice. */
  stop: () => void
}

/**
 * Join one trip's presence room. Callbacks receive the full peer state on
 * every sync/join/leave — the caller renders it, this module owns nothing
 * but the channel. Config is read at call time so tests and callers without
 * a backend get a no-op session (channel null) instead of a throw.
 */
export function joinTripPresence(
  client: SupabaseClient | null,
  tripId: string,
  identity: { userId: string; name: string },
  onState: (state: PresenceState) => void,
): PresenceSession {
  const selfKey = presenceKey(identity.userId)
  let state: PresenceState = EMPTY_PRESENCE
  const emit = () => onState(state)

  if (!client || !tripId || !identity.userId) {
    return { channel: null, selfKey, get: () => state, stop: () => {} }
  }

  const channel = client.channel(presenceChannelName(tripId), { config: { presence: { key: selfKey } } })
  channel
    .on('presence', { event: 'sync' }, () => {
      // presenceState() is a session-keyed map of record lists. Hand it to
      // the parser as the untrusted wire shape it reads.
      state = presenceFromSync(channel.presenceState())
      emit()
    })
    .subscribe(status => {
      // Join-track only once the channel is actually live — tracking on
      // SUBSCRIBING races the join and the server drops it silently.
      if (status !== 'SUBSCRIBED') return
      void channel.track(presencePayload(identity.userId, identity.name))
    })

  return {
    channel,
    selfKey,
    get: () => state,
    stop: () => {
      try {
        void channel.untrack()
      } catch { /* already gone */ }
      void client.removeChannel(channel)
    },
  }
}
