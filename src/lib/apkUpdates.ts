// ============ APK update decision core (no UI, no network) ============
// The Android app ships as a sideloaded APK, so there is no store to tell the
// user a newer build exists. This module answers one question — "is a newer
// build that I am allowed to offer available?" — and nothing else. It does not
// navigate, download, install, or render. A notice UI and a release feed are
// later work (issue #809).
//
// Every external boundary is injected, so the decisions are testable in the
// node environment with no DOM and no network:
//
//   clock     — `now()` in epoch ms (tests step it; nothing here reads Date.now)
//   storage   — `UpdateStore` for the Later record (localStorageStore, or a fake)
//   transport — `fetchManifest(url)` distinguishes "offline" from "failed"
//   identity  — the installed app's package id, channel and integer code
//
// The adapter that later wires this into the app supplies all four:
//
//   const info = await App.getInfo()            // @capacitor/app
//   const installed = installedFromAppInfo(info, 'production')
//
// On Android, `App.getInfo()` maps to the native build as:
//   info.id      -> applicationId      ("app.yatraflow.mobile")
//   info.build   -> versionCode        BUT AS A STRING ("14"), never a number
//   info.version -> versionName        ("0.14-native", not semver)
// `installedFromAppInfo` parses that string and refuses anything that is not an
// integer, so a non-numeric build fails loudly at the boundary instead of
// silently comparing garbage.
//
// Version comparison here is ALWAYS the integer version code. The display
// version is not comparable ("0.14-native" vs "0.9-native") and is carried only
// for display.
//
// Unsettled inputs (deliberately not decided here): the manifest URL, the
// approved download hosts, which channel the app is on, and where the published
// manifest lives. The core invents no host and accepts no wildcard — the caller
// passes an explicit allowlist, and an empty allowlist approves nothing.

/** The two release channels. An audit build is never upgraded by the production feed. */
export type UpdateChannel = 'production' | 'audit'

/** The installed app, as read once at the native boundary. */
export interface InstalledApp {
  /** The Android application id, e.g. the audit build's own id. */
  packageId: string
  channel: UpdateChannel
  /** The integer version code the installed APK carries. */
  versionCode: number
  /** The display version, for showing the user what they run. Never compared. */
  versionName: string
}

/** A published release, after validation. Untrusted until proven otherwise. */
export interface UpdateManifest {
  packageId: string
  channel: UpdateChannel
  versionCode: number
  versionName: string
  notes: string
  /** The permanent download page. Only ever present once approved. */
  downloadUrl: string
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'newer'
  /** A newer release exists, but Later silences automatic reminders for it. */
  | 'suppressed'
  | 'offline'
  | 'failed'

export type UpdateFailure =
  | 'malformed'
  | 'unsafe-destination'
  | 'wrong-package'
  | 'wrong-channel'
  | 'network'

/** What the caller should show, and what a notice may offer. */
export interface UpdateState {
  phase: UpdatePhase
  /** The eligible release, present for 'newer' and 'suppressed'. */
  manifest?: UpdateManifest
  /** Why the check failed, present for 'failed'. */
  failure?: UpdateFailure
  /** When the last check finished, in epoch ms. */
  checkedAt?: number
  /** True when the last check was the user's explicit request. */
  manual?: boolean
}

/** What the transport boundary reports back. */
export type FetchOutcome =
  | { ok: true; body: unknown }
  | { ok: false; reason: 'offline' | 'network' }

/** Failure-tolerant persistence for the Later record. */
export interface UpdateStore {
  read(): string | null
  write(value: string): void
}

export interface UpdateCheckerOptions {
  /** The installed app, read from the native boundary. */
  installed: InstalledApp
  /** Where the manifest lives. Must be an approved HTTPS URL, or construction throws. */
  manifestUrl: string
  /** Exact hostnames allowed for the manifest and the download. No wildcards. */
  approvedHosts: readonly string[]
  /** The current instant in epoch ms. */
  now: () => number
  /** Reads and parses the manifest. Reports offline separately from failed. */
  fetchManifest: (url: string) => Promise<FetchOutcome>
  /** Persistence for the Later record. Omit to keep it for this session only. */
  store?: UpdateStore
  /** How often an automatic check may run. Defaults to one day. */
  intervalMs?: number
  /** How long Later silences one version. Defaults to one day. */
  suppressionMs?: number
}

export interface UpdateChecker {
  /** The current state. Safe to read at any time; never triggers work. */
  state(): UpdateState
  /** Observe each change. Emits on real change only, so notices cannot duplicate. */
  subscribe(listener: (state: UpdateState) => void): () => void
  /**
   * Runs a check. `{ manual: true }` is the user's explicit request: it ignores
   * the automatic interval and the Later record. Automatic checks join an
   * in-flight check instead of starting a second request.
   */
  check(options?: { manual?: boolean }): Promise<UpdateState>
  /**
   * Records Later for the release currently on offer. Returns false when
   * nothing is on offer.
   */
  later(): boolean
}

/** One day in ms. The spec's "one-day" default for both the interval and Later. */
export const UPDATE_DAY_MS = 24 * 60 * 60 * 1000

function isChannel(value: unknown): value is UpdateChannel {
  return value === 'production' || value === 'audit'
}

/**
 * True when `url` is an HTTPS destination on exactly one of `approvedHosts`.
 *
 * Deliberately strict: no wildcards, no suffix matching (so
 * `dl.example.com.evil.test` cannot pass as `dl.example.com`), no embedded
 * credentials, and no port other than the default. An empty allowlist approves
 * nothing.
 */
export function isApprovedHttpsUrl(url: string, approvedHosts: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.username !== '' || parsed.password !== '') return false
  if (parsed.port !== '') return false
  const host = parsed.hostname.toLowerCase()
  return approvedHosts.some((approved) => approved.trim().toLowerCase() === host)
}

