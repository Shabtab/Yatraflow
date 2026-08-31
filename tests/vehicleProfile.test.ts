import { describe, it, expect } from 'vitest'
import {
  defaultVehicleProfile,
  resolveVehicleRange,
  formatCapacity,
  isElectric,
  fuelStopLabel,
} from '../src/lib/vehicleProfile'

describe('vehicleProfile', () => {
  it('default car profile', () => {
    const p = defaultVehicleProfile('car')
    expect(p.vehicleType).toBe('car')
    expect(p.fuelType).toBe('petrol')
    expect(p.capacity).toBe(45)
    expect(p.economy).toBe(15)
  })

  it('default motorcycle profile', () => {
    const p = defaultVehicleProfile('motorcycle')
    expect(p.vehicleType).toBe('motorcycle')
    expect(p.capacity).toBe(12)
    expect(p.economy).toBe(40)
  })

  it('default EV profile', () => {
    const p = defaultVehicleProfile('ev')
    expect(p.vehicleType).toBe('ev')
    expect(p.fuelType).toBe('electric')
    expect(p.capacity).toBe(50)
    expect(p.economy).toBe(6)
  })

  it('falls back to car for unknown mode', () => {
    const p = defaultVehicleProfile('train')
    expect(p.vehicleType).toBe('car')
  })

  it('resolve range for car', () => {
    const r = resolveVehicleRange(defaultVehicleProfile('car'))
    expect(r.rangeKm).toBeCloseTo(675, 0)     // 45 * 15
    expect(r.reserveKm).toBeCloseTo(101.25, 2) // 675 * 0.15
    expect(r.planCadenceKm).toBeCloseTo(573.75, 2) // 675 - 101.25
  })

  it('resolve range for motorcycle', () => {
    const r = resolveVehicleRange(defaultVehicleProfile('motorcycle'))
    expect(r.rangeKm).toBeCloseTo(480, 0)
    expect(r.planCadenceKm).toBeCloseTo(408, 0)
  })

  it('resolve range for EV', () => {
    const r = resolveVehicleRange(defaultVehicleProfile('ev'))
    expect(r.rangeKm).toBeCloseTo(300, 0)     // 50 * 6
    expect(r.planCadenceKm).toBeCloseTo(255, 0) // 300 * 0.85
  })

  it('falls back to car when no profile or mode given', () => {
    const r = resolveVehicleRange()
    expect(r.rangeKm).toBeCloseTo(675, 0)
  })

  it('formatCapacity', () => {
    expect(formatCapacity(defaultVehicleProfile('car'))).toBe('45 L')
    expect(formatCapacity(defaultVehicleProfile('ev'))).toBe('50 kWh')
  })

  it('isElectric', () => {
    expect(isElectric(defaultVehicleProfile('ev'))).toBe(true)
    expect(isElectric(defaultVehicleProfile('car'))).toBe(false)
    expect(isElectric()).toBe(false)
  })

  it('fuelStopLabel', () => {
    expect(fuelStopLabel(defaultVehicleProfile('car'))).toBe('Fuel')
    expect(fuelStopLabel(defaultVehicleProfile('ev'))).toBe('Charge')
    expect(fuelStopLabel({ ...defaultVehicleProfile('car'), fuelType: 'cng' })).toBe('CNG')
    expect(fuelStopLabel()).toBe('Fuel')
  })
})
