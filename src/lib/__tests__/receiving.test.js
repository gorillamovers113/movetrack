import { describe, it, expect } from 'vitest'
import {
  RECEIVING_STEPS, lastNameMismatch, boxSetDiff, parseBoxNumbers,
  receivingChecklist, receivingProgress, receivingComplete, readyToReceive,
} from '../mutations.js'

const box = (number) => ({ number, openUrl: 'o', closedUrl: 'c', uid: 'm1', userName: 'Ali', at: 1 })
const unit = { number: '906', tenant: 'Maria Ochoa', boxes: [box('BB-1007'), box('BB-1008')] }

describe('warehouse checks', () => {
  it('is the three things the manager verifies', () => {
    expect(RECEIVING_STEPS.map((s) => s.key)).toEqual(['recv_number', 'recv_lastname', 'recv_boxes'])
  })

  it('matches the last name, not the whole name, and ignores case', () => {
    expect(lastNameMismatch(unit, 'ochoa')).toBe(null)
    expect(lastNameMismatch(unit, ' Ochoa ')).toBe(null)
    expect(lastNameMismatch(unit, 'Maria')).toEqual({ recorded: 'Ochoa', entered: 'Maria' })
  })

  it('takes the last word as the surname, so middle names do not break it', () => {
    expect(lastNameMismatch({ tenant: 'Fang Jing Yang' }, 'Yang')).toBe(null)
    expect(lastNameMismatch({ tenant: 'Wendell P. Round' }, 'Round')).toBe(null)
  })

  it('says nothing when there is nothing to compare', () => {
    expect(lastNameMismatch({}, 'Ochoa')).toBe(null)
    expect(lastNameMismatch(unit, '')).toBe(null)
  })
})

describe('box reconciliation', () => {
  it('accepts the boxes the mover logged, in any order or case', () => {
    expect(boxSetDiff(unit, ['bb-1008', 'BB-1007']).ok).toBe(true)
  })

  it('reports a box still on the truck', () => {
    const d = boxSetDiff(unit, ['BB-1007'])
    expect(d.ok).toBe(false)
    expect(d.missing).toEqual(['BB-1008'])
    expect(d.unexpected).toEqual([])
  })

  it('reports a box belonging to someone else', () => {
    const d = boxSetDiff(unit, ['BB-1007', 'BB-1008', 'BB-9999'])
    expect(d.ok).toBe(false)
    expect(d.missing).toEqual([])
    expect(d.unexpected).toEqual(['BB-9999'])
  })

  it('reports both directions at once', () => {
    const d = boxSetDiff(unit, ['BB-9999'])
    expect(d.missing).toEqual(['BB-1007', 'BB-1008'])
    expect(d.unexpected).toEqual(['BB-9999'])
  })

  it('ignores a box the mover never finished logging', () => {
    const half = { boxes: [box('BB-1'), { number: 'BB-2', openUrl: 'o' }] }
    expect(boxSetDiff(half, ['BB-1']).ok).toBe(true)
  })

  it('reads however someone types a list on a phone', () => {
    expect(parseBoxNumbers('bb-1, BB-2  bb-3\nBB-4;BB-5')).toEqual(['BB-1', 'BB-2', 'BB-3', 'BB-4', 'BB-5'])
    expect(parseBoxNumbers('')).toEqual([])
    expect(parseBoxNumbers(null)).toEqual([])
  })

  it('counts a duplicate typed twice only once', () => {
    expect(boxSetDiff(unit, ['BB-1007', 'BB-1007', 'BB-1008']).ok).toBe(true)
  })
})

describe('receiving checklist', () => {
  const steps = {
    recv_number: { userName: 'Robin', at: 1, value: '906', matched: true },
    recv_lastname: { userName: 'Robin', at: 2, value: 'Ochoa', matched: true },
    recv_boxes: { userName: 'Robin', at: 3, value: 'BB-1007, BB-1008', matched: true },
  }

  it('starts empty and completes only when all three are done', () => {
    expect(receivingProgress({})).toEqual({ done: 0, total: 3 })
    expect(receivingComplete({})).toBe(false)
    expect(receivingComplete({ steps })).toBe(true)
  })

  it('carries who checked it, when, what they typed and whether it matched', () => {
    const row = receivingChecklist({ steps }).find((s) => s.key === 'recv_lastname')
    expect(row).toMatchObject({ done: true, by: 'Robin', at: 2, value: 'Ochoa', matched: true })
  })

  it('a mismatch still counts as done, it is recorded not blocked', () => {
    const bad = { steps: { ...steps, recv_number: { userName: 'Robin', at: 1, value: '905', matched: false } } }
    expect(receivingComplete(bad)).toBe(true)
    expect(receivingChecklist(bad).find((s) => s.key === 'recv_number').matched).toBe(false)
  })
})

describe('what the warehouse can receive', () => {
  it('accepts a loaded unit, because the drivers do not use the app', () => {
    expect(readyToReceive({ stage: 'loaded' })).toBe(true)
  })

  it('still accepts a picked-up unit, for the day a driver does', () => {
    expect(readyToReceive({ stage: 'picked_up' })).toBe(true)
  })

  it('refuses anything the movers have not finished', () => {
    for (const stage of ['not_started', 'packing', 'packed', 'at_warehouse']) {
      expect(readyToReceive({ stage })).toBe(false)
    }
    expect(readyToReceive(null)).toBe(false)
  })
})
