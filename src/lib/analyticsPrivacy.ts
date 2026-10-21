import type { BeforeSendEvent } from '@vercel/analytics/react'
import { redactSnapshotUrl } from './snapshot'

/** A snapshot payload is the whole trip, so no analytics data point may carry
 *  it (#805). A browser keeps the fragment out of a request, but the collector
 *  reads the page's own URL inside the page and could read the token there, so
 *  strip it here instead of assuming the network did. The page view stays; only
 *  the trip goes. */
export function analyticsBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  return { ...event, url: redactSnapshotUrl(event.url) }
}
