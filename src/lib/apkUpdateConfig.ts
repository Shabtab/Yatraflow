// ============ APK update feed configuration ============
// Both values are build variables, in the same shape as lib/featureFlags. An
// unset value means "no feed", so the feature stays inert. No live host is
// named in this file.
//
// PROPOSED permanent endpoint, not configured and not live: the project already
// serves the app from its canonical origin, so the manifest belongs at
// `https://www.yatraflow.in/android/manifest.json`, with the APK behind a
// stable path on that same host. Neither variable gets a value until a real
// feed exists and the coordinator approves it. See docs/APK-UPDATE-FEED.md for
// the contract and the activation steps.

import type { UpdateChannel } from './apkUpdates'

/** The production Android application id, matching capacitor.config.ts. */
export const PRODUCTION_APP_ID = 'app.yatraflow.mobile'

/**
 * The audit application id. The audit build applies an external, debug-only
 * Gradle override that appends `.t3audit`; the id never appears in the app
 * source otherwise, which is why it is spelled out here as a known value.
 */
export const AUDIT_APP_ID = 'app.yatraflow.mobile.t3audit'

/**
 * The channel an installed app id belongs to, or null when it is not ours.
 * Only these two exact ids are recognised. An unknown id gets no check, so a
 * wrong channel can never be guessed.
 */
export function channelForAppId(appId: string): UpdateChannel | null {
  if (appId === PRODUCTION_APP_ID) return 'production'
  if (appId === AUDIT_APP_ID) return 'audit'
  return null
}

/** The manifest URL, or '' when unconfigured. */
export function apkUpdateFeedUrl(raw?: string): string {
  const value = raw ?? (import.meta.env.VITE_APK_UPDATE_FEED_URL as string | undefined)
  return (value ?? '').trim()
}

/**
 * The exact approved hosts for the manifest and the download, lower-cased.
 * Empty when unconfigured, and an empty list approves nothing.
 */
export function apkUpdateHosts(raw?: string): string[] {
  const value = raw ?? (import.meta.env.VITE_APK_UPDATE_HOSTS as string | undefined)
  return (value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}
