// The "kept for you" card: pure helpers over real fields only.
// Node env, no DOM. Source pins read text with CRLF turned into LF first.
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  boughtOn, buildPurchaseShelf, creatorFirstName, isKeptRow, keepsakeChips, keepsakeLine, republishedLine,
  type PurchaseRow,
} from '../src/lib/purchases'
import type { Entitlement, PurchaseOrder } from '../src/lib/payments'
import type { PublishedItinerary, User } from '../src/data/types'

const read = async (relativePath: string) =>
  (await readFile(join(process.cwd(), relativePath), 'utf8')).replace(/\r\n/g, '\n')

const GRANTED_AT = Date.UTC(2026, 8, 12, 10, 0)

function pub(overrides: Partial<PublishedItinerary> = {}): PublishedItinerary {
  return {
    id: 'pub_a', tripId: 'trip_a', creatorId: 'creator_1', title: 'Spiti Valley Circuit',
    tagline: 'Cold desert, high passes', routeSummary: ['Shimla', 'Kaza'], durationDays: 6,
    estimatedBudgetPerPersonInr: 24000, travelStyle: 'roadtrip', travelTips: ['Carry cash', 'Acclimatise'],
    warningsAndAssumptions: [], freeDayIndexes: [0], premiumPriceInr: 500, publishedAt: 1_700_000_000_000,
    views: 1, copies: 1, ...overrides,
  }
}

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return { id: 'ent_1', userId: 'buyer_1', pubId: 'pub_a', orderId: 'order_1', amountPaidInr: 500, grantedAt: GRANTED_AT, ...overrides }
}

function creator(name: string, avatarUrl?: string): User {
  return { id: 'creator_1', email: 'c@example.com', createdAt: 0, profile: { name, avatarUrl, languages: ['en'], travelStyles: [], isCreator: true } }
}

function rowFor(pubOverrides: Partial<PublishedItinerary> = {}, name = 'Priya Nair', avatarUrl?: string): PurchaseRow {
  return buildPurchaseShelf([entitlement()], [pub(pubOverrides)], [creator(name, avatarUrl)]).rows[0]!
}

describe('the row carries the creator’s own fields', () => {
  it('reads the avatar, the tip count, the best season and the tagline', () => {
    const row = rowFor({ bestSeason: 'Oct–Mar' }, 'Priya Nair', 'https://example.com/p.png')
    expect(row.creatorAvatarUrl).toBe('https://example.com/p.png')
    expect(row.tipCount).toBe(2)
    expect(row.bestSeason).toBe('Oct–Mar')
    expect(row.tagline).toBe('Cold desert, high passes')
  })

  it('leaves a field empty when the source is missing or blank', () => {
    const row = rowFor({ travelTips: ['', '  '], bestSeason: '   ', tagline: '' })
    expect(row.tipCount).toBe(0)
    expect(row.bestSeason).toBeUndefined()
    expect(row.tagline).toBeUndefined()
    expect(row.creatorAvatarUrl).toBeUndefined()
  })

  it('gives zero tips and no season for a plan whose row is gone', () => {
    const row = buildPurchaseShelf([entitlement({ pubId: 'pub_gone' })], [], []).rows[0]!
    expect(row.rowExists).toBe(false)
    expect(row.tipCount).toBe(0)
    expect(row.bestSeason).toBeUndefined()
  })

  it('does not throw on a publication whose list fields are not arrays', () => {
    const broken = pub({ travelTips: undefined as unknown as string[], bestSeason: 5 as unknown as string })
    expect(() => buildPurchaseShelf([entitlement()], [broken], [creator('Priya Nair')])).not.toThrow()
    const row = buildPurchaseShelf([entitlement()], [broken], [creator('Priya Nair')]).rows[0]!
    expect(row.tipCount).toBe(0)
    expect(row.bestSeason).toBeUndefined()
  })
})

describe('keepsakeLine', () => {
  it('names the creator and the date the plan became yours', () => {
    const line = keepsakeLine(rowFor())
    expect(line).toBe(`Made by Priya Nair · yours since ${boughtOn(GRANTED_AT, true)}`)
    expect(line).toContain('12 Sep')
    expect(line).toContain('2026')
  })

  it('is null when the creator’s name is missing', () => {
    const row = buildPurchaseShelf([entitlement()], [pub()], []).rows[0]!
    expect(row.creatorName).toBeUndefined()
    expect(keepsakeLine(row)).toBeNull()
  })

  it('drops the date part when the date cannot be read, and never prints an invalid date', () => {
    const row = buildPurchaseShelf([entitlement({ grantedAt: Number.NaN })], [pub()], [creator('Priya Nair')]).rows[0]!
    expect(row.dateReadable).toBe(false)
    const line = keepsakeLine(row)
    expect(line).toBe('Made by Priya Nair')
    expect(line).not.toMatch(/invalid|unknown/i)
  })

  it('never throws on a bare row', () => {
    expect(() => keepsakeLine({} as PurchaseRow)).not.toThrow()
    expect(keepsakeLine({} as PurchaseRow)).toBeNull()
  })
})

