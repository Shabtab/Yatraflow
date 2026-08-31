// ============ Vehicle profile — range & fuel/charging cadence ============
// Pure module. No network, no env. Computes real range from user-stated
// capacity + economy, with a 15 % reserve buffer so fuel stops are planned
// before the tank is empty.

import type { VehicleProfile, FuelType } from '../data/types'

export interface ResolvedRange {
  /** capacity × economy — total theoretical range */
  rangeKm: number
  /** range × 0.15 — never plan a stop below this */
  reserveKm: number
  /** range − reserve = the km at which we plan a fuel/charging stop */
  planCadenceKm: number
}

const DEFAULTS: Record<string, VehicleProfile> = {
  car: { vehicleType: 'car', fuelType: 'petrol', capacity: 45, economy: 15 },
  motorcycle: { vehicleType: 'motorcycle', fuelType: 'petrol', capacity: 12, economy: 40 },
  ev: { vehicleType: 'ev', fuelType: 'electric', capacity: 50, economy: 6 },
}

/** Build a default profile from a transport mode (best-effort). */
export function defaultVehicleProfile(mode: string): VehicleProfile {
  return DEFAULTS[mode] ?? DEFAULTS.car
}

/** Compute range, reserve, and plan cadence from a profile or mode fallback. */
export function resolveVehicleRange(
  profile?: VehicleProfile,
  transportMode?: string,
): ResolvedRange {
  const p = profile ?? (transportMode ? defaultVehicleProfile(transportMode) : DEFAULTS.car)
  const rangeKm = p.capacity * p.economy
  const reserveKm = rangeKm * 0.15
  return {
    rangeKm,
    reserveKm,
    planCadenceKm: Math.max(80, rangeKm - reserveKm),
  }
}

/** Human-readable capacity string, e.g. "45 L" or "50 kWh". */
export function formatCapacity(profile: VehicleProfile): string {
  return profile.fuelType === 'electric'
    ? `${profile.capacity} kWh`
    : `${profile.capacity} L`
}

/** True when the profile is for an electric vehicle. */
export function isElectric(profile?: VehicleProfile): boolean {
  return profile?.fuelType === 'electric'
}

/** Fuel-type-aware label for a fuel stop: "Fuel", "CNG", or "Charge". */
export function fuelStopLabel(profile?: VehicleProfile): string {
  if (!profile) return 'Fuel'
  if (profile.fuelType === 'electric') return 'Charge'
  if (profile.fuelType === 'cng') return 'CNG'
  return 'Fuel'
}
