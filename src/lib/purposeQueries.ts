// ============ Purpose-specific search queries ============
// Maps each HaltPurpose to the Google text queries and Overpass selectors
// that find the right kind of place for that segment. Highway-biased for
// functional stops (meal, fuel, rest); wider tourist queries for sight.
//
// No network — pure string tables. The caller (geocode.ts / google.ts /
// free.ts) decides which queries to run based on the segment at hand.

import type { FuelType } from '../data/types'
import type { HaltPurpose } from './providers/hits'

export interface PurposeQuerySet {
  /** Google Places textSearch queries (e.g. "highway dhabas"). */
  googleQueries: string[]
  /** Overpass nwr selectors (e.g. "amenity=restaurant"). */
  overpassSelectors: string[]
  /** Category bias used by rankAndCap. */
  categoryBias: string[]
}

// ---- core query tables ----

const MEAL_QUERIES: PurposeQuerySet = {
  googleQueries: ['highway dhabas restaurants', 'highway food court', 'roadside restaurants'],
  overpassSelectors: ['amenity=restaurant', 'amenity=fast_food', 'amenity=food_court'],
  categoryBias: ['food'],
}

const STRETCH_QUERIES: PurposeQuerySet = {
  googleQueries: ['highway tea stalls', 'roadside cafes', 'highway coffee shops'],
  overpassSelectors: ['amenity=cafe', 'amenity=fast_food'],
  categoryBias: ['cafe', 'food'],
}

const REST_QUERIES: PurposeQuerySet = {
  googleQueries: ['highway rest areas', 'roadside rest stops'],
  overpassSelectors: ['highway=rest_area', 'amenity=shelter'],
  categoryBias: ['rest'],
}

const HOTEL_QUERIES: PurposeQuerySet = {
  googleQueries: ['hotels', 'highway hotels', 'town hotels'],
  overpassSelectors: ['tourism=hotel', 'tourism=guest_house', 'tourism=motel'],
  categoryBias: ['hotel'],
}

const SIGHT_QUERIES: PurposeQuerySet = {
  googleQueries: ['tourist attractions', 'places to visit'],
  overpassSelectors: ['tourism=attraction', 'tourism=viewpoint', 'historic=monument'],
  categoryBias: ['sightseeing'],
}

function fuelQueries(fuelType?: FuelType): PurposeQuerySet {
  if (fuelType === 'electric') {
    return {
      googleQueries: ['EV charging stations', 'electric vehicle charging'],
      overpassSelectors: ['amenity=charging_station'],
      categoryBias: ['transport-hub'],
    }
  }
  if (fuelType === 'cng') {
    return {
      googleQueries: ['CNG pumps', 'CNG filling stations'],
      overpassSelectors: ['amenity=fuel', 'fuel:cng=yes'],
      categoryBias: ['transport-hub'],
    }
  }
  // petrol / diesel (default)
  return {
    googleQueries: ['petrol pumps', 'fuel stations', 'gas stations'],
    overpassSelectors: ['amenity=fuel'],
    categoryBias: ['transport-hub'],
  }
}

/** Return the query set for a given halt purpose and fuel type. */
export function queriesForPurpose(
  purpose: HaltPurpose,
  fuelType?: FuelType,
  _includeHighway?: boolean, // reserved for future highway-only filtering
): PurposeQuerySet {
  switch (purpose) {
    case 'meal': return MEAL_QUERIES
    case 'stretch': return STRETCH_QUERIES
    case 'rest': return REST_QUERIES
    case 'fuel': return fuelQueries(fuelType)
    case 'overnight': return HOTEL_QUERIES
    case 'sight': return SIGHT_QUERIES
    default: return STRETCH_QUERIES
  }
}
