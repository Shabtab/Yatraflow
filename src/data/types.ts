// ============ YatraFlow core data model ============
// Designed so Indian destinations, transport modes and regional
// languages can be added without schema changes.

export type ID = string

export const TRANSPORT_MODES = ['car', 'motorcycle', 'train', 'bus', 'flight', 'taxi', 'mixed'] as const
export type TransportMode = (typeof TRANSPORT_MODES)[number]

export const TRAVEL_STYLES = [
  'relaxed', 'balanced', 'packed', 'adventure', 'luxury',
  'budget', 'family', 'spiritual', 'food-focused', 'creator',
] as const
export type TravelStyle = (typeof TRAVEL_STYLES)[number]

export const STOP_CATEGORIES = [
  'sightseeing', 'food', 'nature', 'beach', 'temple', 'adventure',
  'shopping', 'museum', 'travel', 'hotel', 'rest', 'event', 'transport-hub',
] as const
export type StopCategory = (typeof STOP_CATEGORIES)[number]

export const STOP_STATUSES = ['suggested', 'confirmed', 'rejected', 'maybe', 'needs-booking'] as const
export type StopStatus = (typeof STOP_STATUSES)[number]

export type FixedCommitmentType = 'hotel-checkin' | 'train-departure' | 'flight-departure' | 'event' | 'other'

/** A geocoded lat/lng pair — used for trip start/end geography and map anchors. */
export interface LatLngPoint {
  lat: number
  lng: number
}

export interface FixedCommitment {
  id: ID
  title: string
  type: FixedCommitmentType
  dayIndex: number          // 0-based day of the trip
  time: string              // "HH:MM" 24h
  notes?: string
}

export interface UserProfile {
  name: string
  avatarUrl?: string        // may be a data URI or remote URL; initials fallback used if absent
  homeCity?: string
  languages: string[]       // e.g. ['en', 'hi', 'ml'] — ISO-ish codes, ready for i18n
  travelStyles: TravelStyle[]
  isCreator: boolean
  creatorBio?: string
  socialLinks?: { youtube?: string; instagram?: string }
}

export interface User {
  id: ID                    // = Supabase auth.users.id (uuid)
  email: string
  profile: UserProfile
  createdAt: number
}

export interface TripMember {
  userId: ID
  role: 'owner' | 'editor' | 'commenter' | 'viewer'
  joinedAt: number
}

export interface Expense {
  id: ID
  label: string
  category:
    | 'transport' | 'accommodation' | 'food' | 'activities'
    | 'entry-fees' | 'tolls-parking' | 'local-travel' | 'emergency-buffer'
  amountInr: number         // TOTAL for whole group unless perPerson is true
  perPerson?: boolean
  optional?: boolean        // false => essential cost
  stopId?: ID               // attached to an itinerary stop
  dayIndex?: number
}

export interface ItineraryStop {
  id: ID
  title: string
  category: StopCategory
  locationName: string
  /** lat/lng kept as plain numbers so any maps provider can consume them later */
  lat: number
  lng: number
  description?: string
  visitMinutes: number
  openTime?: string         // "HH:MM"
  closeTime?: string        // "HH:MM"
  entryFeeInrPerPerson: number
  transportCostInrTotal: number   // cost of travelling TO this stop from previous point
  priority: 'must-do' | 'nice-to-have' | 'optional'
  notes?: string
  sourceUrl?: string
  status: StopStatus
  orderInDay: number
  /** true for auto-generated start/destination anchor stops (safe to move/delete) */
  auto?: boolean
  weatherSensitive?: boolean // e.g. beach, trek viewpoints
  /** leg-aware travel fields — auto-filled by the StopEditor when a geocoded place is picked */
  departTime?: string        // "HH:MM" — departure from the previous point
  arrivalTime?: string       // "HH:MM" — computed as departTime + legTravelMinutes
  legDistanceKm?: number     // road distance from the previous point (OSRM or estimate)
  legTravelMinutes?: number  // travel time in minutes for that leg
}

export interface ItineraryDay {
  id: ID
  index: number             // 0-based
  title?: string            // e.g. "Munnar hills"
  stops: ItineraryStop[]
}

export interface Trip {
  id: ID
  name: string
  startLocation: string
  /** Geocoded point A — captured when the user picks a real place for the start. */
  startLocationCoords?: LatLngPoint
  destinations: string[]
  /**
   * Geocoded points for `destinations`, parallel array (null when a destination
   * was typed without picking a real place). Last entry anchors the trip's end.
   */
  destinationCoords?: (LatLngPoint | null)[]
  startDate: string         // ISO yyyy-mm-dd
  endDate: string
  travellers: number
  transportMode: TransportMode
  /**
   * Optional user-stated fuel economy (km per litre) for self-drive modes.
   * When set on a car/motorcycle trip the engine derives fuel ₹/km from it
   * (distance ÷ economy × indicative ₹/L) instead of the blended mode table.
   */
  fuelEconomyKmL?: number
  budgetPerPersonInr: number
  travelStyle: TravelStyle
  fixedCommitments: FixedCommitment[]
  days: ItineraryDay[]
  expenses: Expense[]
  members?: TripMember[]
  coverEmoji: string
  visibility: 'private' | 'public'
  createdAt: number
  updatedAt: number
}

export interface StopSuggestion {
  id: ID
  tripId: ID
  dayIndex: number
  proposedBy: ID
  title: string
  category: StopCategory
  locationName: string
  lat: number
  lng: number
  description?: string
  visitMinutes: number
  estimatedEntryFeeInr: number
  estimatedTransportInr: number
  votes: Vote[]             // value: +1 / -1
  comments: Comment[]
  status: 'open' | 'accepted' | 'declined'
  createdAt: number
}

export interface Vote {
  userId: ID
  value: 1 | -1
  createdAt: number
}

export interface Comment {
  id: ID
  authorId: ID
  text: string
  createdAt: number
}

export interface TripDecision {
  id: ID
  tripId: ID
  question: string
  context?: string
  options: { id: ID; label: string; costImpactInr?: number; timeImpactMin?: number }[]
  votesByUserId: Record<ID, ID>   // userId -> optionId
  status: 'open' | 'resolved'
  resolvedOptionId?: ID
  raisedBy: ID
  createdAt: number
  resolvedAt?: number
}

export interface ActivityEntry {
  id: ID
  tripId: ID
  actorId: ID
  verb: string              // e.g. "added stop", "voted on", "resolved decision"
  target?: string
  at: number
}

export interface Notification {
  id: ID
  userId: ID                // recipient
  tripId?: ID
  text: string
  read: boolean
  at: number
}

export interface PublishedItinerary {
  id: ID                    // slug used in public URL
  tripId: ID
  creatorId: ID
  title: string
  tagline: string
  coverImageUrl?: string
  routeSummary: string[]    // ordered place names
  durationDays: number
  estimatedBudgetPerPersonInr: number
  travelStyle: TravelStyle
  bestSeason?: string
  travelTips: string[]
  warningsAndAssumptions: string[]
  freeDayIndexes: number[]  // which itinerary days are freely viewable
  premiumPriceInr?: number  // placeholder for future payments
  subscriberCta?: string
  publishedAt: number
  views: number
  copies: number
}

/** A snapshot of the plan used by the Budget tab's current-vs-proposed comparison. */
export interface PlanSnapshot {
  takenAt: number
  label: string
  totalCostInr: number
  travelMinutes: number
  stopCount: number
}
