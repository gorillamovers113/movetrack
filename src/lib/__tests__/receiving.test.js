import { describe, it, expect } from 'vitest'
import {
  RECEIVING_STEPS, lastNameMismatch,
  receivingChecklist, receivingComplete, receivingDiff, receivedVaults, receivedVaultError,
} from '../mutations.js'

const shot = { url: 'u', kind: 'photo', uid: 'm1', userName: 'Ali', at: 1 }
const vault = (number) => ({ number, uid: 'm1', userName: 'Ali', at: 1, open: shot, closed: shot })
const unit = { number: '906', tenant: 'Maria Ochoa', vaults: [vault('BB-1007'), vault('BB-1008')] }

describe('warehouse checks', () => {
  it('is the three things the manager verifies', () => {
    expect(RECEIVING_STEPS.map((s) => s.key)).toEqual(['recv_number', 'recv_lastname', 'recv_vaults'])
  })

  // A unit's vaults come off a truck one at a time, sometimes an hour apart.
  it('books the vaults in one at a time, not as one list', () => {
    expect(RECEIVING_STEPS.find((s) => s.key === 'recv_vaults').repeatable).toBe(true)
  })

  it('reads a last name the way a person reads it off paperwork', () => {
    expect(lastNameMismatch(unit, 'ochoa')).toBe(null)
    expect(lastNameMismatch(unit, ' Ochoa ')).toBe(null)
    expect(lastNameMismatch(unit, 'Niu')).toEqual({ recorded: 'Ochoa', entered: 'Niu' })
  })

  it('says nothing when there is no name to compare against', () => {
    expect(lastNameMismatch(unit, '')).toBe(null)
    expect(lastNameMismatch({}, 'Ochoa')).toBe(null)
  })
})

/* What the dock is still waiting on, and what turned up that should not have.
 *
 * Expected comes from what the movers actually finished logging on site, not
 * from what anybody remembers loading. */
describe('what has arrived against what was loaded', () => {
  const arrived = (n, matched = true) => ({ number: n, matched, uid: 'w1', userName: 'Jeremy Williams', at: 1 })

  it('is not ok until every logged vault has landed', () => {
    expect(receivingDiff({ ...unit, received: [arrived('BB-1007')] }))
      .toMatchObject({ missing: ['BB-1008'], unexpected: [], ok: false })
    expect(receivingDiff({ ...unit, received: [arrived('BB-1007'), arrived('BB-1008')] }))
      .toMatchObject({ missing: [], unexpected: [], ok: true })
  })

  it('reads a number the way a person reads it off the side', () => {
    expect(receivingDiff({ ...unit, received: [arrived('bb-1007 '), arrived('BB-1008')] }).ok).toBe(true)
  })

  it('names a vault that arrived but was never loaded against this unit', () => {
    const d = receivingDiff({ ...unit, received: [arrived('BB-1007'), arrived('BB-1008'), arrived('BB-9999')] })
    expect(d.unexpected).toEqual(['BB-9999'])
    // Still ok: everything expected is here. The stray is flagged separately,
    // because refusing to book in a unit that is physically on the dock helps
    // nobody.
    expect(d.ok).toBe(true)
  })

  it('ignores a vault the movers never finished logging', () => {
    const half = { ...unit, vaults: [vault('BB-1'), { number: 'BB-2', open: shot }], received: [arrived('BB-1')] }
    expect(receivingDiff(half).ok).toBe(true)
  })

  it('is not ok on a unit where nothing was loaded and nothing arrived', () => {
    expect(receivingDiff({ vaults: [], received: [] }).ok).toBe(false)
  })

  it('does not fall over on junk', () => {
    expect(receivingDiff({}).ok).toBe(false)
    expect(receivedVaults(null)).toEqual([])
    expect(receivedVaults({ received: [null] })).toEqual([])
  })
})

describe('booking a vault in at the dock', () => {
  const withOne = { ...unit, received: [{ number: 'BB-1007', matched: true, at: 1 }] }

  it('refuses a blank, a stub, and one already booked in', () => {
    expect(receivedVaultError('', withOne)).toMatch(/Enter the number/)
    expect(receivedVaultError('B', withOne)).toMatch(/too short/)
    expect(receivedVaultError('bb-1007', withOne)).toMatch(/already booked in/)
    expect(receivedVaultError('BB-1008', withOne)).toBe(null)
  })

  // A stray is recorded and flagged, never refused: it is on the dock either
  // way and the office needs to know it arrived.
  it('accepts a number that is not on this unit, for flagging', () => {
    expect(receivedVaultError('BB-9999', withOne)).toBe(null)
  })
})

describe('the receiving checklist', () => {
  const done = (key) => ({ [key]: { userName: 'Jeremy Williams', at: 1, value: 'x', matched: true } })

  it('counts the vaults row as done only when they are all here', () => {
    const partial = { ...unit, steps: { ...done('recv_number'), ...done('recv_lastname') }, received: [{ number: 'BB-1007', at: 1 }] }
    const row = receivingChecklist(partial).find((r) => r.key === 'recv_vaults')
    expect(row).toMatchObject({ done: false, count: 1, expected: 2, missing: ['BB-1008'] })
    expect(receivingComplete(partial)).toBe(false)
  })

  it('completes once the last one lands', () => {
    const all = {
      ...unit,
      steps: { ...done('recv_number'), ...done('recv_lastname') },
      received: [{ number: 'BB-1007', at: 1 }, { number: 'BB-1008', at: 2 }],
    }
    expect(receivingChecklist(all).find((r) => r.key === 'recv_vaults').done).toBe(true)
    expect(receivingComplete(all)).toBe(true)
  })

  // A unit sitting half-received forever is worse than one booked in short
  // with a flag on it, because only one of those gets chased.
  it('completes when the manager says the rest did not come', () => {
    const short = {
      ...unit,
      steps: {
        ...done('recv_number'), ...done('recv_lastname'),
        recv_vaults_short: { userName: 'Jeremy Williams', at: 3, missing: ['BB-1008'] },
      },
      received: [{ number: 'BB-1007', at: 1 }],
    }
    expect(receivingChecklist(short).find((r) => r.key === 'recv_vaults')).toMatchObject({ done: true, short: true })
    expect(receivingComplete(short)).toBe(true)
  })

  it('credits the first vault booked in, and counts them all', () => {
    const u = { ...unit, received: [
      { number: 'BB-1008', userName: 'Jeremy Williams', at: 900 },
      { number: 'BB-1007', userName: 'Robin Vale', at: 100 },
    ] }
    expect(receivingChecklist(u).find((r) => r.key === 'recv_vaults'))
      .toMatchObject({ by: 'Robin Vale', at: 100, count: 2 })
  })
})