/**
 * Maps `App.getInfo()` to the installed identity. Android reports the version
 * code as a string, so it is parsed here and rejected when it is not an integer
 * — a wrong code would make every later comparison meaningless.
 */
export function installedFromAppInfo(
  info: { id: string; build: string; version: string },
  channel: UpdateChannel,
): InstalledApp {
  const packageId = typeof info.id === 'string' ? info.id.trim() : ''
  if (!packageId) throw new Error('apkUpdates: the native app id is empty, so no release can be matched')
  const raw = typeof info.build === 'string' ? info.build.trim() : ''
  if (!/^\d+$/.test(raw)) {
    throw new Error(`apkUpdates: the native build "${String(info.build)}" is not an integer version code`)
  }
  return {
    packageId,
    channel,
    versionCode: Number(raw),
    versionName: typeof info.version === 'string' ? info.version : '',
  }
}

/**
 * The Later record, kept in localStorage. Reads degrade to "nothing recorded"
 * and writes are best-effort, the same contract as the other UI-pref helpers —
 * private mode and quota must never break an update check.
 */
export function localStorageStore(key: string): UpdateStore {
  return {
    read: () => {
      if (typeof localStorage === 'undefined') return null
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    write: (value) => {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.setItem(key, value)
      } catch {
        /* private mode or quota — persistence is best-effort by design */
      }
    },
  }
}

interface Suppression {
  versionCode: number
  until: number
}

function parseSuppression(raw: string | null): Suppression | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const code = (parsed as Record<string, unknown>).versionCode
    const until = (parsed as Record<string, unknown>).until
    if (typeof code !== 'number' || !Number.isInteger(code)) return null
    if (typeof until !== 'number' || !Number.isFinite(until)) return null
    return { versionCode: code, until }
  } catch {
    return null
  }
}

/** Validates an untrusted manifest against the installed app and the allowlist. */
function parseManifest(
  body: unknown,
  installed: InstalledApp,
  approvedHosts: readonly string[],
): { ok: true; manifest: UpdateManifest } | { ok: false; failure: UpdateFailure } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, failure: 'malformed' }
  }
  const raw = body as Record<string, unknown>
  const versionCode = raw.versionCode
  const versionName = raw.versionName
  const notes = raw.notes
  const packageId = raw.packageId
  const channel = raw.channel
  const downloadUrl = raw.downloadUrl

  if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode < 0) {
    return { ok: false, failure: 'malformed' }
  }
  if (typeof versionName !== 'string' || versionName.trim() === '') return { ok: false, failure: 'malformed' }
  if (typeof notes !== 'string') return { ok: false, failure: 'malformed' }
  if (typeof packageId !== 'string' || packageId.trim() === '') return { ok: false, failure: 'malformed' }
  if (!isChannel(channel)) return { ok: false, failure: 'malformed' }
  if (typeof downloadUrl !== 'string' || downloadUrl.trim() === '') return { ok: false, failure: 'malformed' }

  // Channel isolation before the destination: a feed for another app or another
  // channel is not this app's feed, whatever it points at.
  if (packageId !== installed.packageId) return { ok: false, failure: 'wrong-package' }
  if (channel !== installed.channel) return { ok: false, failure: 'wrong-channel' }
  if (!isApprovedHttpsUrl(downloadUrl, approvedHosts)) return { ok: false, failure: 'unsafe-destination' }

  return { ok: true, manifest: { packageId, channel, versionCode, versionName, notes, downloadUrl } }
}

