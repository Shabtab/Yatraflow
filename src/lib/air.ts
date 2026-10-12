// ============ Air travel: airports, block time, arcs, indicative fares ============
// A flight trip is not a road trip with a bigger speed number. Three things have
// to exist before a Map/Timeline/Board can describe one honestly:
//
//   1. WHICH airports — the nearest commercial airport to each end of the trip.
//      Bundled as data rather than fetched: a Places call per trip end costs
//      quota, needs a key, and answers "an airport", not "the airport you'd
//      actually fly from" (a city can have two). A static list is deterministic,
//      offline and testable — and `nearestAirport` reports the distance it
//      measured, so the traveller confirms the choice.
//   2. HOW LONG the flight takes — block time. No schedule API is configured
//      here and no keyless provider serves flights, so this is a MODEL
//      (taxi + climb/descent + cruise), not live data. It is labelled an
//      estimate everywhere it renders, and a manually entered depart/arrive
//      pair replaces it outright.
//   3. WHAT it costs — an indicative per-person fare from route length. Also a
//      model, also labelled, also replaced by a manually entered fare.
//
// Nothing here claims live data. That is the transparency promise, and the two
// numbers this module invents are the ones the UI must show assumptions for.
import { haversineKm } from './geo'

export interface Airport {
  /** IATA code — the identity a traveller recognises and types. */
  iata: string
  name: string
  city: string
  state: string
  lat: number
  lng: number
}

export interface LatLng {
  lat: number
  lng: number
}

/**
 * India's commercial airports with scheduled passenger service: IATA code, name,
 * city, state and published coordinates. Deliberately a curated list and not a
 * scrape — it is data the engine reasons over, so it must be stable enough to
 * unit-test and small enough to ship in the bundle.
 *
 * Coordinates are the airport reference points (roughly the terminal), which is
 * what "nearest airport to this town" must measure to. A missing entry means
 * `nearestAirport` returns null and the UI says so rather than guessing.
 */
