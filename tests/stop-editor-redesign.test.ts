import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PlanFactsRow, StopEditor } from '../src/components/StopEditor'
import { STOP_PRIORITY_CHOICES, stopPlanFacts } from '../src/lib/stopForm'
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

