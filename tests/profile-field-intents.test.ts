import { describe, expect, it } from 'vitest'
import type { PrivateUserProfile } from '../src/data/types'
import { applyLedger, beginLedger, settleLedger } from '../src/store/fieldIntents'

const base: PrivateUserProfile = { name: 'A', isCreator: false, creatorAvailable: true, languages: [], travelStyles: [], homeCity: 'Base' }

describe('overlapping profile intents', () => {
  for (const equal of [true, false]) for (const firstAccepted of [true, false]) for (const secondAccepted of [true, false]) {
    it.each([[0, 1], [1, 0]])(`keeps issue order with equal=${equal}, outcomes=${firstAccepted},${secondAccepted}, completion=%j`, (first, second) => {
      const values = ['One', equal ? 'One' : 'Two']
      let ledger = beginLedger(undefined, base, 1, { homeCity: values[0] })
      ledger = beginLedger(ledger, base, 2, { homeCity: values[1] })
      const accepted = [firstAccepted, secondAccepted]
      for (const index of [first, second]) ledger = settleLedger(ledger, index + 1, accepted[index] ? 'accepted' : 'failed')
      expect(applyLedger(ledger, base).homeCity).toBe(secondAccepted ? values[1] : firstAccepted ? values[0] : 'Base')
    })
  }

  it('removes a refused optional field and keeps an unrelated server update', () => {
    const ledger = settleLedger(beginLedger(undefined, base, 1, { creatorBio: 'Refused' }), 1, 'failed')
    const result = applyLedger(ledger, { ...base, name: 'Remote rename', creatorBio: 'Refused' })
    expect(result).not.toHaveProperty('creatorBio')
    expect(result.name).toBe('Remote rename')
  })
})