export const INDIAN_AIRPORTS: readonly Airport[] = [
  // ---- North ----
  { iata: 'DEL', name: 'Indira Gandhi International', city: 'Delhi', state: 'Delhi', lat: 28.5562, lng: 77.1 },
  { iata: 'IXC', name: 'Chandigarh', city: 'Chandigarh', state: 'Chandigarh', lat: 30.6735, lng: 76.7886 },
  { iata: 'ATQ', name: 'Sri Guru Ram Dass Jee', city: 'Amritsar', state: 'Punjab', lat: 31.7096, lng: 74.7973 },
  { iata: 'LUH', name: 'Sahnewal', city: 'Ludhiana', state: 'Punjab', lat: 30.8547, lng: 75.9526 },
  { iata: 'SXR', name: 'Sheikh ul-Alam', city: 'Srinagar', state: 'Jammu & Kashmir', lat: 33.9871, lng: 74.7742 },
  { iata: 'IXJ', name: 'Jammu', city: 'Jammu', state: 'Jammu & Kashmir', lat: 32.6891, lng: 74.8374 },
  { iata: 'IXL', name: 'Kushok Bakula Rimo', city: 'Leh', state: 'Ladakh', lat: 34.1359, lng: 77.5465 },
  { iata: 'DHM', name: 'Gaggal', city: 'Dharamshala', state: 'Himachal Pradesh', lat: 32.1394, lng: 76.2634 },
  { iata: 'KUU', name: 'Bhuntar', city: 'Kullu', state: 'Himachal Pradesh', lat: 31.8767, lng: 77.1542 },
  { iata: 'SLV', name: 'Shimla', city: 'Shimla', state: 'Himachal Pradesh', lat: 31.0818, lng: 77.0679 },
  { iata: 'PGH', name: 'Pantnagar', city: 'Pantnagar', state: 'Uttarakhand', lat: 29.0324, lng: 79.4737 },
  { iata: 'DED', name: 'Jolly Grant', city: 'Dehradun', state: 'Uttarakhand', lat: 30.1897, lng: 78.1804 },
  // ---- West ----
  { iata: 'BOM', name: 'Chhatrapati Shivaji Maharaj', city: 'Mumbai', state: 'Maharashtra', lat: 19.0896, lng: 72.8656 },
  { iata: 'PNQ', name: 'Lohegaon', city: 'Pune', state: 'Maharashtra', lat: 18.5793, lng: 73.9089 },
  { iata: 'ISK', name: 'Nashik', city: 'Nashik', state: 'Maharashtra', lat: 20.5191, lng: 73.9132 },
  { iata: 'SND', name: 'Shirdi', city: 'Shirdi', state: 'Maharashtra', lat: 19.6883, lng: 74.3789 },
  { iata: 'IXU', name: 'Aurangabad', city: 'Aurangabad', state: 'Maharashtra', lat: 19.8627, lng: 75.3981 },
  { iata: 'JLG', name: 'Jalgaon', city: 'Jalgaon', state: 'Maharashtra', lat: 20.9625, lng: 75.6253 },
  { iata: 'KLH', name: 'Kolhapur', city: 'Kolhapur', state: 'Maharashtra', lat: 16.6636, lng: 74.2896 },
  { iata: 'SDW', name: 'Sindhudurg', city: 'Chipi', state: 'Maharashtra', lat: 16.0136, lng: 73.5313 },
  { iata: 'NAG', name: 'Dr. Babasaheb Ambedkar', city: 'Nagpur', state: 'Maharashtra', lat: 21.0921, lng: 79.0472 },
  { iata: 'AMD', name: 'Sardar Vallabhbhai Patel', city: 'Ahmedabad', state: 'Gujarat', lat: 23.0774, lng: 72.6267 },
  { iata: 'BDQ', name: 'Vadodara', city: 'Vadodara', state: 'Gujarat', lat: 22.3362, lng: 73.2263 },
  { iata: 'STV', name: 'Surat', city: 'Surat', state: 'Gujarat', lat: 21.1143, lng: 72.7419 },
  { iata: 'BHU', name: 'Bhavnagar', city: 'Bhavnagar', state: 'Gujarat', lat: 21.7522, lng: 72.1852 },
  { iata: 'RAJ', name: 'Rajkot International', city: 'Rajkot', state: 'Gujarat', lat: 22.3917, lng: 71.0333 },
  { iata: 'JGA', name: 'Govardhanpur', city: 'Jamnagar', state: 'Gujarat', lat: 22.4655, lng: 70.0127 },
  { iata: 'IXY', name: 'Kandla', city: 'Kandla', state: 'Gujarat', lat: 23.1127, lng: 70.1003 },
  { iata: 'BHJ', name: 'Rudra Mata', city: 'Bhuj', state: 'Gujarat', lat: 23.2878, lng: 69.6701 },
  { iata: 'PBD', name: 'Porbandar', city: 'Porbandar', state: 'Gujarat', lat: 21.6487, lng: 69.6583 },
  { iata: 'DIU', name: 'Diu', city: 'Diu', state: 'Daman & Diu', lat: 20.7131, lng: 70.9214 },
  { iata: 'GOI', name: 'Dabolim', city: 'Vasco da Gama', state: 'Goa', lat: 15.3808, lng: 73.8314 },
  { iata: 'GOX', name: 'Manohar International', city: 'Mopa', state: 'Goa', lat: 15.7384, lng: 73.8677 },
  { iata: 'JAI', name: 'Sanganer', city: 'Jaipur', state: 'Rajasthan', lat: 26.8242, lng: 75.8122 },
  { iata: 'JDH', name: 'Jodhpur', city: 'Jodhpur', state: 'Rajasthan', lat: 26.2637, lng: 73.0056 },
  { iata: 'UDR', name: 'Maharana Pratap', city: 'Udaipur', state: 'Rajasthan', lat: 24.6177, lng: 73.8962 },
  { iata: 'JSA', name: 'Jaisalmer', city: 'Jaisalmer', state: 'Rajasthan', lat: 26.8887, lng: 70.8647 },
  { iata: 'BKB', name: 'Nal', city: 'Bikaner', state: 'Rajasthan', lat: 28.0706, lng: 73.2072 },
  { iata: 'KQH', name: 'Kishangarh', city: 'Ajmer', state: 'Rajasthan', lat: 26.5897, lng: 74.7682 },

  // ---- Central ----
  { iata: 'BHO', name: 'Raja Bhoj', city: 'Bhopal', state: 'Madhya Pradesh', lat: 23.2875, lng: 77.3374 },
  { iata: 'IDR', name: 'Devi Ahilya Bai Holkar', city: 'Indore', state: 'Madhya Pradesh', lat: 22.7218, lng: 75.8011 },
  { iata: 'JLR', name: 'Jabalpur', city: 'Jabalpur', state: 'Madhya Pradesh', lat: 23.1778, lng: 80.052 },
  { iata: 'GWL', name: 'Gwalior', city: 'Gwalior', state: 'Madhya Pradesh', lat: 26.2933, lng: 78.2278 },
  { iata: 'HJR', name: 'Khajuraho', city: 'Khajuraho', state: 'Madhya Pradesh', lat: 24.8174, lng: 79.9186 },
  { iata: 'RPR', name: 'Swami Vivekananda', city: 'Raipur', state: 'Chhattisgarh', lat: 21.1804, lng: 81.7387 },
  // ---- East ----
  { iata: 'CCU', name: 'Netaji Subhas Chandra Bose', city: 'Kolkata', state: 'West Bengal', lat: 22.6547, lng: 88.4467 },
  { iata: 'IXB', name: 'Bagdogra', city: 'Siliguri', state: 'West Bengal', lat: 26.6812, lng: 88.328 },
  { iata: 'COH', name: 'Cooch Behar', city: 'Cooch Behar', state: 'West Bengal', lat: 26.3307, lng: 89.4674 },
  { iata: 'RDP', name: 'Kazi Nazrul Islam', city: 'Durgapur', state: 'West Bengal', lat: 23.6225, lng: 87.2432 },
  { iata: 'BBI', name: 'Biju Patnaik', city: 'Bhubaneswar', state: 'Odisha', lat: 20.2444, lng: 85.8178 },
  { iata: 'JRG', name: 'Jharsuguda', city: 'Jharsuguda', state: 'Odisha', lat: 21.913, lng: 84.0503 },
  { iata: 'IXR', name: 'Birsa Munda', city: 'Ranchi', state: 'Jharkhand', lat: 23.3143, lng: 85.3217 },
  { iata: 'IXW', name: 'Sonari', city: 'Jamshedpur', state: 'Jharkhand', lat: 22.8132, lng: 86.1689 },
  { iata: 'DGH', name: 'Deoghar', city: 'Deoghar', state: 'Jharkhand', lat: 24.4454, lng: 86.7022 },
  { iata: 'PAT', name: 'Jayaprakash Narayan', city: 'Patna', state: 'Bihar', lat: 25.5913, lng: 85.088 },
  { iata: 'GAY', name: 'Gaya', city: 'Gaya', state: 'Bihar', lat: 24.7443, lng: 84.9512 },
  { iata: 'DBR', name: 'Darbhanga', city: 'Darbhanga', state: 'Bihar', lat: 26.1937, lng: 85.917 },
  // ---- North East ----
  { iata: 'GAU', name: 'Lokpriya Gopinath Bordoloi', city: 'Guwahati', state: 'Assam', lat: 26.1061, lng: 91.5858 },
  { iata: 'SHL', name: 'Umroi', city: 'Shillong', state: 'Meghalaya', lat: 25.7036, lng: 91.9787 },
  { iata: 'IXA', name: 'Maharaja Bir Bikram', city: 'Agartala', state: 'Tripura', lat: 23.887, lng: 91.2404 },
  { iata: 'IXS', name: 'Silchar', city: 'Silchar', state: 'Assam', lat: 24.9129, lng: 92.9787 },
  { iata: 'AJL', name: 'Lengpui', city: 'Aizawl', state: 'Mizoram', lat: 23.8406, lng: 92.6197 },
  { iata: 'IMF', name: 'Bir Tikendrajit', city: 'Imphal', state: 'Manipur', lat: 24.76, lng: 93.8969 },
  { iata: 'DMU', name: 'Dimapur', city: 'Dimapur', state: 'Nagaland', lat: 25.8839, lng: 93.7711 },
  { iata: 'DIB', name: 'Dibrugarh', city: 'Dibrugarh', state: 'Assam', lat: 27.4839, lng: 95.0169 },
  { iata: 'JRH', name: 'Jorhat', city: 'Jorhat', state: 'Assam', lat: 26.7315, lng: 94.1757 },
  // ---- South ----
  { iata: 'MAA', name: 'Chennai International', city: 'Chennai', state: 'Tamil Nadu', lat: 12.9941, lng: 80.1709 },
  { iata: 'CJB', name: 'Coimbatore', city: 'Coimbatore', state: 'Tamil Nadu', lat: 11.03, lng: 77.0434 },
  { iata: 'TRZ', name: 'Tiruchirappalli', city: 'Tiruchirappalli', state: 'Tamil Nadu', lat: 10.7654, lng: 78.7097 },
  { iata: 'IXM', name: 'Madurai', city: 'Madurai', state: 'Tamil Nadu', lat: 9.8345, lng: 78.0934 },
  { iata: 'TCR', name: 'Thoothukudi', city: 'Thoothukudi', state: 'Tamil Nadu', lat: 8.7244, lng: 78.0258 },
  { iata: 'SXV', name: 'Salem', city: 'Salem', state: 'Tamil Nadu', lat: 11.7814, lng: 78.0655 },
  { iata: 'PNY', name: 'Puducherry', city: 'Puducherry', state: 'Puducherry', lat: 11.9686, lng: 79.8121 },
  { iata: 'BLR', name: 'Kempegowda International', city: 'Bengaluru', state: 'Karnataka', lat: 13.1986, lng: 77.7066 },
  { iata: 'MYQ', name: 'Mysuru', city: 'Mysuru', state: 'Karnataka', lat: 12.2302, lng: 76.6557 },
  { iata: 'IXE', name: 'Mangaluru', city: 'Mangaluru', state: 'Karnataka', lat: 12.9613, lng: 74.8902 },
  { iata: 'HBX', name: 'Hubballi', city: 'Hubballi', state: 'Karnataka', lat: 15.3616, lng: 75.0849 },
  { iata: 'IXG', name: 'Belagavi', city: 'Belagavi', state: 'Karnataka', lat: 15.8593, lng: 74.6183 },
  { iata: 'GBI', name: 'Kalaburagi', city: 'Kalaburagi', state: 'Karnataka', lat: 17.306, lng: 76.81 },
  { iata: 'HYD', name: 'Rajiv Gandhi International', city: 'Hyderabad', state: 'Telangana', lat: 17.2403, lng: 78.4294 },
  { iata: 'VGA', name: 'Vijayawada', city: 'Vijayawada', state: 'Andhra Pradesh', lat: 16.5304, lng: 80.7968 },
  { iata: 'VTZ', name: 'Visakhapatnam', city: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.7212, lng: 83.2245 },
  { iata: 'RJA', name: 'Rajahmundry', city: 'Rajahmundry', state: 'Andhra Pradesh', lat: 17.1104, lng: 81.8181 },
  { iata: 'TIR', name: 'Tirupati', city: 'Tirupati', state: 'Andhra Pradesh', lat: 13.6325, lng: 79.5434 },
  { iata: 'PUT', name: 'Puttaparthi', city: 'Puttaparthi', state: 'Andhra Pradesh', lat: 14.0183, lng: 78.0892 },
  { iata: 'CDP', name: 'Kadapa', city: 'Kadapa', state: 'Andhra Pradesh', lat: 14.5102, lng: 78.7728 },
  { iata: 'KJB', name: 'Kurnool', city: 'Kurnool', state: 'Andhra Pradesh', lat: 15.7058, lng: 78.1689 },
  { iata: 'TRV', name: 'Thiruvananthapuram', city: 'Thiruvananthapuram', state: 'Kerala', lat: 8.4821, lng: 76.9201 },
  { iata: 'COK', name: 'Cochin International', city: 'Kochi', state: 'Kerala', lat: 10.152, lng: 76.4019 },
  { iata: 'CCJ', name: 'Kozhikode', city: 'Kozhikode', state: 'Kerala', lat: 11.1368, lng: 75.9553 },
  { iata: 'CNN', name: 'Kannur', city: 'Kannur', state: 'Kerala', lat: 11.9189, lng: 75.5472 },
  { iata: 'AGX', name: 'Agatti', city: 'Agatti', state: 'Lakshadweep', lat: 10.8236, lng: 72.1761 },
  { iata: 'IXZ', name: 'Veer Savarkar', city: 'Port Blair', state: 'Andaman & Nicobar', lat: 11.6412, lng: 92.7297 },
  { iata: 'IXT', name: 'Pasighat', city: 'Pasighat', state: 'Arunachal Pradesh', lat: 28.0683, lng: 95.3355 },
  { iata: 'TEI', name: 'Tezu', city: 'Tezu', state: 'Arunachal Pradesh', lat: 27.9417, lng: 96.1344 },
]

