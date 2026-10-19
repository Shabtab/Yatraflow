import { describe, expect, it } from 'vitest'
import { stopPresentation } from '../src/lib/stopKind'

describe('transport stop presentation', () => {
  it('uses the selected mode for a travel stop', () => {
    const stop = { category: 'travel' as const, title: 'Delhi to Mumbai' }
    expect(stopPresentation(stop, 'flight')).toMatchObject({ label: 'Flight', mode: 'flight' })
    expect(stopPresentation(stop, 'train')).toMatchObject({ label: 'Train', mode: 'train' })
    expect(stopPresentation(stop, 'bus')).toMatchObject({ label: 'Bus', mode: 'bus' })
    expect(stopPresentation(stop, 'car')).toMatchObject({ label: 'Drive', mode: 'car' })
    expect(stopPresentation(stop, 'mixed').label).toBe('Travel')
  })

  it('keeps airport transfers on the ground in a flight trip', () => {
    expect(stopPresentation({ category: 'travel', title: 'Taxi to airport' }, 'flight'))
      .toMatchObject({ label: 'Taxi', mode: 'taxi' })
    expect(stopPresentation({ category: 'travel', title: 'Airport transfer to hotel' }, 'flight'))
      .toMatchObject({ label: 'Transfer', mode: 'taxi' })
    expect(stopPresentation({ category: 'travel', title: 'Mumbai stay', auto: true }, 'flight'))
      .toMatchObject({ label: 'Route point', mode: 'mixed' })
  })

  it('names the hub rather than calling an airport a drive', () => {
    expect(stopPresentation({ category: 'transport-hub', title: 'Delhi airport' }, 'flight'))
      .toMatchObject({ label: 'Airport', mode: 'flight' })
    expect(stopPresentation({ category: 'transport-hub', title: 'Howrah station' }, 'train').label)
      .toBe('Transport hub')
  })

  it('preserves non-transport labels and the existing style kinds', () => {
    expect(stopPresentation({ category: 'travel', title: 'Travel' }).label).toBe('Travel')
    expect(stopPresentation({ category: 'hotel', title: 'Hotel' }, 'flight'))
      .toEqual({ kind: 'stay', label: 'Stay' })
    expect(stopPresentation({ category: 'travel', title: 'Delhi to Mumbai' }, 'flight').kind)
      .toBe('drive')
  })
})
