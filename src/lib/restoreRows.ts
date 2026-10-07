// ============ Restoring the rows a trip delete cascades away ============
// Deleting a trip cascades six tables (see supabase/schema.sql): trip_members,
// suggestions, decisions, activity, notifications and published_itineraries.
// Undo re-inserts the trip row, and used to stop there — so every vote, decision,
// activity entry, notification and the public Explore link were gone for good
// (issue #43). These mappers turn the cached rows back into the shape Postgres
// expects so the undo path can put them back.
//
// Pure, with no react/supabase/toast imports, so the column mapping is
// unit-testable in the node environment (same reasoning as tripRow.ts).
import type { StopSuggestion, TripDecision, ActivityEntry, Notification, PublishedItinerary } from '../data/types'

/** Votes, comments, status and created_at are restored, not reset — a suggestion
 *  that had been accepted must not come back as an open one. */
export function suggestionToRow(s: StopSuggestion) {
  return {
    id: s.id, trip_id: s.tripId, day_index: s.dayIndex, proposed_by: s.proposedBy,
    title: s.title, category: s.category, location_name: s.locationName,
    lat: s.lat, lng: s.lng, description: s.description ?? null,
    visit_minutes: s.visitMinutes, estimated_entry_fee_inr: s.estimatedEntryFeeInr,
    estimated_transport_inr: s.estimatedTransportInr,
    votes: s.votes, comments: s.comments, status: s.status, created_at: s.createdAt,
  }
}

/** A resolved decision keeps its resolution; `resolved_option_id` is a uuid
 *  column, so an absent resolution has to be null rather than undefined. */
export function decisionToRow(d: TripDecision, withComments = false) {
  const row: Record<string, unknown> = {
    id: d.id, trip_id: d.tripId, question: d.question, context: d.context ?? null,
    options: d.options, votes_by_user_id: d.votesByUserId, status: d.status,
    resolved_option_id: d.resolvedOptionId ?? null, raised_by: d.raisedBy,
    created_at: d.createdAt, resolved_at: d.resolvedAt ?? null,
  }
  // decisions.comments ships in supabase/migrations/20260920_decision_comments.sql;
  // omit the key entirely on pre-migration databases, the same shape as
  // tripToRow's cols gate — a write naming an unknown column is rejected whole.
  if (withComments) row.comments = d.comments
  return row
}

export function activityToRow(a: ActivityEntry) {
  return { id: a.id, trip_id: a.tripId, actor_id: a.actorId, verb: a.verb, target: a.target ?? null, at: a.at }
}

export function notificationToRow(n: Notification) {
  return { id: n.id, user_id: n.userId, trip_id: n.tripId ?? null, text: n.text, read: n.read, at: n.at }
}

/** The published row is the public URL: its `id` IS the slug, so restoring must
 *  reuse it or the old share link breaks even though a link exists again.
 *  `published_at`/`views`/`copies` ride along so the counts survive too.
 *  `withRefreshedAt` gates `refreshed_at` the way `withComments` gates the
 *  decision column. The key is omitted until the caller says the column
 *  exists: a write naming an unknown column is rejected whole. */
export function publishedToRow(p: PublishedItinerary, withRefreshedAt: boolean) {
  const row: Record<string, unknown> = {
    id: p.id, trip_id: p.tripId, creator_id: p.creatorId, title: p.title,
    tagline: p.tagline ?? null, cover_image_url: p.coverImageUrl ?? null,
    route_summary: p.routeSummary, duration_days: p.durationDays,
    estimated_budget_per_person_inr: p.estimatedBudgetPerPersonInr,
    travel_style: p.travelStyle, best_season: p.bestSeason ?? null,
    travel_tips: p.travelTips, warnings_and_assumptions: p.warningsAndAssumptions,
    free_day_indexes: p.freeDayIndexes, premium_price_inr: p.premiumPriceInr ?? null,
    subscriber_cta: p.subscriberCta ?? null,
    published_at: p.publishedAt, views: p.views, copies: p.copies,
  }
  // The sitemap's <lastmod> and Explore's freshness sort read refreshed_at
  // (api/sitemap.js). An undo that drops it buries the revived publication.
  if (withRefreshedAt) row.refreshed_at = p.refreshedAt ?? null
  return row
}
