import { describe, expect, it } from 'vitest'
import { addCrewEntry, addCrewFields, parseCrewEntry, type CrewEntry } from '../src/lib/crewInvite'

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

describe('a free-form crew entry', () => {
  it.each(['Ammu (98450) 21234', 'Ammu +91 (98450) 21234', 'Ammu 0 (98450) 21234', 'Ammu 91-98450-21234', 'Team 2 (98450) 21234'])('accepts the complete formatted number in %s', raw => {
    expect(parseCrewEntry(raw)).toMatchObject({ name: raw.startsWith('Team') ? 'Team 2' : 'Ammu', phone: '9845021234' })
  })
  it.each(['+971 9845021234', 'Ammu +971 9845021234', '+44 (98450) 21234', '+1 9845021234', '971 9845021234', '98450212345', '9845021234 999', '+91 9845021234 999'])('refuses a suffix of an unsupported or ambiguous number in %s', raw => {
    expect(parseCrewEntry(raw).phone).toBeNull()
  })
  it.each([
    ['Ammu 9845021234', 'Ammu 9876543210', 2],
    ['Ammu 9845021234', 'Other 9845021234', 1],
    ['Ammu', 'ammu', 1],
    ['Ammu', 'Ammu 9845021234', 1],
    ['Ammu 9845021234', 'Ammu', 1],
    ['9845021234', '+91 9845021234', 1],
    ['Ammu', 'Ravi 9845021234', 2],
  ])('applies the same duplicate rule to both input paths: %s / %s', (first, second, length) => {
    const crew = addCrewEntry([], first, 4)
    expect(addCrewEntry(crew, second, 4)).toHaveLength(length)
    const entry = parseCrewEntry(second)
    const result = addCrewFields(crew, { name: entry.name, mobile: entry.phone || '' }, 4)
    expect(result.kind).toBe(length === 2 ? 'added' : 'unchanged')
  })
  it('lifts the number out before the name is read, so a digit in the name cannot eat it', () => {
    expect(parseCrewEntry('Ammu 98450 21234')).toEqual({ raw: 'Ammu 98450 21234', name: 'Ammu', phone: '9845021234' })
    // The regression: normalizing the whole string folded the name's "2" into
    // the number, the 10-digit test failed, and the number vanished.
    expect(parseCrewEntry('Team 2 98450 21234')).toEqual({ raw: 'Team 2 98450 21234', name: 'Team 2', phone: '9845021234' })
    expect(parseCrewEntry('Ravi Kumar 2nd 9845021234')).toEqual({ raw: 'Ravi Kumar 2nd 9845021234', name: 'Ravi Kumar 2nd', phone: '9845021234' })
  })
  it('still accepts the prefixed and dashed forms, and keeps name-only and number-only entries', () => {
    expect(parseCrewEntry('+91 98450 21234').phone).toBe('9845021234')
    expect(parseCrewEntry('09845021234').phone).toBe('9845021234')
    expect(parseCrewEntry('98450-21234').phone).toBe('9845021234')
    expect(parseCrewEntry('Ammu')).toEqual({ raw: 'Ammu', name: 'Ammu', phone: null })
    expect(parseCrewEntry('Team 2')).toEqual({ raw: 'Team 2', name: 'Team 2', phone: null })
  })
  it('refuses a number that is not an Indian mobile rather than guessing', () => {
    for (const bad of ['123', '5845021234', '+1 9845021234', '9198450212345', 'words']) {
      expect(parseCrewEntry(bad).phone).toBeNull()
    }
  })
  it('keeps the same person on one chip when a number is added to a known name', () => {
    const crew = addCrewEntry([], 'Ammu', 3)
    // The second entry is refused rather than merged: the typed number is not
    // silently attached to an existing row the user did not select.
    const again = addCrewEntry(crew, 'Ammu 9845021234', 3)
    expect(again).toHaveLength(1)
    expect(again[0]).toEqual({ raw: 'Ammu', name: 'Ammu', phone: null })
    // A number for a DIFFERENT name is still added.
    const other = addCrewEntry(crew, 'Ravi 9845021234', 3)
    expect(other).toHaveLength(2)
  })
})
