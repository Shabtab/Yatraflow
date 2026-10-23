// Pure-logic tests for the latest-request guard (src/lib/latestRequest.ts).
// No DOM: the guard has no React dependency, so the node env runs it directly.
import { describe, expect, it } from 'vitest'
import { createLatestRequest } from '../src/lib/latestRequest'

describe('createLatestRequest', () => {
  it('treats the newest id as current', () => {
    const latest = createLatestRequest()
    const id = latest.begin()
    expect(latest.isCurrent(id)).toBe(true)
  })

  it('makes an older id stale once a newer request begins', () => {
    const latest = createLatestRequest()
    const older = latest.begin()
    const newer = latest.begin()
    expect(latest.isCurrent(older)).toBe(false)
    expect(latest.isCurrent(newer)).toBe(true)
  })

  it('cancel() makes every issued id stale', () => {
    const latest = createLatestRequest()
    const first = latest.begin()
    const second = latest.begin()
    latest.cancel()
    expect(latest.isCurrent(first)).toBe(false)
    expect(latest.isCurrent(second)).toBe(false)
  })

  it('a request begun after cancel() is current again', () => {
    const latest = createLatestRequest()
    const before = latest.begin()
    latest.cancel()
    const after = latest.begin()
    expect(latest.isCurrent(before)).toBe(false)
    expect(latest.isCurrent(after)).toBe(true)
  })

  it('never treats an id that was not issued as current', () => {
    const latest = createLatestRequest()
    expect(latest.isCurrent(0)).toBe(false)
    expect(latest.isCurrent(1)).toBe(false)
    const id = latest.begin()
    expect(latest.isCurrent(id + 1)).toBe(false)
  })

  it('issues unique, increasing ids over many calls', () => {
    const latest = createLatestRequest()
    const ids: number[] = []
    for (let i = 0; i < 1000; i++) {
      ids.push(latest.begin())
      if (i % 100 === 99) latest.cancel()
    }
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
  })

  it('applies only the newest answer when answers arrive out of order', async () => {
    const latest = createLatestRequest()
    const applied: string[] = []
    let resolveOld!: (value: string) => void
    let resolveNew!: (value: string) => void
    const oldAnswer = new Promise<string>(resolve => { resolveOld = resolve })
    const newAnswer = new Promise<string>(resolve => { resolveNew = resolve })

    const oldId = latest.begin()
    const newId = latest.begin()
    const oldDone = oldAnswer.then(value => { if (latest.isCurrent(oldId)) applied.push(value) })
    const newDone = newAnswer.then(value => { if (latest.isCurrent(newId)) applied.push(value) })

    // The newer request answers first. The older one arrives late.
    resolveNew('newer')
    await newDone
    resolveOld('older')
    await oldDone

    expect(applied).toEqual(['newer'])
  })

  it('drops a late answer that arrives after cancel()', async () => {
    const latest = createLatestRequest()
    const applied: string[] = []
    let resolveAnswer!: (value: string) => void
    const answer = new Promise<string>(resolve => { resolveAnswer = resolve })

    const id = latest.begin()
    const done = answer.then(value => { if (latest.isCurrent(id)) applied.push(value) })
    latest.cancel()
    resolveAnswer('late')
    await done

    expect(applied).toEqual([])
  })
})
