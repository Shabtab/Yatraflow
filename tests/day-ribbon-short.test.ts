// The day ribbon tiles stay short: one row, every tile the same width, and a
// locked tile that never names its place or its title.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DayRibbon, ribbonPlaceOf, type RibbonDay } from '../src/components/storefront/DayRibbon'

function render(days: RibbonDay[], lockedWord = 'Paid plan'): string {
  return renderToStaticMarkup(
    createElement(DayRibbon, {
      label: 'The plan',
      head: { kicker: 'The plan', figure: '6 days', sub: '5 free' },
      days,
      current: null,
      lockedWord,
      onPick: () => {},
    }),
  )
}

describe('ribbonPlaceOf', () => {
  it('prefers a real town field', () => {
    expect(ribbonPlaceOf({ title: 'Day 1', state: 'free' }, 'Manali')).toBe('Manali')
  })
  it('reads the head of a title', () => {
    expect(ribbonPlaceOf({ title: 'Shimla — arrive & acclimatize', state: 'free' })).toBe('Shimla')
  })
  it('reads the end of an arrow route', () => {
    expect(ribbonPlaceOf({ title: 'Chitkul → Kalpa', state: 'free' })).toBe('Kalpa')
  })
  it('reads the town after a closing "to"', () => {
    expect(ribbonPlaceOf({ title: 'The Kinnaur road — to Chitkul', state: 'free' })).toBe('Chitkul')
    expect(ribbonPlaceOf({ title: 'Over the Hindustan–Tibet road to Tabo', state: 'free' })).toBe('Tabo')
    expect(ribbonPlaceOf({ title: 'The Gramphu track to Manali', state: 'free' })).toBe('Manali')
  })
  it('gives nothing when the title names no town', () => {
    expect(ribbonPlaceOf({ title: 'A slow day of walks', state: 'free' })).toBeUndefined()
    expect(ribbonPlaceOf({ title: 'Drive back to the start', state: 'free' })).toBeUndefined()
  })
  it('gives nothing for a locked day, even with a field', () => {
    expect(ribbonPlaceOf({ title: 'Shimla — arrive', state: 'locked' }, 'Shimla')).toBeUndefined()
  })
})

describe('DayRibbon tiles', () => {
  const locked: RibbonDay = {
    index: 4,
    title: 'Shimla — arrive & acclimatize',
    state: 'locked',
    placeCount: 3,
    place: 'Shimla',
  }

  it('shows Paid plan and the count on a locked tile, never the name', () => {
    const html = render([locked])
    expect(html).toContain('Paid plan')
    expect(html).toContain('3 places')
    expect(html).not.toContain('Shimla')
    expect(html).not.toContain('arrive')
  })

  it('shows the place on a free tile', () => {
    const html = render([{ index: 0, title: 'Day 1', state: 'free', placeCount: 2, place: 'Manali' }])
    expect(html).toContain('Manali')
    expect(html).toContain('2 places')
  })

  it('falls back to the title when place is undefined', () => {
    const html = render([{ index: 0, title: 'The Kinnaur road', state: 'yours', placeCount: 1 }])
    expect(html).toContain('The Kinnaur road')
  })
})
