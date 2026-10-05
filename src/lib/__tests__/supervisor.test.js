import { describe, it, expect } from 'vitest'
import { isSupervisor, hasFullReach, describeChange, mayAddLateVault, isUnitLocked } from '../mutations.js'
import { blockingUnit } from '../focus.js'

const user = (over = {}) => ({ uid: 'u1', name: 'Sam', role: 'packer', ...over })

describe('supervisor is a flag, not a role', () => {
  it('is false for a user doc that has never heard of the field', () => {
    // Every account on this project predates the feature and has no
    // `supervisor` key. This is the app-side half of the same guarantee the
    // rules make with me().get('supervisor', false).
    expect(isSupervisor(user())).toBe(false)
    expect(isSupervisor(null)).toBe(false)
    expect(isSupervisor(undefined)).toBe(false)
  })

  it('only true for an explicit true, never for a truthy value', () => {
    expect(isSupervisor(user({ supervisor: true }))).toBe(true)
    expect(isSupervisor(user({ supervisor: 'yes' }))).toBe(false)
    expect(isSupervisor(user({ supervisor: 1 }))).toBe(false)
    expect(isSupervisor(user({ supervisor: false }))).toBe(false)
  })

  it('leaves the underlying role alone', () => {
    const u = user({ role: 'packer', supervisor: true })
    expect(u.role).toBe('packer')
    expect(hasFullReach(u)).toBe(true)
  })

  it('treats admin and supervisor as the same reach', () => {
    expect(hasFullReach(user({ role: 'admin' }))).toBe(true)
    expect(hasFullReach(user({ supervisor: true }))).toBe(true)
    expect(hasFullReach(user())).toBe(false)
    expect(hasFullReach(null)).toBe(false)
  })
})

describe('one apartment at a time does not apply to a supervisor', () => {
  const units = [
    { id: 'a', number: '906', stage: 'packing', crew: { packers: ['u1'], movers: [] }, paused: false },
  ]

  it('still blocks an ordinary packer who has another unit open', () => {
    expect(blockingUnit(units, user(), 'b', 'packing')).toBeTruthy()
  })

  it('does not block a supervisor', () => {
    // A supervisor's job is moving between apartments to check the work. The
    // rule exists to stop a photo landing on the wrong unit when somebody is
    // standing in a different one, which is not what this is.
    expect(blockingUnit(units, user({ supervisor: true }), 'b', 'packing')).toBeNull()
  })

  it('does not block an admin, as before', () => {
    expect(blockingUnit(units, user({ role: 'admin' }), 'b', 'packing')).toBeNull()
  })
})

describe('an edit says what it changed, not just that it changed', () => {
  it('names the old and the new value', () => {
    expect(describeChange('vault', '4760', '4766')).toBe('vault 4760 to 4766')
  })

  it('spells out a value that was empty', () => {
    expect(describeChange('phone', '', '619-555-0134')).toBe('phone (blank) to 619-555-0134')
    expect(describeChange('note', null, 'back after 2')).toBe('note (blank) to back after 2')
    expect(describeChange('note', undefined, 'x')).toBe('note (blank) to x')
  })
})

describe('a vault found after the unit closed', () => {
  // Liv's case on unit 305: three vaults logged, counted and closed the day
  // before, then forgotten items turn up and go to the warehouse in a fourth.
  const sup = { uid: 'liv', name: 'Liv Post', role: 'crew', supervisor: true }
  const mover = { uid: 'm', name: 'Mover', role: 'mover' }

  it('opens the load-out card from packed onward for a supervisor', () => {
    expect(mayAddLateVault(sup, 'packed')).toBe(true)
    expect(mayAddLateVault(sup, 'loaded')).toBe(true)
    expect(mayAddLateVault(sup, 'picked_up')).toBe(true)
    expect(mayAddLateVault(sup, 'at_warehouse')).toBe(true)
  })

  it('does not open it before the unit is packed', () => {
    // A unit still being packed needs the normal flow, not a retrospective
    // vault, and showing both checklists at once would contradict itself.
    expect(mayAddLateVault(sup, 'not_started')).toBe(false)
    expect(mayAddLateVault(sup, 'packing')).toBe(false)
  })

  it('stays shut for an ordinary mover once the unit has moved on', () => {
    expect(mayAddLateVault(mover, 'loaded')).toBe(false)
    expect(mayAddLateVault(mover, 'packed')).toBe(false)
  })

  it('is open to an admin, who always had this reach', () => {
    expect(mayAddLateVault({ uid: 'a', role: 'admin' }, 'loaded')).toBe(true)
  })

  it('refuses an unknown stage rather than guessing', () => {
    expect(mayAddLateVault(sup, 'nonsense')).toBe(false)
    expect(mayAddLateVault(null, 'loaded')).toBe(false)
  })
})

describe('a closed phase is read-only, supervisors included', () => {
  it('reads an absent flag as open, which every one of the 50 units is', () => {
    expect(isUnitLocked({ number: '305' })).toBe(false)
    expect(isUnitLocked({ number: '305', locked: false })).toBe(false)
    expect(isUnitLocked(null)).toBe(false)
  })

  it('only an explicit true locks, never a truthy value', () => {
    expect(isUnitLocked({ locked: true })).toBe(true)
    expect(isUnitLocked({ locked: 'yes' })).toBe(false)
    expect(isUnitLocked({ locked: 1 })).toBe(false)
  })
})
