import { describe, it, expect } from 'vitest'
import {
  LOADING_STEPS, VAULT_PARTS, vaultComplete, vaultsOf, completeVaults,
  vaultProgress, vaultTouchedAt, normalizeVaultNumber, vaultNumberError,
  vaultCountMismatch, loadingChecklist, loadingProgress, loadingComplete,
  stickerMismatch, unitNumberMismatch,
} from '../mutations.js'

const shot = (at = 1000, who = 'Ali Mover') => ({ url: 'u', kind: 'photo', uid: 'm1', userName: who, at })
const vault = (over = {}) => ({
  number: 'BB-1007', uid: 'm1', userName: 'Ali Mover', at: 1000,
  open: shot(1100), closed: shot(1200), ...over,
})

describe('vault records', () => {
  it('needs a number and both photos to count', () => {
    expect(vaultComplete(vault())).toBe(true)
    expect(vaultComplete(vault({ open: null }))).toBe(false)
    expect(vaultComplete(vault({ closed: null }))).toBe(false)
    expect(vaultComplete(vault({ number: '   ' }))).toBe(false)
    expect(vaultComplete(null)).toBe(false)
  })

  it('is the two door shots, and nothing else', () => {
    expect(VAULT_PARTS.map((p) => p.key)).toEqual(['open', 'closed'])
  })

  it('counts the number itself as the first of three parts', () => {
    expect(vaultProgress(vault({ open: null, closed: null }))).toEqual({ done: 1, total: 3 })
    expect(vaultProgress(vault({ closed: null }))).toEqual({ done: 2, total: 3 })
    expect(vaultProgress(vault())).toEqual({ done: 3, total: 3 })
  })

  it('reports the last time anybody touched it, not when it was opened', () => {
    expect(vaultTouchedAt(vault({ at: 10, open: shot(50), closed: shot(90) }))).toBe(90)
    expect(vaultTouchedAt(vault({ at: 10, open: null, closed: null }))).toBe(10)
    expect(vaultTouchedAt(null)).toBe(0)
  })

  it('reads a number the way a person reads it off the vault', () => {
    expect(normalizeVaultNumber(' bb-1007 ')).toBe('BB-1007')
    expect(normalizeVaultNumber(null)).toBe('')
  })

  it('rejects a blank or too-short number, and a duplicate on the same unit', () => {
    const unit = { vaults: [vault({ number: 'BB-1007' })] }
    expect(vaultNumberError('', unit)).toMatch(/Enter the number/)
    expect(vaultNumberError('B', unit)).toMatch(/too short/)
    expect(vaultNumberError('bb-1007', unit)).toMatch(/already logged/)
    expect(vaultNumberError('BB-1008', unit)).toBe(null)
  })

  it('rejects a duplicate even against a vault that is only half logged', () => {
    const unit = { vaults: [vault({ number: 'BB-1007', closed: null })] }
    expect(vaultNumberError('BB-1007', unit)).toMatch(/already logged/)
  })

  it('survives a unit with no vaults field at all', () => {
    expect(vaultsOf({})).toEqual([])
    expect(vaultsOf(null)).toEqual([])
    expect(completeVaults({})).toEqual([])
    expect(vaultNumberError('BB-1', {})).toBe(null)
  })
})

describe('the vault count check', () => {
  const unit = { vaults: [vault({ number: 'A' }), vault({ number: 'B' })] }

  it('passes when the count matches what is fully logged', () => {
    expect(vaultCountMismatch(unit, 2)).toBe(null)
    expect(vaultCountMismatch(unit, '2')).toBe(null)
  })

  it('reports both numbers when they disagree', () => {
    expect(vaultCountMismatch(unit, 3)).toEqual({ said: 3, logged: 2 })
    expect(vaultCountMismatch(unit, 1)).toEqual({ said: 1, logged: 2 })
  })

  it('counts only fully logged vaults, which is the gap it exists to catch', () => {
    const half = { vaults: [vault({ number: 'A' }), vault({ number: 'B', closed: null })] }
    expect(vaultCountMismatch(half, 2)).toEqual({ said: 2, logged: 1 })
  })

  it('says nothing before the mover has answered', () => {
    expect(vaultCountMismatch(unit, undefined)).toBe(null)
    expect(vaultCountMismatch(unit, '')).toBe(null)
    expect(vaultCountMismatch(unit, 'three')).toBe(null)
  })
})

