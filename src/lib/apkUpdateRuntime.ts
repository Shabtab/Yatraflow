// ============ APK update runtime (native Android only) ============
// This file joins the reviewed decision core to the app. The core decides
// whether a newer build exists. This file supplies the four boundaries it
// needs, and nothing else: the clock, the Later store, the transport, and the
// installed identity read from the native plugin.
//
// The web stays inert. `bootApkUpdates` refuses to run there, and the notice
// component renders nothing. The feed URL and the approved hosts are build
// variables; while they are unset the whole feature is inert, which is the
// state this packet ships. See docs/APK-UPDATE-FEED.md.

import { App as CapApp } from '@capacitor/app'
import { isNative } from './native'
import {
  createUpdateChecker,
  installedFromAppInfo,
  localStorageStore,
  UPDATE_DAY_MS,
  type FetchOutcome,
  type InstalledApp,
  type UpdateChecker,
  type UpdateState,
} from './apkUpdates'
import { apkUpdateFeedUrl, apkUpdateHosts, channelForAppId } from './apkUpdateConfig'

/** Where the Later record lives. One key, so one version is held back at a time. */
export const APK_UPDATE_LATER_KEY = 'yatraflow_apk_update_later'

/**
 * The feed read deadline. A stalled socket must not hold the core's `inFlight`
 * promise, or the Profile button, for the life of the session.
 */
export const APK_UPDATE_FETCH_TIMEOUT_MS = 10_000

/** Why the runtime cannot check, or null when it can. */
export type UpdateUnavailable = 'web' | 'unsupported-app' | 'unconfigured'

export interface UpdateRuntimeStatus {
  /**
   * True until boot has read the platform and published its own answer. While
   * it is true the runtime does not yet know whether a check can run, so a
   * caller must show loading — never "not configured".
   */
  booting: boolean
  /** Non-null when no check can run, with the reason. */
  unavailable: UpdateUnavailable | null
  /** The installed app as the native boundary reported it. */
  installed: InstalledApp | null
  /** The core's last decision. */
  state: UpdateState
}

interface Runtime {
  checker: UpdateChecker
  installed: InstalledApp
}

let runtime: Runtime | null = null
let boot: Promise<void> | null = null
// Boot starts unknowing, not unconfigured. The old `unconfigured` start made
// Profile claim a configuration fault during the getInfo() await, and disabled
// a control that could still work.
let status: UpdateRuntimeStatus = { booting: true, unavailable: null, installed: null, state: { phase: 'idle' } }
const listeners = new Set<() => void>()

/**
 * Publishes a boot result. Every publish in this file is a boot answer, so the
 * flag clears here rather than at each call site — one place to get it right.
 */
function publish(next: Omit<UpdateRuntimeStatus, 'booting'>): UpdateRuntimeStatus {
  status = { ...next, booting: false }
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* one consumer's bug must not stop the others */
    }
  }
  return status
}

/** The runtime's status. Safe to read at any time; never triggers work. */
export function apkUpdateStatus(): UpdateRuntimeStatus {
  return status
}

/** Observe status changes. */
export function subscribeApkUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** True when a check can actually run in this build and on this device. */
export function apkUpdateEnabled(): boolean {
  return runtime !== null
}

/**
 * Rejects when the signal aborts. The race in `fetchManifest` also covers a
 * body read that ignores the signal, so the deadline holds either way.
 */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new Error('aborted'))
    if (signal.aborted) fail()
    else signal.addEventListener('abort', fail, { once: true })
  })
}

/**
 * Reads the untrusted manifest. Offline is reported separately from a failed
 * transfer. A body that is not JSON is passed through as text, so the core
 * classifies it as malformed rather than blaming the network.
 *
 * The read is bounded: one controller and one timer cover the request and the
 * body. A timeout settles as a network failure while the device still reports
 * online, so a stalled feed stays distinguishable from being offline. The timer
 * is cleared on every path.
 */
async function fetchManifest(url: string): Promise<FetchOutcome> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, reason: 'offline' }
  }
  const controller = new AbortController()
  const deadline = aborted(controller.signal)
  // The race can lose; consume that rejection so it is never unhandled.
  void deadline.catch(() => {})
  const timer = setTimeout(() => controller.abort(), APK_UPDATE_FETCH_TIMEOUT_MS)
  try {
    const request = fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    // Either side of a race can lose. Consume the loser so a rejection is
    // never unhandled, then race again for the body.
    void request.catch(() => {})
    const res = await Promise.race([request, deadline])
    if (!res.ok) return { ok: false, reason: 'network' }
    const body = res.text()
    void body.catch(() => {})
    const text = await Promise.race([body, deadline])
    try {
      return { ok: true, body: JSON.parse(text) }
    } catch {
      return { ok: true, body: text }
    }
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    return { ok: false, reason: offline ? 'offline' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reads the installed identity once and builds the checker. Idempotent: every
 * later call returns the same promise, so a StrictMode double mount cannot
 * build two runtimes or start two requests.
 */
export function bootApkUpdates(): Promise<void> {
  if (boot) return boot

  boot = (async () => {
    if (!isNative) {
      publish({ unavailable: 'web', installed: null, state: { phase: 'idle' } })
      return
    }

    let info: { id: string; build: string; version: string }
    try {
      info = await CapApp.getInfo()
    } catch {
      publish({ unavailable: 'unsupported-app', installed: null, state: { phase: 'idle' } })
      return
    }

    // The channel comes from the app id the device reports, never from a guess.
    // An app id this build does not recognise gets no check at all.
    const channel = channelForAppId(info.id)
    if (!channel) {
      publish({ unavailable: 'unsupported-app', installed: null, state: { phase: 'idle' } })
      return
    }

    let installed: InstalledApp
    try {
      installed = installedFromAppInfo(info, channel)
    } catch {
      // A build that is not an integer version code cannot be compared safely.
      publish({ unavailable: 'unsupported-app', installed: null, state: { phase: 'idle' } })
      return
    }

    const manifestUrl = apkUpdateFeedUrl()
    const approvedHosts = apkUpdateHosts()
    if (!manifestUrl || approvedHosts.length === 0) {
      publish({ unavailable: 'unconfigured', installed, state: { phase: 'idle' } })
      return
    }

    let checker: UpdateChecker
    try {
      checker = createUpdateChecker({
        installed,
        manifestUrl,
        approvedHosts,
        now: () => Date.now(),
        fetchManifest,
        store: localStorageStore(APK_UPDATE_LATER_KEY),
        intervalMs: UPDATE_DAY_MS,
        suppressionMs: UPDATE_DAY_MS,
      })
    } catch {
      // Bad configuration (an unapproved URL, a wildcard host) is a build
      // mistake, not a runtime one. Stay inert and let Profile say so.
      publish({ unavailable: 'unconfigured', installed, state: { phase: 'idle' } })
      return
    }

    runtime = { checker, installed }
    checker.subscribe(() => {
      publish({ unavailable: null, installed, state: checker.state() })
    })
    publish({ unavailable: null, installed, state: checker.state() })
  })()

  return boot
}

/**
 * Runs a check. Automatic checks respect the one-day interval. A manual check
 * is the user's own request, so it bypasses the interval and the Later record.
 * Resolves to the current state, and never rejects.
 */
export async function apkUpdateCheck(options: { manual?: boolean } = {}): Promise<UpdateState> {
  if (!runtime) return status.state
  try {
    return await runtime.checker.check(options)
  } catch {
    return status.state
  }
}

/** Records Later for the release on offer. Returns false when none is. */
export function apkUpdateLater(): boolean {
  if (!runtime) return false
  return runtime.checker.later()
}
