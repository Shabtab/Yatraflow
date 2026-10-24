// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  saveDraft, loadDraft, clearDraft, draftIsWorthKeeping, draftAgeLabel, maskPhone,
  DRAFT_KEY, DRAFT_VERSION, type DraftStore,
} from '../src/lib/createDraft'
import { CREATE_STEPS } from '../src/lib/createSteps'

/** A Map-backed Storage stand-in. */
function fakeStore(opts: { failSet?: boolean; failGet?: boolean } = {}): DraftStore & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem(k: string) {
      if (opts.failGet) throw new Error('denied')
      return map.has(k) ? map.get(k)! : null
    },
    setItem(k: string, v: string) {
      if (opts.failSet) throw new Error('QuotaExceededError')
      map.set(k, v)
    },
    removeItem(k: string) { map.delete(k) },
  }
}

const payload = {
  form: { name: 'Kerala with the crew', startLocation: 'Kochi, Kerala', startDate: '2026-02-14', endDate: '2026-02-19' },
  dests: [{ name: 'Munnar, Kerala', lat: 10.0889, lng: 77.0595 }],
  returnCount: 0,
  crew: [{ name: 'Ammu', phone: '9845021234' }, { name: 'Rahul', phone: null }],
}

describe('create drafts - the unfinished trip that waits', () => {
  it('round-trips a draft through the store', () => {
    const store = fakeStore()
    expect(saveDraft(payload, { store, now: new Date('2026-02-01T10:00:00Z') })).toBe(true)
    const got = loadDraft({ store })
    expect(got).not.toBeNull()
    expect(got!.v).toBe(DRAFT_VERSION)
    expect(got!.savedAt).toBe('2026-02-01T10:00:00.000Z')
    expect(got!.form.name).toBe('Kerala with the crew')
    expect(got!.dests).toHaveLength(1)
    // the crew rides along - a resumed draft does not lose the people. The
    // NUMBER does not: only the last three digits are stored (D7), so a number
    // sitting in localStorage is not a copy of someone else's phone number. The
    // mask lives in `label`, and `phone` is null, so nothing can message it.
    expect(got!.crew).toEqual([{ name: 'Ammu', phone: null, label: '••• 234' }, { name: 'Rahul', phone: null }])
    expect(store.map.has(DRAFT_KEY)).toBe(true)
  })

  it('re-saving overwrites rather than duplicating', () => {
    const store = fakeStore()
    saveDraft(payload, { store })
    saveDraft({ ...payload, form: { ...payload.form, name: 'Second name' } }, { store })
    expect(store.map.size).toBe(1)
    expect(loadDraft({ store })!.form.name).toBe('Second name')
  })

  it('NEGATIVE: a version we do not understand is discarded, not half-read', () => {
    const store = fakeStore()
    store.map.set(DRAFT_KEY, JSON.stringify({ v: 99, savedAt: 'x', form: {}, dests: [], returnCount: 0 }))
    expect(loadDraft({ store })).toBeNull()
  })

  it('NEGATIVE: corrupt or partial JSON degrades to "no draft"', () => {
    const store = fakeStore()
    store.map.set(DRAFT_KEY, '{not json')
    expect(loadDraft({ store })).toBeNull()
    store.map.set(DRAFT_KEY, JSON.stringify({ v: DRAFT_VERSION }))
    expect(loadDraft({ store })).toBeNull()
    store.map.set(DRAFT_KEY, JSON.stringify({ v: DRAFT_VERSION, savedAt: 'x', form: null }))
    expect(loadDraft({ store })).toBeNull()
  })

  it('NEGATIVE: a denied or full store never throws, it just declines', () => {
    const full = fakeStore({ failSet: true })
    expect(saveDraft(payload, { store: full })).toBe(false)
    const denied = fakeStore({ failGet: true })
    expect(loadDraft({ store: denied })).toBeNull()
    expect(saveDraft(payload, { store: null })).toBe(false)
    expect(loadDraft({ store: null })).toBeNull()
    expect(clearDraft({ store: null })).toBe(false)
  })

  it('a draft written before crew existed loads with an empty crew, not a crash', () => {
    const store = fakeStore()
    saveDraft({ form: { name: 'Old' }, dests: [], returnCount: 0 }, { store })
    const got = loadDraft({ store })!
    expect(got.crew).toEqual([])
  })

  it('junk in the crew list is dropped rather than believed', () => {
    const store = fakeStore()
    store.map.set(DRAFT_KEY, JSON.stringify({ v: DRAFT_VERSION, savedAt: 'x', form: { name: 'X' }, dests: [], returnCount: 0, crew: [{ phone: 42 }, null, { name: 'ok', phone: '9845021234' }] }))
    const got = loadDraft({ store })!
    expect(got.crew).toEqual([{ name: 'ok', phone: null, label: '••• 234' }])
  })

  it('clear removes it for good', () => {
    const store = fakeStore()
    saveDraft(payload, { store })
    expect(clearDraft({ store })).toBe(true)
    expect(loadDraft({ store })).toBeNull()
  })

  it('an untouched form is not worth interrupting anyone about', () => {
    expect(draftIsWorthKeeping(null)).toBe(false)
    expect(draftIsWorthKeeping({
      v: DRAFT_VERSION, savedAt: 'x', returnCount: 0, dests: [],
      form: { name: '', startLocation: '', startDate: '', endDate: '', travellers: 2 },
    })).toBe(false)
  })

  it('a crew-only draft is worth resuming - the planner typed those people', () => {
    const d = { v: DRAFT_VERSION, savedAt: 'x', returnCount: 0, dests: [], form: { name: '', startLocation: '' }, crew: [{ name: 'Ammu', phone: '9845021234' }] } as never as StoredDraft
    expect(draftIsWorthKeeping(d)).toBe(true)
  })

  it('any real progress makes it worth keeping', () => {
    const base = { v: DRAFT_VERSION, savedAt: 'x', returnCount: 0, dests: [] as const }
    expect(draftIsWorthKeeping({ ...base, form: { name: 'Goa' } })).toBe(true)
    expect(draftIsWorthKeeping({ ...base, form: { startLocation: 'Panaji, Goa' } })).toBe(true)
    expect(draftIsWorthKeeping({ ...base, form: { startDate: '2026-02-14' } })).toBe(true)
    expect(draftIsWorthKeeping({ ...base, form: {}, dests: [{ name: 'Palolem, Goa' }] })).toBe(true)
  })

  it('the age label is coarse and honest', () => {
    const now = new Date('2026-02-01T12:00:00Z')
    expect(draftAgeLabel('2026-02-01T11:59:40Z', now)).toBe('just now')
    expect(draftAgeLabel('2026-02-01T11:48:00Z', now)).toBe('12 min ago')
    expect(draftAgeLabel('2026-02-01T09:00:00Z', now)).toBe('3 h ago')
    expect(draftAgeLabel('2026-01-31T09:00:00Z', now)).toBe('yesterday')
    expect(draftAgeLabel('2026-01-28T09:00:00Z', now)).toBe('4 days ago')
    expect(draftAgeLabel('not-a-date', now)).toBe('earlier')
  })

  it('a draft with junk in dests or returnCount is still loadable and safe', () => {
    const store = fakeStore()
    store.map.set(DRAFT_KEY, JSON.stringify({
      v: DRAFT_VERSION, savedAt: 'x', form: { name: 'X' },
      dests: [{ name: 'ok' }, { nope: 1 }, null, { name: 'fine' }],
      returnCount: -4.7,
    }))
    const got = loadDraft({ store })!
    expect(got.dests.map(d => d.name)).toEqual(['ok', 'fine'])
    expect(got.returnCount).toBe(0)
  })
})

