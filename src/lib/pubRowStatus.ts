// ============ A publication row's one status (MR11) ============
// The owner dashboard draws one row per publication. Each row states
// its status and offers its own action, and both come from HERE, so
// a row cannot label itself "Live" and simultaneously offer to
// publish it again.
//
// The rules were inline in `HubOverview` before this module existed.
// They are the same rules, moved so a test can read them without a
// DOM — the test suite runs in node env.
import type { PublishedItinerary, Trip } from '../data/types'

/** `live` — on Explore now. `behind` — the page is live, but the
 *  itinerary changed after the page was built, so it describes an
 *  older plan. `unpublished` — withdrawn from Explore, and kept in
 *  this list on purpose: its funnel and its sales history still
 *  belong to its owner. */
export type PubRowStatusKey = 'live' | 'behind' | 'unpublished'

export interface PubRowStatus {
  key: PubRowStatusKey
  /** The chip's label. Every row states its status, live included. */
  label: string
  tone: 'ok' | 'saffron' | 'info'
  /** The row's own action, derived from the same key as the label. */
  action: 'edit' | 'update-page' | 'publish-again'
  actionLabel: string
}

/** The publication's status, and the action that follows from it.
 *
 *  Precedence is load-bearing. A withdrawn page is `unpublished`
 *  whatever the itinerary did afterwards: a page that is down cannot
 *  be behind, and offering "Update page" for it would point at a
 *  page nobody can read. */
export function pubRowStatus(
  pub: Pick<PublishedItinerary, 'unpublishedAt' | 'refreshedAt' | 'publishedAt'>,
  trip: Pick<Trip, 'updatedAt'> | undefined,
): PubRowStatus {
  if (pub.unpublishedAt) {
    return {
      key: 'unpublished', label: 'Unpublished', tone: 'info',
      action: 'publish-again', actionLabel: 'Publish again',
    }
  }
  // `refreshedAt` is when the page was last built; a publication that
  // never refreshed was built at publish time.
  const builtAt = pub.refreshedAt ?? pub.publishedAt
  if (trip && trip.updatedAt > builtAt) {
    return {
      key: 'behind', label: 'Page behind itinerary', tone: 'saffron',
      action: 'update-page', actionLabel: 'Update page',
    }
  }
  return {
    key: 'live', label: 'Live', tone: 'ok',
    action: 'edit', actionLabel: 'Edit',
  }
}