describe('keepsakeChips', () => {
  it('shows a tips chip and a season chip from real data, in the creator’s first name', () => {
    expect(keepsakeChips(rowFor({ bestSeason: 'Oct–Mar' }))).toEqual(['2 tips from Priya', 'Best Oct–Mar, says Priya'])
  })

  it('says "1 tip" for one tip', () => {
    expect(keepsakeChips(rowFor({ travelTips: ['Carry cash'] }))).toEqual(['1 tip from Priya'])
  })

  it('has no tips chip when there are no tips', () => {
    const chips = keepsakeChips(rowFor({ travelTips: [], bestSeason: 'Oct–Mar' }))
    expect(chips).toEqual(['Best Oct–Mar, says Priya'])
    expect(chips.join(' ')).not.toMatch(/\b0 tips?\b/)
  })

  it('has no season chip when the season is missing', () => {
    expect(keepsakeChips(rowFor({ bestSeason: undefined }))).toEqual(['2 tips from Priya'])
  })

  it('gives no chips at all when there is nothing real to say', () => {
    expect(keepsakeChips(rowFor({ travelTips: [], bestSeason: '' }))).toEqual([])
  })

  it('credits "the creator" when the name is missing, never a made-up name', () => {
    const row = buildPurchaseShelf([entitlement()], [pub({ bestSeason: 'Oct–Mar' })], []).rows[0]!
    expect(keepsakeChips(row)).toEqual(['2 tips from the creator', 'Best Oct–Mar, says the creator'])
  })

  it('never throws on a bare row', () => {
    expect(() => keepsakeChips({} as PurchaseRow)).not.toThrow()
    expect(keepsakeChips({} as PurchaseRow)).toEqual([])
  })
})

describe('creatorFirstName', () => {
  it('takes the first word, and the whole name when it is one word', () => {
    expect(creatorFirstName('Priya Nair')).toBe('Priya')
    expect(creatorFirstName('  VerdentDev ')).toBe('VerdentDev')
    expect(creatorFirstName('')).toBeUndefined()
    expect(creatorFirstName(undefined)).toBeUndefined()
  })
})

describe('republishedLine', () => {
  const LATER = GRANTED_AT + 40 * 86_400_000

  it('names the creator and the month, and claims no more than a re-publish', () => {
    const line = republishedLine(rowFor({ refreshedAt: LATER }))
    expect(line).toBe('Priya Nair re-published this plan in Oct 2026, after you bought it.')
    expect(line).not.toMatch(/new|added|changed|stops|fixed|improved/i)
  })

  it('follows the existing rule: no line when the plan was not re-published after the purchase', () => {
    expect(republishedLine(rowFor({ refreshedAt: undefined }))).toBeNull()
    expect(republishedLine(rowFor({ refreshedAt: GRANTED_AT - 1000 }))).toBeNull()
    expect(republishedLine(rowFor({ refreshedAt: GRANTED_AT }))).toBeNull()
  })

  it('says "The creator" when the name is missing', () => {
    const row = buildPurchaseShelf([entitlement()], [pub({ refreshedAt: LATER })], []).rows[0]!
    expect(republishedLine(row)).toMatch(/^The creator re-published this plan in /)
  })
})

describe('isKeptRow: only a held plan gets the kept card', () => {
  it('is true for an active, paid, on-sale plan', () => {
    expect(isKeptRow(rowFor())).toBe(true)
  })

  it('is false for a plan that is off sale, and the row is still listed', () => {
    const row = rowFor({ unpublishedAt: 1_760_000_000_000 })
    expect(row.rowExists).toBe(true)
    expect(isKeptRow(row)).toBe(false)
  })

  it('is false for a plan whose publication row is gone', () => {
    const row = buildPurchaseShelf([entitlement({ pubId: 'pub_gone' })], [], []).rows[0]!
    expect(isKeptRow(row)).toBe(false)
  })

  it('is false for a refunded purchase', () => {
    const order: PurchaseOrder = {
      id: 'order_1', userId: 'buyer_1', pubId: 'pub_a', amountInr: 500, status: 'failed',
      createdAt: GRANTED_AT, paidAt: GRANTED_AT, refundedPaise: 50_000,
    }
    const row = buildPurchaseShelf([], [pub()], [creator('Priya Nair')], [order]).rows[0]!
    expect(row.refunded).toBe(true)
    expect(isKeptRow(row)).toBe(false)
  })

  it('is false for a payment whose grant has not landed', () => {
    const order: PurchaseOrder = {
      id: 'order_9', userId: 'buyer_1', pubId: 'pub_a', amountInr: 500, status: 'paid',
      createdAt: GRANTED_AT, paidAt: GRANTED_AT, refundedPaise: 0,
    }
    const row = buildPurchaseShelf([], [pub()], [creator('Priya Nair')], [order]).rows[0]!
    expect(row.pendingGrant).toBe(true)
    expect(isKeptRow(row)).toBe(false)
  })
})

describe('the page wires the kept card and keeps the plain one for the other rows', () => {
  it('uses the keepsake line, chips and seal only for a kept row', async () => {
    const source = await read('src/pages/Purchases.tsx')
    expect(source).toContain('const provenance = isKeptRow(row) ? keepsakeLine(row) : null')
    expect(source).toContain('const keptChips = isKeptRow(row) ? keepsakeChips(row) : []')
    expect(source).toContain('{isKeptRow(row) && (')
    expect(source).toContain('className="pur-seal"')
    expect(source).toContain('<BookmarkCheck size={13} aria-hidden />')
  })

  it('keeps the plain provenance line for every other row', async () => {
    const source = await read('src/pages/Purchases.tsx')
    expect(source).toContain('creator no longer listed')
    expect(source).toContain('bought {boughtOn(row.grantedAt, row.dateReadable)}')
  })

  it('hides the avatar from assistive technology, because the name is in the text', async () => {
    const source = await read('src/pages/Purchases.tsx')
    expect(source).toContain('<span className="pur-avatar" aria-hidden="true">')
  })

  it('keeps the refunded, pending and off-sale notes', async () => {
    const source = await read('src/pages/Purchases.tsx')
    expect(source).toContain('The money for this plan was refunded')
    expect(source).toContain('<b>Payment received</b>')
    expect(source).toContain('This plan is not listed publicly any more.')
  })
})