/** Case/whitespace-tolerant IATA lookup. Returns null for an unknown code. */

// ---------------- Block time ----------------

/** Wheels-up to wheels-down model. Each term is a planning assumption, shown to
 *  the traveller wherever a flight time renders — never presented as data. */
export const AIR_TAXI_OUT_MIN = 20
export const AIR_CLIMB_DESCENT_MIN = 20
export const AIR_TAXI_IN_MIN = 15
/** Typical narrow-body cruise over Indian domestic sectors. */
export const AIR_CRUISE_KMPH = 800

/** The one sentence the UI shows beside an estimated flight duration. */
export const AIR_TIME_ASSUMPTION_TEXT =
  `Estimated block time: ${AIR_TAXI_OUT_MIN} min taxi-out + ${AIR_CLIMB_DESCENT_MIN} min climb and descent ` +
  `+ cruise at ${AIR_CRUISE_KMPH} km/h + ${AIR_TAXI_IN_MIN} min taxi-in. Enter your flight's real times to replace it.`

/**
 * Estimated block time in minutes for a sector, rounded to 5 — the granularity a
 * published schedule actually uses. Deterministic and offline: the same two
 * airports always give the same number, so tests pin it and the traveller is
 * never shown a figure that moves between reloads.
 */
export function airBlockMinutes(from: LatLng, to: LatLng): number {
  const km = airDistanceKm(from, to)
  if (!Number.isFinite(km) || km <= 0) return 0
  const cruiseMin = (km / AIR_CRUISE_KMPH) * 60
  const total = AIR_TAXI_OUT_MIN + AIR_CLIMB_DESCENT_MIN + cruiseMin + AIR_TAXI_IN_MIN
  return Math.max(5, Math.round(total / 5) * 5)
}

