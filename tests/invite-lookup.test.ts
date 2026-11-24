// ============ #1019 — what a code lookup's answer means ============
//
// classifyInviteRows is the one place that decides whether the RPC's answer is
// a trip, a dead link, or a failed read. fetchTripByInviteCode and the join
// gate both rely on it, so the decisions are pinned here, on the function
// itself.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { classifyInviteRows } from '../src/lib/inviteLookup'

const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const ROW = { id: '1019b000-0000-4000-8000-000000000001', write_version: 3, name: 'Goa Beach Week' }

describe('classifyInviteRows', () => {
  it('no rows is dead: the RPC answered, and no trip has this code', () => {
    expect(classifyInviteRows([])).toEqual({ kind: 'dead' })
  })

  it('a row with a trip id and a usable write_version is found', () => {
    expect(classifyInviteRows([ROW])).toEqual({ kind: 'found', row: ROW })
  })

  it('a row with an empty or missing trip id is failed, not dead', () => {
    expect(classifyInviteRows([{ ...ROW, id: '' }])).toEqual({ kind: 'failed' })
    expect(classifyInviteRows([{ ...ROW, id: undefined }])).toEqual({ kind: 'failed' })
  })

  it('a row whose write_version is not a non-negative safe integer is failed', () => {
    for (const write_version of [undefined, null, 1.5, -1, '3', Number.MAX_SAFE_INTEGER + 2]) {
      expect(classifyInviteRows([{ ...ROW, write_version }]), `write_version ${String(write_version)}`).toEqual({ kind: 'failed' })
    }
  })

  it('a null row in the array is failed', () => {
    expect(classifyInviteRows([null])).toEqual({ kind: 'failed' })
  })

  it('a data value that is not an array is failed: a refused shape is a server fault', () => {
    for (const data of [null, undefined, {}, 'x']) {
      expect(classifyInviteRows(data), String(data)).toEqual({ kind: 'failed' })
    }
  })

  it('the join gate shows the dead-link copy word for word', () => {
    expect(APP).toContain('This invite link no longer works.')
    expect(APP).toContain('Ask the trip owner for a new one. If you are already on this trip, open it from My trips.')
  })
})
