import { currentRoute } from './router'
import { redactSnapshotUrl } from './snapshot'

/** Feedback mailto: pre-fills the app version + current route so a report is
 *  reproducible without the reporter doing any work. Reuses the same support
 *  address the password-reset flow already uses.
 *
 *  A snapshot route resolves to a bearer payload, and this draft leaves the
 *  device. The token is stripped and the route label kept, because a reporter
 *  who is looking at a snapshot needs the route far more than the trip
 *  (#805). */
export function feedbackHref(): string {
  const route = redactSnapshotUrl(currentRoute())
  const subject = encodeURIComponent(`YatraFlow feedback (v${__APP_VERSION__})`)
  const body = encodeURIComponent(
    `Page: ${route}\nApp version: ${__APP_VERSION__}\n\nWhat worked, what broke, what you wish existed:\n\n`,
  )
  return `mailto:support@yatraflow.app?subject=${subject}&body=${body}`
}