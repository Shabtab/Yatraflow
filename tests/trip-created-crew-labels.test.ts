// The moment-after screen's crew rows: what they are called, and what they offer.
//
// A resumed phone-only draft reaches this page as { name:'', phone:null,
// label:'••• 234' }. The page names it from that label and never from a phone it
// does not have, so the row cannot read "+91 null" and two such entries cannot
// collapse into two identical rows. The label is a NAME here, not a number: it
// re-enters the parser as text, finds no mobile, and leaves `phone` null, so
// WhatsApp and SMS stay unavailable.
//
// These import the page's own helpers, so the rules pinned here are the ones the
// page follows.
import { describe, expect, it } from 'vitest'
import { handoffCrewText, crewRowName, composeCrew } from '../src/pages/TripCreated'
import { readHandoff, stashHandoff, type HandoffCrew } from '../src/lib/createHandoff'
import { channelNeedsPhone, inviteChannelUrl, type CrewEntry } from '../src/lib/crewInvite'

/** A handoff store that holds one value, like sessionStorage would. */
function storeWith(handoff: unknown) {
  const map = new Map<string, string>()
  if (handoff !== undefined) map.set('yf.createHandoff.v1', JSON.stringify(handoff))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  }
}

/** The page's own composition, as the page calls it. */
function crewFrom(handoffCrew: HandoffCrew[], extras: string[] = []): CrewEntry[] {
  return composeCrew(handoffCrew, extras, 8)
}

describe('handoffCrewText', () => {
  it('names a phone-only resumed entry by its label, not by a phone it lacks', () => {
    expect(handoffCrewText({ name: '', phone: null, label: '••• 234' })).toBe('••• 234')
  })

  it('keeps a named entry with a number as name and number', () => {
    expect(handoffCrewText({ name: 'Ammu', phone: '9845021234' })).toBe('Ammu 9845021234')
  })

  it('keeps a named entry with no number at all by its name', () => {
    expect(handoffCrewText({ name: 'Ammu', phone: null })).toBe('Ammu')
  })

  it('prefers the name over the label when a resumed entry has both', () => {
    expect(handoffCrewText({ name: 'Ammu', phone: null, label: '••• 234' })).toBe('Ammu')
  })

  it('is empty, not a malformed number, when there is nothing to name', () => {
    expect(handoffCrewText({ name: '', phone: null })).toBe('')
  })
})

describe('the crew a handoff produces on the moment-after screen', () => {
  it('keeps two phone-only entries distinct and never prints +91 null', () => {
    const crew = crewFrom([
      { name: '', phone: null, label: '••• 234' },
      { name: '', phone: null, label: '••• 777' },
    ])
    expect(crew).toHaveLength(2)
    const names = crew.map(crewRowName)
    expect(names).toEqual(['••• 234', '••• 777'])
    expect(names.some(n => n.includes('null'))).toBe(false)
    expect(names.some(n => n.includes('+91'))).toBe(false)
  })

  it('leaves a masked entry with no phone, so no channel can message it', () => {
    const [only] = crewFrom([{ name: '', phone: null, label: '••• 234' }])
    expect(only.phone).toBeNull()
    expect(only.label).toBeUndefined()
    expect(inviteChannelUrl('whatsapp', only.phone, 'hi', 'https://x/join/1')).toBeNull()
    expect(inviteChannelUrl('sms', only.phone, 'hi', 'https://x/join/1')).toBeNull()
    expect(channelNeedsPhone('whatsapp')).toBe(true)
    expect(channelNeedsPhone('sms')).toBe(true)
  })

  it('keeps an ordinary name and number, with its messaging channels available', () => {
    const [only] = crewFrom([{ name: 'Ammu', phone: '9845021234' }])
    expect(only.name).toBe('Ammu')
    expect(only.phone).toBe('9845021234')
    expect(crewRowName(only)).toBe('Ammu')
    expect(inviteChannelUrl('whatsapp', only.phone, 'hi', 'https://x/join/1')).toContain('wa.me/919845021234')
    expect(inviteChannelUrl('sms', only.phone, 'hi', 'https://x/join/1')).toContain('sms:+919845021234')
  })

  it('does not merge a phone-only entry with a named one', () => {
    const crew = crewFrom([
      { name: '', phone: null, label: '••• 234' },
      { name: 'Ammu', phone: '9845021234' },
    ])
    expect(crew).toHaveLength(2)
    expect(crew.map(crewRowName)).toEqual(['••• 234', 'Ammu'])
  })
})

describe('crewRowName', () => {
  it('shows the number when the entry has no name', () => {
    expect(crewRowName({ raw: '9845021234', name: '', phone: '9845021234' })).toBe('+91 9845021234')
  })

  it('never renders a bare number prefix for an entry with no number', () => {
    expect(crewRowName({ raw: '', name: '', phone: null })).toBe('')
  })
})

describe('readHandoff', () => {
  it('returns the label for a phone-only entry and keeps the phone null', () => {
    const store = storeWith({
      tripId: 't1', tripName: 'Kerala', plannerName: 'Me', days: 2, travellers: 2, crew: [
        { name: '', phone: null, label: '••• 234' },
      ], bill: null,
    })
    const handoff = readHandoff('t1', { store })
    expect(handoff?.crew).toEqual([{ name: '', phone: null, label: '••• 234' }])
  })

  it('refuses a full number written into the label slot', () => {
    const store = storeWith({
      tripId: 't1', tripName: 'Kerala', plannerName: 'Me', days: 2, travellers: 2,
      crew: [{ name: '', phone: null, label: '9845021234' }], bill: null,
    })
    expect(readHandoff('t1', { store })?.crew).toEqual([{ name: '', phone: null }])
  })
})

describe('stashHandoff round trip', () => {
  it('carries two distinct phone-only labels through to the page', () => {
    const store = storeWith(undefined)
    const ok = stashHandoff({
      tripId: 't1', tripName: 'Kerala', plannerName: 'Me', roadKm: null, rangeKm: null,
      days: 2, travellers: 2,
      crew: [
        { name: '', phone: null, label: '••• 234' },
        { name: '', phone: null, label: '••• 777' },
      ],
      bill: null,
    }, { store })
    expect(ok).toBe(true)
    const crew = crewFrom(readHandoff('t1', { store })?.crew ?? [])
    expect(crew.map(crewRowName)).toEqual(['••• 234', '••• 777'])
    expect(crew.every(c => c.phone === null)).toBe(true)
  })
})
