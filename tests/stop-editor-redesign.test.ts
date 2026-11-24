import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PlanFactsRow, StopEditor } from '../src/components/StopEditor'
import { STOP_PRIORITY_CHOICES, stopPlanFacts, stopEditorSummaries } from '../src/lib/stopForm'
import { buildDayCards } from '../src/lib/dayCards'
import type { Trip } from '../src/data/types'

const trip: Trip = {
  id: 'trip', name: 'Trip', startLocation: 'Kochi', destinations: ['Munnar'],
  startDate: '2026-10-01', endDate: '2026-10-01', travellers: 2, transportMode: 'car',
  budgetPerPersonInr: 10000, travelStyle: 'balanced', fixedCommitments: [],
  days: [{ id: 'day', index: 0, title: 'Day 1', stops: [
    { id: 'skip', title: 'Skipped', category: 'sightseeing', locationName: 'Kochi', lat: 9.93, lng: 76.26, visitMinutes: 30, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'optional', status: 'rejected', orderInDay: 0 },
    { id: 'visit', title: 'Visit', category: 'sightseeing', locationName: 'Munnar', lat: 10.08, lng: 77.05, visitMinutes: 90, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
  ] }],
  expenses: [], coverEmoji: '', visibility: 'private', createdAt: 1, updatedAt: 1, members: [],
}

describe('stop editor plan facts', () => {
  const facts = buildDayCards(trip, trip.days).byDay.get(0)
  it('looks up the active stop by id and leaves a rejected stop empty', () => {
    const planned = stopPlanFacts({ mode: 'edit', stopId: 'visit' }, facts)
    expect(planned?.arrive).toBe(facts?.sim.arrivalTimes[facts.sim.activeStops.findIndex(s => s.id === 'visit')])
    expect(planned?.leave).toBeTruthy()
    expect(planned?.stayMin).toBe(facts?.journey.points.find(p => p.stop.id === 'visit')?.dwellMinutes)
    expect(stopPlanFacts({ mode: 'edit', stopId: 'skip' }, facts)).toBeUndefined()
    expect(stopPlanFacts({ mode: 'add', dayIndex: 0 }, facts)).toBeUndefined()
    expect(stopPlanFacts({ mode: 'edit', stopId: 'visit' }, undefined)).toBeUndefined()
  })
  it('shows the real leg into a stop, and no leg when the day starts at the stop', () => {
    const kochi = { ...trip, startLocationCoords: { lat: 9.93, lng: 76.26 } }
    const away = stopPlanFacts({ mode: 'edit', stopId: 'visit' }, buildDayCards(kochi, kochi.days).byDay.get(0))
    expect(away?.distanceKm).toBeGreaterThan(1)
    expect(away?.driveMin).toBeGreaterThan(0)
    const here = { ...trip, startLocationCoords: { lat: 10.08, lng: 77.05 } }
    const first = stopPlanFacts({ mode: 'edit', stopId: 'visit' }, buildDayCards(here, here.days).byDay.get(0))
    expect(first?.arrive).toBeTruthy()
    expect(first?.distanceKm).toBeUndefined()
    expect(first?.driveMin).toBeUndefined()
    const html = renderToStaticMarkup(React.createElement(PlanFactsRow, { facts: first!, timeFormat: '24h' }))
    expect(html).not.toMatch(/km|drive/)
  })
  it('omits absent facts and renders no empty row', () => {
    expect(renderToStaticMarkup(React.createElement(PlanFactsRow, { facts: {}, timeFormat: '24h' }))).toBe('')
    const html = renderToStaticMarkup(React.createElement(PlanFactsRow, { facts: { arrive: '10:40' }, timeFormat: '24h' }))
    expect(html).toContain('arrive 10:40')
    expect(html).not.toContain('leave')
    expect(html).not.toContain('drive')
  })
  it('keeps plan facts out of both save paths', () => {
    const source = readFileSync(new URL('../src/components/StopEditor.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const submit = source.slice(source.indexOf('  async function submit('), source.indexOf('\n  return (', source.indexOf('  async function submit(')))
    expect(submit).not.toContain('planFacts')
    expect(submit).toContain('onSave({ ...v, title: v.title.trim(), locationName: v.locationName.trim() })')
  })
  it('maps the visible choices to the existing priority values', () => {
    expect(STOP_PRIORITY_CHOICES.map(c => [c.label, c.value])).toEqual([
      ['Must', 'must-do'], ['Nice', 'nice-to-have'], ['If time', 'optional'],
    ])
    expect(STOP_PRIORITY_CHOICES.every(c => c.accessibleLabel.length > c.label.length)).toBe(true)
  })
  it('renders no photo box without a photo source', () => {
    const html = renderToStaticMarkup(React.createElement(StopEditor, { open: true, onClose: () => {}, onSave: () => {} }))
    expect(html).not.toMatch(/<img|photo/i)
  })
})


describe('phone section summaries', () => {
  it('omits unknown hours and unset or zero costs', () => {
    expect(stopEditorSummaries({}, '24h')).toEqual({ categoryHours: '', costs: '', details: '' })
    const summary = stopEditorSummaries({ entryFeeInrPerPerson: 0, transportCostInrTotal: 0 }, '24h')
    expect(summary.costs).toBe('')
    expect(summary.categoryHours).not.toContain('Always open')
    expect(summary.costs).not.toContain('Free')
  })
  it('formats only supplied hours, costs and details', () => {
    const summary = stopEditorSummaries({ category: 'museum', openTime: '09:00', closeTime: '17:00', entryFeeInrPerPerson: 50, notes: 'Parking', status: 'confirmed' }, '24h')
    expect(summary).toEqual({ categoryHours: 'Museum · Opens 09:00–17:00', costs: 'Entry ₹50', details: 'Notes · Confirmed' })
    expect(stopEditorSummaries({ closeTime: '17:00' }, '24h').categoryHours).toBe('Closes 17:00')
  })
})
