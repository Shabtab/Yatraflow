// ============ Seed data ============
// Comprehensive, current Indian demo content. New accounts get the demo trips
// reseeded into their own Supabase account via seedDemoFor() in src/store/store.ts.
// Covers every travel style and the collaboration / suggestions / decisions /
// publishing features so no page or tab is empty in the demo.
//
// Cover images: trips and published itineraries intentionally leave coverImageUrl
// unset. The UI auto-resolves a popular Wikipedia photo of the headline
// destination (see lib/tripThumb + components/CoverThumb), which is the product
// default. Owners can still override with their own image via the cover picker.
import type { Trip, PublishedItinerary, StopSuggestion, TripDecision, ActivityEntry, Notification, User } from './types'

export const uid = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`

// ---------------- Demo users (so collaborators & creators render) ----------------
// Stable ids keep suggestions/decisions/member references coherent across the
// seed. Passwords are handled by Supabase Auth and are NOT stored here.
export const DEMO_USER_IDS = {
  demo: 'u_demo', meera: 'u_meera', arjun: 'u_arjun', devika: 'u_devika',
} as const

const demoUsers: User[] = [
  { id: DEMO_USER_IDS.demo, email: 'demo@yatraflow.in', createdAt: Date.now() - 90 * 86400000,
    profile: { name: 'Demo Traveller', homeCity: 'Kochi, Kerala', languages: ['en', 'hi', 'ml'], travelStyles: ['balanced', 'food-focused'], isCreator: false } },
  { id: DEMO_USER_IDS.meera, email: 'meera@yatraflow.in', createdAt: Date.now() - 80 * 86400000,
    profile: { name: 'Meera Nair', homeCity: 'Bengaluru', languages: ['en', 'ml', 'ta'], travelStyles: ['relaxed', 'food-focused'], isCreator: false } },
  { id: DEMO_USER_IDS.arjun, email: 'arjun@yatraflow.in', createdAt: Date.now() - 70 * 86400000,
    profile: { name: 'Arjun Mehta', homeCity: 'Mumbai', languages: ['en', 'hi', 'mr'], travelStyles: ['adventure', 'budget'], isCreator: false } },
  { id: DEMO_USER_IDS.devika, email: 'devika@yatraflow.in', createdAt: Date.now() - 120 * 86400000,
    profile: { name: 'Devika Rathore', homeCity: 'Jaipur', languages: ['en', 'hi'], travelStyles: ['creator', 'luxury', 'spiritual'], isCreator: true,
      creatorBio: 'Heritage storyteller. I plan slow, deep India itineraries — forts, havelis, food lanes and the people in between.',
      socialLinks: { youtube: 'youtube.com/@DevikaRoams', instagram: 'instagram.com/devikaroams' } } },
]

// ---------------- Helpers ----------------
function T(daysAgo: number): number { return Date.now() - daysAgo * 86400000 }
function futureDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86400000)
  return d.toISOString().slice(0, 10)
}

// ============================================================================
// TRIPS — one per travel style (3 detailed flagship + 7 concise)
// ============================================================================

// ---------------- balanced — Kerala (flagship, detailed) ----------------
const keralaTripId = 'trip_kerala_demo'
const keralaTrip: Trip = {
  id: keralaTripId,
  name: 'Kerala Hills & Backwaters Road Trip',
  startLocation: 'Kochi',
  destinations: ['Munnar', 'Thekkady', 'Alleppey'],
  startDate: futureDate(14), endDate: futureDate(17),
  travellers: 4, transportMode: 'car', budgetPerPersonInr: 22000,
  travelStyle: 'balanced', coverEmoji: '🌴', visibility: 'private',
  createdAt: T(10), updatedAt: T(1),
  members: [
    { userId: DEMO_USER_IDS.demo, role: 'owner', joinedAt: T(10) },
    { userId: DEMO_USER_IDS.meera, role: 'editor', joinedAt: T(9) },
    { userId: DEMO_USER_IDS.arjun, role: 'commenter', joinedAt: T(8) },
  ],
  fixedCommitments: [
    { id: 'fc_1', title: 'Hotel check-in — Kochi', type: 'hotel-checkin', dayIndex: 0, time: '14:00', notes: 'Fort Kochi homestay' },
    { id: 'fc_2', title: 'Houseboat boarding — Alleppey', type: 'event', dayIndex: 3, time: '12:00', notes: 'Boarding gate closes 12:30 sharp' },
    { id: 'fc_3', title: 'Train departure — Ernakulam Jn', type: 'train-departure', dayIndex: 3, time: '19:45', notes: 'Vrinda Express' },
  ],
  days: [
    { id: 'day_k_1', index: 0, title: 'Kochi to Munnar — waterfalls en route', stops: [
      { id: 'st_k_cheeyappara', title: 'Cheeyappara Waterfalls', category: 'nature', locationName: 'Cheeyappara, Idukki', lat: 9.9917, lng: 76.7606, description: 'Seven-step waterfall right off the Kochi–Munnar highway. Roadside tea and pakodas.', visitMinutes: 40, openTime: '06:00', closeTime: '18:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'nice-to-have', notes: 'Can get crowded 11–2.', status: 'confirmed', orderInDay: 1 },
      { id: 'st_k_valara', title: 'Valara Waterfalls', category: 'nature', locationName: 'Valara, Idukki', lat: 10.0392, lng: 76.7853, description: 'Dense forest cascade 10 min above Cheeyappara.', visitMinutes: 25, openTime: '06:00', closeTime: '18:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'optional', status: 'maybe', orderInDay: 2 },
      { id: 'st_k_hotel_munnar', title: 'Check-in — Munnar hill resort', category: 'hotel', locationName: 'Munnar town', lat: 10.0889, lng: 77.0595, description: 'Tea-valley view rooms. Early dinner on terrace.', visitMinutes: 45, openTime: '13:00', closeTime: '23:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 3 },
      { id: 'st_k_blossom', title: 'Blossom International Park evening walk', category: 'nature', locationName: 'Munnar', lat: 10.0740, lng: 77.0298, description: 'Easy lakeside trail — good leg-stretch after the ghat drive.', visitMinutes: 60, openTime: '09:00', closeTime: '18:00', entryFeeInrPerPerson: 50, transportCostInrTotal: 200, priority: 'optional', weatherSensitive: true, status: 'suggested', orderInDay: 4 },
    ] },
    { id: 'day_k_2', index: 1, title: 'Munnar — tea estates & Top Station', stops: [
      { id: 'st_k_sunrise', title: 'Top Station sunrise viewpoint', category: 'sightseeing', locationName: 'Top Station, Munnar', lat: 10.1333, lng: 77.2167, description: 'Sunrise over the Tamil Nadu valley. Leave by 5 AM.', visitMinutes: 75, openTime: '05:00', closeTime: '18:00', entryFeeInrPerPerson: 20, transportCostInrTotal: 900, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
      { id: 'st_k_tea', title: 'KDHP Tea Museum', category: 'museum', locationName: 'Nullatanni, Munnar', lat: 10.0798, lng: 77.0600, description: 'History of tea in Munnar with a tasting session.', visitMinutes: 90, openTime: '09:00', closeTime: '16:00', entryFeeInrPerPerson: 150, transportCostInrTotal: 250, priority: 'nice-to-have', status: 'confirmed', orderInDay: 2 },
      { id: 'st_k_lunch', title: 'Lunch at Saravana Bhavan', category: 'food', locationName: 'Munnar town', lat: 10.0870, lng: 77.0585, description: 'Kerala meals on banana leaf.', visitMinutes: 60, openTime: '08:00', closeTime: '21:00', entryFeeInrPerPerson: 180, transportCostInrTotal: 100, priority: 'must-do', status: 'confirmed', orderInDay: 3 },
      { id: 'st_k_matupetty', title: 'Mattupetty Dam & lake', category: 'nature', locationName: 'Mattupetty', lat: 10.1060, lng: 77.1300, description: 'Pedal boating between tea slopes.', visitMinutes: 70, openTime: '09:30', closeTime: '17:00', entryFeeInrPerPerson: 30, transportCostInrTotal: 350, priority: 'nice-to-have', weatherSensitive: true, status: 'suggested', orderInDay: 4 },
      { id: 'st_k_echo', title: 'Echo Point', category: 'sightseeing', locationName: 'Munnar', lat: 10.1105, lng: 77.1408, description: 'Popular echo viewpoint; skip if short on time.', visitMinutes: 40, openTime: '07:00', closeTime: '18:00', entryFeeInrPerPerson: 20, transportCostInrTotal: 150, priority: 'optional', status: 'suggested', orderInDay: 5 },
      { id: 'st_k_kundala', title: 'Kundala Lake', category: 'nature', locationName: 'Kundala Valley', lat: 10.1210, lng: 77.1660, description: 'Arch dam lake with shikara rides.', visitMinutes: 55, openTime: '09:00', closeTime: '17:30', entryFeeInrPerPerson: 25, transportCostInrTotal: 150, priority: 'optional', weatherSensitive: true, status: 'maybe', orderInDay: 6 },
    ] },
    { id: 'day_k_3', index: 2, title: 'Munnar to Thekkady — spice country', stops: [
      { id: 'st_k_spice', title: 'Spice garden guided walk', category: 'nature', locationName: 'Kumily, Thekkady', lat: 9.5970, lng: 77.1620, description: 'Cardamom, pepper and vanilla estate tour.', visitMinutes: 80, openTime: '08:00', closeTime: '17:00', entryFeeInrPerPerson: 200, transportCostInrTotal: 300, priority: 'nice-to-have', status: 'confirmed', orderInDay: 1 },
      { id: 'st_k_permits', title: 'Periyar boat safari (book slots)', category: 'adventure', locationName: 'Periyar Tiger Reserve', lat: 9.4644, lng: 77.1570, description: '1.5h lake safari — elephant/gaur sightings possible. Needs booking.', visitMinutes: 120, openTime: '07:30', closeTime: '16:00', entryFeeInrPerPerson: 300, transportCostInrTotal: 400, priority: 'must-do', weatherSensitive: true, notes: 'Book upper-deck seats online.', status: 'needs-booking', orderInDay: 2 },
      { id: 'st_k_kathakali', title: 'Kathakali & Kalaripayattu show', category: 'event', locationName: 'Kumily junction', lat: 9.5960, lng: 77.1615, description: 'Evening cultural performance — makeup demo starts 30 min early.', visitMinutes: 90, openTime: '17:00', closeTime: '20:00', entryFeeInrPerPerson: 300, transportCostInrTotal: 150, priority: 'nice-to-have', status: 'confirmed', orderInDay: 3 },
    ] },
    { id: 'day_k_4', index: 3, title: 'Thekkady to Alleppey houseboat', stops: [
      { id: 'st_k_houseboat', title: 'Houseboat boarding & cruise', category: 'travel', locationName: 'Punnamada jetty, Alleppey', lat: 9.4981, lng: 76.3388, description: 'Overnight houseboat through Kuttanad paddy fields.', visitMinutes: 300, openTime: '11:30', closeTime: '17:30', entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      { id: 'st_k_dinner', title: 'Farewell Kerala sadya dinner', category: 'food', locationName: 'Onboard houseboat', lat: 9.4850, lng: 76.3400, description: 'Karimeen pollichathu onboard.', visitMinutes: 90, openTime: '19:00', closeTime: '22:00', entryFeeInrPerPerson: 450, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 2 },
    ] },
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

// ---------------- packed — Goa (flagship, detailed) ----------------
const goaTripId = 'trip_goa_demo'
const goaTrip: Trip = {
  id: goaTripId,
  name: 'Goa Long Weekend with the Gang',
  startLocation: 'Mumbai', destinations: ['North Goa', 'Old Goa'],
  startDate: futureDate(30), endDate: futureDate(32),
  travellers: 6, transportMode: 'car', budgetPerPersonInr: 14000,
  travelStyle: 'packed', coverEmoji: '🏖️', visibility: 'private',
  createdAt: T(6), updatedAt: T(2),
  members: [
    { userId: DEMO_USER_IDS.demo, role: 'owner', joinedAt: T(6) },
    { userId: DEMO_USER_IDS.arjun, role: 'editor', joinedAt: T(6) },
  ],
  fixedCommitments: [
    { id: 'fc_g1', title: 'Return drive deadline — Mumbai', type: 'other', dayIndex: 2, time: '16:00', notes: 'One of us has a Monday shift' },
  ],
  days: [
    { id: 'day_g_1', index: 0, title: 'Panjim arrival & North Goa beaches', stops: [
      { id: 'st_g_baga', title: 'Baga Beach sunset', category: 'beach', locationName: 'Baga', lat: 15.5555, lng: 73.7519, description: 'Shack hopping after sunset.', visitMinutes: 120, openTime: '06:00', closeTime: '22:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 600, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
      { id: 'st_g_cafe', title: 'Late lunch at Thalassa (booking needed)', category: 'food', locationName: 'Siolim', lat: 15.6180, lng: 73.7380, description: 'Greek cliffside views.', visitMinutes: 90, openTime: '12:00', closeTime: '23:00', entryFeeInrPerPerson: 800, transportCostInrTotal: 500, priority: 'nice-to-have', notes: 'Weekend queues — reserve.', status: 'needs-booking', orderInDay: 2 },
    ] },
    { id: 'day_g_2', index: 1, title: 'Forts, markets & Old Goa churches', stops: [
      { id: 'st_g_fort', title: 'Chapora Fort (Dil Chahta Hai fort)', category: 'sightseeing', locationName: 'Vagator', lat: 15.6060, lng: 73.7360, description: 'Morning light is best; climb before it gets hot.', visitMinutes: 60, openTime: '09:00', closeTime: '18:30', entryFeeInrPerPerson: 0, transportCostInrTotal: 400, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
      { id: 'st_g_market', title: 'Anjuna Flea Market', category: 'shopping', locationName: 'Anjuna', lat: 15.5760, lng: 73.7410, description: 'Wednesdays only — check the date!', visitMinutes: 90, openTime: '08:00', closeTime: '18:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 300, priority: 'optional', status: 'suggested', orderInDay: 2 },
      { id: 'st_g_basilica', title: 'Basilica of Bom Jesus', category: 'temple', locationName: 'Old Goa', lat: 15.5009, lng: 73.9116, description: 'UNESCO baroque church; St Francis Xavier relics.', visitMinutes: 60, openTime: '09:00', closeTime: '18:30', entryFeeInrPerPerson: 0, transportCostInrTotal: 700, priority: 'must-do', status: 'confirmed', orderInDay: 3 },
      { id: 'st_g_river', title: 'Mandovi river cruise', category: 'event', locationName: 'Panjim jetty', lat: 15.4989, lng: 73.8278, description: 'Live music cruise at sunset.', visitMinutes: 90, openTime: '16:00', closeTime: '19:45', entryFeeInrPerPerson: 500, transportCostInrTotal: 300, priority: 'nice-to-have', status: 'suggested', orderInDay: 4 },
    ] },
    { id: 'day_g_3', index: 2, title: 'Slow morning & drive back', stops: [
      { id: 'st_g_brunch', title: 'Beach brunch at Curlies', category: 'food', locationName: 'Anjuna', lat: 15.5740, lng: 73.7390, description: 'Final swim + breakfast.', visitMinutes: 105, openTime: '08:00', closeTime: '21:00', entryFeeInrPerPerson: 550, transportCostInrTotal: 250, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
    ] },
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

// ---------------- luxury — Rajasthan (flagship, detailed) ----------------
const rajasthanTripId = 'trip_rajasthan_creator'
const rajasthanTrip: Trip = {
  id: rajasthanTripId,
  name: 'Royal Rajasthan Heritage Circuit',
  startLocation: 'Jaipur', destinations: ['Jaipur', 'Jodhpur', 'Udaipur'],
  startDate: futureDate(45), endDate: futureDate(51),
  travellers: 2, transportMode: 'car', budgetPerPersonInr: 48000,
  travelStyle: 'luxury', coverEmoji: '🏰', visibility: 'public',
  createdAt: T(60), updatedAt: T(3),
  members: [
    { userId: DEMO_USER_IDS.devika, role: 'owner', joinedAt: T(60) },
    { userId: DEMO_USER_IDS.demo, role: 'editor', joinedAt: T(58) },
  ],
  fixedCommitments: [
    { id: 'fc_r1', title: 'Haveli check-in — Jaipur', type: 'hotel-checkin', dayIndex: 0, time: '15:00' },
  ],
  days: [
    { id: 'day_r_1', index: 0, title: 'Pink City icons', stops: [
      { id: 'st_r_amer', title: 'Amer Fort at opening hour', category: 'temple', locationName: 'Amer', lat: 26.9855, lng: 75.8513, description: 'Beat the crowds; mirror palace in soft light.', visitMinutes: 150, openTime: '08:00', closeTime: '17:30', entryFeeInrPerPerson: 200, transportCostInrTotal: 500, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      { id: 'st_r_hawamahal', title: 'Hawa Mahal photo walk', category: 'sightseeing', locationName: 'Jaipur old city', lat: 26.9239, lng: 75.8267, description: 'Wind Palace facade from Wind View Café across the street.', visitMinutes: 60, openTime: '09:00', closeTime: '16:30', entryFeeInrPerPerson: 50, transportCostInrTotal: 200, priority: 'nice-to-have', status: 'confirmed', orderInDay: 2 },
      { id: 'st_r_chowki', title: 'Chowki Dhani village evening', category: 'event', locationName: 'Tonk Road outskirts', lat: 26.7590, lng: 75.8080, description: 'Folk dances, Rajasthani thali.', visitMinutes: 180, openTime: '17:30', closeTime: '23:00', entryFeeInrPerPerson: 900, transportCostInrTotal: 800, priority: 'nice-to-have', status: 'confirmed', orderInDay: 3 },
    ] },
    { id: 'day_r_2', index: 1, title: 'Jaipur → Jodhpur', stops: [
      { id: 'st_r_mehrangarh', title: 'Mehrangarh Fort', category: 'temple', locationName: 'Jodhpur', lat: 26.2967, lng: 73.0351, description: 'Rampart views over the blue city.', visitMinutes: 150, openTime: '09:00', closeTime: '17:00', entryFeeInrPerPerson: 200, transportCostInrTotal: 400, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      { id: 'st_r_toorji', title: 'Toorji ka Jhalra stepwell café hop', category: 'food', locationName: 'Old Jodhpur', lat: 26.2935, lng: 73.0270, description: 'Stepwell sunset + rooftop dinner.', visitMinutes: 90, openTime: '08:00', closeTime: '22:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 150, priority: 'nice-to-have', status: 'suggested', orderInDay: 2 },
    ] },
    { id: 'day_r_3', index: 2, title: 'Jodhpur → Udaipur via Ranakpur', stops: [
      { id: 'st_r_ranakpur', title: 'Ranakpur Jain Temple', category: 'temple', locationName: 'Ranakpur', lat: 25.1170, lng: 73.4410, description: '1,444 marble pillars — none identical.', visitMinutes: 90, openTime: '12:00', closeTime: '17:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 300, notes: 'Opens to non-Jain visitors at noon.', priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      { id: 'st_r_citypalace', title: 'City Palace Udaipur sunset', category: 'museum', locationName: 'Udaipur', lat: 24.5764, lng: 73.6835, description: 'Lake Pichola from the upper courtyards.', visitMinutes: 120, openTime: '09:30', closeTime: '19:30', entryFeeInrPerPerson: 300, transportCostInrTotal: 250, priority: 'must-do', status: 'confirmed', orderInDay: 2 },
    ] },
  ],
  expenses: [
    { id: 'exr_1', label: 'Chauffeur-driven sedan (7 days)', category: 'transport', amountInr: 28000, optional: false },
    { id: 'exr_2', label: 'Heritage hotels (6 nights)', category: 'accommodation', amountInr: 96000, optional: false },
    { id: 'exr_3', label: 'Fine dining & thalis', category: 'food', amountInr: 2200, perPerson: true, optional: false },
    { id: 'exr_4', label: 'Private guides (3 cities)', category: 'activities', amountInr: 9000, optional: false },
    { id: 'exr_5', label: 'Shopping allowance', category: 'activities', amountInr: 12000, optional: true },
  ],
}

// ---------------- adventure — Sikkim (concise) ----------------
const sikkimTripId = 'trip_sikkim_demo'
const sikkimTrip: Trip = {
  id: sikkimTripId,
  name: 'Sikkim Adventure Week',
  startLocation: 'Bagdogra', destinations: ['Gangtok', 'Tsomgo Lake', 'Pelling'],
  startDate: futureDate(55), endDate: futureDate(60),
  travellers: 3, transportMode: 'car', budgetPerPersonInr: 31000,
  travelStyle: 'adventure', coverEmoji: '🏔️', visibility: 'private',
  createdAt: T(40), updatedAt: T(5),
  members: [
    { userId: DEMO_USER_IDS.arjun, role: 'owner', joinedAt: T(40) },
    { userId: DEMO_USER_IDS.devika, role: 'commenter', joinedAt: T(38) },
  ],
  fixedCommitments: [
    { id: 'fc_s1', title: 'Nathula permit submission', type: 'other', dayIndex: 1, time: '10:00', notes: 'Needs passport details 24h ahead' },
  ],
  days: [
    { id: 'day_s_1', index: 0, title: 'Bagdogra → Gangtok', stops: [
      { id: 'st_s_rumtek', title: 'Rumtek Monastery', category: 'temple', locationName: 'Gangtok', lat: 27.2920, lng: 88.6130, description: 'One of Sikkim’s largest monasteries.', visitMinutes: 90, openTime: '06:00', closeTime: '18:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 400, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      { id: 'st_s_mg', title: 'MG Marg evening stroll', category: 'food', locationName: 'Gangtok', lat: 27.3314, lng: 88.6138, description: 'Vehicle-free promenade, momos and cafés.', visitMinutes: 75, openTime: '08:00', closeTime: '22:00', entryFeeInrPerPerson: 300, transportCostInrTotal: 100, priority: 'nice-to-have', status: 'suggested', orderInDay: 2 },
    ] },
    { id: 'day_s_2', index: 1, title: 'Tsomgo Lake & Nathula', stops: [
      { id: 'st_s_tsomgo', title: 'Tsomgo (Changu) Lake', category: 'nature', locationName: 'Tsomgo', lat: 27.6765, lng: 88.7660, description: 'Glacial lake at 3,753m. Yak rides at the shore.', visitMinutes: 120, openTime: '07:00', closeTime: '15:00', entryFeeInrPerPerson: 200, transportCostInrTotal: 1500, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
      { id: 'st_s_nathula', title: 'Nathula Pass (border viewpoint)', category: 'adventure', locationName: 'Nathula', lat: 27.6870, lng: 88.8530, description: 'Indo-China border at 4,310m. Permit mandatory.', visitMinutes: 90, openTime: '08:00', closeTime: '14:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 1500, priority: 'must-do', weatherSensitive: true, notes: 'Closes in heavy snow.', status: 'needs-booking', orderInDay: 2 },
    ] },
    { id: 'day_s_3', index: 2, title: 'Gangtok → Pelling via Ravangla', stops: [
      { id: 'st_s_buddha', title: 'Buddha Park, Ravangla', category: 'sightseeing', locationName: 'Ravangla', lat: 27.2910, lng: 88.3540, description: '95-ft statue of Padmasambhava with Himalayan views.', visitMinutes: 70, openTime: '08:00', closeTime: '18:00', entryFeeInrPerPerson: 50, transportCostInrTotal: 300, priority: 'nice-to-have', status: 'suggested', orderInDay: 1 },
    ] },
  ],
  expenses: [
    { id: 'exs_1', label: 'Shared cab (5 days)', category: 'transport', amountInr: 18000, optional: false },
    { id: 'exs_2', label: 'Homestays (5 nights)', category: 'accommodation', amountInr: 15000, optional: false },
    { id: 'exs_3', label: 'Permits & entry fees', category: 'activities', amountInr: 1200, perPerson: true, optional: false },
    { id: 'exs_4', label: 'Food (per person)', category: 'food', amountInr: 3500, perPerson: true, optional: false },
  ],
}

// ---------------- budget — Spiti (concise) ----------------
const spitiTripId = 'trip_spiti_demo'
const spitiTrip: Trip = {
  id: spitiTripId,
  name: 'Spiti Valley on a Shoestring',
  startLocation: 'Chandigarh', destinations: ['Kaza', 'Key Monastery', 'Chandratal'],
  startDate: futureDate(70), endDate: futureDate(76),
  travellers: 4, transportMode: 'car', budgetPerPersonInr: 16000,
  travelStyle: 'budget', coverEmoji: '🚌', visibility: 'private',
  createdAt: T(33), updatedAt: T(4),
  members: [{ userId: DEMO_USER_IDS.demo, role: 'owner', joinedAt: T(33) }],
  fixedCommitments: [
    { id: 'fc_sp1', title: 'Shared tempo traveller pickup', type: 'other', dayIndex: 0, time: '06:30', notes: 'Chandigarh sector 43' },
  ],
  days: [
    { id: 'day_sp_1', index: 0, title: 'Chandigarh → Narkanda', stops: [
      { id: 'st_sp_hatu', title: 'Hatu Peak viewpoint', category: 'nature', locationName: 'Narkanda', lat: 31.2660, lng: 77.4740, description: 'First high-altitude pine forest stop.', visitMinutes: 60, openTime: '06:00', closeTime: '18:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 200, priority: 'nice-to-have', status: 'confirmed', orderInDay: 1 },
    ] },
    { id: 'day_sp_2', index: 1, title: 'Narkanda → Kaza (the big drive)', stops: [
      { id: 'st_sp_kunzum', title: 'Kunzum La (4,551m)', category: 'adventure', locationName: 'Kunzum Pass', lat: 32.3980, lng: 77.6250, description: 'Gateway to Spiti. Pray at the goddess shrine.', visitMinutes: 45, openTime: '07:00', closeTime: '17:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
    ] },
    { id: 'day_sp_3', index: 2, title: 'Key, Kibber & the high villages', stops: [
      { id: 'st_sp_key', title: 'Key Monastery', category: 'temple', locationName: 'Key', lat: 32.2830, lng: 77.7700, description: '1000-year-old hilltop monastery.', visitMinutes: 90, openTime: '06:00', closeTime: '18:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 200, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      { id: 'st_sp_chandratal', title: 'Chandratal Lake camp', category: 'nature', locationName: 'Chandratal', lat: 32.4780, lng: 77.6170, description: 'Crescent lake at 4,300m. Stargazing.', visitMinutes: 120, openTime: '08:00', closeTime: '19:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 300, priority: 'must-do', weatherSensitive: true, status: 'suggested', orderInDay: 2 },
    ] },
  ],
  expenses: [
    { id: 'exsp_1', label: 'Tempo traveller share', category: 'transport', amountInr: 7000, perPerson: true, optional: false },
    { id: 'exsp_2', label: 'Homestays (6 nights)', category: 'accommodation', amountInr: 7200, optional: false },
    { id: 'exsp_3', label: 'Food (per person)', category: 'food', amountInr: 4200, perPerson: true, optional: false },
    { id: 'exsp_4', label: 'Permits & camping', category: 'activities', amountInr: 2500, optional: true },
  ],
}

// ---------------- spiritual — Varanasi & Rishikesh (concise) ----------------
const spiritualTripId = 'trip_spiritual_demo'
const spiritualTrip: Trip = {
  id: spiritualTripId,
  name: 'Ganga & Ghats — Varanasi to Rishikesh',
  startLocation: 'Varanasi', destinations: ['Varanasi', 'Rishikesh', 'Haridwar'],
  startDate: futureDate(20), endDate: futureDate(24),
  travellers: 2, transportMode: 'train', budgetPerPersonInr: 12000,
  travelStyle: 'spiritual', coverEmoji: '🛕', visibility: 'private',
  createdAt: T(25), updatedAt: T(2),
  members: [
    { userId: DEMO_USER_IDS.devika, role: 'owner', joinedAt: T(25) },
    { userId: DEMO_USER_IDS.meera, role: 'viewer', joinedAt: T(24) },
  ],
  fixedCommitments: [
    { id: 'fc_sp2', title: 'Ganga aarti — Dashashwamedh Ghat', type: 'event', dayIndex: 0, time: '18:30', notes: 'Arrive 30 min early for a spot' },
  ],
  days: [
    { id: 'day_spi_1', index: 0, title: 'Varanasi ghats & aarti', stops: [
      { id: 'st_spi_dash', title: 'Dashashwamedh Ghat aarti', category: 'event', locationName: 'Varanasi', lat: 25.3090, lng: 83.0110, description: 'Nightly fire ritual on the Ganga.', visitMinutes: 75, openTime: '18:30', closeTime: '20:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      { id: 'st_spi_assi', title: 'Assi Ghat morning yoga', category: 'event', locationName: 'Varanasi', lat: 25.2840, lng: 83.0030, description: 'Sunrise riverside practice.', visitMinutes: 60, openTime: '05:30', closeTime: '08:00', entryFeeInrPerPerson: 200, transportCostInrTotal: 0, priority: 'nice-to-have', status: 'suggested', orderInDay: 2 },
    ] },
    { id: 'day_spi_2', index: 1, title: 'Varanasi → Rishikesh (overnight train)', stops: [
      { id: 'st_spi_sarnath', title: 'Sarnath stupa', category: 'temple', locationName: 'Sarnath', lat: 25.3750, lng: 83.0250, description: 'Where the Buddha gave his first sermon.', visitMinutes: 90, openTime: '06:00', closeTime: '18:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 300, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
    ] },
    { id: 'day_spi_3', index: 2, title: 'Rishikesh & Haridwar', stops: [
      { id: 'st_spi_laxman', title: 'Laxman Jhula & Beatles Ashram', category: 'sightseeing', locationName: 'Rishikesh', lat: 30.0900, lng: 78.3180, description: 'Suspension bridge and the abandoned ashram graffiti.', visitMinutes: 100, openTime: '06:00', closeTime: '18:00', entryFeeInrPerPerson: 150, transportCostInrTotal: 100, priority: 'nice-to-have', status: 'suggested', orderInDay: 1 },
      { id: 'st_spi_haridwar', title: 'Haridwar Ganga aarti', category: 'event', locationName: 'Haridwar', lat: 29.9460, lng: 78.1640, description: 'Mass aarti at Har Ki Pauri.', visitMinutes: 75, openTime: '18:00', closeTime: '19:30', entryFeeInrPerPerson: 0, transportCostInrTotal: 200, priority: 'must-do', status: 'confirmed', orderInDay: 2 },
    ] },
  ],
  expenses: [
    { id: 'exspi_1', label: 'Sleeper train (both ways)', category: 'transport', amountInr: 2400, optional: false },
    { id: 'exspi_2', label: 'Hotels (4 nights)', category: 'accommodation', amountInr: 6400, optional: false },
    { id: 'exspi_3', label: 'Puja & boat rides', category: 'activities', amountInr: 1500, perPerson: true, optional: false },
    { id: 'exspi_4', label: 'Food (per person)', category: 'food', amountInr: 1700, perPerson: true, optional: false },
  ],
}

// ---------------- food-focused — Mumbai (concise) ----------------
const mumbaiTripId = 'trip_mumbai_demo'
const mumbaiTrip: Trip = {
  id: mumbaiTripId,
  name: 'Mumbai Weekend Food Sprint',
  startLocation: 'Mumbai', destinations: ['Colaba', 'Bandra', 'Juhu'],
  startDate: futureDate(8), endDate: futureDate(9),
  travellers: 2, transportMode: 'car', budgetPerPersonInr: 7500,
  travelStyle: 'food-focused', coverEmoji: '🍲', visibility: 'private',
  createdAt: T(7), updatedAt: T(1),
  members: [{ userId: DEMO_USER_IDS.arjun, role: 'owner', joinedAt: T(7) }],
  fixedCommitments: [
    { id: 'fc_m1', title: 'Britannia & Co lunch reservation', type: 'other', dayIndex: 0, time: '12:30', notes: 'Berry pulao sells out' },
  ],
  days: [
    { id: 'day_m_1', index: 0, title: 'Colaba & South Mumbai', stops: [
      { id: 'st_m_britannia', title: 'Britannia & Co.', category: 'food', locationName: 'Ballard Estate', lat: 18.9350, lng: 72.8350, description: 'Parsi berry pulao & caramel custard since 1923.', visitMinutes: 90, openTime: '11:30', closeTime: '16:00', entryFeeInrPerPerson: 700, transportCostInrTotal: 150, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      { id: 'st_m_khedgulee', title: 'Kheema pav at Olympia', category: 'food', locationName: 'Colaba', lat: 18.9210, lng: 72.8330, description: 'Late-night Irani café classic.', visitMinutes: 60, openTime: '07:00', closeTime: '23:30', entryFeeInrPerPerson: 350, transportCostInrTotal: 100, priority: 'nice-to-have', status: 'suggested', orderInDay: 2 },
    ] },
    { id: 'day_m_2', index: 1, title: 'Bandra & Juhu', stops: [
      { id: 'st_m_elco', title: 'Elco Market chaat', category: 'food', locationName: 'Bandra', lat: 19.0600, lng: 72.8350, description: 'Famous pani puri & sev puri.', visitMinutes: 50, openTime: '11:00', closeTime: '23:00', entryFeeInrPerPerson: 250, transportCostInrTotal: 100, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      { id: 'st_m_juhu', title: 'Juhu Beach street food', category: 'food', locationName: 'Juhu', lat: 19.0890, lng: 72.8260, description: 'Bhel, pav bhaji and roasted corn by the sea.', visitMinutes: 70, openTime: '17:00', closeTime: '23:00', entryFeeInrPerPerson: 300, transportCostInrTotal: 200, priority: 'nice-to-have', weatherSensitive: true, status: 'suggested', orderInDay: 2 },
    ] },
  ],
  expenses: [
    { id: 'exm_1', label: 'Cab (2 days)', category: 'transport', amountInr: 1800, optional: false },
    { id: 'exm_2', label: 'Hotel (1 night)', category: 'accommodation', amountInr: 4000, optional: false },
    { id: 'exm_3', label: 'Food crawl (per person)', category: 'food', amountInr: 2200, perPerson: true, optional: false },
  ],
}

// ---------------- family — Delhi–Agra–Jaipur (concise) ----------------
const familyTripId = 'trip_family_demo'
const familyTrip: Trip = {
  id: familyTripId,
  name: 'Golden Triangle with the Kids',
  startLocation: 'Delhi', destinations: ['Agra', 'Jaipur'],
  startDate: futureDate(36), endDate: futureDate(40),
  travellers: 5, transportMode: 'car', budgetPerPersonInr: 18000,
  travelStyle: 'family', coverEmoji: '👨‍👩‍👧‍👦', visibility: 'private',
  createdAt: T(28), updatedAt: T(3),
  members: [
    { userId: DEMO_USER_IDS.meera, role: 'owner', joinedAt: T(28) },
    { userId: DEMO_USER_IDS.demo, role: 'editor', joinedAt: T(27) },
  ],
  fixedCommitments: [
    { id: 'fc_f1', title: 'Taj Mahal skip-the-line tickets', type: 'other', dayIndex: 1, time: '07:00', notes: 'Book online, sunrise slot' },
  ],
  days: [
    { id: 'day_f_1', index: 0, title: 'Delhi icons', stops: [
      { id: 'st_f_red', title: 'Red Fort', category: 'sightseeing', locationName: 'Old Delhi', lat: 28.6560, lng: 77.2410, description: 'Mughal citadel with sound-and-light show.', visitMinutes: 120, openTime: '09:30', closeTime: '16:30', entryFeeInrPerPerson: 100, transportCostInrTotal: 300, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
      { id: 'st_f_rail', title: 'National Rail Museum', category: 'museum', locationName: 'Chanakyapuri', lat: 28.5840, lng: 77.1880, description: 'Toy-train ride the kids will love.', visitMinutes: 90, openTime: '10:00', closeTime: '17:00', entryFeeInrPerPerson: 100, transportCostInrTotal: 200, priority: 'nice-to-have', status: 'suggested', orderInDay: 2 },
    ] },
    { id: 'day_f_2', index: 1, title: 'Agra — Taj at sunrise', stops: [
      { id: 'st_f_taj', title: 'Taj Mahal', category: 'sightseeing', locationName: 'Agra', lat: 27.1750, lng: 78.0420, description: 'Arrive at first light to beat heat and crowds.', visitMinutes: 150, openTime: '06:00', closeTime: '18:30', entryFeeInrPerPerson: 200, transportCostInrTotal: 600, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
      { id: 'st_f_fatehpur', title: 'Fatehpur Sikri', category: 'sightseeing', locationName: 'Fatehpur Sikri', lat: 27.0940, lng: 77.6760, description: 'Abandoned Mughal capital, en route to Jaipur.', visitMinutes: 90, openTime: '07:00', closeTime: '18:00', entryFeeInrPerPerson: 100, transportCostInrTotal: 300, priority: 'optional', status: 'suggested', orderInDay: 2 },
    ] },
    { id: 'day_f_3', index: 2, title: 'Jaipur for families', stops: [
      { id: 'st_f_jantar', title: 'Jantar Mantar', category: 'museum', locationName: 'Jaipur', lat: 26.9247, lng: 75.8243, description: 'Giant sundials — surprisingly fun for kids.', visitMinutes: 75, openTime: '09:00', closeTime: '16:30', entryFeeInrPerPerson: 50, transportCostInrTotal: 250, priority: 'nice-to-have', status: 'suggested', orderInDay: 1 },
      { id: 'st_f_zoo', title: 'Jaipur Zoo & Central Park', category: 'nature', locationName: 'Jaipur', lat: 26.8930, lng: 75.8150, description: 'Easy evening wind-down.', visitMinutes: 80, openTime: '08:30', closeTime: '17:30', entryFeeInrPerPerson: 50, transportCostInrTotal: 150, priority: 'optional', status: 'maybe', orderInDay: 2 },
    ] },
  ],
  expenses: [
    { id: 'exf_1', label: 'Innova self-drive (5 days)', category: 'transport', amountInr: 22000, optional: false },
    { id: 'exf_2', label: 'Family hotels (4 nights)', category: 'accommodation', amountInr: 24000, optional: false },
    { id: 'exf_3', label: 'Tickets & guides', category: 'activities', amountInr: 3200, perPerson: true, optional: false },
    { id: 'exf_4', label: 'Food (per person)', category: 'food', amountInr: 3500, perPerson: true, optional: false },
  ],
}

// ---------------- relaxed — Andaman (concise) ----------------
const andamanTripId = 'trip_andaman_demo'
const andamanTrip: Trip = {
  id: andamanTripId,
  name: 'Andaman Slow Island Days',
  startLocation: 'Port Blair', destinations: ['Havelock', 'Neil Island'],
  startDate: futureDate(48), endDate: futureDate(53),
  travellers: 2, transportMode: 'mixed', budgetPerPersonInr: 28000,
  travelStyle: 'relaxed', coverEmoji: '🌴', visibility: 'private',
  createdAt: T(22), updatedAt: T(2),
  members: [{ userId: DEMO_USER_IDS.demo, role: 'owner', joinedAt: T(22) }],
  fixedCommitments: [
    { id: 'fc_a1', title: 'Makruzz ferry — Port Blair → Havelock', type: 'other', dayIndex: 0, time: '09:00', notes: 'Web check-in opens 48h prior' },
  ],
  days: [
    { id: 'day_a_1', index: 0, title: 'Havelock — Radhanagar', stops: [
      { id: 'st_a_radha', title: 'Radhanagar Beach', category: 'beach', locationName: 'Havelock', lat: 11.9440, lng: 92.5730, description: 'Sunset beach rated among Asia’s best.', visitMinutes: 150, openTime: '06:00', closeTime: '18:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 200, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
    ] },
    { id: 'day_a_2', index: 1, title: 'Elephant Beach & snorkel', stops: [
      { id: 'st_a_elephant', title: 'Elephant Beach snorkel', category: 'adventure', locationName: 'Havelock', lat: 11.9600, lng: 92.5900, description: 'Reef shallows, beginner-friendly.', visitMinutes: 150, openTime: '08:00', closeTime: '16:00', entryFeeInrPerPerson: 1000, transportCostInrTotal: 800, priority: 'nice-to-have', weatherSensitive: true, status: 'suggested', orderInDay: 1 },
    ] },
    { id: 'day_a_3', index: 2, title: 'Neil Island hop', stops: [
      { id: 'st_a_neil', title: 'Natural Bridge, Neil Island', category: 'nature', locationName: 'Neil Island', lat: 11.8400, lng: 92.7000, description: 'Coral arch shaped by the tide.', visitMinutes: 90, openTime: '07:00', closeTime: '17:00', entryFeeInrPerPerson: 0, transportCostInrTotal: 300, priority: 'must-do', weatherSensitive: true, status: 'confirmed', orderInDay: 1 },
    ] },
  ],
  expenses: [
    { id: 'exa_1', label: 'Ferries (3 legs)', category: 'transport', amountInr: 6000, optional: false },
    { id: 'exa_2', label: 'Resorts (5 nights)', category: 'accommodation', amountInr: 30000, optional: false },
    { id: 'exa_3', label: 'Scuba & snorkel', category: 'activities', amountInr: 4000, optional: true },
    { id: 'exa_4', label: 'Food (per person)', category: 'food', amountInr: 5000, perPerson: true, optional: false },
  ],
}

// ---------------- creator — Curated India Highlights (concise) ----------------
const creatorTripId = 'trip_creator_demo'
const creatorTrip: Trip = {
  id: creatorTripId,
  name: 'Devika’s India Highlights — 10 Days, 4 Cities',
  startLocation: 'Delhi', destinations: ['Agra', 'Jaipur', 'Udaipur'],
  startDate: futureDate(80), endDate: futureDate(89),
  travellers: 2, transportMode: 'car', budgetPerPersonInr: 52000,
  travelStyle: 'creator', coverEmoji: '✨', visibility: 'public',
  createdAt: T(50), updatedAt: T(4),
  members: [
    { userId: DEMO_USER_IDS.devika, role: 'owner', joinedAt: T(50) },
  ],
  fixedCommitments: [
    { id: 'fc_c1', title: 'Creator meet-up — Udaipur', type: 'event', dayIndex: 8, time: '19:00', notes: 'Follower meet & greet' },
  ],
  days: [
    { id: 'day_c_1', index: 0, title: 'Delhi intro', stops: [
      { id: 'st_c_qutub', title: 'Qutub Minar', category: 'sightseeing', locationName: 'Mehrauli, Delhi', lat: 28.5240, lng: 77.1850, description: 'Tallest brick minaret in the world.', visitMinutes: 80, openTime: '07:00', closeTime: '17:00', entryFeeInrPerPerson: 100, transportCostInrTotal: 300, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
    ] },
    { id: 'day_c_2', index: 1, title: 'Agra', stops: [
      { id: 'st_c_taj', title: 'Taj Mahal', category: 'sightseeing', locationName: 'Agra', lat: 27.1750, lng: 78.0420, description: 'The hero shot, golden hour.', visitMinutes: 150, openTime: '06:00', closeTime: '18:30', entryFeeInrPerPerson: 200, transportCostInrTotal: 600, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
    ] },
    { id: 'day_c_3', index: 2, title: 'Jaipur', stops: [
      { id: 'st_c_city', title: 'City Palace Jaipur', category: 'museum', locationName: 'Jaipur', lat: 26.9255, lng: 75.8236, description: 'Still-home to the royal family.', visitMinutes: 110, openTime: '09:30', closeTime: '17:00', entryFeeInrPerPerson: 200, transportCostInrTotal: 250, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
    ] },
    { id: 'day_c_4', index: 3, title: 'Udaipur', stops: [
      { id: 'st_c_lake', title: 'Lake Pichola boat ride', category: 'nature', locationName: 'Udaipur', lat: 24.5770, lng: 73.6820, description: 'Sunset from the water, palaces on both shores.', visitMinutes: 90, openTime: '10:00', closeTime: '18:00', entryFeeInrPerPerson: 400, transportCostInrTotal: 300, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
    ] },
  ],
  expenses: [
    { id: 'exc_1', label: 'Private car + driver (10 days)', category: 'transport', amountInr: 42000, optional: false },
    { id: 'exc_2', label: 'Boutique hotels (9 nights)', category: 'accommodation', amountInr: 99000, optional: false },
    { id: 'exc_3', label: 'Guides & experiences', category: 'activities', amountInr: 9000, optional: false },
    { id: 'exc_4', label: 'Food (per person)', category: 'food', amountInr: 6000, perPerson: true, optional: false },
  ],
}

const trips = [keralaTrip, goaTrip, rajasthanTrip, sikkimTrip, spitiTrip, spiritualTrip, mumbaiTrip, familyTrip, andamanTrip, creatorTrip]

// ============================================================================
// SUGGESTIONS / DECISIONS / ACTIVITY / NOTIFICATIONS (tied to flagship trips)
// ============================================================================

const suggestions: StopSuggestion[] = [
  {
    id: 'sg_1', tripId: keralaTripId, dayIndex: 1, proposedBy: DEMO_USER_IDS.meera, title: 'Pothamedu viewpoint sunset',
    category: 'sightseeing', locationName: 'Pothamedu, Munnar', lat: 10.0680, lng: 77.0480,
    description: 'Quiet viewpoint over the tea valleys — better than Echo Point honestly.',
    visitMinutes: 45, estimatedEntryFeeInr: 0, estimatedTransportInr: 250,
    votes: [{ userId: DEMO_USER_IDS.meera, value: 1, createdAt: T(2) }, { userId: DEMO_USER_IDS.arjun, value: 1, createdAt: T(1) }],
    comments: [{ id: 'cm_1', authorId: DEMO_USER_IDS.arjun, text: 'Yes! Echo Point was a letdown last time.', createdAt: T(1) }],
    status: 'open', createdAt: T(2),
  },
  {
    id: 'sg_2', tripId: keralaTripId, dayIndex: 2, proposedBy: DEMO_USER_IDS.arjun, title: 'Elephant junction bath experience',
    category: 'adventure', locationName: 'Kumily', lat: 9.5870, lng: 77.1550,
    description: 'Ethical elephant bathing session, 45 min. Kids would love it.',
    visitMinutes: 60, estimatedEntryFeeInr: 700, estimatedTransportInr: 300,
    votes: [{ userId: DEMO_USER_IDS.arjun, value: 1, createdAt: T(1) }, { userId: DEMO_USER_IDS.meera, value: -1, createdAt: T(1) }],
    comments: [{ id: 'cm_2', authorId: DEMO_USER_IDS.meera, text: 'I read mixed reviews about this place — can we check an ethical operator?', createdAt: T(1) }],
    status: 'open', createdAt: T(1),
  },
  {
    id: 'sg_3', tripId: goaTripId, dayIndex: 1, proposedBy: DEMO_USER_IDS.arjun, title: 'Sunset dolphin boat trip — Sinquerim',
    category: 'adventure', locationName: 'Sinquerim, Goa', lat: 15.5090, lng: 73.7770,
    description: 'Early-morning dolphin spotting before the beaches get busy.',
    visitMinutes: 90, estimatedEntryFeeInr: 500, estimatedTransportInr: 200,
    votes: [{ userId: DEMO_USER_IDS.demo, value: 1, createdAt: T(1) }],
    comments: [], status: 'open', createdAt: T(1),
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
    votesByUserId: { [DEMO_USER_IDS.meera]: 'o_1', [DEMO_USER_IDS.arjun]: 'o_3' },
    status: 'open', raisedBy: DEMO_USER_IDS.demo, createdAt: T(2),
  },
  {
    id: 'dc_2', tripId: keralaTripId,
    question: 'Vegetarian-only houseboat menu or mixed?',
    options: [
      { id: 'o_4', label: 'Pure veg sadya' },
      { id: 'o_5', label: 'Mixed — include karimeen', costImpactInr: 900 },
    ],
    votesByUserId: {},
    status: 'open', raisedBy: DEMO_USER_IDS.meera, createdAt: T(1),
  },
  {
    id: 'dc_3', tripId: goaTripId,
    question: 'Stay in Anjuna or split between Anjuna & Palolem?',
    context: 'Palolem is quieter but adds a 3h south drive.',
    options: [
      { id: 'o_6', label: 'All in Anjuna (less driving)' },
      { id: 'o_7', label: 'Split — 1 night Palolem', costImpactInr: 2500, timeImpactMin: -180 },
    ],
    votesByUserId: { [DEMO_USER_IDS.arjun]: 'o_6' },
    status: 'open', raisedBy: DEMO_USER_IDS.demo, createdAt: T(2),
  },
]

const activityFeed: ActivityEntry[] = [
  { id: 'af_1', tripId: keralaTripId, actorId: DEMO_USER_IDS.meera, verb: 'suggested “Pothamedu viewpoint sunset”', target: 'Day 2', at: T(2) },
  { id: 'af_2', tripId: keralaTripId, actorId: DEMO_USER_IDS.arjun, verb: 'voted on “Pothamedu viewpoint sunset”', target: 'Suggestion', at: T(1) },
  { id: 'af_3', tripId: keralaTripId, actorId: DEMO_USER_IDS.demo, verb: 'moved “Echo Point” later in Day 2', target: 'Timeline', at: Date.now() - 26 * 3600000 },
  { id: 'af_4', tripId: keralaTripId, actorId: DEMO_USER_IDS.meera, verb: 'raised decision “Which stop do we drop?”', target: 'Decisions', at: T(2) },
  { id: 'af_5', tripId: goaTripId, actorId: DEMO_USER_IDS.arjun, verb: 'confirmed “Basilica of Bom Jesus”', target: 'Day 2', at: T(2) },
  { id: 'af_6', tripId: rajasthanTripId, actorId: DEMO_USER_IDS.devika, verb: 'published this itinerary to Explore', target: 'Explore', at: T(20) },
]

const notificationsSeed: Notification[] = [
  { id: 'nt_1', userId: DEMO_USER_IDS.demo, tripId: keralaTripId, text: 'Meera Nair suggested “Pothamedu viewpoint sunset” for Day 2.', read: false, at: T(2) },
  { id: 'nt_2', userId: DEMO_USER_IDS.demo, tripId: keralaTripId, text: 'Arjun voted on a suggestion.', read: false, at: T(1) },
  { id: 'nt_3', userId: DEMO_USER_IDS.demo, tripId: keralaTripId, text: 'New unresolved decision: “Which stop do we drop?”', read: false, at: T(2) },
  { id: 'nt_4', userId: DEMO_USER_IDS.demo, tripId: goaTripId, text: 'Arjun confirmed “Basilica of Bom Jesus” on the Goa trip.', read: false, at: T(2) },
]

// ============================================================================
// PUBLISHED ITINERARIES — one per travel style (Explore + public pages)
// Each is tied to a real seeded trip id so its public page resolves.
// ============================================================================

const publishedItineraries: PublishedItinerary[] = [
  {
    id: 'pub-kerala-balanced', tripId: keralaTripId, creatorId: DEMO_USER_IDS.demo,
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
    freeDayIndexes: [0], premiumPriceInr: 199, subscriberCta: 'Full PDF + booking checklist + my exact homestay contacts.',
    publishedAt: T(5), views: 1284, copies: 96,
  },
  {
    id: 'pub-goa-packed', tripId: goaTripId, creatorId: DEMO_USER_IDS.arjun,
    title: 'Goa Friends Long Weekend',
    tagline: 'Beaches, forts, flea markets and one very good Greek lunch.',
    routeSummary: ['Mumbai', 'Baga', 'Anjuna', 'Old Goa'],
    durationDays: 3, estimatedBudgetPerPersonInr: 14000, travelStyle: 'packed',
    bestSeason: 'Nov–Feb',
    travelTips: ['Leave Mumbai by 5 AM to beat the Lonavala crawl.', 'Thalassa needs reservations days ahead on weekends.'],
    warningsAndAssumptions: ['Costs assume 6 people sharing two cars.', 'Some shacks close mid-monsoon.'],
    freeDayIndexes: [0], premiumPriceInr: 149, subscriberCta: 'Full shack list + party calendar + driver contacts.',
    publishedAt: T(9), views: 2140, copies: 187,
  },
  {
    id: 'pub-rajasthan-luxury', tripId: rajasthanTripId, creatorId: DEMO_USER_IDS.devika,
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
    freeDayIndexes: [0, 1], premiumPriceInr: 499, subscriberCta: 'Room-by-room hotel picks, guide contacts and my photo-spot map.',
    publishedAt: T(20), views: 5310, copies: 342,
  },
  {
    id: 'pub-sikkim-adventure', tripId: sikkimTripId, creatorId: DEMO_USER_IDS.arjun,
    title: 'Sikkim Adventure Week',
    tagline: 'Gangtok, Nathula pass and Tsomgo lake — permits decoded.',
    routeSummary: ['Bagdogra', 'Gangtok', 'Tsomgo Lake', 'Pelling'],
    durationDays: 6, estimatedBudgetPerPersonInr: 31000, travelStyle: 'adventure',
    bestSeason: 'Mar–Jun, Oct–Nov',
    travelTips: ['Nathula permits need 24h advance processing.', 'Altitude: take the acclimatization day seriously.'],
    warningsAndAssumptions: ['High-altitude sections carry real weather risk — always confirm pass status locally.'],
    freeDayIndexes: [0], premiumPriceInr: 249, subscriberCta: 'Permit paperwork templates + verified stay list.',
    publishedAt: T(35), views: 1890, copies: 74,
  },
  {
    id: 'pub-spiti-budget', tripId: spitiTripId, creatorId: DEMO_USER_IDS.demo,
    title: 'Spiti Valley on a Shoestring',
    tagline: 'Monasteries, moonland and a crescent lake at 4,300m — under ₹16k.',
    routeSummary: ['Chandigarh', 'Narkanda', 'Kaza', 'Chandratal'],
    durationDays: 7, estimatedBudgetPerPersonInr: 16000, travelStyle: 'budget',
    bestSeason: 'Jun–Sep',
    travelTips: ['Share a tempo traveller to split the long drive cost.', 'Carry enough cash — ATMs are rare past Kaza.'],
    warningsAndAssumptions: ['Roads close without warning after snow; build buffer days.'],
    freeDayIndexes: [0, 1], premiumPriceInr: 149, subscriberCta: 'Night-by-night homestay list + permit checklist.',
    publishedAt: T(18), views: 1420, copies: 88,
  },
  {
    id: 'pub-spiritual', tripId: spiritualTripId, creatorId: DEMO_USER_IDS.devika,
    title: 'Ganga & Ghats — Varanasi to Rishikesh',
    tagline: 'Aarti at dawn and dusk, Sarnath’s stupa, and the Beatles Ashram.',
    routeSummary: ['Varanasi', 'Rishikesh', 'Haridwar'],
    durationDays: 5, estimatedBudgetPerPersonInr: 12000, travelStyle: 'spiritual',
    bestSeason: 'Oct–Mar',
    travelTips: ['Book the Dashashwamedh aarti boat 1 day ahead.', 'Carry a shawl — ghats get cold at night.'],
    warningsAndAssumptions: ['Train schedules shift; verify before booking onward legs.'],
    freeDayIndexes: [0], premiumPriceInr: 99, subscriberCta: 'Ghat-by-ghat walking plan + aarti timings.',
    publishedAt: T(14), views: 980, copies: 51,
  },
  {
    id: 'pub-mumbai-food', tripId: mumbaiTripId, creatorId: DEMO_USER_IDS.arjun,
    title: 'Mumbai Weekend Food Sprint',
    tagline: 'Colaba to Bandra — street food, Irani cafés and sea-link sunsets in 48 hours.',
    routeSummary: ['Colaba', 'Bandra', 'Juhu'],
    durationDays: 2, estimatedBudgetPerPersonInr: 7500, travelStyle: 'food-focused',
    bestSeason: 'All year (avoid monsoon high-tide evenings)',
    travelTips: ['Use local trains between 11 AM–4 PM only.', 'Irani cafés close earlier than you think.'],
    warningsAndAssumptions: ['Food costs scale fast if you add fine dining.'],
    freeDayIndexes: [0, 1], premiumPriceInr: 79, subscriberCta: 'Dish-by-dish crawl map + reservation links.',
    publishedAt: T(12), views: 1650, copies: 122,
  },
  {
    id: 'pub-family', tripId: familyTripId, creatorId: DEMO_USER_IDS.meera,
    title: 'Golden Triangle with the Kids',
    tagline: 'Delhi, Agra and Jaipur paced for little legs and big sights.',
    routeSummary: ['Delhi', 'Agra', 'Jaipur'],
    durationDays: 5, estimatedBudgetPerPersonInr: 18000, travelStyle: 'family',
    bestSeason: 'Oct–Mar',
    travelTips: ['Taj at sunrise beats the heat and the crowds.', 'Keep a 1pm hotel break for naps.'],
    warningsAndAssumptions: ['Long drives between cities — pad with extra stops.'],
    freeDayIndexes: [0], premiumPriceInr: 149, subscriberCta: 'Kid-tested stops + stroller-friendly routes.',
    publishedAt: T(16), views: 1330, copies: 97,
  },
  {
    id: 'pub-andaman-relaxed', tripId: andamanTripId, creatorId: DEMO_USER_IDS.demo,
    title: 'Andaman Slow Island Days',
    tagline: 'Radhanagar sunsets, reef snorkels and ferry-hopping at island pace.',
    routeSummary: ['Port Blair', 'Havelock', 'Neil Island'],
    durationDays: 6, estimatedBudgetPerPersonInr: 28000, travelStyle: 'relaxed',
    bestSeason: 'Oct–May',
    travelTips: ['Book Makruzz seats 48h ahead — they sell out.', 'Carry reef-safe sunscreen.'],
    warningsAndAssumptions: ['Ferries cancel in rough seas; keep a buffer day.'],
    freeDayIndexes: [0], premiumPriceInr: 199, subscriberCta: 'Ferry timetable + resort shortlist.',
    publishedAt: T(22), views: 1120, copies: 64,
  },
  {
    id: 'pub-creator', tripId: creatorTripId, creatorId: DEMO_USER_IDS.devika,
    title: 'Devika’s India Highlights — 10 Days, 4 Cities',
    tagline: 'A creator-curated loop through the icons, with the photo spots marked.',
    routeSummary: ['Delhi', 'Agra', 'Jaipur', 'Udaipur'],
    durationDays: 10, estimatedBudgetPerPersonInr: 52000, travelStyle: 'creator',
    bestSeason: 'Oct–Mar',
    travelTips: ['Shoot the Taj at first light from the east bank.', 'Udaipur’s lake palette is best at dusk.'],
    warningsAndAssumptions: ['Premium tier — this is the curated, filmed version.'],
    freeDayIndexes: [0, 1], premiumPriceInr: 599, subscriberCta: 'Full shot list + my exact hotel and café picks.',
    publishedAt: T(30), views: 4200, copies: 210,
  },
]

export const seedData = {
  users: demoUsers,
  trips,
  suggestions,
  decisions,
  activity: activityFeed,
  notifications: notificationsSeed,
  published: publishedItineraries,
}
