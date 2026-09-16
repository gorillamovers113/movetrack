/* Getting the vault sheet out of the app and over to BigBox.
 *
 * BigBox bill from their own warehouse list and we hold the custody record.
 * Reconciling the two is a conversation that happens over email or text, so
 * the export has to land in whatever Jeff already has open: a spreadsheet, a
 * mail draft, or a printed sheet in a folder.
 *
 * Three shapes, one set of rows:
 *   CSV      opens in Excel, for his side of the reconciliation
 *   text     pastes into an email or a text message with the columns intact
 *   by unit  groups the vaults under the apartment that filled them, which is
 *            how a disagreement actually gets settled
 */

export function vaultPhotoLabel(row) {
  if (!row.on.length) return 'empty'
  if (row.complete) return 'open + closed'
  if (row.shots.of === 0) return 'not logged'
  if (row.shots.open) return 'open only'
  if (row.shots.closed) return 'closed only'
  return 'no photos'
}

const positionLabel = (row) => row.on.map((x) => (x.pos ? `${x.pos.nth} of ${x.pos.of}` : '')).filter(Boolean).join(', ')
const unitLabel = (row) => row.on.map((x) => x.unit.number).join(', ')
const customerLabel = (row) => (row.on.length ? row.on.map((x) => x.unit.tenant || '-').join(', ') : 'Empty')

export const VAULT_COLUMNS = [
  ['Vault', (r) => r.number],
  ['Unit', unitLabel],
  ['Customer', customerLabel],
  ['Of', positionLabel],
  ['Status', (r, statusLabel) => statusLabel(r.status)],
  ['Photos', vaultPhotoLabel],
  ['Bay', (r) => r.bay || ''],
]

export function vaultSheetCSV(rows, statusLabel) {
  const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"'
  const lines = [VAULT_COLUMNS.map(([h]) => esc(h)).join(',')]
  for (const r of rows || []) lines.push(VAULT_COLUMNS.map(([, get]) => esc(get(r, statusLabel))).join(','))
  return lines.join('\n')
}

/* Fixed-width, because it gets pasted into a mail draft and a comma-separated
 * line is unreadable there. Column widths come from the content, so a long
 * tenant name widens the column instead of running into the next one.
 */
export function vaultSheetText(rows, statusLabel, heading = '') {
  const body = (rows || []).map((r) => VAULT_COLUMNS.map(([, get]) => String(get(r, statusLabel) ?? '')))
  const head = VAULT_COLUMNS.map(([h]) => h)
  const width = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)))
  const line = (cells) => cells.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd()
  return [
    ...(heading ? [heading, ''] : []),
    line(head),
    width.map((w) => '-'.repeat(w)).join('  '),
    ...body.map(line),
    '',
    `${body.length} vault${body.length === 1 ? '' : 's'}`,
  ].join('\n')
}

/* The same vaults grouped under the apartment that filled them.
 *
 * This is the view that settles an argument. BigBox split one customer across
 * two accounts because a surname was misread off a handwritten label, and
 * nothing in a flat list makes that visible. Three vault numbers sitting under
 * one name does.
 */
export function vaultsByUnit(rows) {
  const byUnit = new Map()
  for (const r of rows || []) {
    for (const { unit } of r.on) {
      const g = byUnit.get(unit.id) || { id: unit.id, number: unit.number, tenant: unit.tenant, vaults: [] }
      g.vaults.push({ number: r.number, complete: r.complete, photos: vaultPhotoLabel(r) })
      byUnit.set(unit.id, g)
    }
  }
  for (const g of byUnit.values()) {
    g.vaults.sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))
  }
  return [...byUnit.values()].sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))
}

export function vaultExportName(ext, date = new Date()) {
  return `gorilla-movers-vault-manifest-${date.toISOString().slice(0, 10)}.${ext}`
}

export function downloadText(text, filename, type = 'text/csv') {
  const blob = new Blob([text], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
