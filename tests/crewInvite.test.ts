// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  normalizeIndianMobile, parseCrewEntry, addCrewEntry, whatsappInviteUrl,
  crewInviteMessage, PLANNER_ROLE_LINE, inviteChannelUrl, channelNeedsPhone,
  type CrewEntry,
} from '../src/lib/crewInvite'

describe('crew invites - everything that must be right before anything is sent', () => {
  it('normalises the ways an Indian mobile actually gets typed', () => {
    expect(normalizeIndianMobile('9845021234')).toBe('9845021234')
    expect(normalizeIndianMobile('98450 21234')).toBe('9845021234')
    expect(normalizeIndianMobile('98450-21234')).toBe('9845021234')
    expect(normalizeIndianMobile('+91 98450 21234')).toBe('9845021234')
    expect(normalizeIndianMobile('+919845021234')).toBe('9845021234')
    expect(normalizeIndianMobile('09845021234')).toBe('9845021234')
    expect(normalizeIndianMobile('919845021234')).toBe('9845021234')
    expect(normalizeIndianMobile('(98450) 21234')).toBe('9845021234')
  })

  it('NEGATIVE: refuses anything it cannot honestly message', () => {
    expect(normalizeIndianMobile('12345')).toBeNull()          // too short
    expect(normalizeIndianMobile('9845021234567')).toBeNull()  // too long
    expect(normalizeIndianMobile('1234567890')).toBeNull()     // landline-shaped
    expect(normalizeIndianMobile('5845021234')).toBeNull()     // not a mobile prefix
    expect(normalizeIndianMobile('Ammu')).toBeNull()
    expect(normalizeIndianMobile('')).toBeNull()
    expect(normalizeIndianMobile('+91')).toBeNull()
  })

  it('splits a free-form entry into name and number, or keeps what it got', () => {
    expect(parseCrewEntry('Ammu 98450 21234')).toEqual({ raw: 'Ammu 98450 21234', name: 'Ammu', phone: '9845021234' })
    expect(parseCrewEntry('Ammu +91 98450 21234')).toEqual({ raw: 'Ammu +91 98450 21234', name: 'Ammu', phone: '9845021234' })
    expect(parseCrewEntry('9845021234')).toEqual({ raw: '9845021234', name: '', phone: '9845021234' })
    expect(parseCrewEntry('Ammu (sister)')).toEqual({ raw: 'Ammu (sister)', name: 'Ammu (sister)', phone: null })
    expect(parseCrewEntry('   ')).toEqual({ raw: '', name: '', phone: null })
  })

  it('adding respects the limit, refuses blanks, and refuses duplicates', () => {
    let list: CrewEntry[] = []
    list = addCrewEntry(list, 'Ammu 9845021234', 4)
    expect(list).toHaveLength(1)
    // same number typed differently is still the same person
    const again = addCrewEntry(list, '+91 98450 21234', 4)
    expect(again).toHaveLength(1)
    // a nameless duplicate is caught by name
    let names: CrewEntry[] = []
    names = addCrewEntry(names, 'Rahul', 4)
    expect(addCrewEntry(names, 'rahul', 4)).toHaveLength(1)
    // blanks never land
    expect(addCrewEntry(list, '   ', 4)).toHaveLength(1)
    // the limit is a hard cap
    let l: CrewEntry[] = []
    for (const v of ['a', 'b', 'c', 'd', 'e']) l = addCrewEntry(l, v, 3)
    expect(l.map(e => e.name)).toEqual(['a', 'b', 'c'])
    // a zero limit adds nothing (one traveller = nobody to invite)
    expect(addCrewEntry([], 'Ammu', 0)).toHaveLength(0)
  })

  it('the WhatsApp link carries the country code and an encoded message', () => {
    const url = whatsappInviteUrl('9845021234', 'Hi & welcome')
    expect(url.startsWith('https://wa.me/919845021234?text=')).toBe(true)
    expect(url).toContain('Hi%20%26%20welcome')
    // the text must survive a round trip exactly
    const text = crewInviteMessage({ tripName: 'Kerala with the crew', joinUrl: 'https://x/#/join/GOA-K7QF' })
    const encoded = text
    const back = decodeURIComponent(new URL(whatsappInviteUrl('9845021234', encoded)).searchParams.get('text') || '')
    expect(back).toBe(text)
  })

  it('the message names the trip, says who is planning, and gives the link', () => {
    const msg = crewInviteMessage({ tripName: 'Kerala with the crew', joinUrl: 'https://x/#/join/GOA-K7QF', plannerName: 'Asha', role: 'editor' })
    expect(msg).toContain('Asha is planning')
    expect(msg).toContain('"Kerala with the crew"')
    expect(msg).toContain('https://x/#/join/GOA-K7QF')
    expect(msg).toContain('vote on stops')
    expect(msg.split('\n')).toHaveLength(2)
    // without a planner name it still reads like a person
    const anon = crewInviteMessage({ tripName: 'Goa run', joinUrl: 'https://x/#/join/GOA-K7QF' })
    expect(anon.startsWith("We're planning")).toBe(true)
  })

  it('the message never oversells - no urgency, no exclamation stack, no bait', () => {
    const msg = crewInviteMessage({ tripName: 'Kerala', joinUrl: 'https://x' })
    expect(msg).not.toMatch(/!{2,}/)
    expect(msg.toLowerCase()).not.toMatch(/hurry|limited|expires|don't miss|amazing|free forever/)
    expect(msg.length).toBeLessThan(260)
  })

  it('the planner-role line matches what the invite actually asks', () => {
    expect(PLANNER_ROLE_LINE).toContain('planner')
    expect(PLANNER_ROLE_LINE).toContain('vote')
  })
})

describe('invite channels (the moment-after crew row)', () => {
  const TEXT = 'Has9 is planning "Kerala Backwaters" on YatraFlow.'
  const URL = 'https://yatraflow.app/#/join/KERALABACK-UX6Y'

  it('maps each channel to its honest target - and refuses to fake one', () => {
    // whatsapp carries the number and the prefilled text
    expect(inviteChannelUrl('whatsapp', '9845021234', TEXT, URL)).toBe(
      'https://wa.me/919845021234?text=' + encodeURIComponent(TEXT))
    // sms carries the body too
    expect(inviteChannelUrl('sms', '9845021234', TEXT, URL)).toBe(
      'sms:+919845021234?body=' + encodeURIComponent(TEXT))
    // telegram opens its own chat chooser - no number needed
    const tg = inviteChannelUrl('telegram', null, TEXT, URL)
    expect(tg).toContain('https://t.me/share/url?url=' + encodeURIComponent(URL))
    expect(tg).toContain('&text=' + encodeURIComponent(TEXT))
    // instagram has no DM intent URL - null, never a plausible-looking guess
    expect(inviteChannelUrl('insta', '9845021234', TEXT, URL)).toBeNull()
  })

  it('channels that need a number say so, and go null without one', () => {
    expect(channelNeedsPhone('whatsapp')).toBe(true)
    expect(channelNeedsPhone('sms')).toBe(true)
    expect(channelNeedsPhone('telegram')).toBe(false)
    expect(channelNeedsPhone('insta')).toBe(false)
    expect(inviteChannelUrl('whatsapp', null, TEXT, URL)).toBeNull()
    expect(inviteChannelUrl('sms', null, TEXT, URL)).toBeNull()
  })
})