// ---------------- Indicative fare ----------------

/** Indicative per-person economy fare model, in ₹. */
export const AIR_FARE_BASE_INR = 2900
export const AIR_FARE_PER_KM_INR = 3.4
export const AIR_FARE_MIN_INR = 2900
export const AIR_FARE_MAX_INR = 18000

/** The one sentence the UI shows beside an estimated fare. */
export const AIR_FARE_ASSUMPTION_TEXT =
  `Indicative fare: ₹${AIR_FARE_BASE_INR.toLocaleString('en-IN')} base + ₹${AIR_FARE_PER_KM_INR}/km of great-circle ` +
  `distance, held between ₹${AIR_FARE_MIN_INR.toLocaleString('en-IN')} and ₹${AIR_FARE_MAX_INR.toLocaleString('en-IN')} per person. ` +
  'Enter the fare you actually paid to replace it.'

/**
 * Indicative per-person fare for a sector, from route length. This is a MODEL,
 * not a quote — it exists so a flight trip's budget has a number in it before
 * the traveller books, and it is replaced outright by a manually entered fare.
 * Clamped so a 200 km hop does not read as ₹2,300 and a 2,000 km one as ₹20k.
 */
export function airFareEstimateInr(from: LatLng, to: LatLng): number {
  const km = airDistanceKm(from, to)
  if (!Number.isFinite(km) || km <= 0) return AIR_FARE_MIN_INR
  const raw = AIR_FARE_BASE_INR + km * AIR_FARE_PER_KM_INR
  return Math.round(Math.min(AIR_FARE_MAX_INR, Math.max(AIR_FARE_MIN_INR, raw)))
}

