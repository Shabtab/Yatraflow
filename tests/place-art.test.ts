import { describe, expect, it } from 'vitest'
import {
  placeArtFor,
  placeArtIdFor,
  placeFallbacksFrom,
  placeTables,
  tokensOf,
  type PlaceArtFallbacks,
  type PlaceArtTables,
} from '../src/lib/placeArt'
import { ART_MANIFEST, coverFor, focalXFor, focalYFor } from '../src/lib/regionArt'

const FALLBACKS: PlaceArtFallbacks = placeFallbacksFrom(ART_MANIFEST)
const TABLES = placeTables()

/** A tiny table pair, so a test states only the entries it needs. */
function tablesOf(
  destinations: Array<[string, string, string[]]>,
  states: Array<[string, string[]]>,
): PlaceArtTables {
  return {
    destination: Object.fromEntries(destinations.map(([place, state, ids]) => [place.toLowerCase(), { place, state, ids, aliases: [] }])),
    state: Object.fromEntries(states.map(([state, ids]) => [state.toLowerCase(), { state, ids, aliases: [] }])),
  }
}

describe('tokensOf', () => {
  it('splits on every non-letter and lower-cases', () => {
    expect(tokensOf('Jammu & Kashmir')).toEqual(['jammu', 'kashmir'])
    expect(tokensOf('Rishikesh, Uttarakhand')).toEqual(['rishikesh', 'uttarakhand'])
    expect(tokensOf('  NEW   DELHI ')).toEqual(['new', 'delhi'])
    expect(tokensOf('')).toEqual([])
  })

  it('keeps a non-Latin script as a token rather than dropping it', () => {
    // The app's own regionFor uses \p{L}, so this layer must not be stricter.
    expect(tokensOf('कोच्चि')).toEqual(['कोच्चि'])
  })

  it('does not treat a digit run as a place token', () => {
    expect(tokensOf('Sector 17, Chandigarh')).toEqual(['sector', 'chandigarh'])
  })
})

describe('tokensOf boundaries: a short substring never matches', () => {
  it('does not resolve a name that merely contains a place name', () => {
    // These are the classic false positives. Each one contains a supported name
    // as a character run but not as a token, so it must not match.
    for (const near of ['Goalpara', 'Keralapuram', 'Goainghat', 'Panjimabad']) {
      const match = placeArtFor([near], near, FALLBACKS, TABLES)
      expect(match?.kind, near).toBe('generic')
    }
  })

  it('does not match a state name embedded in a longer token', () => {
    for (const near of ['Biharsharif', 'Odishapur', 'Punjabia']) {
      expect(placeArtFor([near], near, FALLBACKS, TABLES)?.kind, near).toBe('generic')
    }
  })

  it('matches the same names once they are their own token', () => {
    expect(placeArtFor(['Goalpara, Assam'], 's', FALLBACKS, TABLES)?.kind).toBe('state')
    expect(placeArtFor(['Keralapuram, Kerala'], 's', FALLBACKS, TABLES)?.kind).toBe('state')
  })
})

