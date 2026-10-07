// ============ Undo-restore row mapping (issue #43) ============
// Deleting a trip cascades suggestions/decisions/activity/notifications/
// published_itineraries away, and undo re-inserts them from the client cache.
// These mappers are the whole of that write, so two failure modes matter and are
// checked here: a wrong column name (Postgres rejects the row and the data is
// silently lost again) and a reset field (an accepted suggestion coming back
// "open" is its own kind of data loss).
import { describe, it, expect } from 'vitest'
import {
  suggestionToRow, decisionToRow, activityToRow, notificationToRow, publishedToRow,
} from '../src/lib/restoreRows'
import type {
  StopSuggestion, TripDecision, ActivityEntry, Notification, PublishedItinerary,
} from '../src/data/types'

const suggestion: StopSuggestion = {
  id: 'sg-1', tripId: 'trip-1', dayIndex: 2, proposedBy: 'user-b', title: 'Chinese Fish',
  category: 'food', locationName: 'Kerala Diner', lat: 9.93, lng: 76.26,
  visitMinutes: 45, estimatedEntryFeeInr: 0, estimatedTransportInr: 200,
  votes: [{ userId: 'user-a', value: 1, createdAt: 10 }],
  comments: [{ id: 'cm-1', authorId: 'user-a', text: 'go here', createdAt: 11 }],
  status: 'accepted', createdAt: 12,
}

const decision: TripDecision = {
  id: 'dc-1', tripId: 'trip-1', question: 'Houseboat or resort?', context: 'Night 3',
  options: [{ id: 'op-1', label: 'Houseboat', costImpactInr: 4000 }],
  votesByUserId: { 'user-a': 'op-1', 'user-b': 'op-1' },
  comments: [{ id: 'cm-2', authorId: 'user-b', text: 'houseboat, obviously', createdAt: 22 }],
  status: 'resolved', resolvedOptionId: 'op-1', raisedBy: 'user-a',
  createdAt: 20, resolvedAt: 21,
}

const activity: ActivityEntry = {
  id: 'ac-1', tripId: 'trip-1', actorId: 'user-b', verb: 'upvoted a suggestion', target: 'Chinese Fish', at: 30,
}

const notification: Notification = {
  id: 'nt-1', userId: 'user-b', tripId: 'trip-1', text: 'user-a suggested a stop', read: true, at: 40,
}

const published: PublishedItinerary = {
  id: 'kerala-4-days', tripId: 'trip-1', creatorId: 'user-a', title: 'Kerala, 4 days',
  tagline: 'Backwaters at easy pace', routeSummary: ['Kochi', 'Munnar'], durationDays: 4,
  estimatedBudgetPerPersonInr: 12000, travelStyle: 'balanced', travelTips: ['Book early'],
  warningsAndAssumptions: ['Monsoon risk'], freeDayIndexes: [2],
  publishedAt: 50, views: 17, copies: 3,
}

describe('restore row mappers (#43)', () => {
  it('emits only snake_case columns, so Postgres accepts every row', () => {
    const rows = [
      suggestionToRow(suggestion), decisionToRow(decision), activityToRow(activity),
      notificationToRow(notification), publishedToRow(published, false),
    ]
    for (const row of rows) {
      const camel = Object.keys(row).filter(k => /[A-Z]/.test(k))
      expect(camel).toEqual([])
    }
  })

  it('names the suggestion columns the schema declares', () => {
    expect(suggestionToRow(suggestion)).toMatchObject({
      id: 'sg-1', trip_id: 'trip-1', day_index: 2, proposed_by: 'user-b',
      location_name: 'Kerala Diner', visit_minutes: 45,
      estimated_entry_fee_inr: 0, estimated_transport_inr: 200, created_at: 12,
    })
  })

  it('carries votes, comments and status instead of resetting the suggestion', () => {
    const row = suggestionToRow(suggestion)
    expect(row.votes).toEqual([{ userId: 'user-a', value: 1, createdAt: 10 }])
    expect(row.comments).toEqual([{ id: 'cm-1', authorId: 'user-a', text: 'go here', createdAt: 11 }])
    expect(row.status).toBe('accepted')
  })

  it('keeps a resolved decision resolved, including who voted which way', () => {
    const row = decisionToRow(decision)
    expect(row).toMatchObject({
      trip_id: 'trip-1', status: 'resolved', resolved_option_id: 'op-1',
      resolved_at: 21, raised_by: 'user-a', created_at: 20,
    })
    expect(row.votes_by_user_id).toEqual({ 'user-a': 'op-1', 'user-b': 'op-1' })
  })

  it('gates decision comments on the capability flag (20260920_decision_comments.sql)', () => {
    // A write naming a column the database does not have is rejected whole, so
    // the key must be ABSENT — not null — until the probe says the column
    // exists; the same shape as tripToRow's cols gate.
    expect(decisionToRow(decision)).not.toHaveProperty('comments')
    expect(decisionToRow(decision, true).comments).toEqual([
      { id: 'cm-2', authorId: 'user-b', text: 'houseboat, obviously', createdAt: 22 },
    ])
  })

  it('restores the public URL by its slug, with the view/copy counts intact', () => {
    const row = publishedToRow(published, false)
    // `id` IS the slug in the public link — minting a new one would leave the
    // share URL people already have pointing at nothing.
    expect(row.id).toBe('kerala-4-days')
    expect(row).toMatchObject({ trip_id: 'trip-1', creator_id: 'user-a', published_at: 50, views: 17, copies: 3 })
  })

  it('carries refreshed_at when the caller says the column exists (#368)', () => {
    // Undo re-inserts the row. The sitemap's <lastmod> and Explore's newest
    // sort read refreshed_at, so it must survive the delete too.
    const row = publishedToRow({ ...published, refreshedAt: 1728000000000 }, true)
    expect(row.refreshed_at).toBe(1728000000000)
  })

  it('sends a null refreshed_at when the restored row never had one', () => {
    // Pre-v0.37 rows carry no stamp; the column still needs a value.
    expect(publishedToRow(published, true).refreshed_at).toBeNull()
  })

  it('omits refreshed_at entirely until the caller says the column exists', () => {
    // A write naming a column the database lacks is rejected whole. The key
    // must be ABSENT — not null — behind the capability probe.
    expect('refreshed_at' in publishedToRow(published, false)).toBe(false)
  })

  it('sends null rather than undefined for absent optional columns', () => {
    // undefined keys are dropped from the insert entirely, which is fine here,
    // but uuid/text columns written as undefined break the whole row.
    expect(suggestionToRow(suggestion).description).toBeNull()
    expect(decisionToRow({ ...decision, resolvedOptionId: undefined, resolvedAt: undefined }).resolved_option_id).toBeNull()
    expect(activityToRow({ ...activity, target: undefined }).target).toBeNull()
    expect(notificationToRow({ ...notification, tripId: undefined }).trip_id).toBeNull()
    expect(publishedToRow({ ...published, bestSeason: undefined }, false).best_season).toBeNull()
  })

  it('maps activity and notification ownership columns', () => {
    expect(activityToRow(activity)).toEqual({
      id: 'ac-1', trip_id: 'trip-1', actor_id: 'user-b', verb: 'upvoted a suggestion', target: 'Chinese Fish', at: 30,
    })
    expect(notificationToRow(notification)).toEqual({
      id: 'nt-1', user_id: 'user-b', trip_id: 'trip-1', text: 'user-a suggested a stop', read: true, at: 40,
    })
  })
})
