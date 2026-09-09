import { describe, it, expect } from 'vitest'
import {
  makeEvent, boxMismatch, nextStage, nextOverflowStage,
  nextReturnStage, nextReturnOverflowStage,
  nextReturnUnitAction, nextReturnContainerAction, nextReturnOverflowAction,
  matchContainerByNumber, surnameOf,
  STICKER_COLORS, stickerHex, inventoryRangeLabel, inventoryRangeError, overlappingUnits,
  CARTON_TYPES, sumCartons, cartonsFromForm, cartonSummary,
  SUPPLY_TYPES, sumSupplies, suppliesFromForm, supplySummary,
  PACKING_STEPS, REQUIRED_STEPS, packingChecklist, packingProgress, nextPackingStep, packingComplete, wouldCompletePacking,
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

describe('packing checklist', () => {
  const full = {
    stickerColor: 'Blue',
    inventoryFrom: 1,
    inventoryTo: 42,
    materials: { small: 12, medium: 8 },
    media: [
      { phase: 'door', kind: 'photo' },
      { phase: 'rooms', kind: 'video' },
      { phase: 'inventory', kind: 'photo' },
      { phase: 'packed', kind: 'photo' },
    ],
  }

  it('is Casey\'s items, in the order a packer does them, with the note last', () => {
    expect(PACKING_STEPS.map((s) => s.key)).toEqual(['door', 'rooms', 'sticker', 'inventory', 'numbers', 'materials', 'packed', 'notes'])
  })

  it('every required item done on a finished unit', () => {
    expect(packingChecklist(full).every((s) => s.done || s.optional)).toBe(true)
    expect(packingProgress(full)).toEqual({ done: 7, total: 7 })
  })

  it('nothing done on an untouched unit, and it does not crash', () => {
    expect(packingChecklist({}).some((s) => s.done)).toBe(false)
    expect(packingProgress({})).toEqual({ done: 0, total: 7 })
    expect(packingProgress(null)).toEqual({ done: 0, total: 7 })
    expect(packingProgress({ media: null })).toEqual({ done: 0, total: 7 })
  })

  it('tells the door shot apart from the room shot', () => {
    // Both are "a photo taken before packing"; only the phase distinguishes
    // them, which is the whole reason they are captured separately.
    const doorOnly = { media: [{ phase: 'door', kind: 'photo' }] }
    const list = packingChecklist(doorOnly)
    expect(list.find((s) => s.key === 'door').done).toBe(true)
    expect(list.find((s) => s.key === 'rooms').done).toBe(false)
  })

  it('needs both ends of the sticker range, not just one', () => {
    expect(packingChecklist({ inventoryFrom: 1 }).find((s) => s.key === 'numbers').done).toBe(false)
    expect(packingChecklist({ inventoryTo: 42 }).find((s) => s.key === 'numbers').done).toBe(false)
    expect(packingChecklist({ inventoryFrom: 1, inventoryTo: 42 }).find((s) => s.key === 'numbers').done).toBe(true)
  })

  it('a half-packed unit reports honestly', () => {
    const started = { stickerColor: 'Red', media: [{ phase: 'door' }, { phase: 'rooms' }] }
    expect(packingProgress(started)).toEqual({ done: 3, total: 7 })
  })
})

describe('checklist attribution', () => {
  const events = [
    { type: 'stage', to: 'packing', ts: 1000, userName: 'Liv Post' },
    { type: 'stage', to: 'packed', ts: 5000, userName: 'Ana Ruiz' },
  ]
  const unit = {
    stickerColor: 'Blue',
    inventoryFrom: 1, inventoryTo: 42,
    materials: { small: 12 },
    media: [
      { phase: 'door', ts: 900, userName: 'Liv Post' },
      { phase: 'rooms', ts: 950, userName: 'Liv Post' },
      { phase: 'inventory', ts: 4900, userName: 'Ana Ruiz' },
      { phase: 'packed', ts: 4950, userName: 'Ana Ruiz' },
    ],
  }

  it('names who did each task and when', () => {
    const by = Object.fromEntries(packingChecklist(unit, events).map((s) => [s.key, s]))
    expect(by.door).toMatchObject({ done: true, by: 'Liv Post', at: 900 })
    expect(by.rooms).toMatchObject({ done: true, by: 'Liv Post', at: 950 })
    expect(by.sticker).toMatchObject({ done: true, by: 'Liv Post', at: 1000 })
    expect(by.inventory).toMatchObject({ done: true, by: 'Ana Ruiz', at: 4900 })
    expect(by.numbers).toMatchObject({ done: true, by: 'Ana Ruiz', at: 5000 })
    expect(by.packed).toMatchObject({ done: true, by: 'Ana Ruiz', at: 4950 })
  })

  it('credits the person who first completed it, not whoever added another shot later', () => {
    const u = { media: [
      { phase: 'door', ts: 900, userName: 'Liv Post' },
      { phase: 'door', ts: 9999, userName: 'Someone Else' },
    ] }
    expect(packingChecklist(u, []).find((s) => s.key === 'door')).toMatchObject({ by: 'Liv Post', at: 900 })
  })

  it('an incomplete item carries no attribution', () => {
    const by = Object.fromEntries(packingChecklist({}, []).map((s) => [s.key, s]))
    expect(by.door.done).toBe(false)
    expect(by.door.by).toBeUndefined()
  })

  it('survives evidence with no name or timestamp', () => {
    const u = { stickerColor: 'Red', media: [{ phase: 'door' }] }
    const by = Object.fromEntries(packingChecklist(u, []).map((s) => [s.key, s]))
    expect(by.door.done).toBe(true)
    expect(by.door.by).toBe(null)
    expect(by.sticker).toMatchObject({ done: true, by: null, at: null })
  })

  it('still counts progress with events missing', () => {
    expect(packingProgress(unit)).toEqual({ done: 7, total: 7 })
  })
})

describe('materials as its own checklist item', () => {
  it('is separate from the packed photos', () => {
    // Photographed but no materials recorded: 'packed' done, 'materials' not.
    const u = { media: [{ phase: 'packed', ts: 1, userName: 'Liv Post' }] }
    const by = Object.fromEntries(packingChecklist(u, []).map((s) => [s.key, s]))
    expect(by.packed.done).toBe(true)
    expect(by.materials.done).toBe(false)
  })

  it('ticks once cartons are recorded, and is attributed', () => {
    const u = { materials: { small: 12 } }
    const evs = [{ type: 'stage', to: 'packed', ts: 5000, userName: 'Ana Ruiz' }]
    expect(packingChecklist(u, evs).find((s) => s.key === 'materials'))
      .toMatchObject({ done: true, by: 'Ana Ruiz', at: 5000 })
  })

  it('an all-zero breakdown does not count as recorded', () => {
    expect(packingChecklist({ materials: {} }, []).find((s) => s.key === 'materials').done).toBe(false)
    expect(packingChecklist({ materials: { small: 0 } }, []).find((s) => s.key === 'materials').done).toBe(false)
  })
})

// Each item is ticked off by its own write, so each carries the name and time
// of whoever did THAT item. This is the whole point of splitting the seven:
// two packers can share a unit and the record shows honestly who did which.
describe('per-item ticks', () => {
  const step = (name, at) => ({ uid: 'u', userName: name, at })

  it('an item reports the person who ticked it, not whoever finished the unit', () => {
    const unit = {
      steps: {
        door: step('Liv Post', 1000),
        rooms: step('Ana Ruiz', 2000),
      },
    }
    const by = Object.fromEntries(packingChecklist(unit, []).map((s) => [s.key, s]))
    expect(by.door).toMatchObject({ done: true, by: 'Liv Post', at: 1000 })
    expect(by.rooms).toMatchObject({ done: true, by: 'Ana Ruiz', at: 2000 })
    expect(by.sticker.done).toBe(false)
  })

  it('an explicit tick wins over evidence derived from media', () => {
    const unit = {
      steps: { door: step('Ana Ruiz', 9000) },
      media: [{ phase: 'door', kind: 'photo', userName: 'Liv Post', ts: 1000 }],
    }
    expect(packingChecklist(unit, []).find((s) => s.key === 'door'))
      .toMatchObject({ by: 'Ana Ruiz', at: 9000 })
  })

  it('a unit packed under the old combined flow still reads its evidence', () => {
    const unit = { media: [{ phase: 'door', kind: 'photo', userName: 'Liv Post', ts: 500 }] }
    expect(packingChecklist(unit, []).find((s) => s.key === 'door'))
      .toMatchObject({ done: true, by: 'Liv Post', at: 500 })
  })

  it('nextPackingStep walks the list in order and ends at null', () => {
    expect(nextPackingStep({}, []).key).toBe('door')
    expect(nextPackingStep({ steps: { door: step('Liv', 1) } }, []).key).toBe('rooms')

    const all = { steps: Object.fromEntries(PACKING_STEPS.map((s) => [s.key, step('Liv', 1)])) }
    expect(nextPackingStep(all, [])).toBe(null)
    expect(packingComplete(all, [])).toBe(true)
  })

  it('a unit is not complete until every one of the seven is ticked', () => {
    const six = { steps: Object.fromEntries(PACKING_STEPS.slice(0, 6).map((s) => [s.key, step('Liv', 1)])) }
    expect(packingComplete(six, [])).toBe(false)
    expect(packingProgress(six, []).done).toBe(6)
    expect(nextPackingStep(six, []).key).toBe('packed')
  })

  it('items may be ticked out of order', () => {
    const unit = { steps: { materials: step('Liv', 1), packed: step('Liv', 2) } }
    const by = Object.fromEntries(packingChecklist(unit, []).map((s) => [s.key, s]))
    expect(by.materials.done).toBe(true)
    expect(by.packed.done).toBe(true)
    expect(nextPackingStep(unit, []).key).toBe('door')
    expect(packingProgress(unit, []).done).toBe(2)
  })
})

// Notes is item 8 and optional: it is attributed like the rest when someone
// fills it in, but a unit is finished without it.
describe('optional Notes item', () => {
  const step = (name, at) => ({ uid: 'u', userName: name, at })
  const allSeven = () => Object.fromEntries(REQUIRED_STEPS.map((s) => [s.key, step('Liv', 1)]))

  it('is the eighth item and the only optional one', () => {
    expect(PACKING_STEPS).toHaveLength(8)
    expect(PACKING_STEPS[7].key).toBe('notes')
    expect(REQUIRED_STEPS).toHaveLength(7)
    expect(PACKING_STEPS.filter((s) => s.optional).map((s) => s.key)).toEqual(['notes'])
  })

  it('does not block a unit from being complete', () => {
    const u = { steps: allSeven() }
    expect(packingComplete(u, [])).toBe(true)
    expect(nextPackingStep(u, [])).toBe(null)
  })

  it('is never offered as the next thing to do', () => {
    expect(nextPackingStep({ steps: {} }, []).key).toBe('door')
    const sixDone = { steps: Object.fromEntries(REQUIRED_STEPS.slice(0, 6).map((s) => [s.key, step('Liv', 1)])) }
    expect(nextPackingStep(sixDone, []).key).toBe('packed')
  })

  it('progress counts the seven required items, never the note', () => {
    expect(packingProgress({ steps: allSeven() }, [])).toEqual({ done: 7, total: 7 })
    const noteOnly = { steps: { notes: step('Liv', 1) } }
    expect(packingProgress(noteOnly, [])).toEqual({ done: 0, total: 7 })
  })

  it('records who wrote the note and when, like every other item', () => {
    const u = { steps: { notes: step('Ana Ruiz', 4242) } }
    const notes = packingChecklist(u, []).find((s) => s.key === 'notes')
    expect(notes).toMatchObject({ done: true, by: 'Ana Ruiz', at: 4242, optional: true })
  })

  it('is not done until someone actually writes one', () => {
    expect(packingChecklist({}, []).find((s) => s.key === 'notes').done).toBe(false)
  })
})

// The 1 MiB Firestore document ceiling is the constraint that made unit 906's
// fifth photo impossible, so the accounting behind the guard is worth pinning.
describe('embedded media accounting', () => {
  const dataUrl = (kb) => 'data:image/jpeg;base64,' + 'A'.repeat(kb * 1024)

  it('counts only embedded photos, never Storage URLs', async () => {
    const { embeddedMediaBytes } = await import('../../store.jsx')
    const unit = {
      media: [
        { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/units%2Fa.jpg?alt=media' },
        { url: dataUrl(60) },
      ],
    }
    // The Storage URL contributes nothing regardless of the photo behind it.
    expect(embeddedMediaBytes(unit)).toBeGreaterThan(60 * 1024)
    expect(embeddedMediaBytes(unit)).toBeLessThan(62 * 1024)
  })

  it('is zero for a unit with no media, and does not crash on a bare object', async () => {
    const { embeddedMediaBytes } = await import('../../store.jsx')
    expect(embeddedMediaBytes({})).toBe(0)
    expect(embeddedMediaBytes(null)).toBe(0)
    expect(embeddedMediaBytes({ media: [null, {}, { url: null }] })).toBe(0)
  })
})

// Casey's rule: the seven can be done in any order, skipping around, but all
// seven have to be there before a unit counts as finished.
describe('any order, but all seven to finish', () => {
  const tick = (at) => ({ uid: 'u', userName: 'Liv', at })
  const withSteps = (keys) => ({ steps: Object.fromEntries(keys.map((k, i) => [k, tick(i + 1)])) })
  const KEYS = REQUIRED_STEPS.map((s) => s.key)

  it('a scrambled order finishes on the seventh item, whichever it is', () => {
    const order = ['materials', 'packed', 'door', 'numbers', 'rooms', 'inventory', 'sticker']
    let unit = { steps: {} }
    order.forEach((key, i) => {
      const last = i === order.length - 1
      expect(wouldCompletePacking(unit, [], key)).toBe(last)
      unit = { steps: { ...unit.steps, [key]: tick(i + 1) } }
    })
    expect(packingComplete(unit, [])).toBe(true)
  })

  it('every single item can be the last one and still complete the unit', () => {
    for (const last of KEYS) {
      const rest = KEYS.filter((k) => k !== last)
      expect(wouldCompletePacking(withSteps(rest), [], last)).toBe(true)
    }
  })

  it('six of seven never completes, whichever one is missing', () => {
    for (const missing of KEYS) {
      const six = KEYS.filter((k) => k !== missing)
      expect(packingComplete(withSteps(six), [])).toBe(false)
      // Re-ticking one already done must not finish it either.
      expect(wouldCompletePacking(withSteps(six), [], six[0])).toBe(false)
    }
  })

  it('the optional note neither completes a unit nor is needed by one', () => {
    const six = KEYS.slice(0, 6)
    expect(wouldCompletePacking(withSteps(six), [], 'notes')).toBe(false)
    expect(packingComplete(withSteps(KEYS), [])).toBe(true)
  })
})

// Boxes and materials are counted separately on purpose: a roll of tape is not
// a carton, and must never inflate the number billing and restock read.
describe('materials, separate from boxes', () => {
  it('is Casey\'s list from day one', () => {
    expect(CARTON_TYPES.map((t) => t.key)).toEqual(['small', 'medium', 'large', 'dishpack', 'wardrobe'])
    expect(SUPPLY_TYPES.map((t) => t.key)).toEqual(['paper', 'paperpad', 'tape', 'plasticwrap'])
  })

  it('totals and summarises materials on their own', () => {
    const sup = { paper: 2, tape: 3, plasticwrap: 1 }
    expect(sumSupplies(sup)).toBe(6)
    expect(supplySummary(sup)).toBe('2 packing paper, 3 tape, 1 plastic wrap')
  })

  it('a material never counts as a box, and vice versa', () => {
    expect(sumCartons({ tape: 99, paper: 99 })).toBe(0)
    expect(sumSupplies({ small: 99, wardrobe: 99 })).toBe(0)
  })

  it('reads the supply_ fields off the form, dropping blanks and zeroes', () => {
    expect(suppliesFromForm({ supply_tape: '3', supply_paper: '', supply_paperpad: '0', supply_plasticwrap: '2' }))
      .toEqual({ tape: 3, plasticwrap: 2 })
  })

  it('handles a unit that recorded no materials at all', () => {
    expect(sumSupplies(undefined)).toBe(0)
    expect(supplySummary(null)).toBe(null)
    expect(suppliesFromForm({})).toEqual({})
  })
})

// A video is a complete record on its own. The crew shot a walkthrough on day
// one and were told to add a still as well, which is how unit 902 ended up
// with two photos of somebody's legs.
describe('video counts as evidence', () => {
  const tick = (name, at) => ({ uid: 'u', userName: name, at })

  it('a step is done whether the evidence is a photo or a video', () => {
    const withVideo = { media: [{ phase: 'packed', kind: 'video', userName: 'Liv', ts: 5 }] }
    const withPhoto = { media: [{ phase: 'packed', kind: 'photo', userName: 'Liv', ts: 5 }] }
    for (const u of [withVideo, withPhoto]) {
      expect(packingChecklist(u, []).find((s) => s.key === 'packed').done).toBe(true)
    }
  })

  it('the door item accepts a video too', () => {
    const u = { media: [{ phase: 'door', kind: 'video', userName: 'Liv', ts: 1 }] }
    expect(packingChecklist(u, []).find((s) => s.key === 'door')).toMatchObject({ done: true, by: 'Liv' })
  })

  it('no label promises a photo where a video is accepted', () => {
    for (const key of ['door', 'rooms', 'packed']) {
      const step = PACKING_STEPS.find((s) => s.key === key)
      expect(step.label.toLowerCase()).not.toMatch(/\bphoto\b(?!s or video)/)
    }
  })
})
