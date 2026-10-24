import { describe, expect, it } from 'vitest'
import { addCrewFields, type CrewEntry } from '../src/lib/crewInvite'

describe('separate create crew fields', () => {
  it('stores both fields without parsing digits out of the name', () => {
    const original: CrewEntry[] = []
    const result = addCrewFields(original, { name: '  Team 2  ', mobile: '+91 98450 21234' }, 3)
    expect(result.kind).toBe('added')
    if (result.kind !== 'added') throw new Error('Expected a crew member')
    expect(result.crew[0]).toEqual({ name: 'Team 2', phone: '9845021234', raw: 'Team 2 +91 98450 21234' })
    expect(original).toEqual([])
  })
  it('accepts name-only and number-only entries', () => {
    expect(addCrewFields([], { name: 'Ammu', mobile: '' }, 1)).toMatchObject({ kind: 'added', crew: [{ name: 'Ammu', phone: null }] })
    expect(addCrewFields([], { name: '', mobile: '09845021234' }, 1)).toMatchObject({ kind: 'added', crew: [{ name: '', phone: '9845021234' }] })
  })
  it('rejects a bad mobile even when a name is present', () => {
    for (const mobile of ['123', '5845021234', '+1 9845021234', 'words']) {
      expect(addCrewFields([], { name: 'Ammu', mobile }, 2)).toMatchObject({ kind: 'invalid', field: 'mobile' })
    }
    expect(addCrewFields([], { name: ' ', mobile: '' }, 2)).toMatchObject({ kind: 'invalid', field: 'name' })
  })
  it('keeps duplicate rules and crew limits', () => {
    const crew = [{ name: 'Ammu', phone: '9845021234', raw: 'Ammu 9845021234' }, { name: 'Ravi', phone: null, raw: 'Ravi' }]
    expect(addCrewFields(crew, { name: 'Other', mobile: '+91 9845021234' }, 4)).toMatchObject({ kind: 'unchanged', message: expect.stringContaining('already') })
    expect(addCrewFields(crew, { name: 'ravi', mobile: '' }, 4)).toMatchObject({ kind: 'unchanged', message: expect.stringContaining('already') })
    expect(addCrewFields(crew, { name: 'New', mobile: '' }, 2)).toMatchObject({ kind: 'unchanged', message: expect.stringContaining('full') })
    expect(addCrewFields([], { name: 'New', mobile: '' }, 0)).toMatchObject({ kind: 'unchanged' })
    expect(crew).toHaveLength(2)
  })
})