// ---------------- Arc geometry ----------------

/**
 * Spherical interpolation along the great circle — the shape a flight path takes
 * on a map, and the honest stand-in for "the map showed road directions for a
 * flight". Returns [lng, lat] pairs, the shape every other geometry in this app
 * already uses.
 */
export function airArc(from: LatLng, to: LatLng, segments = 48): [number, number][] {
  if (!Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) {
    return []
  }
  const d2r = (v: number) => (v * Math.PI) / 180
  const r2d = (v: number) => (v * 180) / Math.PI
  const toVec = (lat: number, lng: number): [number, number, number] => {
    const la = d2r(lat)
    const lo = d2r(lng)
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]
  }
  const a = toVec(from.lat, from.lng)
  const b = toVec(to.lat, to.lng)
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  const omega = Math.acos(dot)
  const out: [number, number][] = [[from.lng, from.lat]]
  if (omega < 1e-9) {
    out.push([to.lng, to.lat])
    return out
  }
  const sinOmega = Math.sin(omega)
  const steps = Math.max(2, Math.min(256, Math.floor(segments)))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const k0 = Math.sin((1 - t) * omega) / sinOmega
    const k1 = Math.sin(t * omega) / sinOmega
    const x = a[0] * k0 + b[0] * k1
    const y = a[1] * k0 + b[1] * k1
    const z = a[2] * k0 + b[2] * k1
    out.push([r2d(Math.atan2(y, x)), r2d(Math.asin(Math.max(-1, Math.min(1, z))))])
  }
  return out
}