function sameRelease(a: UpdateManifest | undefined, b: UpdateManifest | undefined): boolean {
  if (!a || !b) return a === undefined && b === undefined
  return (
    a.packageId === b.packageId
    && a.channel === b.channel
    && a.versionCode === b.versionCode
    && a.versionName === b.versionName
    && a.notes === b.notes
    && a.downloadUrl === b.downloadUrl
  )
}

/**
 * Builds the checker. Configuration errors throw here, at construction, rather
 * than turning every later check into a confusing failure.
 */
export function createUpdateChecker(options: UpdateCheckerOptions): UpdateChecker {
  const {
    installed,
    manifestUrl,
    approvedHosts,
    now,
    fetchManifest,
    store,
    intervalMs = UPDATE_DAY_MS,
    suppressionMs = UPDATE_DAY_MS,
  } = options

  if (!Number.isInteger(installed.versionCode) || installed.versionCode < 0) {
    throw new Error('apkUpdates: the installed version code must be a non-negative integer')
  }
  if (!isChannel(installed.channel)) {
    throw new Error(`apkUpdates: "${String(installed.channel)}" is not a known update channel`)
  }
  if (approvedHosts.some((host) => host.includes('*'))) {
    throw new Error('apkUpdates: the approved host list must not contain a wildcard')
  }
  if (!isApprovedHttpsUrl(manifestUrl, approvedHosts)) {
    throw new Error('apkUpdates: the manifest URL must be an approved HTTPS destination')
  }

  let state: UpdateState = { phase: 'idle' }
  let inFlight: Promise<UpdateState> | null = null
  let seq = 0
  /** This session's Later record, which outranks whatever the store still holds. */
  let held: Suppression | null = null
  const listeners = new Set<(next: UpdateState) => void>()

  function readHeld(): Suppression | null {
    return held ?? parseSuppression(store?.read() ?? null)
  }

  /**
   * Notifies only on a real change, so a repeated check cannot raise a second
   * notice for the same release. `checkedAt` and `manual` are excluded on
   * purpose: they describe when and why, not what is on offer.
   */
  function emit(next: UpdateState): UpdateState {
    const previous = state
    state = next
    const changed =
      previous.phase !== next.phase
      || previous.failure !== next.failure
      || !sameRelease(previous.manifest, next.manifest)
    if (changed) {
      for (const listener of listeners) listener(next)
    }
    return next
  }

  function resolve(outcome: FetchOutcome, manual: boolean): UpdateState {
    const checkedAt = now()
    if (!outcome.ok) {
      return outcome.reason === 'offline'
        ? { phase: 'offline', checkedAt, manual }
        : { phase: 'failed', failure: 'network', checkedAt, manual }
    }

    const parsed = parseManifest(outcome.body, installed, approvedHosts)
    if (!parsed.ok) return { phase: 'failed', failure: parsed.failure, checkedAt, manual }

    const release = parsed.manifest
    if (release.versionCode <= installed.versionCode) return { phase: 'current', checkedAt, manual }

    // Re-read the record at commit time: a Later tap that landed while this
    // request was in flight must still win over the result it raced.
    const record = manual ? null : readHeld()
    const suppressed =
      record !== null && record.versionCode === release.versionCode && checkedAt < record.until

    return suppressed
      ? { phase: 'suppressed', manifest: release, checkedAt, manual }
      : { phase: 'newer', manifest: release, checkedAt, manual }
  }

  async function run(seqAtStart: number, manual: boolean): Promise<UpdateState> {
    // Keep any release already on offer while the re-check runs, so the notice
    // the user is looking at does not flicker away.
    emit({ ...state, phase: 'checking', manual })

    let next: UpdateState
    try {
      next = resolve(await fetchManifest(manifestUrl), manual)
    } catch {
      next = { phase: 'failed', failure: 'network', checkedAt: now(), manual }
    }

    // A newer check started while this one was in flight. Its answer is the
    // current one; this one is stale news and must not overwrite it.
    if (seqAtStart !== seq) return state
    return emit(next)
  }

  function check(options: { manual?: boolean } = {}): Promise<UpdateState> {
    const manual = options.manual === true

    if (!manual) {
      // One request at a time: a repeat joins the answer already on its way.
      if (inFlight) return inFlight
      // Bounded frequency: the automatic path waits out the interval.
      if (state.checkedAt !== undefined && now() - state.checkedAt < intervalMs) {
        return Promise.resolve(state)
      }
    }

    const seqAtStart = ++seq
    const promise = run(seqAtStart, manual)
    inFlight = promise
    void promise.then(() => {
      if (inFlight === promise) inFlight = null
    })
    return promise
  }

  function later(): boolean {
    const release = state.manifest
    if (!release) return false
    held = { versionCode: release.versionCode, until: now() + suppressionMs }
    store?.write(JSON.stringify(held))
    emit({ ...state, phase: 'suppressed' })
    return true
  }

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    check,
    later,
  }
}
