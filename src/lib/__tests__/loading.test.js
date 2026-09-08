import { describe, it, expect } from 'vitest'
import {
  LOADING_STEPS, boxComplete, boxesOf, completeBoxes, normalizeBoxNumber,
  boxNumberError, loadingChecklist, loadingProgress, loadingComplete,
  stickerMismatch, unitNumberMismatch,
} from '../mutations.js'

const box = (over = {}) => ({ number: 'BB-1007', openUrl: 'o', closedUrl: 'c', uid: 'm1', userName: 'Ali Mover', at: 1000, ...over })

describe('box records', () => {
  it('needs a number and both photos to count', () => {
    expect(boxComplete(box())).toBe(true)
    expect(boxComplete(box({ openUrl: null }))).toBe(false)
    expect(boxComplete(box({ closedUrl: null }))).toBe(false)
    expect(boxComplete(box({ number: '   ' }))).toBe(false)
    expect(boxComplete(null)).toBe(false)
  })

  it('reads a number the way a person reads it off the box', () => {
    expect(normalizeBoxNumber(' bb-1007 ')).toBe('BB-1007')
    expect(normalizeBoxNumber(null)).toBe('')
  })

  it('rejects a blank or too-short number, and a duplicate on the same unit', () => {
    const unit = { boxes: [box({ number: 'BB-1007' })] }
    expect(boxNumberError('', unit)).toMatch(/Enter the number/)
    expect(boxNumberError('B', unit)).toMatch(/too short/)
    expect(boxNumberError('bb-1007', unit)).toMatch(/already logged/)
    expect(boxNumberError('BB-1008', unit)).toBe(null)
  })

  it('survives a unit with no boxes field at all', () => {
    expect(boxesOf({})).toEqual([])
    expect(boxesOf(null)).toEqual([])
    expect(completeBoxes({})).toEqual([])
    expect(boxNumberError('BB-1', {})).toBe(null)
  })
})

describe('mover checklist', () => {
  it('is the photo, the two confirmations, and the repeatable boxes item', () => {
    expect(LOADING_STEPS.map((s) => s.key)).toEqual(['load_unit_photo', 'load_sticker', 'load_number', 'load_boxes'])
    expect(LOADING_STEPS.find((s) => s.key === 'load_boxes').repeatable).toBe(true)
  })

  it('nothing done on a freshly packed unit', () => {
    expect(loadingProgress({})).toEqual({ done: 0, total: 4 })
    expect(loadingComplete({})).toBe(false)
  })

  it('credits the photo to whoever took it', () => {
    const unit = { steps: { load_unit_photo: { uid: 'm1', userName: 'Ali Mover', at: 500 } } }
    expect(loadingChecklist(unit).find((s) => s.key === 'load_unit_photo'))
      .toMatchObject({ done: true, by: 'Ali Mover', at: 500 })
  })

  it('the boxes item completes on the first fully logged box, and counts them', () => {
    const unit = { boxes: [box({ number: 'BB-1', at: 900, userName: 'Ali' }), box({ number: 'BB-2', at: 1900, userName: 'Sam' })] }
    const item = loadingChecklist(unit).find((s) => s.key === 'load_boxes')
    // Attributed to the first box actually completed, not the newest one.
    expect(item).toMatchObject({ done: true, by: 'Ali', at: 900, count: 2 })
  })

  it('a half-logged box does not satisfy the boxes item', () => {
    const unit = { boxes: [box({ closedUrl: null })] }
    expect(loadingChecklist(unit).find((s) => s.key === 'load_boxes')).toMatchObject({ done: false, count: 0 })
    expect(loadingComplete(unit)).toBe(false)
  })

  const allSteps = {
    load_unit_photo: { userName: 'Ali', at: 1 },
    load_sticker: { userName: 'Ali', at: 2, value: 'Pink', matched: true },
    load_number: { userName: 'Ali', at: 3, value: '906', matched: true },
  }

  it('is complete only with every item and at least one full box', () => {
    expect(loadingComplete({ steps: allSteps })).toBe(false)
    expect(loadingComplete({ boxes: [box()] })).toBe(false)
    expect(loadingComplete({ steps: allSteps, boxes: [box()] })).toBe(true)
  })

  it('a missing confirmation blocks completion', () => {
    const { load_number, ...missing } = allSteps
    expect(loadingComplete({ steps: missing, boxes: [box()] })).toBe(false)
  })

  it('surfaces what the mover typed and whether it matched', () => {
    const rows = loadingChecklist({ steps: allSteps })
    expect(rows.find((s) => s.key === 'load_sticker')).toMatchObject({ done: true, value: 'Pink', matched: true })
    expect(rows.find((s) => s.key === 'load_number')).toMatchObject({ done: true, value: '906', matched: true })
  })

  it('handles the two-and-a-half boxes a real unit takes', () => {
    const unit = { steps: allSteps, boxes: [box({ number: 'A' }), box({ number: 'B' }), box({ number: 'C' })] }
    expect(loadingChecklist(unit).find((s) => s.key === 'load_boxes').count).toBe(3)
    expect(loadingComplete(unit)).toBe(true)
  })
})

// The point of typing the colour and number rather than confirming what is on
// screen: a mover handed the wrong apartment's boxes is caught here.
describe('blind checks against what the packer recorded', () => {
  const unit = { number: '906', stickerColor: 'Pink' }

  it('passes when they agree, ignoring case and spacing', () => {
    expect(stickerMismatch(unit, 'pink')).toBe(null)
    expect(unitNumberMismatch(unit, ' 906 ')).toBe(null)
  })

  it('reports both sides when they disagree', () => {
    expect(stickerMismatch(unit, 'Blue')).toEqual({ recorded: 'Pink', entered: 'Blue' })
    expect(unitNumberMismatch(unit, '905')).toEqual({ recorded: '906', entered: '905' })
  })

  it('says nothing when there is nothing to compare against', () => {
    expect(stickerMismatch({}, 'Pink')).toBe(null)
    expect(stickerMismatch(unit, '')).toBe(null)
    expect(unitNumberMismatch({}, '906')).toBe(null)
    expect(unitNumberMismatch(unit, '')).toBe(null)
  })
})