describe('create drafts - the step a draft was left on', () => {
  it('round-trips the step, so a resumed draft reopens where it was', () => {
    const store = fakeStore()
    saveDraft({ ...payload, step: 'budget' }, { store })
    expect(loadDraft({ store })!.step).toBe('budget')
  })

  it('a draft written before the guided flow loads with no step, not a crash', () => {
    // The version gate rejects any other `v`, so `step` had to be optional
    // rather than a version bump - a bump would have thrown every draft away.
    const store = fakeStore()
    saveDraft(payload, { store })
    const got = loadDraft({ store })!
    expect(got.step).toBeUndefined()
    expect(got.form.name).toBe('Kerala with the crew')
  })

  it('discards a step this build does not know', () => {
    // A future build could add a step, and its draft can outlive the build that
    // wrote it. A screen that does not exist is worse than the start.
    const store = fakeStore()
    store.map.set(DRAFT_KEY, JSON.stringify({
      v: DRAFT_VERSION, savedAt: 'x', form: { name: 'X' }, dests: [], returnCount: 0, step: 'packing',
    }))
    expect(loadDraft({ store })!.step).toBeUndefined()
  })

  it('discards a step that is not even a string', () => {
    const store = fakeStore()
    store.map.set(DRAFT_KEY, JSON.stringify({
      v: DRAFT_VERSION, savedAt: 'x', form: { name: 'X' }, dests: [], returnCount: 0, step: 7,
    }))
    expect(loadDraft({ store })!.step).toBeUndefined()
  })

  it('accepts every one of the six steps', () => {
    for (const step of CREATE_STEPS) {
      const store = fakeStore()
      saveDraft({ ...payload, step }, { store })
      expect(loadDraft({ store })!.step).toBe(step)
    }
  })
})

