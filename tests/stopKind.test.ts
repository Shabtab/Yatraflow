// ============ Stop-kind marker tests ============
// Pure logic, node env — guards the category/title → StopKind display mapping
// used by the Timeline stop cards (Calm Travel Intelligence M4).
import { describe, it, expect } from 'vitest'
import { stopKindOf, STOP_KIND_LABELS, type StopKind } from '../src/lib/stopKind'

describe('stopKindOf', () => {
  it('maps travel categories to drive', () => {
    expect(stopKindOf({ category: 'travel', title: 'Manali → Keylong' })).toBe('drive')
    expect(stopKindOf({ category: 'transport-hub', title: 'Howrah station' })).toBe('drive')
  })

  it('maps hotel/food/rest categories to their kinds', () => {
    expect(stopKindOf({ category: 'hotel', title: 'Jispa camp check-in' })).toBe('stay')
    expect(stopKindOf({ category: 'food', title: 'Lunch at Keylong' })).toBe('food')
    expect(stopKindOf({ category: 'rest', title: 'More Plains tea break' })).toBe('rest')
  })

  it('detects fuel halts by title regardless of category', () => {
    expect(stopKindOf({ category: 'rest', title: 'Upshi fuel stop' })).toBe('fuel')
    expect(stopKindOf({ category: 'sightseeing', title: 'Petrol pump top-up' })).toBe('fuel')
    expect(stopKindOf({ category: 'rest', title: 'EV charging break' })).toBe('fuel')
  })

  it('detects scenic viewpoints by title words, and nature/beach/adventure categories', () => {
    expect(stopKindOf({ category: 'sightseeing', title: 'Baralacha La pass' })).toBe('viewpoint')
    expect(stopKindOf({ category: 'activity' as never, title: 'Shanti Stupa sunset' })).toBe('viewpoint')
    expect(stopKindOf({ category: 'nature', title: 'Pine forest walk' })).toBe('viewpoint')
    expect(stopKindOf({ category: 'beach', title: 'Radhanagar swim' })).toBe('viewpoint')
    expect(stopKindOf({ category: 'adventure', title: 'River crossing' })).toBe('viewpoint')
  })

  it('falls back to activity for culture categories and missing data', () => {
    expect(stopKindOf({ category: 'temple', title: 'Rumtek monastery' })).toBe('activity')
    expect(stopKindOf({ category: 'museum', title: 'Indian Museum' })).toBe('activity')
    expect(stopKindOf({ category: 'shopping', title: 'Mall Road' })).toBe('activity')
    expect(stopKindOf({ title: 'Uncategorised stop' })).toBe('activity')
  })

  it('has a display label for every kind', () => {
    const kinds: StopKind[] = ['drive', 'stay', 'food', 'fuel', 'rest', 'activity', 'viewpoint']
    for (const k of kinds) expect(STOP_KIND_LABELS[k]).toBeTruthy()
    expect(Object.keys(STOP_KIND_LABELS).sort()).toEqual([...kinds].sort())
  })
})
