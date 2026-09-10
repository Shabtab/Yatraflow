// ============ Browser push notifications (local, no service worker) ============
// In-app notifications (the bell in App.tsx) already exist via pushNotification()
// in the store. This module adds the *browser* layer on top: when enabled, a new
// in-app notification for the session user ALSO surfaces as an OS-level
// Notification — so a collaborator's change pings you even when the tab is in
// the background.
//
// Deliberately no service worker / push subscription here (that needs server
// keys + a push endpoint — M6/M7 territory). This is the local Notification
// API only: free, offline-safe, and enough for the "did something happen while
// I looked away" case.
//
// Three guards keep it quiet-by-default:
//  1. Permission must be explicitly granted (opt-in toggle, see shouldPrompt()).
//  2. Dedupe: one browser ping per notification id (shouldNotify()).
//  3. Read-flag + focus: rows already marked read, and notifications that arrive
//     while the tab is focused, stay in-app only.

/** localStorage key for the opt-in flag (\"1\"/\"0\", same convention as uiPrefs flags). */
export const BROWSER_NOTIF_FLAG = 'yatraflow_browser_notif'

/** Storage abstraction so node tests can pass a fake. Defaults to localStorage. */
export interface NotifStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): NotifStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/** True when the user opted in to browser notifications. */
export function browserNotifEnabled(storage: NotifStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(BROWSER_NOTIF_FLAG) === '1'
  } catch {
    return false
  }
}

/** Persist the opt-in flag. Silent no-op when storage is unavailable. */
export function setBrowserNotifEnabled(value: boolean, storage: NotifStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(BROWSER_NOTIF_FLAG, value ? '1' : '0')
  } catch {
    // Private mode / quota — best-effort by design.
  }
}

/** Whether the Notification API exists in this environment. */
export function browserNotifSupported(): boolean {
  return typeof Notification !== 'undefined'
}

/** Current permission state, or 'unsupported' when the API is missing. */
export function browserNotifPermission(): NotificationPermission | 'unsupported' {
  if (!browserNotifSupported()) return 'unsupported'
  return Notification.permission
}

/**
 * Whether to offer the opt-in prompt: supported browser, permission not yet
 * decided, and the user hasn't already opted in/out (no stored flag).
 */
export function shouldPromptBrowserNotif(storage: NotifStorage | null = defaultStorage()): boolean {
  if (!browserNotifSupported()) return false
  if (Notification.permission !== 'default') return false
  try {
    return storage?.getItem(BROWSER_NOTIF_FLAG) === null
  } catch {
    return false
  }
}

/**
 * Request OS-level permission. Resolves to the resulting permission string.
 * Must be called from a user gesture (button click) — browsers ignore or block
 * permission prompts fired on page load.
 */
export async function requestBrowserNotifPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!browserNotifSupported()) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export interface BrowserNotifCandidate {
  id: string
  userId: string
  text: string
  read: boolean
}

/**
 * Dedupe + routing decision for one notification row. Returns true when a
 * browser ping should fire:
 *  - the row belongs to the session user,
 *  - it is still unread (a row already marked read was handled — in-app is enough),
 *  - we haven't pinged this id before (seenIds guard),
 *  - and the tab is NOT focused (a focused tab already shows the bell badge;
 *    pinging too would double-announce every collaborator keystroke).
 *
 * On true, the caller MUST recordSeenNotifId() after firing (kept separate so
 * tests can assert the decision without mutating state).
 */
export function shouldBrowserNotify(
  n: BrowserNotifCandidate,
  sessionUserId: string | null,
  seenIds: ReadonlySet<string>,
  documentVisible: boolean,
): boolean {
  if (!sessionUserId) return false
  if (n.userId !== sessionUserId) return false
  if (n.read) return false
  if (seenIds.has(n.id)) return false
  if (documentVisible) return false
  return true
}

/** Fire one OS-level notification. No-op when permission isn't granted. */
export function fireBrowserNotification(title: string, body: string): void {
  if (!browserNotifSupported()) return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, tag: 'yatraflow-notif' })
  } catch {
    // Blocked by the browser / OS — in-app bell still carries the message.
  }
}