describe('mover checklist', () => {
  it('is the photos, the confirmations, the repeatable vaults item and the count', () => {
    expect(LOADING_STEPS.map((s) => s.key)).toEqual(
      ['load_unit_photo', 'load_sticker', 'load_number', 'load_vaults', 'load_vault_count', 'load_after_photo'],
    )
    expect(LOADING_STEPS.find((s) => s.key === 'load_vaults').repeatable).toBe(true)
  })

  it('nothing done on a freshly packed unit', () => {
    expect(loadingProgress({})).toEqual({ done: 0, total: 6 })
    expect(loadingComplete({})).toBe(false)
  })

  it('credits the photo to whoever took it', () => {
    const unit = { steps: { load_unit_photo: { uid: 'm1', userName: 'Ali Mover', at: 500 } } }
    expect(loadingChecklist(unit).find((s) => s.key === 'load_unit_photo'))
      .toMatchObject({ done: true, by: 'Ali Mover', at: 500 })
  })

  it('the vaults item reports the first one finished, and counts them', () => {
    const unit = { vaults: [
      vault({ number: 'BB-1', at: 800, open: shot(850, 'Ali'), closed: shot(900, 'Ali'), userName: 'Ali' }),
      vault({ number: 'BB-2', at: 1800, open: shot(1850, 'Sam'), closed: shot(1900, 'Sam'), userName: 'Sam' }),
    ] }
    const item = loadingChecklist(unit).find((s) => s.key === 'load_vaults')
    // Attributed to the first vault actually finished, not the newest one.
    expect(item).toMatchObject({ done: true, by: 'Ali', at: 900, count: 2, started: 2 })
  })

  it('a half-logged vault holds the item open even when another is finished', () => {
    const unit = { vaults: [vault({ number: 'A' }), vault({ number: 'B', closed: null })] }
    const item = loadingChecklist(unit).find((s) => s.key === 'load_vaults')
    expect(item).toMatchObject({ done: false, count: 1, started: 2 })
    expect(loadingComplete(unit)).toBe(false)
  })

  it('a vault with only a number does not satisfy the vaults item', () => {
    const unit = { vaults: [vault({ open: null, closed: null })] }
    expect(loadingChecklist(unit).find((s) => s.key === 'load_vaults'))
      .toMatchObject({ done: false, count: 0, started: 1 })
  })

  const allSteps = {
    load_unit_photo: { userName: 'Ali', at: 1 },
    load_sticker: { userName: 'Ali', at: 2, value: 'Pink', matched: true },
    load_number: { userName: 'Ali', at: 3, value: '906', matched: true },
    load_vault_count: { userName: 'Ali', at: 4, value: 1, matched: true },
    load_after_photo: { userName: 'Ali', at: 5 },
  }

  it('is complete only with every item and at least one full vault', () => {
    expect(loadingComplete({ steps: allSteps })).toBe(false)
    expect(loadingComplete({ vaults: [vault()] })).toBe(false)
    expect(loadingComplete({ steps: allSteps, vaults: [vault()] })).toBe(true)
  })

  it('a missing confirmation blocks completion', () => {
    const { load_number, ...missing } = allSteps
    expect(loadingComplete({ steps: missing, vaults: [vault()] })).toBe(false)
  })

  // The whole reason for asking the count: every box ticked, and the unit
  // still short a vault nobody logged.
  it('blocks close-out when the count does not match what was logged', () => {
    const steps = { ...allSteps, load_vault_count: { userName: 'Ali', at: 4, value: 3, matched: false } }
    const unit = { steps, vaults: [vault({ number: 'A' }), vault({ number: 'B' })] }
    expect(loadingChecklist(unit).every((s) => s.done)).toBe(true)
    expect(loadingComplete(unit)).toBe(false)
  })

  it('lets the unit close once the count is corrected', () => {
    const steps = { ...allSteps, load_vault_count: { userName: 'Ali', at: 4, value: 2, matched: true } }
    expect(loadingComplete({ steps, vaults: [vault({ number: 'A' }), vault({ number: 'B' })] })).toBe(true)
  })

  it('surfaces what the mover typed and whether it matched', () => {
    const rows = loadingChecklist({ steps: allSteps })
    expect(rows.find((s) => s.key === 'load_sticker')).toMatchObject({ done: true, value: 'Pink', matched: true })
    expect(rows.find((s) => s.key === 'load_number')).toMatchObject({ done: true, value: '906', matched: true })
    expect(rows.find((s) => s.key === 'load_vault_count')).toMatchObject({ done: true, value: 1, matched: true })
  })

  it('handles the two and a half vaults a real unit takes', () => {
    const steps = { ...allSteps, load_vault_count: { userName: 'Ali', at: 4, value: 3, matched: true } }
    const unit = { steps, vaults: [vault({ number: 'A' }), vault({ number: 'B' }), vault({ number: 'C' })] }
    expect(loadingChecklist(unit).find((s) => s.key === 'load_vaults').count).toBe(3)
    expect(loadingComplete(unit)).toBe(true)
  })
})

