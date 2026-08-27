import { describe, it, expect } from 'vitest'
import {
  makeEvent, boxMismatch, nextStage, nextOverflowStage,
  nextReturnStage, nextReturnOverflowStage,
  nextReturnUnitAction, nextReturnContainerAction, nextReturnOverflowAction,
  matchContainerByNumber,
} from '../mutations.js'

describe('boxMismatch', () => {
  it('flags a real mismatch', () => expect(boxMismatch(6, 5)).toBe(true))
  it('passes when equal', () => expect(boxMismatch(6, 6)).toBe(false))
  it('ignores missing counts', () => expect(boxMismatch(null, 5)).toBe(false))
})
describe('nextStage', () => {
  it('advances', () => expect(nextStage('packed')).toBe('loaded'))
  it('ends at warehouse', () => expect(nextStage('at_warehouse')).toBe(null))
})
describe('nextOverflowStage', () => {
  it('advances', () => expect(nextOverflowStage('identified')).toBe('prepped'))
  it('advances through transit', () => expect(nextOverflowStage('prepped')).toBe('in_transit'))
  it('ends at warehouse', () => expect(nextOverflowStage('at_warehouse')).toBe(null))
  it('unknown stage yields null', () => expect(nextOverflowStage('bogus')).toBe(null))
})
describe('makeEvent', () => {
  it('stamps user + action', () => {
    const e = makeEvent({ uid: 'u1', userName: 'Sam', role: 'packer' }, 'stage', 'Started packing', { unitId: 'x' })
    expect(e).toMatchObject({ uid: 'u1', userName: 'Sam', role: 'packer', type: 'stage', action: 'Started packing', unitId: 'x' })
    expect(typeof e.ts).toBe('number')
  })
})

describe('nextReturnStage', () => {
  it('starts from the outbound terminal stage', () => expect(nextReturnStage('at_warehouse')).toBe('return_loaded'))
  it('walks the full return leg in order', () => {
    expect(nextReturnStage('return_loaded')).toBe('return_transit')
    expect(nextReturnStage('return_transit')).toBe('back_on_site')
    expect(nextReturnStage('back_on_site')).toBe('unloaded')
    expect(nextReturnStage('unloaded')).toBe('unpacked')
  })
  it('ends at unpacked (terminal)', () => expect(nextReturnStage('unpacked')).toBe(null))
  it('unknown stage yields null', () => expect(nextReturnStage('bogus')).toBe(null))
})

describe('nextReturnOverflowStage', () => {
  it('starts from the outbound terminal stage', () => expect(nextReturnOverflowStage('at_warehouse')).toBe('rt_transit'))
  it('ends at returned (terminal)', () => {
    expect(nextReturnOverflowStage('rt_transit')).toBe('returned')
    expect(nextReturnOverflowStage('returned')).toBe(null)
  })
})

describe('nextReturnUnitAction', () => {
  it('warehouse (or admin) loads a unit at_warehouse for return', () => {
    expect(nextReturnUnitAction('warehouse', 'at_warehouse')).toEqual({ key: 'loadForReturn', label: 'Load for return' })
    expect(nextReturnUnitAction('admin', 'at_warehouse')).toEqual({ key: 'loadForReturn', label: 'Load for return' })
  })
  it('gates at_warehouse to the warehouse role', () => {
    expect(nextReturnUnitAction('mover', 'at_warehouse')).toBe(null)
    expect(nextReturnUnitAction('packer', 'at_warehouse')).toBe(null)
  })
  it('mover unloads a unit back_on_site', () => {
    expect(nextReturnUnitAction('mover', 'back_on_site')).toEqual({ key: 'unloadReturn', label: 'Unload into apartment' })
    expect(nextReturnUnitAction('warehouse', 'back_on_site')).toBe(null)
  })
  it('packer unpacks an unloaded unit', () => {
    expect(nextReturnUnitAction('packer', 'unloaded')).toEqual({ key: 'unpackUnit', label: 'Unpack' })
    expect(nextReturnUnitAction('mover', 'unloaded')).toBe(null)
  })
  it('return_loaded/return_transit are container-level, dedicated-screen stages: no quick action', () => {
    expect(nextReturnUnitAction('admin', 'return_loaded')).toBe(null)
    expect(nextReturnUnitAction('admin', 'return_transit')).toBe(null)
  })
  it('unpacked (terminal) and unknown stages yield null', () => {
    expect(nextReturnUnitAction('admin', 'unpacked')).toBe(null)
    expect(nextReturnUnitAction('admin', 'bogus')).toBe(null)
  })
})

