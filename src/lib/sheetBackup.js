/* Mirror every completed checklist item into a Google Sheet.
 *
 * Firestore is still the source of truth: it is replicated, it queues writes
 * made with no signal, and every item already writes an immutable event. The
 * Sheet is a second, human-readable copy that Casey can open, sort, print and
 * hand to someone, without needing the app or an export step.
 *
 * It posts to a Google Apps Script web app bound to the Sheet, rather than
 * going through the Sheets API from a Cloud Function, for one practical
 * reason: Cloud Functions need the project on a billing plan, and this needed
 * to work the night before the move. The trade is that a post is fire and
 * forget, so a row can be missed on a bad connection. That is why
 * `allRows()` exists: an admin can rebuild the entire sheet from Firestore at
 * any time, so a missed row is a temporary gap, never a lost record.
 *
 * The request is deliberately a "simple" cross-origin request (text/plain, no
 * custom headers) so the browser does not send a CORS preflight, which Apps
 * Script does not answer.
 */

import { PACKING_STEPS, packingChecklist, packingProgress, cartonSummary, sumCartons, supplySummary, sumSupplies, inventoryRangeLabel } from './mutations.js'

// Column order for the sheet. Kept explicit and stable: someone will build a
// filter or a formula against these, and silently reordering them later would
// break it.
export const SHEET_COLUMNS = [
  'When', 'Unit', 'Tenant', 'Floor', 'Item', 'Done by', 'Role',
  'Stage', 'Progress', 'Sticker colour', 'Sticker numbers',
  'Pieces', 'Boxes', 'Box breakdown', 'Materials', 'Material breakdown', 'Photos', 'Note', 'Unit ID',
]

function isoLocal(ts) {
  if (!Number.isFinite(ts)) return ''
  // Written for a person reading a spreadsheet, not for a machine: local
  // wall-clock time, which is what "when did that happen" means on a job.
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// One row per completed checklist item. Carries the unit's state at the time
// the item was completed, so a single row is readable on its own without
// cross-referencing the rest of the sheet.
export function stepRow({ unit, stepKey, userName, role, ts, noteText, events = [] }) {
  const step = PACKING_STEPS.find((s) => s.key === stepKey)
  const progress = packingProgress(unit, events)
  const photos = ((unit && unit.media) || []).filter((m) => m && m.phase === stepKey).length
  return [
    isoLocal(ts),
    (unit && unit.number) || '',
    (unit && unit.tenant) || '',
    (unit && unit.floor) != null ? unit.floor : '',
    step ? step.label : stepKey,
    userName || '',
    role || '',
    (unit && unit.stage) || '',
    `${progress.done}/${progress.total}`,
    (unit && unit.stickerColor) || '',
    inventoryRangeLabel(unit) || '',
    (unit && unit.pieces) != null ? unit.pieces : '',
    sumCartons(unit && unit.materials) || '',
    cartonSummary(unit && unit.materials) || '',
    sumSupplies(unit && unit.supplies) || '',
    supplySummary(unit && unit.supplies) || '',
    photos || '',
    noteText || '',
    (unit && unit.id) || '',
  ]
}

// The whole job as rows: one per completed item across every unit, oldest
// first. This is what the "back up everything now" button sends, and it is
// what makes a missed live row recoverable rather than lost.
export function allRows(units = [], events = []) {
  const rows = []
  for (const unit of units) {
    const unitEvents = events.filter((e) => e && e.unitId === unit.id)
    for (const item of packingChecklist(unit, unitEvents)) {
      if (!item.done) continue
      rows.push(stepRow({
        unit,
        stepKey: item.key,
        userName: item.by,
        role: '',
        ts: item.at,
        noteText: '',
        events: unitEvents,
      }))
    }
  }
  return rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])))
}

// Fire and forget. Never throws and never blocks: a packer standing in an
// apartment must not be held up, or shown an error, because a spreadsheet
// mirror was slow. The work is already safely in Firestore by this point.
export async function pushRows(url, rows) {
  if (!url || !rows || rows.length === 0) return { sent: false, reason: 'nothing to send' }
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ columns: SHEET_COLUMNS, rows }),
    })
    return { sent: true }
  } catch (err) {
    // Swallowed on purpose. Logged so it is visible in a console, and
    // recoverable at any time with the re-sync button.
    console.warn('[sheetBackup] row not mirrored to the sheet:', err && err.message)
    return { sent: false, reason: err && err.message }
  }
}
