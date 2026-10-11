// ============ My trips — status tag ============
// A dot plus a word. Each status has its own dot shape, so colour never carries
// the status alone: Upcoming is a filled circle, Live a pulsing filled circle on
// a saffron pill, Past a filled square and Draft a hollow ring. The label is
// always in the DOM. On the phone list row the dot is the only visible part, so
// the label is visually hidden and read by screen readers. The dot uses one dark
// ink on the white pill in both themes (see styles.css, .mt-tag).
import type { TripStatus } from '../../lib/tripsPage'

const STATUS_LABEL: Record<TripStatus, string> = {
  live: 'Live',
  upcoming: 'Upcoming',
  past: 'Past',
  draft: 'Draft',
}

export function StatusTag({ status }: { status: TripStatus }) {
  return (
    <span className={`mt-tag mt-tag--${status}`}>
      <span className="mt-tag-dot" aria-hidden="true" />
      <span className="mt-tag-label">{STATUS_LABEL[status]}</span>
    </span>
  )
}
