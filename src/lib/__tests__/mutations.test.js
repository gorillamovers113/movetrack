import { describe, it, expect } from 'vitest'
import { makeEvent, boxMismatch, nextStage } from '../mutations.js'

describe('boxMismatch', () => {
  it('flags a real mismatch', () => expect(boxMismatch(6, 5)).toBe(true))
  it('passes when equal', () => expect(boxMismatch(6, 6)).toBe(false))
  it('ignores missing counts', () => expect(boxMismatch(null, 5)).toBe(false))
})
describe('nextStage', () => {
  it('advances', () => expect(nextStage('packed')).toBe('loaded'))
  it('ends at warehouse', () => expect(nextStage('at_warehouse')).toBe(null))
})
describe('makeEvent', () => {
  it('stamps user + action', () => {
    const e = makeEvent({ uid: 'u1', userName: 'Sam', role: 'packer' }, 'stage', 'Started packing', { unitId: 'x' })
    expect(e).toMatchObject({ uid: 'u1', userName: 'Sam', role: 'packer', type: 'stage', action: 'Started packing', unitId: 'x' })
    expect(typeof e.ts).toBe('number')
  })
})
