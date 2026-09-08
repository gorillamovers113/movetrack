import { describe, it, expect } from 'vitest'
import { SHEET_COLUMNS, stepRow, allRows, pushRows } from '../sheetBackup.js'

const tick = (name, at) => ({ uid: 'u', userName: name, at })

const unit = {
  id: 'unit-906', number: '906', tenant: 'Maria Ochoa', floor: 9,
  stage: 'packing', stickerColor: 'Pink', inventoryFrom: 1, inventoryTo: 9,
  pieces: 45, materials: { small: 20, medium: 30, large: 10, wardrobe: 4 },
  media: [{ phase: 'door', kind: 'photo' }, { phase: 'door', kind: 'photo' }, { phase: 'rooms', kind: 'video' }],
  steps: { door: tick('Liv Post', 1000) },
}

describe('sheet backup rows', () => {
  it('a row has one cell per column, in that order', () => {
    const row = stepRow({ unit, stepKey: 'door', userName: 'Liv Post', role: 'packer', ts: 1000 })
    expect(row).toHaveLength(SHEET_COLUMNS.length)
    expect(row[SHEET_COLUMNS.indexOf('Unit')]).toBe('906')
    expect(row[SHEET_COLUMNS.indexOf('Tenant')]).toBe('Maria Ochoa')
    expect(row[SHEET_COLUMNS.indexOf('Item')]).toBe('Front door photo with the unit number')
    expect(row[SHEET_COLUMNS.indexOf('Done by')]).toBe('Liv Post')
    expect(row[SHEET_COLUMNS.indexOf('Role')]).toBe('packer')
    expect(row[SHEET_COLUMNS.indexOf('Unit ID')]).toBe('unit-906')
  })

  it('carries the unit state so a row reads on its own', () => {
    const row = stepRow({ unit, stepKey: 'materials', userName: 'Liv Post', role: 'packer', ts: 2000 })
    expect(row[SHEET_COLUMNS.indexOf('Sticker colour')]).toBe('Pink')
    expect(row[SHEET_COLUMNS.indexOf('Sticker numbers')]).toBe('1-9')
    expect(row[SHEET_COLUMNS.indexOf('Pieces')]).toBe(45)
    expect(row[SHEET_COLUMNS.indexOf('Cartons')]).toBe(64)
    expect(String(row[SHEET_COLUMNS.indexOf('Carton breakdown')])).toContain('20')
  })

  it('counts only the photos belonging to that item', () => {
    expect(stepRow({ unit, stepKey: 'door', ts: 1 })[SHEET_COLUMNS.indexOf('Photos')]).toBe(2)
    expect(stepRow({ unit, stepKey: 'rooms', ts: 1 })[SHEET_COLUMNS.indexOf('Photos')]).toBe(1)
    expect(stepRow({ unit, stepKey: 'packed', ts: 1 })[SHEET_COLUMNS.indexOf('Photos')]).toBe('')
  })

  it('writes the note text on a note row and nowhere else', () => {
    const note = stepRow({ unit, stepKey: 'notes', ts: 1, noteText: 'Tenant not home' })
    expect(note[SHEET_COLUMNS.indexOf('Note')]).toBe('Tenant not home')
    expect(stepRow({ unit, stepKey: 'door', ts: 1 })[SHEET_COLUMNS.indexOf('Note')]).toBe('')
  })

  it('a full rebuild emits one row per completed item, oldest first', () => {
    // Deliberately bare units: only the ticks should produce rows, so the
    // fixture must not carry media or fields the checklist derives from.
    const units = [
      { id: 'a', number: '901', tenant: 'A Tenant', floor: 9, steps: { door: tick('Liv', 3000), rooms: tick('Ana', 1000) } },
      { id: 'b', number: '902', tenant: 'B Tenant', floor: 9, steps: { door: tick('Liv', 2000) } },
    ]
    const rows = allRows(units, [])
    expect(rows).toHaveLength(3)
    // Sorted by the formatted timestamp, so the earliest work leads.
    const whens = rows.map((r) => r[0])
    expect([...whens].sort()).toEqual(whens)
    expect(rows.map((r) => r[SHEET_COLUMNS.indexOf('Done by')])).toContain('Ana')
  })

  it('skips items nobody has done', () => {
    expect(allRows([{ id: 'x', number: '1', steps: {} }], [])).toEqual([])
  })

  it('never throws when the sheet is unreachable, and reports it did not send', async () => {
    const original = globalThis.fetch
    globalThis.fetch = () => Promise.reject(new Error('offline'))
    await expect(pushRows('https://script.google.com/x', [[1]])).resolves.toMatchObject({ sent: false })
    globalThis.fetch = original
  })

  it('does nothing when no sheet is configured', async () => {
    await expect(pushRows('', [[1]])).resolves.toMatchObject({ sent: false })
    await expect(pushRows('https://x', [])).resolves.toMatchObject({ sent: false })
  })
})