describe('create drafts - crew numbers are masked (D7)', () => {
  it('keeps the last three digits and nothing else', () => {
    expect(maskPhone('9845021234')).toBe('••• 234')
    expect(maskPhone('+91 98450 21234')).toBe('••• 234')
    expect(maskPhone('098450-21234')).toBe('••• 234')
  })

  it('never writes a full number to the store', () => {
    const store = fakeStore()
    saveDraft(payload, { store })
    // The whole point: the raw storage string must not contain the number.
    expect(store.map.get(DRAFT_KEY)).not.toContain('9845021234')
    expect(store.map.get(DRAFT_KEY)).toContain('••• 234')
  })

  it('masks a full number that an older draft already put on the device', () => {
    // Written before D7, read after it. The number is on the device either way;
    // this build must not hand it back.
    const store = fakeStore()
    store.map.set(DRAFT_KEY, JSON.stringify({
      v: DRAFT_VERSION, savedAt: 'x', form: { name: 'X' }, dests: [], returnCount: 0,
      crew: [{ name: 'Ammu', phone: '9845021234' }],
    }))
    expect(loadDraft({ store })!.crew).toEqual([{ name: 'Ammu', phone: null, label: '••• 234' }])
  })

  it('keeps the identity of a phone-only entry, and keeps two of them apart', () => {
    // The regression: a phone-only chip resumed with an empty name and a null
    // phone, so it lost its name, its Remove label and its identity on the next
    // autosave. The label carries who it is without carrying the number.
    const store = fakeStore()
    saveDraft({
      ...payload,
      crew: [{ name: '', phone: '9845021234' }, { name: '', phone: '9845077777' }],
    }, { store })
    const got = loadDraft({ store })!
    expect(got.crew).toEqual([
      { name: '', phone: null, label: '••• 234' },
      { name: '', phone: null, label: '••• 777' },
    ])
    // Two entries, two different labels: they do not collapse into one chip.
    expect(new Set(got.crew!.map(c => c.label)).size).toBe(2)
  })

  it('keeps the label through a second save, so autosave cannot lose it', () => {
    const store = fakeStore()
    saveDraft({ ...payload, crew: [{ name: '', phone: '9845021234' }] }, { store })
    const resumed = loadDraft({ store })!
    // What the page hands back on the next autosave: phone is null, label rides
    // along. The stored copy must still name the person.
    saveDraft({ ...payload, crew: resumed.crew! }, { store })
    expect(loadDraft({ store })!.crew).toEqual([{ name: '', phone: null, label: '••• 234' }])
  })

  it('refuses a full number stored in the label slot', () => {
    // A label is a display string, never a number. A hand-edited draft that puts
    // a full number there is dropped rather than shown or linked.
    const store = fakeStore()
    store.map.set(DRAFT_KEY, JSON.stringify({
      v: DRAFT_VERSION, savedAt: 'x', form: { name: 'X' }, dests: [], returnCount: 0,
      crew: [{ name: '', phone: null, label: '9845021234' }],
    }))
    expect(loadDraft({ store })!.crew).toEqual([{ name: '', phone: null }])
  })

  it('leaves a crew member with no number alone', () => {
    const store = fakeStore()
    saveDraft({ ...payload, crew: [{ name: 'Rahul', phone: null }] }, { store })
    expect(loadDraft({ store })!.crew).toEqual([{ name: 'Rahul', phone: null }])
  })

  it('an empty number masks to an empty string rather than three bullets', () => {
    expect(maskPhone('')).toBe('')
    expect(maskPhone('no digits here')).toBe('')
  })
})