// The point of typing the colour and number rather than confirming what is on
// screen: a mover handed the wrong apartment's load is caught here.
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

// The empty-unit shot is the last thing that happens, and a unit is not closed
// out without it: it is the only evidence of what condition the apartment was
// left in.
describe('after-loading photo', () => {
  const beforeAfter = {
    load_unit_photo: { userName: 'Ali', at: 1 },
    load_sticker: { userName: 'Ali', at: 2, value: 'Pink', matched: true },
    load_number: { userName: 'Ali', at: 3, value: '906', matched: true },
    load_vault_count: { userName: 'Ali', at: 4, value: 1, matched: true },
  }

  it('blocks close-out until it is taken', () => {
    expect(loadingComplete({ steps: beforeAfter, vaults: [vault()] })).toBe(false)
  })

  it('completes the unit once it is there', () => {
    const steps = { ...beforeAfter, load_after_photo: { userName: 'Ali', at: 9 } }
    expect(loadingComplete({ steps, vaults: [vault()] })).toBe(true)
  })

  it('is the last item on the list, after the vaults and the count', () => {
    expect(LOADING_STEPS[LOADING_STEPS.length - 1].key).toBe('load_after_photo')
  })

  it('records who took it and when, like every other item', () => {
    const unit = { steps: { load_after_photo: { userName: 'Sam Diaz', at: 4242 } } }
    expect(loadingChecklist(unit).find((s) => s.key === 'load_after_photo'))
      .toMatchObject({ done: true, by: 'Sam Diaz', at: 4242 })
  })
})

/* Records written by a phone still on the pre-vault build.
 *
 * A crew phone does not reload, so after the vault split deployed Víctor's app
 * kept writing the old single-shot `boxes` shape. Re-allowing the key without
 * this mapping would have been worse than the permission error it replaced:
 * his work would have landed somewhere nothing reads. */
describe('the old boxes shape', () => {
  const legacyBox = (over = {}) => ({
    number: 'BB-7371', containerId: 'c1', openUrl: 'o.jpg', closedUrl: 'c.jpg',
    uid: 'm1', userName: 'Víctor Mendez', at: 1000, ...over,
  })

  it('reads as a finished vault, with the photos where the new code looks', () => {
    const [v] = vaultsOf({ boxes: [legacyBox()] })
    expect(v).toMatchObject({ number: 'BB-7371', userName: 'Víctor Mendez', legacy: true })
    expect(v.open).toMatchObject({ url: 'o.jpg', kind: 'photo', userName: 'Víctor Mendez' })
    expect(v.closed).toMatchObject({ url: 'c.jpg', kind: 'photo' })
    expect(vaultComplete(v)).toBe(true)
  })

  it('counts on the checklist and lets the unit close', () => {
    const steps = {
      load_unit_photo: { userName: 'V', at: 1 },
      load_sticker: { userName: 'V', at: 2, value: 'Orange', matched: true },
      load_number: { userName: 'V', at: 3, value: '906', matched: true },
      load_vault_count: { userName: 'V', at: 4, value: 1, matched: true },
      load_after_photo: { userName: 'V', at: 5 },
    }
    const unit = { steps, boxes: [legacyBox()] }
    expect(completeVaults(unit)).toHaveLength(1)
    expect(loadingComplete(unit)).toBe(true)
  })

  it('stays incomplete when only one door was shot', () => {
    const [v] = vaultsOf({ boxes: [legacyBox({ closedUrl: null })] })
    expect(vaultComplete(v)).toBe(false)
    expect(v.closed).toBeUndefined()
  })

  it('does not duplicate a vault logged both ways, and the new record wins', () => {
    const unit = {
      vaults: [{ number: 'BB-7371', uid: 'm1', userName: 'Víctor Mendez', at: 9 }],
      boxes: [legacyBox({ number: 'bb-7371' })],
    }
    const list = vaultsOf(unit)
    expect(list).toHaveLength(1)
    expect(list[0].legacy).toBeUndefined()
  })

  it('carries both shapes when they are genuinely different vaults', () => {
    const unit = {
      vaults: [{ number: 'BB-1', uid: 'm1', userName: 'V', at: 9 }],
      boxes: [legacyBox({ number: 'BB-2' })],
    }
    expect(vaultsOf(unit).map((v) => v.number)).toEqual(['BB-1', 'BB-2'])
  })

  it('blocks a duplicate number typed against a legacy record', () => {
    expect(vaultNumberError('bb-7371', { boxes: [legacyBox()] })).toMatch(/already logged/)
  })
})