describe('exact supported destination override', () => {
  it('gives a named destination its own scene, not its state scene', () => {
    const match = placeArtFor(['Rishikesh'], 'seed-1', FALLBACKS, TABLES)
    expect(match).toMatchObject({ kind: 'destination', id: 'rishikesh-v1', place: 'Rishikesh' })
  })

  it('resolves a destination written with its state after a comma', () => {
    for (const spelling of ['Rishikesh, Uttarakhand', 'rishikesh', '  RISHIKESH  ']) {
      expect(placeArtFor([spelling], 's', FALLBACKS, TABLES), spelling).toMatchObject({ kind: 'destination', id: 'rishikesh-v1' })
    }
  })

  it('resolves every one of the nine required destination scenes', () => {
    const expected: Array<[string, string]> = [
      ['Udaipur', 'udaipur-v1'],
      ['Munnar', 'munnar-v1'],
      ['Darjeeling', 'darjeeling-v1'],
      ['Jaipur', 'jaipur-v1'],
      ['Mumbai', 'mumbai-v1'],
      ['Leh', 'leh-v1'],
      ['Manali', 'manali-v1'],
      ['Rishikesh', 'rishikesh-v1'],
      ['Shillong', 'shillong-v1'],
    ]
    for (const [place, id] of expected) {
      const match = placeArtFor([place], place, FALLBACKS, TABLES)
      expect(match?.kind, place).toBe('destination')
      // A single-id destination can only resolve to that id.
      expect(match?.id, place).toBe(id)
    }
  })

  it('keeps a place with two scenes inside its own pair', () => {
    // Coorg owns coorg-1 and coorg-2. Any seed must pick one of them, and both
    // must be reachable, because the variant choice is seed-driven.
    const seen = new Set<string>()
    for (let index = 0; index < 200; index += 1) {
      const match = placeArtFor(['Coorg'], `seed-${index}`, FALLBACKS, TABLES)
      expect(match?.kind).toBe('destination')
      expect(['coorg-1', 'coorg-2']).toContain(match?.id)
      if (match) seen.add(match.id)
    }
    expect([...seen].sort()).toEqual(['coorg-1', 'coorg-2'])
  })

  it('honours an explicit alias and only an explicit one', () => {
    expect(placeArtFor(['Alleppey'], 's', FALLBACKS, TABLES)).toMatchObject({ kind: 'destination', id: 'kerala-1' })
    expect(placeArtFor(['Bombay'], 's', FALLBACKS, TABLES)).toMatchObject({ kind: 'destination', id: 'mumbai-v1' })
    // "Alappy" is not an alias, so it stays unknown.
    expect(placeArtFor(['Alappy'], 's', FALLBACKS, TABLES)?.kind).toBe('generic')
  })
})

describe('state and UT representative fallback', () => {
  it('gives a supported jurisdiction its representative scene', () => {
    // Only single-scene jurisdictions are listed here: for these, any seed must
    // produce the one declared id, so the assertion is exact.
    const expected: Array<[string, string]> = [
      ['Bhubaneswar, Odisha', 'odisha-v1'],
      ['Patna, Bihar', 'bihar-v1'],
      ['Varanasi, Uttar Pradesh', 'uttar-pradesh-v1'],
      ['Kolkata, West Bengal', 'west-bengal-v1'],
      ['Ahmedabad, Gujarat', 'gujarat-v1'],
      ['Amritsar, Punjab', 'punjab-v1'],
      ['Gangtok, Sikkim', 'sikkim-v1'],
      ['Kohima, Nagaland', 'nagaland-v1'],
      ['Agartala, Tripura', 'tripura-v1'],
      ['Imphal, Manipur', 'manipur-v1'],
      ['Aizawl, Mizoram', 'mizoram-v1'],
      ['Raipur, Chhattisgarh', 'chhattisgarh-v1'],
      ['Ranchi, Jharkhand', 'jharkhand-v1'],
      ['Bhopal, Madhya Pradesh', 'madhya-pradesh-v1'],
      ['Itanagar, Arunachal Pradesh', 'arunachal-pradesh-v1'],
      ['Dispur, Assam', 'assam-v1'],
      ['Guwahati, Assam', 'assam-v1'],
      ['Hyderabad, Telangana', 'telangana-v1'],
      ['Chennai, Tamil Nadu', 'tamil-nadu-v1'],
      ['Chandigarh', 'chandigarh-v1'],
      ['Kavaratti, Lakshadweep', 'lakshadweep-v1'],
      ['Port Blair, Andaman and Nicobar Islands', 'andaman-and-nicobar-islands-v1'],
      ['Silvassa', 'dadra-and-nagar-haveli-and-daman-and-diu-v1'],
      ['New Delhi', 'delhi-v1'],
      ['Panaji, Goa', 'goa-1,goa-2'],
    ]
    for (const [place, id] of expected) {
      const match = placeArtFor([place], place, FALLBACKS, TABLES)
      // The kind is an internal distinction; what matters is the scene. Delhi is
      // both a UT and a city that share one id, so it may resolve as either.
      expect(['state', 'destination'], place).toContain(match?.kind)
      if (id.includes(',')) expect(id.split(','), place).toContain(match?.id)
      else expect(match?.id, place).toBe(id)
    }
  })

  it('gives Shillong its own destination scene, not the Meghalaya representative', () => {
    // Shillong is a supported destination inside a multi-scene state. The
    // specific scene wins over the jurisdiction's two generic scenes.
    const match = placeArtFor(['Shillong, Meghalaya'], 's', FALLBACKS, TABLES)
    expect(match).toMatchObject({ kind: 'destination', id: 'shillong-v1' })
  })

  it('reaches a multi-scene jurisdiction only through its own ids', () => {
    // Goa owns goa-1 and goa-2, so a Goa stop must land on one of those two and
    // never on a neighbouring state's scene.
    const seen = new Set<string>()
    for (let index = 0; index < 200; index += 1) {
      const match = placeArtFor(['Panaji, Goa'], `seed-${index}`, FALLBACKS, TABLES)
      expect(match?.kind).toBe('state')
      expect(['goa-1', 'goa-2']).toContain(match?.id)
      if (match) seen.add(match.id)
    }
    expect([...seen].sort()).toEqual(['goa-1', 'goa-2'])
  })

  it('resolves every one of the 36 jurisdictions in the manifest', () => {
    // The coverage plan lists 36 jurisdictions: 31 generated new plus 5 reuse.
    const states = Object.values(TABLES.state)
    expect(states).toHaveLength(36)
    for (const entry of states) {
      const match = placeArtFor([entry.state], entry.state, FALLBACKS, TABLES)
      expect(['state', 'destination'], entry.state).toContain(match?.kind)
      expect(entry.ids, entry.state).toContain(match?.id)
    }
  })
})