export function airportByIata(iata: string | null | undefined): Airport | null {
  const code = (iata ?? '').trim().toUpperCase()
  if (!code) return null
  return INDIAN_AIRPORTS.find(a => a.iata === code) ?? null
}

/** How far a point may sit from an airport before we call it "no airport" (km). */
export const AIRPORT_SEARCH_MAX_KM = 400

/**
 * The `count` airports closest to `point`, nearest first. `maxKm` bounds the
 * search: a point with nothing inside the radius gets a SHORTER list rather
 * than a far-away airport presented as "your airport". A city with two fields
 * (Delhi, Mumbai, Goa, Bengaluru's neighbours) returns both, so the
 * UI can let the traveller pick — which is the whole point of returning a list
 * rather than a single winner.
 */
export function nearestAirports(point: LatLng | null | undefined, count = 1, maxKm = AIRPORT_SEARCH_MAX_KM): Airport[] {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return []
  return INDIAN_AIRPORTS
    .map(a => ({ a, km: haversineKm(point.lat, point.lng, a.lat, a.lng) }))
    .filter(x => x.km <= maxKm)
    .sort((x, y) => x.km - y.km)
    .slice(0, Math.max(0, count))
    .map(x => x.a)
}

/** The single closest airport, or null when none sits inside `maxKm`. */
export function nearestAirport(point: LatLng | null | undefined, maxKm = AIRPORT_SEARCH_MAX_KM): Airport | null {
  return nearestAirports(point, 1, maxKm)[0] ?? null
}

/** Great-circle distance between two points, in km. */
export function airDistanceKm(from: LatLng, to: LatLng): number {
  return haversineKm(from.lat, from.lng, to.lat, to.lng)
}
