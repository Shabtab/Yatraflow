// ============ Seed data ============
// Realistic Indian demo content. With real Supabase auth, new accounts get the
// demo trips reseeded into their own Supabase account (see src/lib/seedSupabase.ts).
// The `User` objects here are only used to pre-fill profile fields for the
// reseeded demo owner; passwords are handled by Supabase Auth, not stored here.
import type { Trip, PublishedItinerary, StopSuggestion, TripDecision, ActivityEntry, Notification, UserProfile } from './types'

export const uid = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`

// ---------------- Profile templates ----------------
// With real Supabase auth these are only used to pre-fill the profile of the
// demo-trip owner when a new account is seeded (see src/lib/seedSupabase.ts).
// Passwords are handled by Supabase Auth and are NOT stored here.

export const demoProfileTemplates: Record<string, UserProfile> = {
  'demo@yatraflow.in': {
    name: 'Demo Traveller',
    homeCity: 'Kochi, Kerala',
    languages: ['en', 'hi', 'ml'],
    travelStyles: ['balanced', 'food-focused'],
    isCreator: false,
  },
  'meera@yatraflow.in': {
    name: 'Meera Nair',
    homeCity: 'Bengaluru',
    languages: ['en', 'ml', 'ta'],
    travelStyles: ['relaxed', 'food-focused'],
    isCreator: false,
  },
  'arjun@yatraflow.in': {
    name: 'Arjun Mehta',
    homeCity: 'Mumbai',
    languages: ['en', 'hi', 'mr'],
    travelStyles: ['adventure', 'budget'],
    isCreator: false,
  },
  'devika@yatraflow.in': {
    name: 'Devika Rathore',
    avatarUrl: undefined,
    homeCity: 'Jaipur',
    languages: ['en', 'hi'],
    travelStyles: ['creator', 'luxury', 'spiritual'],
    isCreator: true,
    creatorBio: 'Heritage storyteller. I plan slow, deep India itineraries — forts, havelis, food lanes and the people in between.',
    socialLinks: { youtube: 'youtube.com/@DevikaRoams', instagram: 'instagram.com/devikaroams' },
  },
}

function T(daysAgo: number): number { return Date.now() - daysAgo * 86400000 }

// ---------------- Kerala road trip (the flagship demo trip) ----------------
// Dates are generated relative to "today" so the demo always feels live.
function futureDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86400000)
  return d.toISOString().slice(0, 10)
}

const keralaTripId = 'trip_kerala_demo'
const goaTripId = 'trip_goa_demo'

const keralaTrip: Trip = {
  id: keralaTripId,
  name: 'Kerala Hills & Backwaters Road Trip',
  startLocation: 'Kochi',
  destinations: ['Munnar', 'Thekkady', 'Alleppey'],
  startDate: futureDate(14),
  endDate: futureDate(17),
  travellers: 4,
  transportMode: 'car',
  budgetPerPersonInr: 22000,
  travelStyle: 'balanced',
  coverEmoji: '🌴',
  visibility: 'private',
  createdAt: T(10),
  updatedAt: T(1),
  fixedCommitments: [
    { id: 'fc_1', title: 'Hotel check-in — Kochi', type: 'hotel-checkin', dayIndex: 0, time: '14:00', notes: 'Fort Kochi homestay' },
    { id: 'fc_2', title: 'Houseboat boarding — Alleppey', type: 'event', dayIndex: 3, time: '12:00', notes: 'Boarding gate closes 12:30 sharp' },
    { id: 'fc_3', title: 'Train departure — Ernakulam Jn', type: 'train-departure', dayIndex: 3, time: '19:45', notes: 'Vrinda Express' },
  ],
  days: [
    // ---- Day 1: Kochi → Munnar ----
    {
      id: 'day_k_1', index: 0, title: 'Kochi to Munnar — waterfalls en route',
      stops: [
        {
          id: 'st_k_cheeyappara', title: 'Cheeyappara Waterfalls', category: 'nature',
          locationName: 'Cheeyappara, Idukki', lat: 9.9917, lng: 76.7606,
          description: 'Seven-step waterfall right off the Kochi–Munnar highway. Roadside tea and pakodas.',
          visitMinutes: 40, openTime: '06:00', closeTime: '18:00', entryFeeInrPerPerson: 0,
          transportCostInrTotal: 0, priority: 'nice-to-have', notes: 'Can get crowded 11–2.', status: 'confirmed', orderInDay: 1,
        },
        {
          id: 'st_k_valara', title: 'Valara Waterfalls', category: 'nature',
          locationName: 'Valara, Idukki', lat: 10.0392, lng: 76.7853,
          description: 'Dense forest cascade 10 min above Cheeyappara.', visitMinutes: 25,
          openTime: '06:00', closeTime: '18:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
          priority: 'optional', status: 'maybe', orderInDay: 2,
        },
        {
          id: 'st_k_hotel_munnar', title: 'Check-in — Munnar hill resort', category: 'hotel',
          locationName: 'Munnar town', lat: 10.0889, lng: 77.0595,
          description: 'Tea-valley view rooms. Early dinner on terrace.', visitMinutes: 45,
          openTime: '13:00', closeTime: '23:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
          priority: 'must-do', status: 'confirmed', orderInDay: 3,
        },
        {
          id: 'st_k_blossom', title: 'Blossom International Park evening walk', category: 'nature',
          locationName: 'Munnar', lat: 10.0740, lng: 77.0298,
          description: 'Easy lakeside trail — good leg-stretch after the ghat drive.', visitMinutes: 60,
          openTime: '09:00', closeTime: '18:00', entryFeeInrPerPerson: 50, transportCostInrTotal: 200,
          priority: 'optional', weatherSensitive: true, status: 'suggested', orderInDay: 4,
        },
      ],
    },
    // ---- Day 2: Munnar full day ----
    {
      id: 'day_k_2', index: 1, title: 'Munnar — tea estates & Top Station',
      stops: [
        {
          id: 'st_k_sunrise', title: 'Top Station sunrise viewpoint', category: 'sightseeing',
          locationName: 'Top Station, Munnar', lat: 10.1333, lng: 77.2167,
          description: 'Sunrise over the Tamil Nadu valley. Leave by 5 AM.', visitMinutes: 75,
          openTime: '05:00', closeTime: '18:00', entryFeeInrPerPerson: 20, transportCostInrTotal: 900,
          priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1,
        },
        {
          id: 'st_k_tea', title: 'KDHP Tea Museum', category: 'museum',
          locationName: 'Nullatanni, Munnar', lat: 10.0798, lng: 77.0600,
          description: 'History of tea in Munnar with a tasting session.', visitMinutes: 90,
          openTime: '09:00', closeTime: '16:00', entryFeeInrPerPerson: 150, transportCostInrTotal: 250,
          priority: 'nice-to-have', status: 'confirmed', orderInDay: 2,
        },
        {
          id: 'st_k_lunch', title: 'Lunch at Saravana Bhavan', category: 'food',
          locationName: 'Munnar town', lat: 10.0870, lng: 77.0585,
          description: 'Kerala meals on banana leaf.', visitMinutes: 60,
          openTime: '08:00', closeTime: '21:00', entryFeeInrPerPerson: 180, transportCostInrTotal: 100,
          priority: 'must-do', status: 'confirmed', orderInDay: 3,
        },
        {
          id: 'st_k_matupetty', title: 'Mattupetty Dam & lake', category: 'nature',
          locationName: 'Mattupetty', lat: 10.1060, lng: 77.1300,
          description: 'Pedal boating between tea slopes.', visitMinutes: 70,
          openTime: '09:30', closeTime: '17:00', entryFeeInrPerPerson: 30, transportCostInrTotal: 350,
          priority: 'nice-to-have', weatherSensitive: true, status: 'suggested', orderInDay: 4,
        },
        {
          id: 'st_k_echo', title: 'Echo Point', category: 'sightseeing',
          locationName: 'Munnar', lat: 10.1105, lng: 77.1408,
          description: 'Popular echo viewpoint; skip if short on time.', visitMinutes: 40,
          openTime: '07:00', closeTime: '18:00', entryFeeInrPerPerson: 20, transportCostInrTotal: 150,
          priority: 'optional', status: 'suggested', orderInDay: 5,
        },
        {
          id: 'st_k_kundala', title: 'Kundala Lake', category: 'nature',
          locationName: 'Kundala Valley', lat: 10.1210, lng: 77.1660,
          description: 'Arch dam lake with shikara rides.', visitMinutes: 55,
          openTime: '09:00', closeTime: '17:30', entryFeeInrPerPerson: 25, transportCostInrTotal: 150,
          priority: 'optional', weatherSensitive: true, status: 'maybe', orderInDay: 6,
        },
      ],
    },
    // ---- Day 3: Munnar → Thekkady ----
    {
      id: 'day_k_3', index: 2, title: 'Munnar to Thekkady — spice country',
      stops: [
        {
          id: 'st_k_spice', title: 'Spice garden guided walk', category: 'nature',
          locationName: 'Kumily, Thekkady', lat: 9.5970, lng: 77.1620,
          description: 'Cardamom, pepper and vanilla estate tour.', visitMinutes: 80,
          openTime: '08:00', closeTime: '17:00', entryFeeInrPerPerson: 200, transportCostInrTotal: 300,
          priority: 'nice-to-have', status: 'confirmed', orderInDay: 1,
        },
        {
          id: 'st_k_permits', title: 'Periyar boat safari (book slots)', category: 'adventure',
          locationName: 'Periyar Tiger Reserve', lat: 9.4644, lng: 77.1570,
          description: '1.5h lake safari — elephant/gaur sightings possible. Needs booking.', visitMinutes: 120,
          openTime: '07:30', closeTime: '16:00', entryFeeInrPerPerson: 300, transportCostInrTotal: 400,
          priority: 'must-do', weatherSensitive: true, notes: 'Book upper-deck seats online.', status: 'needs-booking', orderInDay: 2,
        },
        {
          id: 'st_k_kathakali', title: 'Kathakali & Kalaripayattu show', category: 'event',
          locationName: 'Kumily junction', lat: 9.5960, lng: 77.1615,
          description: 'Evening cultural performance — makeup demo starts 30 min early.', visitMinutes: 90,
          openTime: '17:00', closeTime: '20:00', entryFeeInrPerPerson: 300, transportCostInrTotal: 150,
          priority: 'nice-to-have', status: 'confirmed', orderInDay: 3,
        },
      ],
    },
    // ---- Day 4: Thekkady → Alleppey houseboat ----
    {
      id: 'day_k_4', index: 3, title: 'Thekkady to Alleppey — houseboat finale',
      stops: [
        {
          id: 'st_k_houseboat', title: 'Houseboat boarding & cruise', category: 'travel',
          locationName: 'Punnamada jetty, Alleppey', lat: 9.4981, lng: 76.3388,
          description: 'Overnight houseboat through Kuttanad paddy fields.', visitMinutes: 300,
          openTime: '11:30', closeTime: '17:30', entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
          priority: 'must-do', status: 'confirmed', orderInDay: 1,
        },
        {
          id: 'st_k_dinner', title: 'Farewell Kerala sadya dinner', category: 'food',
          locationName: 'Onboard houseboat', lat: 9.4850, lng: 76.3400,
          description: 'Karimeen pollichathu onboard.', visitMinutes: 90,
          openTime: '19:00', closeTime: '22:00', entryFeeInrPerPerson: 450, transportCostInrTotal: 0,
          priority: 'must-do', status: 'confirmed', orderInDay: 2,
        },
      ],
    },
  ],
  expenses: [
    { id: 'ex_1', label: 'Self-drive car rental (4 days)', category: 'transport', amountInr: 7200, optional: false },
    { id: 'ex_2', label: 'Fuel estimate (~430 km)', category: 'transport', amountInr: 3800, optional: false },
    { id: 'ex_3', label: 'Tolls & parking', category: 'tolls-parking', amountInr: 850, optional: false },
    { id: 'ex_4', label: 'Munnar resort (2 nights)', category: 'accommodation', amountInr: 11200, optional: false },
    { id: 'ex_5', label: 'Kochi homestay (1 night)', category: 'accommodation', amountInr: 3600, optional: false },
    { id: 'ex_6', label: 'Houseboat (overnight, all meals)', category: 'accommodation', amountInr: 14500, optional: false },
    { id: 'ex_7', label: 'Meals for group (per person/day est.)', category: 'food', amountInr: 900, perPerson: true, optional: false },
    { id: 'ex_8', label: 'Souvenirs & tea shopping', category: 'activities', amountInr: 2500, optional: true },
    { id: 'ex_9', label: 'Emergency buffer', category: 'emergency-buffer', amountInr: 3000, optional: true },
    { id: 'ex_10', label: 'Local autos & ferries', category: 'local-travel', amountInr: 1200, optional: false },
  ],
}

// ---------------- Goa friends trip ----------------
const goaTrip: Trip = {
  id: goaTripId,
  name: 'Goa Long Weekend with the Gang',
  startLocation: 'Mumbai',
  destinations: ['North Goa', 'Old Goa'],
  startDate: futureDate(30),
  endDate: futureDate(32),
  travellers: 6,
  transportMode: 'car',
  budgetPerPersonInr: 14000,
  travelStyle: 'packed',
  coverEmoji: '🏖️',
  visibility: 'private',
  createdAt: T(6),
  updatedAt: T(2),
  fixedCommitments: [
    { id: 'fc_g1', title: 'Return drive deadline — Mumbai', type: 'other', dayIndex: 2, time: '16:00', notes: 'One of us has a Monday shift' },
  ],
  days: [
    {
      id: 'day_g_1', index: 0, title: 'Panjim arrival & North Goa beaches',
      stops: [
        { id: 'st_g_baga', title: 'Baga Beach sunset', category: 'beach', locationName: 'Baga', lat: 15.5555, lng: 73.7519, description: 'Shack hopping after sunset.', visitMinutes: 120, openTime: '06:00', closeTime: '22:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 600, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
        { id: 'st_g_cafe', title: 'Late lunch at Thalassa (booking needed)', category: 'food', locationName: 'Siolim', lat: 15.6180, lng: 73.7380, description: 'Greek cliffside views.', visitMinutes: 90, openTime: '12:00', closeTime: '23:00', entryFeeInrPerPerson: 800, transportCostInrTotal: 500, priority: 'nice-to-have', notes: 'Weekend queues — reserve.', status: 'needs-booking', orderInDay: 2 },
      ],
    },
    {
      id: 'day_g_2', index: 1, title: 'Forts, markets & Old Goa churches',
      stops: [
        { id: 'st_g_fort', title: 'Chapora Fort (Dil Chahta Hai fort)', category: 'sightseeing', locationName: 'Vagator', lat: 15.6060, lng: 73.7360, description: 'Morning light is best; climb before it gets hot.', visitMinutes: 60, openTime: '09:00', closeTime: '18:30', entryFeeInrPerPerson: 0, transportCostInrTotal: 400, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
        { id: 'st_g_market', title: 'Anjuna Flea Market', category: 'shopping', locationName: 'Anjuna', lat: 15.5760, lng: 73.7410, description: 'Wednesdays only — check the date!', visitMinutes: 90, openTime: '08:00', closeTime: '18:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 300, priority: 'optional', status: 'suggested', orderInDay: 2 },
        { id: 'st_g_basilica', title: 'Basilica of Bom Jesus', category: 'temple', locationName: 'Old Goa', lat: 15.5009, lng: 73.9116, description: 'UNESCO baroque church; St Francis Xavier relics.', visitMinutes: 60, openTime: '09:00', closeTime: '18:30', entryFeeInrPerPerson: 0, transportCostInrTotal: 700, priority: 'must-do', status: 'confirmed', orderInDay: 3 },
        { id: 'st_g_river', title: 'Mandovi river cruise', category: 'event', locationName: 'Panjim jetty', lat: 15.4989, lng: 73.8278, description: 'Live music cruise at sunset.', visitMinutes: 90, openTime: '16:00', closeTime: '19:45', entryFeeInrPerPerson: 500, transportCostInrTotal: 300, priority: 'nice-to-have', status: 'suggested', orderInDay: 4 },
      ],
    },
    {
      id: 'day_g_3', index: 2, title: 'Slow morning & drive back',
      stops: [
        { id: 'st_g_brunch', title: 'Beach brunch at Curlies', category: 'food', locationName: 'Anjuna', lat: 15.5740, lng: 73.7390, description: 'Final swim + breakfast.', visitMinutes: 105, openTime: '08:00', closeTime: '21:00', entryFeeInrPerPerson: 550, transportCostInrTotal: 250, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
      ],
    },
  ],
  expenses: [
    { id: 'exg_1', label: 'Two SUVs self-drive (fuel incl.)', category: 'transport', amountInr: 21000, optional: false },
    { id: 'exg_2', label: 'Tolls (Mumbai–Goa both ways)', category: 'tolls-parking', amountInr: 3200, optional: false },
    { id: 'exg_3', label: 'Airbnb Anjuna (2 nights)', category: 'accommodation', amountInr: 24000, optional: false },
    { id: 'exg_4', label: 'Food & drinks (per person)', category: 'food', amountInr: 4200, perPerson: true, optional: false },
    { id: 'exg_5', label: 'Water sports package', category: 'activities', amountInr: 6500, optional: true },
    { id: 'exg_6', label: 'Emergency buffer', category: 'emergency-buffer', amountInr: 4000, optional: true },
  ],
}

// ---------------- Rajasthan creator itinerary (published) ----------------
const rajasthanTripId = 'trip_rajasthan_creator'
const rajasthanTrip: Trip = {
  id: rajasthanTripId,
  name: 'Royal Rajasthan Heritage Circuit',
  startLocation: 'Jaipur',
  destinations: ['Jaipur', 'Jodhpur', 'Udaipur'],
  startDate: futureDate(45),
  endDate: futureDate(51),
  travellers: 2,
  transportMode: 'car',
  budgetPerPersonInr: 48000,
  travelStyle: 'luxury',
  coverEmoji: '🏰',
  visibility: 'public',
  createdAt: T(60),
  updatedAt: T(3),
  fixedCommitments: [
    { id: 'fc_r1', title: 'Haveli check-in — Jaipur', type: 'hotel-checkin', dayIndex: 0, time: '15:00' },
  ],
  days: [
    {
      id: 'day_r_1', index: 0, title: 'Pink City icons',
      stops: [
        { id: 'st_r_amer', title: 'Amer Fort at opening hour', category: 'temple', locationName: 'Amer', lat: 26.9855, lng: 75.8513, description: 'Beat the crowds; mirror palace in soft light.', visitMinutes: 150, openTime: '08:00', closeTime: '17:30', entryFeeInrPerPerson: 200, transportCostInrTotal: 500, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
        { id: 'st_r_hawamahal', title: 'Hawa Mahal photo walk', category: 'sightseeing', locationName: 'Jaipur old city', lat: 26.9239, lng: 75.8267, description: 'Wind Palace facade from Wind View Café across the street.', visitMinutes: 60, openTime: '09:00', closeTime: '16:30', entryFeeInrPerPerson: 50, transportCostInrTotal: 200, priority: 'nice-to-have', status: 'confirmed', orderInDay: 2 },
        { id: 'st_r_chowki', title: 'Chowki Dhani village evening', category: 'event', locationName: 'Tonk Road outskirts', lat: 26.7590, lng: 75.8080, description: 'Folk dances, Rajasthani thali.', visitMinutes: 180, openTime: '17:30', closeTime: '23:00', entryFeeInrPerPerson: 900, transportCostInrTotal: 800, priority: 'nice-to-have', status: 'confirmed', orderInDay: 3 },
      ],
    },
    {
      id: 'day_r_2', index: 1, title: 'Jaipur → Jodhpur',
      stops: [
        { id: 'st_r_mehrangarh', title: 'Mehrangarh Fort', category: 'temple', locationName: 'Jodhpur', lat: 26.2967, lng: 73.0351, description: 'Rampart views over the blue city.', visitMinutes: 150, openTime: '09:00', closeTime: '17:00', entryFeeInrPerPerson: 200, transportCostInrTotal: 400, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
        { id: 'st_r_toorji', title: 'Toorji ka Jhalra stepwell café hop', category: 'food', locationName: 'Old Jodhpur', lat: 26.2935, lng: 73.0270, description: 'Stepwell sunset + rooftop dinner.', visitMinutes: 90, openTime: '08:00', closeTime: '22:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 150, priority: 'nice-to-have', status: 'suggested', orderInDay: 2 },
      ],
    },
    {
      id: 'day_r_3', index: 2, title: 'Jodhpur → Udaipur via Ranakpur',
      stops: [
        { id: 'st_r_ranakpur', title: 'Ranakpur Jain Temple', category: 'temple', locationName: 'Ranakpur', lat: 25.1170, lng: 73.4410, description: '1,444 marble pillars — none identical.', visitMinutes: 90, openTime: '12:00', closeTime: '17:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 300, notes: 'Opens to non-Jain visitors at noon.', priority: 'must-do', status: 'confirmed', orderInDay: 1 },
        { id: 'st_r_citypalace', title: 'City Palace Udaipur sunset', category: 'museum', locationName: 'Udaipur', lat: 24.5764, lng: 73.6835, description: 'Lake Pichola from the upper courtyards.', visitMinutes: 120, openTime: '09:30', closeTime: '19:30', entryFeeInrPerPerson: 300, transportCostInrTotal: 250, priority: 'must-do', status: 'confirmed', orderInDay: 2 },
      ],
    },
  ],
  expenses: [
    { id: 'exr_1', label: 'Chauffeur-driven sedan (7 days)', category: 'transport', amountInr: 28000, optional: false },
    { id: 'exr_2', label: 'Heritage hotels (6 nights)', category: 'accommodation', amountInr: 96000, optional: false },
    { id: 'exr_3', label: 'Fine dining & thalis', category: 'food', amountInr: 2200, perPerson: true, optional: false },
    { id: 'exr_4', label: 'Private guides (3 cities)', category: 'activities', amountInr: 9000, optional: false },
    { id: 'exr_5', label: 'Shopping allowance', category: 'activities', amountInr: 12000, optional: true },
  ],
}

const trips = [keralaTrip, goaTrip, rajasthanTrip]

// ---------------- Suggestions / decisions / feed / notifications ----------------

const suggestions: StopSuggestion[] = [
  {
    id: 'sg_1', tripId: keralaTripId, dayIndex: 1, proposedBy: 'u_meera', title: 'Pothamedu viewpoint sunset',
    category: 'sightseeing', locationName: 'Pothamedu, Munnar', lat: 10.0680, lng: 77.0480,
    description: 'Quiet viewpoint over the tea valleys — better than Echo Point honestly.',
    visitMinutes: 45, estimatedEntryFeeInr: 0, estimatedTransportInr: 250,
    votes: [{ userId: 'u_meera', value: 1, createdAt: T(2) }, { userId: 'u_arjun', value: 1, createdAt: T(1) }],
    comments: [{ id: 'cm_1', authorId: 'u_arjun', text: 'Yes! Echo Point was a letdown last time.', createdAt: T(1) }],
    status: 'open', createdAt: T(2),
  },
  {
    id: 'sg_2', tripId: keralaTripId, dayIndex: 2, proposedBy: 'u_arjun', title: 'Elephant junction bath experience',
    category: 'adventure', locationName: 'Kumily', lat: 9.5870, lng: 77.1550,
    description: 'Ethical elephant bathing session, 45 min. Kids would love it.',
    visitMinutes: 60, estimatedEntryFeeInr: 700, estimatedTransportInr: 300,
    votes: [{ userId: 'u_arjun', value: 1, createdAt: T(1) }, { userId: 'u_meera', value: -1, createdAt: T(1) }],
    comments: [{ id: 'cm_2', authorId: 'u_meera', text: 'I read mixed reviews about this place — can we check an ethical operator?', createdAt: T(1) }],
    status: 'open', createdAt: T(1),
  },
]

const decisions: TripDecision[] = [
  {
    id: 'dc_1', tripId: keralaTripId,
    question: 'Day 2 is packed — which stop do we drop?',
    context: 'Six activities in one day. Health score flags Day 2 as Tight.',
    options: [
      { id: 'o_1', label: 'Drop Echo Point', costImpactInr: -20, timeImpactMin: -95 },
      { id: 'o_2', label: 'Drop Kundala Lake', costImpactInr: -25, timeImpactMin: -115 },
      { id: 'o_3', label: 'Keep everything, start at 5 AM', costImpactInr: 0, timeImpactMin: 0 },
    ],
    votesByUserId: { u_meera: 'o_1', u_arjun: 'o_3' },
    status: 'open', raisedBy: 'u_demo', createdAt: T(2),
  },
  {
    id: 'dc_2', tripId: keralaTripId,
    question: 'Vegetarian-only houseboat menu or mixed?',
    options: [
      { id: 'o_4', label: 'Pure veg sadya' },
      { id: 'o_5', label: 'Mixed — include karimeen' , costImpactInr: 900 },
    ],
    votesByUserId: {},
    status: 'open', raisedBy: 'u_meera', createdAt: T(1),
  },
]

const activityFeed: ActivityEntry[] = [
  { id: 'af_1', tripId: keralaTripId, actorId: 'u_meera', verb: 'suggested “Pothamedu viewpoint sunset”', target: 'Day 2', at: T(2) },
  { id: 'af_2', tripId: keralaTripId, actorId: 'u_arjun', verb: 'voted on “Pothamedu viewpoint sunset”', target: 'Suggestion', at: T(1) },
  { id: 'af_3', tripId: keralaTripId, actorId: 'u_demo', verb: 'moved “Echo Point” later in Day 2', target: 'Timeline', at: Date.now() - 26 * 3600000 },
  { id: 'af_4', tripId: keralaTripId, actorId: 'u_meera', verb: 'raised decision “Which stop do we drop?”', target: 'Decisions', at: T(2) },
  { id: 'af_5', tripId: goaTripId, actorId: 'u_arjun', verb: 'confirmed “Basilica of Bom Jesus”', target: 'Day 2', at: T(2) },
]

const notificationsSeed: Notification[] = [
  { id: 'nt_1', userId: 'u_demo', tripId: keralaTripId, text: 'Meera Nair suggested “Pothamedu viewpoint sunset” for Day 2.', read: false, at: T(2) },
  { id: 'nt_2', userId: 'u_demo', tripId: keralaTripId, text: 'Arjun voted on a suggestion.', read: false, at: T(1) },
  { id: 'nt_3', userId: 'u_demo', tripId: keralaTripId, text: 'New unresolved decision: “Which stop do we drop?”', read: false, at: T(2) },
]

// ---------------- Published itineraries (Explore page) ----------------

const publishedItineraries: PublishedItinerary[] = [
  {
    id: 'kerala-hills-backwaters-4d',
    tripId: keralaTripId, creatorId: 'u_demo',
    title: 'Kerala Hills & Backwaters — 4-Day Road Trip',
    tagline: 'Waterfalls, tea estates and a night drifting through Kuttanad.',
    routeSummary: ['Kochi', 'Munnar', 'Thekkady', 'Alleppey'],
    durationDays: 4, estimatedBudgetPerPersonInr: 22000, travelStyle: 'balanced',
    bestSeason: 'Sep–Mar',
    travelTips: [
      'Start ghat-section drives before 9 AM — mist rolls in after 4 PM.',
      'Carry cash; card machines fail in Munnar town during power cuts.',
      'Book Periyar boat safari slots 3–4 days ahead in season.',
    ],
    warningsAndAssumptions: [
      'All costs are estimates based on typical 2025 prices, not quotes.',
      'Drive times assume ~42 km/h average including traffic pads.',
      'Monsoon (Jun–Aug) can close some waterfall viewpoints.',
    ],
    freeDayIndexes: [0], premiumPriceInr: 199,
    subscriberCta: 'Full PDF + booking checklist + my exact homestay contacts.',
    publishedAt: T(5), views: 1284, copies: 96,
  },
  {
    id: 'goa-friends-long-weekend',
    tripId: goaTripId, creatorId: 'u_arjun',
    title: 'Goa Friends Long Weekend',
    tagline: 'Beaches, forts, flea markets and one very good Greek lunch.',
    routeSummary: ['Mumbai', 'Baga', 'Anjuna', 'Old Goa'],
    durationDays: 3, estimatedBudgetPerPersonInr: 14000, travelStyle: 'packed',
    bestSeason: 'Nov–Feb',
    travelTips: ['Leave Mumbai by 5 AM to beat the Lonavala crawl.', 'Thalassa needs reservations days ahead on weekends.'],
    warningsAndAssumptions: ['Costs assume 6 people sharing two cars.', 'Some shacks close mid-monsoon.'],
    freeDayIndexes: [0], premiumPriceInr: 149,
    subscriberCta: 'Full shack list + party calendar + driver contacts.',
    publishedAt: T(9), views: 2140, copies: 187,
  },
  {
    id: 'rajasthan-heritage-circuit',
    tripId: rajasthanTripId, creatorId: 'u_devika',
    title: 'Royal Rajasthan Heritage Circuit — Jaipur · Jodhpur · Udaipur',
    tagline: 'Forts at opening hour, stepwell sunsets and the stories between them.',
    routeSummary: ['Jaipur', 'Jodhpur', 'Ranakpur', 'Udaipur'],
    durationDays: 7, estimatedBudgetPerPersonInr: 48000, travelStyle: 'luxury',
    bestSeason: 'Oct–Feb',
    travelTips: [
      'Mehrangarh audio guide is worth every rupee.',
      'Ranakpur temple opens to visitors only after noon.',
      'Book Chowki Dhani VIP seating in peak season.',
    ],
    warningsAndAssumptions: ['Luxury pricing — heritage hotels vary wildly by season.', 'Distances use demo coordinates; verify ghat routes.'],
    freeDayIndexes: [0, 1], premiumPriceInr: 499,
    subscriberCta: 'Room-by-room hotel picks, guide contacts and my photo-spot map.',
    publishedAt: T(20), views: 5310, copies: 342,
  },
  {
    id: 'sikkim-adventure-week',
    tripId: 'trip_sikkim_ref', creatorId: 'u_devika',
    title: 'Sikkim Adventure Week',
    tagline: 'Gangtok, Nathula pass and Tsomgo lake — permits decoded.',
    routeSummary: ['Gangtok', 'Tsomgo Lake', 'Nathula', 'Pelling'],
    durationDays: 6, estimatedBudgetPerPersonInr: 31000, travelStyle: 'adventure',
    bestSeason: 'Mar–Jun, Oct–Nov',
    travelTips: ['Nathula permits need 24h advance processing.', 'Altitude: take the acclimatization day seriously.'],
    warningsAndAssumptions: ['High-altitude sections carry real weather risk — always confirm pass status locally.'],
    freeDayIndexes: [0], premiumPriceInr: 249,
    subscriberCta: 'Permit paperwork templates + verified stay list.',
    publishedAt: T(35), views: 1890, copies: 74,
  },
  {
    id: 'mumbai-weekend-sprint',
    tripId: 'trip_mumbai_ref', creatorId: 'u_arjun',
    title: 'Mumbai Weekend Sprint',
    tagline: 'Colaba to Bandra — street food, art deco and sea-link sunsets in 48 hours.',
    routeSummary: ['Colaba', 'Bandra', 'Juhu'],
    durationDays: 2, estimatedBudgetPerPersonInr: 7500, travelStyle: 'food-focused',
    bestSeason: 'All year (avoid monsoon high tide evenings)',
    travelTips: ['Use local trains between 11 AM–4 PM only.', 'Irani cafés close earlier than you think.'],
    warningsAndAssumptions: ['Food costs scale fast if you add fine dining.'],
    freeDayIndexes: [0, 1],
    publishedAt: T(12), views: 980, copies: 51,
  },
]

export const seedData = {
  trips, suggestions, decisions, activity: activityFeed, notifications: notificationsSeed, published: publishedItineraries,
}