describe('cross-state trips', () => {
  it('gives a neutral road scene when matched stops span two states', () => {
    const match = placeArtFor(['Rishikesh', 'Panaji, Goa'], 'trip-1', FALLBACKS, TABLES)
    expect(match?.kind).toBe('crossState')
    expect(['road-1', 'road-2']).toContain(match?.id)
    expect(match).toMatchObject({ states: ['Goa', 'Uttarakhand'] })
  })

  it('never labels a cross-state trip with the first stop state scene', () => {
    // The failure this guards is subtle: taking the first stop's state would
    // paint Uttarakhand's mountains on a trip that also goes to Goa.
    const match = placeArtFor(['Rishikesh, Uttarakhand', 'Panaji, Goa', 'Mumbai'], 'trip-2', FALLBACKS, TABLES)
    expect(match?.kind).toBe('crossState')
    expect(['uttarakhand-v1', 'goa-1', 'goa-2']).not.toContain(match?.id)
  })

  it('still names a single state when one stop is unsupported', () => {
    // One positive match is one state. An unsupported second stop is not
    // evidence of another state, so the jurisdiction scene still applies.
    const match = placeArtFor(['Rishikesh, Uttarakhand', 'Palolem'], 'trip-3', FALLBACKS, TABLES)
    expect(match).toMatchObject({ kind: 'destination', id: 'rishikesh-v1' })
  })

  it('prefers a state scene over the road family when both stops agree', () => {
    const match = placeArtFor(['Varanasi, Uttar Pradesh', 'Lucknow, Uttar Pradesh'], 'trip-4', FALLBACKS, TABLES)
    expect(match).toMatchObject({ kind: 'state', id: 'uttar-pradesh-v1', state: 'Uttar Pradesh' })
  })

  it('treats a same-state pair as one state, not a cross-state trip', () => {
    expect(placeArtFor(['Jaipur', 'Udaipur'], 'trip-5', FALLBACKS, TABLES)?.kind).not.toBe('crossState')
  })
})

describe('unknown and ambiguous controls', () => {
  it('gives the neutral scene for an unsupported name', () => {
    for (const place of ['Ziro Valley', 'Hampi', 'Palolem', 'Somewhere Else']) {
      expect(placeArtFor([place], place, FALLBACKS, TABLES)?.kind, place).toBe('generic')
      expect(placeArtFor([place], place, FALLBACKS, TABLES)?.id, place).toBe('generic-1')
    }
  })

  it('gives the neutral scene for an empty or blank destination list', () => {
    for (const list of [[], [''], ['   '], null, undefined]) {
      const match = placeArtFor(list, 's', FALLBACKS, TABLES)
      expect(match?.kind).toBe('generic')
      expect(match?.id).toBe('generic-1')
    }
  })

  it('treats a name two disagreeing tables claim as ambiguous, not as a guess', () => {
    // A synthetic disagreement: the UT and the city point at different scenes.
    // The honest answer is the neutral scene, never the first table consulted.
    const tables = tablesOf(
      [['Duplicatetown', 'Some State', ['city-scene']]],
      [['Duplicatetown', ['ut-scene']]],
    )
    const match = placeArtFor(['Duplicatetown'], 's', FALLBACKS, tables)
    expect(match?.kind).toBe('generic')
  })

  it('accepts a name both tables claim when they agree on the scene', () => {
    // Delhi and Puducherry are each a UT and a city that share one scene. That
    // is not ambiguity, so those names keep that scene.
    for (const place of ['Delhi', 'Puducherry', 'new delhi']) {
      const match = placeArtFor([place], place, FALLBACKS, TABLES)
      expect(match?.kind, place).not.toBe('generic')
      expect(['delhi-v1', 'puducherry-v1'], place).toContain(match?.id)
    }
  })

  it('does not let an inherited Object name resolve to a scene', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(placeArtFor([name], name, FALLBACKS, TABLES)?.kind, name).toBe('generic')
    }
  })
})

