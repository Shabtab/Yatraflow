// ============ My trips — greeting header ============
// A date label, "Good morning, <first name>", an honest counts line, and the
// page actions. It replaces the shared hero on My trips only. The page passes
// the buttons in, so each button keeps its handler there. The h1 is the page
// title.
import type { ReactNode } from 'react'

export function MyTripsGreeting({ dateLabel, title, counts, primary, secondary }: {
  dateLabel: string
  title: string
  /** The counts line. Empty or null hides it, so a loading read never shows a row of zeros. */
  counts: string | null
  /** The one main button. */
  primary: ReactNode
  /** Quiet buttons that sit beside it. */
  secondary: ReactNode
}) {
  return (
    <header className="mt-greet">
      <div className="mt-greet-copy">
        <span className="mt-greet-date">{dateLabel}</span>
        <h1 className="mt-greet-title">{title}</h1>
        {counts && <p className="mt-greet-counts">{counts}</p>}
      </div>
      <div className="mt-greet-actions">
        {secondary}
        {primary}
      </div>
    </header>
  )
}
