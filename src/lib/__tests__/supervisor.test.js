import { describe, it, expect } from 'vitest'
import { isSupervisor, hasFullReach, describeChange } from '../mutations.js'
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
