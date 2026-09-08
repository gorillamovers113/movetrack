import { describe, it, expect } from 'vitest'
import {
  makeEvent, boxMismatch, nextStage, nextOverflowStage,
  nextReturnStage, nextReturnOverflowStage,
  nextReturnUnitAction, nextReturnContainerAction, nextReturnOverflowAction,
  matchContainerByNumber, surnameOf,
  STICKER_COLORS, stickerHex, inventoryRangeLabel, inventoryRangeError, overlappingUnits,
  CARTON_TYPES, sumCartons, cartonsFromForm, cartonSummary,
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

describe('surnameOf', () => {
  // These are the real tenant strings from the Trinity Manor phase-1 list.
  it('takes the family name, not the second word', () => {
    expect(surnameOf('Bobbye Ellis')).toBe('Ellis')
    expect(surnameOf('Wendell P. Round')).toBe('Round')          // was "P."
    expect(surnameOf('Jerilyn E. "HEATHER" Millard')).toBe('Millard') // was "E."
    expect(surnameOf('Gloria Perez Nunez')).toBe('Nunez')        // was "Perez"
    expect(surnameOf('Tayebeh Tafaghodi Timachi')).toBe('Timachi')
    expect(surnameOf('Fang Jing Yang')).toBe('Yang')             // was "Jing"
  })
  it('passes a single-word entry through', () => {
    expect(surnameOf('VACANT')).toBe('VACANT')
    expect(surnameOf('goblot')).toBe('goblot')
  })
  it('never renders blank for missing or messy input', () => {
    expect(surnameOf('')).toBe('-')
    expect(surnameOf(null)).toBe('-')
    expect(surnameOf(undefined)).toBe('-')
    expect(surnameOf('   ')).toBe('-')
    expect(surnameOf('  Susan   Baker  ')).toBe('Baker')
  })
})

describe('inventory stickers', () => {
  it('offers a colour per unit with a swatch', () => {
    expect(STICKER_COLORS.length).toBeGreaterThan(4)
    expect(STICKER_COLORS.every((c) => c.name && /^#[0-9a-f]{6}$/i.test(c.hex))).toBe(true)
    expect(stickerHex('Blue')).toBe('#2563eb')
    expect(stickerHex('Chartreuse')).toBe(null)
  })

  it('labels a range, collapsing a single sticker', () => {
    expect(inventoryRangeLabel({ inventoryFrom: 1, inventoryTo: 42 })).toBe('1-42')
    expect(inventoryRangeLabel({ inventoryFrom: 7, inventoryTo: 7 })).toBe('7')
    expect(inventoryRangeLabel({})).toBe(null)
    expect(inventoryRangeLabel(null)).toBe(null)
  })

  it('rejects a range a packer could fat-finger', () => {
    expect(inventoryRangeError(1, 42)).toBe(null)
    expect(inventoryRangeError('1', '42')).toBe(null)
    expect(inventoryRangeError('', '')).toBeTruthy()
    expect(inventoryRangeError(0, 5)).toBeTruthy()      // stickers start at 1
    expect(inventoryRangeError(42, 1)).toBeTruthy()     // backwards
    expect(inventoryRangeError('abc', 5)).toBeTruthy()
  })

  it('spots two units claiming the same numbers on the same colour', () => {
    const units = [
      { id: 'a', number: '901', stickerColor: 'Blue', inventoryFrom: 1, inventoryTo: 40 },
      { id: 'b', number: '902', stickerColor: 'Red', inventoryFrom: 1, inventoryTo: 40 },
    ]
    // Overlaps 901, same colour.
    expect(overlappingUnits(units, { unitId: 'c', stickerColor: 'Blue', from: 30, to: 60 }).map((u) => u.number)).toEqual(['901'])
    // Same numbers, different roll: not a collision.
    expect(overlappingUnits(units, { unitId: 'c', stickerColor: 'Green', from: 1, to: 40 })).toEqual([])
    // Clear of both.
    expect(overlappingUnits(units, { unitId: 'c', stickerColor: 'Blue', from: 41, to: 80 })).toEqual([])
    // Never flags the unit being edited against itself.
    expect(overlappingUnits(units, { unitId: 'a', stickerColor: 'Blue', from: 1, to: 40 })).toEqual([])
    // Units with no range recorded are ignored.
    expect(overlappingUnits([{ id: 'z', number: '999' }], { unitId: 'c', stickerColor: 'Blue', from: 1, to: 5 })).toEqual([])
  })
})

describe('carton breakdown', () => {
  it('covers the box types a packer actually uses', () => {
    const keys = CARTON_TYPES.map((t) => t.key)
    expect(keys).toContain('small')
    expect(keys).toContain('medium')
    expect(keys).toContain('large')
    expect(keys).toContain('wardrobe')
    expect(CARTON_TYPES.every((t) => t.key && t.label)).toBe(true)
  })

  it('totals the breakdown', () => {
    expect(sumCartons({ small: 12, medium: 8, wardrobe: 2 })).toBe(22)
    expect(sumCartons({})).toBe(0)
    expect(sumCartons(null)).toBe(0)
    expect(sumCartons(undefined)).toBe(0)
  })

  it('does not let junk from a form input corrupt the total', () => {
    // Values arrive as strings from number inputs, and a packer can type
    // anything into one.
    expect(sumCartons({ small: '12', medium: '8' })).toBe(20)
    expect(sumCartons({ small: 'abc', medium: 5 })).toBe(5)
    expect(sumCartons({ small: -4, medium: 5 })).toBe(5)
    expect(sumCartons({ small: 2.9 })).toBe(2)
    expect(sumCartons({ notABoxType: 99 })).toBe(0)
  })

  it('stores only the box types actually used', () => {
    expect(cartonsFromForm({ carton_small: '12', carton_medium: '', carton_wardrobe: '0' }))
      .toEqual({ small: 12 })
    expect(cartonsFromForm({})).toEqual({})
    expect(cartonsFromForm(null)).toEqual({})
  })

  it('summarises for the unit page', () => {
    expect(cartonSummary({ small: 12, wardrobe: 2 })).toBe('12 small, 2 wardrobe')
    expect(cartonSummary({})).toBe(null)
    expect(cartonSummary(null)).toBe(null)
  })
})