describe('seed stability', () => {
  it('returns the same scene for the same seed, 1000 times', () => {
    for (const place of ['Coorg', 'Panaji, Goa', 'Rishikesh', 'Unknown Place']) {
      const first = placeArtFor([place], 'stable-seed', FALLBACKS, TABLES)
      for (let index = 0; index < 1000; index += 1) {
        expect(placeArtFor([place], 'stable-seed', FALLBACKS, TABLES), place).toEqual(first)
      }
    }
  })

  it('keeps a single-scene place on that scene for every seed', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(placeArtIdFor(['Bhubaneswar, Odisha'], `seed-${index}`, FALLBACKS, TABLES)).toBe('odisha-v1')
    }
  })

  it('does not change the scene when only the destination order changes', () => {
    for (const [a, b] of [['Jaipur', 'Udaipur'], ['Panaji, Goa', 'Rishikesh'], ['Patna, Bihar', 'Palolem']]) {
      const forward = placeArtFor([a, b], 'trip', FALLBACKS, TABLES)
      const backward = placeArtFor([b, a], 'trip', FALLBACKS, TABLES)
      expect(backward?.id, `${a} / ${b}`).toBe(forward?.id)
      expect(backward?.kind, `${a} / ${b}`).toBe(forward?.kind)
    }
  })

  it('does not name a two-destination trip after the first destination', () => {
    // Jaipur and Udaipur are both in Rajasthan and each own a scene. The trip is
    // not a Jaipur trip, so it takes the state scene, not jaipur-v1.
    const match = placeArtFor(['Jaipur', 'Udaipur'], 'trip', FALLBACKS, TABLES)
    expect(match).toMatchObject({ kind: 'state', id: 'rajasthan-v1', state: 'Rajasthan' })
  })
})

describe('upload precedence', () => {
  it('lets the user cover win over a destination scene', () => {
    const choice = coverFor({
      userCover: 'https://example.com/mine.jpg',
      region: 'generic',
      seed: 's',
      placeCount: 1,
      destinations: ['Rishikesh'],
    })
    expect(choice).toEqual({ kind: 'user', url: 'https://example.com/mine.jpg' })
  })

  it('lets the user cover win over a state scene and over a cross-state trip', () => {
    for (const destinations of [['Patna, Bihar'], ['Rishikesh', 'Panaji, Goa']]) {
      expect(coverFor({ userCover: 'https://example.com/x.jpg', region: 'generic', seed: 's', placeCount: 2, destinations }))
        .toEqual({ kind: 'user', url: 'https://example.com/x.jpg' })
    }
  })

  it('still treats a blank cover as no cover', () => {
    expect(coverFor({ userCover: '   ', region: 'generic', seed: 's', placeCount: 1, destinations: ['Patna, Bihar'] }))
      .toEqual({ kind: 'generated', id: 'bihar-v1' })
  })
})

