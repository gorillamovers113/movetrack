import { describe, it, expect } from 'vitest'
import { vaultSheetRows, sortVaultSheet, nextVaultSort, DEFAULT_VAULT_SORT } from '../mutations.js'
import { vaultSheetCSV, vaultSheetText, vaultsByUnit, vaultPhotoLabel, vaultExportName } from '../vaultExport.js'

const shot = (url) => ({ url, kind: 'photo' })

// The real shape of the Trinity Manor board, trimmed: one apartment across
// three vaults with two of them missing their door-open shot, one apartment in
// one vault, one spare vault nobody has filled.
const units = [
  { id: 'u902', number: '902', tenant: 'Qingbo Niu', containerIds: ['c8038', 'c5960', 'c8919'],
    vaults: [
      { number: '8038', containerId: 'c8038', open: shot('o'), closed: shot('c') },
      { number: '5960', containerId: 'c5960', closed: shot('c') },
      { number: '8919', containerId: 'c8919', closed: shot('c') },
    ] },
  { id: 'u801', number: '801', tenant: 'Gayed Gergis', containerIds: ['c7367'],
    vaults: [{ number: '7367', containerId: 'c7367', open: shot('o'), closed: shot('c') }] },
]
const containers = [
  { id: 'c8038', number: '8038', status: 'full', unitIds: ['u902'] },
  { id: 'c5960', number: '5960', status: 'full', unitIds: ['u902'] },
  { id: 'c8919', number: '8919', status: 'at_warehouse', unitIds: ['u902'] },
  { id: 'c7367', number: '7367', status: 'full', unitIds: ['u801'] },
  { id: 'c900', number: '900', status: 'empty', unitIds: [] },
]
const rows = () => vaultSheetRows(containers, units)
const label = (s) => s
const numbers = (list) => list.map((r) => r.number)

describe('sorting the vault sheet by its headings', () => {
  it('opens in their order, highest vault number first', () => {
    expect(numbers(sortVaultSheet(rows(), DEFAULT_VAULT_SORT))).toEqual(['8919', '8038', '7367', '5960', '900'])
  })

  it('sorts vault numbers as numbers, not as text', () => {
    // "900" beats "8919" on a plain string compare and would head the list.
    expect(numbers(sortVaultSheet(rows(), { key: 'number', dir: 'asc' })))
      .toEqual(['900', '5960', '7367', '8038', '8919'])
  })

  it('sorts customers by surname', () => {
    // Gergis before Niu. First names would put Gayed and Qingbo the same way
    // round here, so the test uses the vault that proves which one ran.
    const sorted = sortVaultSheet(rows(), { key: 'customer', dir: 'asc' })
    expect(sorted[0].on[0].unit.tenant).toBe('Gayed Gergis')
  })

  it('brings the incomplete records to the top when sorted by photos', () => {
    const sorted = sortVaultSheet(rows(), { key: 'photos', dir: 'asc' })
    expect(numbers(sorted).slice(0, 2)).toEqual(['5960', '8919'])
  })

  it('sorts status down the lifecycle, not alphabetically', () => {
    // "at_warehouse" sorts before "empty" and "full" as text, and it is the
    // LAST thing that happens to a vault.
    const sorted = sortVaultSheet(rows(), { key: 'status', dir: 'asc' })
    expect(sorted.map((r) => r.status)).toEqual(['empty', 'full', 'full', 'full', 'at_warehouse'])
  })

  it('keeps the empty vault at the bottom whichever way a column runs', () => {
    // Including bay, which is blank on every vault we have. An earlier version
    // keyed this off the sort value being blank, so a column blank everywhere
    // silently lost the rule.
    for (const dir of ['asc', 'desc']) {
      for (const key of ['customer', 'unit', 'bay', 'of', 'photos']) {
        expect(numbers(sortVaultSheet(rows(), { key, dir })).at(-1)).toBe('900')
      }
    }
  })

  it('but sorts it inline on the columns it genuinely has a value for', () => {
    // An empty vault has a number painted on it and a real place in the
    // lifecycle. Forcing it last on those would be a lie about the board.
    expect(numbers(sortVaultSheet(rows(), { key: 'number', dir: 'asc' }))[0]).toBe('900')
    expect(sortVaultSheet(rows(), { key: 'status', dir: 'asc' })[0].status).toBe('empty')
  })

  it('breaks ties on vault number so the sheet never reshuffles', () => {
    const tied = sortVaultSheet(rows(), { key: 'unit', dir: 'asc' })
    expect(numbers(tied).slice(1)).toEqual(['5960', '8038', '8919', '900'])
    expect(numbers(sortVaultSheet(rows(), { key: 'unit', dir: 'asc' }))).toEqual(numbers(tied))
  })

  it('does not mutate the rows it was handed', () => {
    const original = rows()
    const before = numbers(original)
    sortVaultSheet(original, { key: 'customer', dir: 'desc' })
    expect(numbers(original)).toEqual(before)
  })
})

