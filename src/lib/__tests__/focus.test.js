import { describe, it, expect } from 'vitest'
import { openPackingUnit, openLoadingUnit, blockingUnit, blockedMessage } from '../focus.js'

/* One apartment at a time.
 *
 * Liv had 906 and 902 both open on 8 Sep and a photo of one landed on the
 * other. These tests describe the constraint that makes that impossible. */

const LIV = { uid: 'liv', name: 'Liv Post', role: 'packer' }
const VIC = { uid: 'vic', name: 'Víctor Mendez', role: 'mover' }
const AARON = { uid: 'aaron', name: 'Aaron Soto', role: 'crew' }
const CASEY = { uid: 'casey', name: 'Casey P', role: 'admin' }

const shot = { url: 'u', kind: 'photo', uid: 'vic', userName: 'V', at: 1 }
const unit = (over) => ({
  id: over.id, number: over.number, stage: over.stage || 'not_started',
  crew: { packers: over.packers || [], movers: over.movers || [] },
  steps: over.steps || {}, vaults: over.vaults || [],
})

describe('the unit somebody still has open', () => {
  it('is the one they are mid-pack on', () => {
    const units = [unit({ id: 'a', number: '906', stage: 'packing', packers: ['liv'] })]
    expect(openPackingUnit(units, LIV).number).toBe('906')
  })

  it('is not one they already finished packing', () => {
    const units = [unit({ id: 'a', number: '906', stage: 'packed', packers: ['liv'] })]
    expect(openPackingUnit(units, LIV)).toBe(null)
  })

  it('is not a unit belonging to somebody else', () => {
    const units = [unit({ id: 'a', number: '906', stage: 'packing', packers: ['aaron'] })]
    expect(openPackingUnit(units, LIV)).toBe(null)
  })

  // Opening a unit to look at it must not lock somebody out of the building.
  it('for a mover, needs an actual tick, not just being credited', () => {
    const looked = [unit({ id: 'a', number: '906', stage: 'packed', movers: ['vic'] })]
    expect(openLoadingUnit(looked, VIC)).toBe(null)

    const started = [unit({ id: 'a', number: '906', stage: 'packed', movers: ['vic'], steps: { load_unit_photo: { at: 1 } } })]
    expect(openLoadingUnit(started, VIC).number).toBe('906')
  })

  it('is not a loaded unit, because loading is over', () => {
    const units = [unit({ id: 'a', number: '906', stage: 'loaded', movers: ['vic'], steps: { load_unit_photo: { at: 1 } } })]
    expect(openLoadingUnit(units, VIC)).toBe(null)
  })

  it('sees both jobs for somebody who does both', () => {
    const units = [
      unit({ id: 'a', number: '903', stage: 'packing', packers: ['aaron'] }),
      unit({ id: 'b', number: '902', stage: 'packed', movers: ['aaron'], steps: { load_unit_photo: { at: 1 } } }),
    ]
    expect(openPackingUnit(units, AARON).number).toBe('903')
    expect(openLoadingUnit(units, AARON).number).toBe('902')
  })

  it('does not fall over on junk', () => {
    expect(openPackingUnit(null, LIV)).toBe(null)
    expect(openPackingUnit([null, {}], LIV)).toBe(null)
    expect(openPackingUnit([], null)).toBe(null)
  })
})

describe('what blocks starting another', () => {
  const units = [
    unit({ id: 'a', number: '906', stage: 'packing', packers: ['liv'] }),
    unit({ id: 'b', number: '902', stage: 'not_started' }),
  ]

  // The exact situation from 8 Sep.
  it('blocks a second apartment while the first is open', () => {
    expect(blockingUnit(units, LIV, 'b', 'packing').number).toBe('906')
  })

  it('never blocks the unit they already have open', () => {
    expect(blockingUnit(units, LIV, 'a', 'packing')).toBe(null)
  })

  it('does not block when nothing is open', () => {
    expect(blockingUnit([units[1]], LIV, 'b', 'packing')).toBe(null)
  })

  // The admin is who untangles a mess; blocking them would be self-defeating.
  it('never blocks an admin', () => {
    const asAdmin = [...units, unit({ id: 'c', number: '901', stage: 'packing', packers: ['casey'] })]
    expect(blockingUnit(asAdmin, CASEY, 'b', 'packing')).toBe(null)
  })

  // The two jobs are tracked apart: mid-pack on one does not stop a load.
  it('keeps packing and loading separate', () => {
    const both = [
      unit({ id: 'a', number: '903', stage: 'packing', packers: ['aaron'] }),
      unit({ id: 'b', number: '902', stage: 'packed' }),
    ]
    expect(blockingUnit(both, AARON, 'b', 'loading')).toBe(null)
    expect(blockingUnit(both, AARON, 'b', 'packing').number).toBe('903')
  })

  it('names the unit in the message, because "blocked" is not actionable', () => {
    expect(blockedMessage(units[0], 'packing')).toMatch(/906/)
    expect(blockedMessage(units[0], 'loading')).toMatch(/loading/)
  })
})