describe('coverFor — integration with the place layer', () => {
  it('reaches a jurisdiction scene through the cover chain', () => {
    expect(coverFor({ region: 'generic', seed: 'trip', placeCount: 1, destinations: ['Patna, Bihar'] }))
      .toEqual({ kind: 'generated', id: 'bihar-v1' })
  })

  it('reaches an accepted destination scene through the cover chain', () => {
    expect(coverFor({ region: 'generic', seed: 'trip', placeCount: 1, destinations: ['Rishikesh'] }))
      .toEqual({ kind: 'generated', id: 'rishikesh-v1' })
  })

  it('falls through to the region chain for a name the place layer does not know', () => {
    // Munnar is a supported destination in a supported state, but a place the
    // place layer does not recognise must not short-circuit the seven-region
    // chain: "Munnar" is Kerala there too, and both answers are the same scene.
    expect(coverFor({ region: 'kerala', seed: 'trip', placeCount: 1, destinations: ['Munnar'] }))
      .toEqual({ kind: 'generated', id: 'munnar-v1' })
    // "Palolem" is unknown to both layers, so the generic scene answers.
    expect(coverFor({ region: 'generic', seed: 'trip', placeCount: 1, destinations: ['Palolem'] }))
      .toEqual({ kind: 'generated', id: 'generic-1' })
  })

  it('preserves the old region result when no destinations are passed at all', () => {
    // The hero postcards historically passed only a region. That call shape must
    // keep working, and must keep reaching the same seven-region scenes.
    for (const region of ['kerala', 'goa', 'rajasthan', 'coorg', 'meghalaya', 'kashmir', 'generic'] as const) {
      expect(coverFor({ region, seed: 'trip-1', placeCount: 1 })?.kind, region).toBe('generated')
    }
    expect(coverFor({ region: 'kerala', seed: 'trip-1', placeCount: 1 })).toEqual({ kind: 'generated', id: 'kerala-1' })
  })

  it('uses a neutral road scene for a cross-state trip through the cover chain', () => {
    const choice = coverFor({ region: 'generic', seed: 'trip', placeCount: 2, destinations: ['Rishikesh', 'Panaji, Goa'] })
    expect(choice?.kind).toBe('generated')
    expect(['road-1', 'road-2']).toContain(choice && choice.kind === 'generated' ? choice.id : '')
  })
})

describe('focalXFor', () => {
  it('reads the declared square offset for Rishikesh and the default elsewhere', () => {
    // 360 / 512 overflow of a 1536x1024 master in a 1:1 box = 70.3125%.
    expect(focalXFor('rishikesh-v1', '1:1')).toBe(70.3125)
    expect(focalXFor('rishikesh-v1', '16:10')).toBe(50)
    expect(focalXFor('rishikesh-v1', '3:1')).toBe(50)
  })

  it('returns 50 for every id that declares no focalX', () => {
    for (const id of Object.keys(ART_MANIFEST.ids)) {
      if (id === 'rishikesh-v1') continue
      for (const ratio of ['default', '1:1', '16:10', '3:1']) {
        expect(focalXFor(id, ratio), `${id} ${ratio}`).toBe(50)
      }
    }
  })

  it('returns 50 for an unknown id, including inherited Object names', () => {
    for (const name of ['no-such-id', 'constructor', 'toString', '__proto__']) {
      expect(focalXFor(name, '1:1'), name).toBe(50)
    }
  })

  it('clamps an out-of-range declared value instead of panning the scene', () => {
    const manifest = {
      ...ART_MANIFEST,
      ids: {
        ...ART_MANIFEST.ids,
        'too-far': { widths: [320], webp: 320, ratio: '3:2', focalY: { default: 50 }, focalX: { default: 420 } },
        'negative': { widths: [320], webp: 320, ratio: '3:2', focalY: { default: 50 }, focalX: { default: -30 } },
        'not-finite': { widths: [320], webp: 320, ratio: '3:2', focalY: { default: 50 }, focalX: { default: Number.NaN } },
        'only-ratio': { widths: [320], webp: 320, ratio: '3:2', focalY: { default: 50 }, focalX: { default: 50, '1:1': 88 } },
      },
    }
    expect(focalXFor('too-far', '1:1', manifest)).toBe(100)
    expect(focalXFor('negative', '1:1', manifest)).toBe(0)
    expect(focalXFor('not-finite', '1:1', manifest)).toBe(50)
    expect(focalXFor('only-ratio', '1:1', manifest)).toBe(88)
    expect(focalXFor('only-ratio', '16:10', manifest)).toBe(50)
  })

  it('leaves the existing focalY behaviour untouched', () => {
    // The two axes are independent. Adding focalX must not move any focalY.
    expect(focalYFor('rishikesh-v1', '1:1')).toBe(50)
    expect(focalYFor('kerala-1', '21:9')).toBe(40)
    expect(focalYFor('himalaya-2', '3:1')).toBe(40)
    expect(focalYFor('no-such-id', '3:1')).toBe(50)
  })

  it('declares focalX on exactly the one id whose square crop needs it', () => {
    const withFocalX = Object.entries(ART_MANIFEST.ids).filter(([, entry]) => entry.focalX !== undefined).map(([id]) => id)
    expect(withFocalX).toEqual(['rishikesh-v1'])
  })
})

