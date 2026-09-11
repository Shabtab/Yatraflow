/** Feedback mailto: pre-fills the app version + current route so a report is
 *  reproducible without the reporter doing any work. Reuses the same support
 *  address the password-reset flow already uses. */
export function feedbackHref(): string {
  const route = location.hash.replace(/^#/, '') || '/'
  const subject = encodeURIComponent(`YatraFlow feedback (v${__APP_VERSION__})`)
  const body = encodeURIComponent(
    `Page: ${route}\nApp version: ${__APP_VERSION__}\n\nWhat worked, what broke, what you wish existed:\n\n`,
  )
  return `mailto:support@yatraflow.app?subject=${subject}&body=${body}`
}