describe('what a heading click does', () => {
  it('flips direction when the same heading is clicked again', () => {
    expect(nextVaultSort({ key: 'customer', dir: 'asc' }, 'customer')).toEqual({ key: 'customer', dir: 'desc' })
    expect(nextVaultSort({ key: 'customer', dir: 'desc' }, 'customer')).toEqual({ key: 'customer', dir: 'asc' })
  })

  it('starts a new column ascending', () => {
    expect(nextVaultSort({ key: 'number', dir: 'desc' }, 'customer')).toEqual({ key: 'customer', dir: 'asc' })
  })

  it('starts vault number descending, because that is their order', () => {
    expect(nextVaultSort({ key: 'customer', dir: 'asc' }, 'number')).toEqual({ key: 'number', dir: 'desc' })
  })

  it('ignores a heading that does not sort', () => {
    const now = { key: 'number', dir: 'desc' }
    expect(nextVaultSort(now, 'nonsense')).toBe(now)
  })
})

describe('sending the sheet to BigBox', () => {
  const sorted = () => sortVaultSheet(rows(), DEFAULT_VAULT_SORT)

  it('says what is missing rather than just that something is', () => {
    const by = Object.fromEntries(rows().map((r) => [r.number, vaultPhotoLabel(r)]))
    expect(by['8038']).toBe('open + closed')
    expect(by['5960']).toBe('closed only')
    expect(by['900']).toBe('empty')
  })

  it('writes a CSV with a header and one line per vault', () => {
    const lines = vaultSheetCSV(sorted(), label).split('\n')
    expect(lines[0]).toBe('"Vault","Unit","Customer","Of","Status","Photos","Bay"')
    expect(lines).toHaveLength(6)
    expect(lines[1]).toBe('"8919","902","Qingbo Niu","3 of 3","at_warehouse","closed only",""')
  })

  it('escapes a quote in a tenant name instead of breaking the row', () => {
    // Unit 802 really is recorded as Jerilyn E. "HEATHER" Millard.
    const quoted = vaultSheetCSV([{ id: 'x', number: '1', status: 'full', bay: null, on: [{ unit: { number: '802', tenant: 'A "NICK" B' }, pos: null }], shots: { open: 0, closed: 0, of: 0 }, complete: false }], label)
    expect(quoted).toContain('"A ""NICK"" B"')
  })

  it('lines the text version up in columns so it survives an email', () => {
    const lines = vaultSheetText(sorted(), label, 'Gorilla Movers').split('\n')
    expect(lines[0]).toBe('Gorilla Movers')
    expect(lines[2]).toMatch(/^Vault {2}Unit/)
    // The customer column starts at the same offset on the heading and on
    // every row, which is the only thing making it readable as a table.
    const at = lines[2].indexOf('Customer')
    expect(lines[4].indexOf('Qingbo Niu')).toBe(at)
    expect(lines.at(-1)).toBe('5 vaults')
  })

  it('groups the vaults under the apartment that filled them', () => {
    const groups = vaultsByUnit(rows())
    expect(groups.map((g) => g.number)).toEqual(['801', '902'])
    expect(groups[1].vaults.map((v) => v.number)).toEqual(['5960', '8038', '8919'])
    expect(groups[1].vaults.filter((v) => !v.complete)).toHaveLength(2)
  })

  it('leaves an empty vault out of the by-apartment grouping', () => {
    expect(vaultsByUnit(rows()).flatMap((g) => g.vaults.map((v) => v.number))).not.toContain('900')
  })

  it('names the file by the day it was exported', () => {
    expect(vaultExportName('csv', new Date('2026-09-16T23:00:00Z')))
      .toBe('gorilla-movers-vault-manifest-2026-09-16.csv')
  })

  it('survives an empty board', () => {
    expect(vaultSheetCSV([], label).split('\n')).toHaveLength(1)
    expect(vaultSheetText([], label)).toContain('0 vaults')
    expect(vaultsByUnit([])).toEqual([])
  })
})