describe('nextReturnContainerAction', () => {
  it('warehouse (or admin) marks a return_filling container full', () => {
    expect(nextReturnContainerAction('warehouse', 'return_filling')).toEqual({ key: 'markReturnFull', label: 'Mark full, ready for dispatch' })
    expect(nextReturnContainerAction('admin', 'return_filling')).toEqual({ key: 'markReturnFull', label: 'Mark full, ready for dispatch' })
    expect(nextReturnContainerAction('mover', 'return_filling')).toBe(null)
  })
  it('return_full/return_transit/returned_empty are dedicated-screen or terminal: no quick action', () => {
    expect(nextReturnContainerAction('admin', 'return_full')).toBe(null)
    expect(nextReturnContainerAction('admin', 'return_transit')).toBe(null)
    expect(nextReturnContainerAction('admin', 'returned_empty')).toBe(null)
  })
})

describe('nextReturnOverflowAction', () => {
  it('mover (or admin) transports an at_warehouse overflow item back', () => {
    expect(nextReturnOverflowAction('mover', 'at_warehouse')).toEqual({ key: 'transportOverflowBack', label: 'Load & transport back to site' })
    expect(nextReturnOverflowAction('packer', 'at_warehouse')).toBe(null)
  })
  it('mover or packer places an rt_transit item back', () => {
    expect(nextReturnOverflowAction('mover', 'rt_transit')).toEqual({ key: 'returnOverflow', label: 'Unwrap & place back' })
    expect(nextReturnOverflowAction('packer', 'rt_transit')).toEqual({ key: 'returnOverflow', label: 'Unwrap & place back' })
    expect(nextReturnOverflowAction('warehouse', 'rt_transit')).toBe(null)
  })
  it('returned (terminal) yields null', () => expect(nextReturnOverflowAction('admin', 'returned')).toBe(null))
})

describe('matchContainerByNumber', () => {
  const containers = [
    { id: 'c1', number: 'BB-1001', status: 'return_transit' },
    { id: 'c2', number: 'BB-1002', status: 'at_warehouse' },
    { id: 'c3', number: 'bb-1003', status: 'return_transit' },
  ]

  it('finds an exact match in the expected status', () => {
    expect(matchContainerByNumber(containers, 'BB-1001', 'return_transit')).toEqual(containers[0])
  })
  it('matches case-insensitively', () => {
    expect(matchContainerByNumber(containers, 'bb-1001', 'return_transit')).toEqual(containers[0])
    expect(matchContainerByNumber(containers, 'BB-1003', 'return_transit')).toEqual(containers[2])
  })
  it('trims whitespace off the typed number', () => {
    expect(matchContainerByNumber(containers, '  BB-1001  ', 'return_transit')).toEqual(containers[0])
  })
  it('returns null when the number matches but the status does not', () => {
    expect(matchContainerByNumber(containers, 'BB-1002', 'return_transit')).toBe(null)
  })
  it('returns null when no container has that number', () => {
    expect(matchContainerByNumber(containers, 'BB-9999', 'return_transit')).toBe(null)
  })
  it('returns null for an empty or blank typed number', () => {
    expect(matchContainerByNumber(containers, '', 'return_transit')).toBe(null)
    expect(matchContainerByNumber(containers, '   ', 'return_transit')).toBe(null)
    expect(matchContainerByNumber(containers, undefined, 'return_transit')).toBe(null)
  })
  it('handles an empty containers array without crashing', () => {
    expect(matchContainerByNumber([], 'BB-1001', 'return_transit')).toBe(null)
  })
  it('handles a missing containers array without crashing', () => {
    expect(matchContainerByNumber(undefined, 'BB-1001', 'return_transit')).toBe(null)
  })
  it('works for the outbound warehouse-receive reuse (expectedStatus picked_up)', () => {
    const outbound = [
      { id: 'o1', number: 'BB-2001', status: 'picked_up' },
      { id: 'o2', number: 'BB-2002', status: 'at_warehouse' },
    ]
    expect(matchContainerByNumber(outbound, 'bb-2001', 'picked_up')).toEqual(outbound[0])
    expect(matchContainerByNumber(outbound, 'BB-2002', 'picked_up')).toBe(null)
  })
})
