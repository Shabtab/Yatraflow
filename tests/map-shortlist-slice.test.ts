/**
 * #420, slice 1 — the shortlist tray's extraction.
 *
 * `MapTab.tsx` is ~2,900 lines and one 2,700-line component; the issue asks for one
 * module at a time, refactor-only. This pins slice 1: the tray is its own component,
 * the road-order rule is importable and directly tested, and the page no longer
 * carries either — while the vote writer deliberately stays where its tripwire
 * looks for it (`tests/vote-path-composition.test.ts` scans `MapTab.tsx` for
 * `raiseShortlistVote`'s body, and a refactor must not quietly disarm a guard).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { orderByRoad } from '../src/pages/trip/map/roadOrder'

const mapTab = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')
const tray = readFileSync(new URL('../src/pages/trip/map/ShortlistTray.tsx', import.meta.url), 'utf8')

const place = (id: string, latitude: number, longitude: number) => ({ id, latitude, longitude })

describe('#420 — the tray adds in road order', () => {
  it('orders by the route position the caller already measures', () => {
    const kmByLng: Record<number, number> = { 1: 90, 2: 10, 3: 50 }
    const out = orderByRoad(
      [place('a', 1, 1), place('b', 2, 2), place('c', 3, 3)],
      (_lat, lng) => kmByLng[lng] ?? null,
    )
    expect(out.map(h => h.id)).toEqual(['b', 'c', 'a'])
  })

  it('puts a place the route cannot position LAST, never first', () => {
    const out = orderByRoad(
      [place('unknown', 9, 9), place('near', 1, 1), place('far', 2, 2)],
      (_lat, lng) => (lng === 9 ? null : lng * 10),
    )
    expect(out.map(h => h.id)).toEqual(['near', 'far', 'unknown'])
  })

  it('leaves the caller\'s array alone', () => {
    const input = [place('a', 1, 1), place('b', 2, 2)]
    const before = input.map(h => h.id)
    orderByRoad(input, () => 0)
    expect(input.map(h => h.id)).toEqual(before)
  })

  it('keeps two unplaceable places in the order they were collected', () => {
    // `Infinity - Infinity` is NaN, which Array.sort reads as "keep the order" —
    // the behaviour the tray shipped with, kept deliberately by this refactor.
    const out = orderByRoad([place('first', 1, 1), place('second', 2, 2)], () => null)
    expect(out.map(h => h.id)).toEqual(['first', 'second'])
  })
})

describe('#420 — slice 1 wiring', () => {
  it('the page renders the tray module instead of carrying its markup', () => {
    expect(mapTab).toContain("from './map/ShortlistTray'")
    expect(mapTab).toMatch(/<ShortlistTray[\s\S]{0,400}?count=\{trayShortlist\.length\}/)
    expect(mapTab).not.toContain('poi-tray-actions')
    expect(mapTab).not.toContain('className="poi-tray"')
  })

  it('the tray component owns no store, no state and no data access', () => {
    expect(tray).toContain('className="poi-tray"')
    expect(tray).toContain('Add all')
    expect(tray).not.toMatch(/\buseState\b|\buseEffect\b|\buseStore\b|applyChange|addDecision/)
  })

  it('the page uses the extracted ordering rule rather than its own sort', () => {
    expect(mapTab).toContain('orderByRoad(trayShortlist, routeKmOf)')
    expect(mapTab).not.toMatch(/\[\.\.\.trayShortlist\]\.sort\(/)
  })

  it('the vote writer stays where its tripwire reads it', () => {
    // Moving it is slice 2's job, together with re-pointing that guard.
    expect(mapTab).toContain('async function raiseShortlistVote()')
    expect(mapTab).toContain('async function addShortlisted()')
  })
})