describe('manifest places tables', () => {
  it('points every place entry at a declared id', () => {
    const declared = new Set(Object.keys(ART_MANIFEST.ids))
    for (const entry of Object.values(TABLES.destination)) {
      for (const id of entry.ids) expect(declared.has(id), `${entry.place} -> ${id}`).toBe(true)
    }
    for (const entry of Object.values(TABLES.state)) {
      for (const id of entry.ids) expect(declared.has(id), `${entry.state} -> ${id}`).toBe(true)
    }
  })

  it('gives every destination a state that the state table also knows', () => {
    const states = new Set(Object.values(TABLES.state).map(entry => entry.state))
    for (const entry of Object.values(TABLES.destination)) {
      expect(states.has(entry.state), `${entry.place} -> ${entry.state}`).toBe(true)
    }
  })

  it('does not let one jurisdiction alias collide with another', () => {
    // An alias that is another jurisdiction's canonical name would make the
    // longest-run rule decide between two states, which is a guess.
    const canonical = new Map(Object.values(TABLES.state).map(entry => [entry.state.toLowerCase(), entry.state]))
    for (const entry of Object.values(TABLES.state)) {
      for (const alias of entry.aliases) {
        const owner = canonical.get(alias)
        if (owner !== undefined) expect(owner, `${entry.state} claims "${alias}"`).toBe(entry.state)
      }
    }
  })

  it('keeps every alias a whole name, never a fragment', () => {
    for (const entry of [...Object.values(TABLES.state), ...Object.values(TABLES.destination)]) {
      for (const alias of entry.aliases) {
        expect(alias.trim(), alias).toBe(alias)
        expect(alias, alias).not.toBe('')
        expect(tokensOf(alias).length, alias).toBeGreaterThan(0)
      }
    }
  })
})

describe('retained and superseded assets', () => {
  it('keeps the retained Karnataka original and does not reference the rejected study', () => {
    // karnataka-study-v2 is rejected. The manifest must name karnataka-v1 only.
    const allIds = Object.keys(ART_MANIFEST.ids)
    expect(allIds).toContain('karnataka-v1')
    expect(allIds.some(id => id.includes('karnataka-study'))).toBe(false)
    expect(placeArtFor(['Bengaluru, Karnataka'], 's', FALLBACKS, TABLES)).toMatchObject({ kind: 'state', id: 'karnataka-v1' })
  })

  it('resolves Jammu and Kashmir to the active v2, and never to the superseded v1', () => {
    const match = placeArtFor(['Srinagar'], 's', FALLBACKS, TABLES)
    expect(match).toMatchObject({ kind: 'destination', id: 'jammu-and-kashmir-v2' })
    expect(placeArtFor(['Jammu and Kashmir'], 's', FALLBACKS, TABLES)?.id).toBe('jammu-and-kashmir-v2')
    expect(Object.keys(ART_MANIFEST.ids)).not.toContain('jammu-and-kashmir-v1')
  })

  it('keeps Ladakh separate from the Kashmir valley', () => {
    // Himalaya-1 is the trans-Himalayan lake scene, which belongs to Ladakh. A
    // Kashmir destination must not reach it, or a valley trip would show a
    // barren high-altitude lake.
    expect(placeArtFor(['Leh'], 's', FALLBACKS, TABLES)).toMatchObject({ kind: 'destination', id: 'leh-v1' })
    expect(placeArtFor(['Ladakh'], 's', FALLBACKS, TABLES)).toMatchObject({ kind: 'state', id: 'himalaya-1' })
    for (const valley of ['Srinagar', 'Gulmarg', 'Pahalgam', 'Jammu and Kashmir']) {
      expect(placeArtFor([valley], 's', FALLBACKS, TABLES)?.id, valley).not.toBe('himalaya-1')
    }
  })

  it('keeps the inherited seven-region scenes reachable', () => {
    // The older set must not disappear behind the new one: every id the seven
    // regions named is still declared.
    const referenced = [
      ...Object.values(ART_MANIFEST.regions).flat(),
      ...Object.values(ART_MANIFEST.fallbacks).flat(),
      ...Object.values(ART_MANIFEST.vignettes),
    ]
    const declared = new Set(Object.keys(ART_MANIFEST.ids))
    for (const id of referenced) expect(declared.has(id), id).toBe(true)
  })
})
