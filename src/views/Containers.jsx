import React, { useMemo, useState } from 'react'
import { useStore, CONT_STATUS, containerAction } from '../store.jsx'
import { Modal, Lightbox, EventRow, StagePill } from '../ui.jsx'
import { captureMedia } from '../lib/upload.js'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import EmptiesInButton from '../components/EmptiesInButton.jsx'
import BigBoxSwapButton from '../components/BigBoxSwapButton.jsx'
import DeliverReturnButton from '../components/DeliverReturnButton.jsx'
import ReceiveContainerButton from '../components/ReceiveContainerButton.jsx'
import { mayLoad } from '../lib/roles.js'
import {
  sortContainers, vaultBoardStats, vaultPositionInUnit, vaultSheetRows,
  sortVaultSheet, nextVaultSort, DEFAULT_VAULT_SORT, CONTAINER_LIFECYCLE,
} from '../lib/mutations.js'
import { vaultSheetCSV, vaultSheetText, vaultExportName, downloadText, vaultPhotoLabel } from '../lib/vaultExport.js'
import VaultManifest from '../components/VaultManifest.jsx'

// Two ways to read the same board. Cards are for the dock, where you are
// holding a phone and looking for one vault. The sheet is for checking our
// custody record line by line against BigBox's billing sheet, which is the
// job that found three misspelled customer names on their side. The choice
// sticks, because whoever wants one view almost never wants the other.
const VIEW_KEY = 'movetrack.vaults.view'

function storedView() {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'sheet' ? 'sheet' : 'cards'
  } catch {
    return 'cards'
  }
}

// Lifecycle order the pool view groups by, matches CONT_STATUS in store.jsx:
// empty (on site) → filling → full/ready → picked_up (in transit) → at_warehouse,
// then the return leg's mirror: return_filling → return_full → return_transit
// → back_on_site → returned_empty. The return statuses only ever have
// containers in them once the return phase has actually been used, so
// including them here up front is a no-op (nothing to render) until then.
const STATUS_ORDER = CONTAINER_LIFECYCLE

// Every column the sheet sorts by, in the order they are shown.
const SHEET_COLUMNS = [
  ['number', 'Vault'], ['unit', 'Unit'], ['customer', 'Customer'], ['of', 'Of'],
  ['status', 'Status'], ['photos', 'Photos'],
]

export default function Containers({ openUnit, focusId, clearFocus, toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [openId, setOpenId] = useState(focusId || null)
  const [lightbox, setLightbox] = useState(null)
  const [resolveNote, setResolveNote] = useState('')
  const [busy, setBusy] = useState(false)
  // Per-container busy set so a double-tap on the "mark full" quick action
  // (rendered once per card) can't fire the same write twice.
  const [busyIds, setBusyIds] = useState(() => new Set())
  const SAVE_ERROR = "Couldn't save that. Check your signal and try again."

  // Return-leg "dispatch for return" (driver name + optional photo), the
  // mirror of the outbound BigBox swap but one container at a time instead
  // of a batch (docs/superpowers/specs/2026-08-26-return-phase-design.md §3).
  const [driverName, setDriverName] = useState('')
  const [drPreview, setDrPreview] = useState(null)
  const [drUploading, setDrUploading] = useState(false)
  const [drUrl, setDrUrl] = useState(null)
  const [drError, setDrError] = useState(null)

  const isMover = mayLoad(currentUser?.role)
  const isWarehouse = currentUser?.role === 'admin' || currentUser?.role === 'warehouse'

  const groups = useMemo(() => {
    const g = {}
    for (const c of state.containers) (g[c.status] = g[c.status] || []).push(c)
    // Sorted within each status rather than across it: the grouping is the
    // lifecycle and that has to stay. Inside a group they read by tenant.
    for (const status of Object.keys(g)) g[status] = sortContainers(g[status], state.units)
    return g
  }, [state.containers, state.units])

  const open = openId ? state.containers.find((c) => c.id === openId) : null

  const close = () => {
    setOpenId(null); setResolveNote('')
    setDriverName('')
    setDrPreview(null); setDrUploading(false); setDrUrl(null); setDrError(null)
    clearFocus && clearFocus()
  }

  const captureDispatchPhoto = async (file) => {
    setDrError(null); setDrPreview(URL.createObjectURL(file)); setDrUrl(null); setDrUploading(true)
    try {
      const { url } = await captureMedia(file, `containers/${open.id}/dispatch-return/${Date.now()}-${currentUser.uid}.jpg`)
      setDrUrl(url)
    } catch (err) {
      setDrError(err.message || 'Capture failed, try again.')
    } finally {
      setDrUploading(false)
    }
  }

  // Both return a success boolean (instead of throwing) so a modal-context
  // caller can decide whether to close the modal: close on success, stay
  // open with the error toast already shown on failure.
  const markFull = async (c) => {
    if (busyIds.has(c.id)) return false
    setBusyIds((s) => new Set(s).add(c.id))
    try {
      const status = await submitWrite(dispatch({ type: 'markContainerFull', p: { containerId: c.id } }))
      toast(status === 'queued' ? QUEUED_MESSAGE : `${c.number}: marked full, ready for pickup ✓`)
      return true
    } catch (err) {
      toast(err.message || SAVE_ERROR)
      return false
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(c.id); return n })
    }
  }

  const markReturnFull = async (c) => {
    if (busyIds.has(c.id)) return false
    setBusyIds((s) => new Set(s).add(c.id))
    try {
      const status = await submitWrite(dispatch({ type: 'markReturnFull', p: { containerId: c.id } }))
      toast(status === 'queued' ? QUEUED_MESSAGE : `${c.number}: marked full for return, ready for dispatch ✓`)
      return true
    } catch (err) {
      toast(err.message || SAVE_ERROR)
      return false
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(c.id); return n })
    }
  }

  const submitDispatchReturn = async () => {
    if (!driverName.trim()) return toast('Enter the driver name.')
    if (!drUrl) return toast('Add a photo of the container being dispatched for return.')
    setBusy(true)
    try {
      const media = drUrl ? [{ id: `dispatch-${Date.now()}`, kind: 'photo', url: drUrl, label: `Container ${open.number} dispatched for return` }] : []
      const status = await submitWrite(dispatch({ type: 'dispatchReturn', p: { containerId: open.id, driverName: driverName.trim(), media } }))
      toast(status === 'queued' ? QUEUED_MESSAGE : `${open.number}: dispatched for return with ${driverName.trim()} ✓`)
      close()
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const totalCount = state.containers.length

  const stats = useMemo(() => vaultBoardStats(state.containers), [state.containers])
  const [view, setView] = useState(storedView)
  const [sort, setSort] = useState(DEFAULT_VAULT_SORT)
  const [exporting, setExporting] = useState(false)
  const [manifest, setManifest] = useState(false)
  const rows = useMemo(
    () => (view === 'sheet' ? sortVaultSheet(vaultSheetRows(state.containers, state.units), sort) : []),
    [view, sort, state.containers, state.units],
  )
  const chooseView = (next) => {
    setView(next)
    try { window.localStorage.setItem(VIEW_KEY, next) } catch { /* private mode, the view just won't stick */ }
  }

  const statusLabel = (s) => (CONT_STATUS[s] ? CONT_STATUS[s].label : s)
  const heading = `Gorilla Movers · vault manifest · ${state.project?.name || 'Trinity Manor'} · ${new Date().toLocaleDateString('en-US')}`

  // Paste-into-a-message is the fastest of the three and the one most likely
  // to be reached for, so it reports success rather than failing silently on
  // a browser that refuses the clipboard.
  const copySheet = async () => {
    try {
      await navigator.clipboard.writeText(vaultSheetText(rows, statusLabel, heading))
      toast(`Copied ${rows.length} vaults. Paste it into an email or a text.`)
    } catch {
      toast('This browser would not let me use the clipboard. Try the CSV instead.')
    }
    setExporting(false)
  }

  const shareSheet = async () => {
    const text = vaultSheetText(rows, statusLabel, heading)
    // Only on a phone, and only when the OS actually offers a share sheet.
    if (!navigator.share) return copySheet()
    try {
      await navigator.share({ title: 'Gorilla Movers vault manifest', text })
    } catch { /* the user backing out of the OS share sheet is not an error */ }
    setExporting(false)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Vaults</h1>
          <p>Chain of custody for every vault</p>
          <div className="row vault-stats" style={{ gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
            <span><strong>{stats.vaults}</strong> vault{stats.vaults === 1 ? '' : 's'} on the board</span>
            <span><strong>{stats.inUse}</strong> in use</span>
            <span><strong>{stats.empty}</strong> empty</span>
            <span><strong>{stats.units}</strong> unit{stats.units === 1 ? '' : 's'} loaded</span>
            {stats.spread > 0 && (
              <span><strong>{stats.spread}</strong> across more than one vault</span>
            )}
            {stats.perUnit != null && (
              <span><strong>{stats.perUnit}</strong> vaults per unit on average</span>
            )}
          </div>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="seg" role="group" aria-label="How to show the vaults">
            <button className={view === 'cards' ? 'on' : ''} aria-pressed={view === 'cards'} onClick={() => chooseView('cards')}>Cards</button>
            <button className={view === 'sheet' ? 'on' : ''} aria-pressed={view === 'sheet'} onClick={() => chooseView('sheet')}>Sheet</button>
          </div>
          {view === 'sheet' && totalCount > 0 && (
            <div className="export-wrap">
              <button className="btn btn-dark" aria-expanded={exporting} onClick={() => setExporting((x) => !x)}>Export ▾</button>
              {exporting && (
                <>
                  {/* Catches the next click anywhere so the menu closes the way
                    * every other menu on a phone does, without a document
                    * listener that has to be torn down. */}
                  <div className="export-catch" onClick={() => setExporting(false)} />
                  <div className="export-menu" role="menu">
                    {navigator.share
                      ? <button role="menuitem" onClick={shareSheet}><b>Share</b><span>Text, email, AirDrop</span></button>
                      : <button role="menuitem" onClick={copySheet}><b>Copy</b><span>Paste into an email or text</span></button>}
                    <button role="menuitem" onClick={() => { downloadText(vaultSheetCSV(rows, statusLabel), vaultExportName('csv')); setExporting(false) }}>
                      <b>CSV</b><span>Opens in Excel</span>
                    </button>
                    <button role="menuitem" onClick={() => { setManifest(true); setExporting(false) }}>
                      <b>Printable manifest</b><span>Branded sheet, print or save as PDF</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {(isMover || isWarehouse) && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {isMover && (
              <>
                <EmptiesInButton toast={toast} />
                <BigBoxSwapButton toast={toast} />
                <DeliverReturnButton toast={toast} />
              </>
            )}
            {isWarehouse && <ReceiveContainerButton toast={toast} />}
          </div>
        )}
      </div>

      {totalCount === 0 && (
        <div className="card empty">
          <div className="big">📦</div>
          No vaults on site yet.{isMover ? ' Log the empties the driver dropped off to get started.' : ''}
        </div>
      )}

      {view === 'sheet' && totalCount > 0 && (
        <div className="card" style={{ padding: 0, marginBottom: 18 }}>
          <div className="table-scroll">
            <table className="tbl vault-sheet">
              <thead>
                <tr>
                  {SHEET_COLUMNS.map(([key, label]) => (
                    <th
                      key={key}
                      aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button className="th-sort" onClick={() => setSort((s) => nextVaultSort(s, key))}>
                        {label}
                        <span className="th-arrow">{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="click" onClick={() => setOpenId(r.id)}>
                    <td className="vault-sheet-num">
                      {r.number}
                      {r.flagged && <span style={{ color: 'var(--red)', marginLeft: 6 }}>⚑</span>}
                    </td>
                    <td>{r.on.length ? r.on.map((x) => x.unit.number).join(', ') : <span className="muted">-</span>}</td>
                    <td>{r.on.length ? r.on.map((x) => x.unit.tenant || '-').join(', ') : <span className="muted">Empty</span>}</td>
                    <td className="muted">{r.on.map((x) => (x.pos ? `${x.pos.nth} of ${x.pos.of}` : '')).filter(Boolean).join(', ') || '-'}</td>
                    <td>
                      <span className="badge" style={{ background: CONT_STATUS[r.status].color + '22', color: CONT_STATUS[r.status].color }}>
                        {CONT_STATUS[r.status].label}
                      </span>
                    </td>
                    {/* Says what is missing, not just that something is. A vault
                      * sealed in the warehouse can never have its door-open shot
                      * taken, so "closed only" is a fact to read off the sheet,
                      * not a task anyone can still do. */}
                    <td className={r.on.length && !r.complete ? 'vault-sheet-gap' : 'muted'}>
                      {r.complete && '✓ '}{vaultPhotoLabel(r)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'cards' && STATUS_ORDER.filter((s) => groups[s]?.length).map((status) => (
        <div key={status}>
          <div className="section-title">{CONT_STATUS[status].label} · {groups[status].length}</div>
          <div className="cont-grid" style={{ marginBottom: 18 }}>
            {groups[status].map((c) => {
              const units = c.unitIds.map((id) => state.units.find((u) => u.id === id)).filter(Boolean)
              // Covers both the outbound filling → full quick tap and its
              // return-leg mirror (return_filling → return_full); returns
              // null everywhere else, same as containerAction always has.
              const quickAction = containerAction(currentUser, c, state.project?.returnPhase)
              return (
                <div key={c.id} className="card cont-card" onClick={() => setOpenId(c.id)}>
                  <div className="row">
                    <span className="cont-num grow">{c.number}{c.flag?.open && <span style={{ color: 'var(--red)', marginLeft: 7 }}>⚑</span>}</span>
                    <span className="badge" style={{ background: CONT_STATUS[status].color + '22', color: CONT_STATUS[status].color }}>
                      ● {CONT_STATUS[status].label}{c.bay ? ` · ${c.bay}` : ''}
                    </span>
                  </div>
                  <div className="cont-units">
                    {units.length > 0
                      /* "1 unit" was true of nearly every vault and told
                       * nobody anything: unit 906 fills three vaults and each
                       * one read "1 unit", so the board never showed that the
                       * apartment was split. Name the unit, and when its goods
                       * run across several vaults say which one this is. */
                      ? units.map((u) => {
                        const pos = vaultPositionInUnit(u, c.id)
                        const part = pos ? ` · vault ${pos.nth} of ${pos.of}` : ''
                        return `Unit ${u.number} · ${u.tenant || '-'}${part}`
                      }).join(' · ')
                      : (status === 'empty' ? 'Empty, nothing loaded yet' : '-')}
                  </div>
                  {quickAction && (
                    <button
                      className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }}
                      disabled={busyIds.has(c.id)}
                      onClick={(e) => { e.stopPropagation(); if (quickAction.key === 'markReturnFull') markReturnFull(c); else markFull(c) }}
                    >{busyIds.has(c.id) ? 'Saving…' : quickAction.label}</button>
                  )}
                  {status === 'return_full' && isWarehouse && (
                    <button
                      className="btn btn-dark btn-sm" style={{ marginTop: 10, width: '100%' }}
                      onClick={(e) => { e.stopPropagation(); setOpenId(c.id) }}
                    >Dispatch for return →</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {open && (
        <Modal
          title={`Container ${open.number}`}
          sub={`${CONT_STATUS[open.status]?.label || open.status}${open.bay ? ' · ' + open.bay : ''}${open.driverName ? ' · outbound driver: ' + open.driverName : ''}${open.returnDriverName ? ' · return driver: ' + open.returnDriverName : ''}`}
          onClose={() => { if (!busy) close() }}
        >
          <div className="section-title" style={{ marginTop: 0 }}>Units inside</div>
          {open.unitIds.length === 0 && <div className="muted" style={{ padding: '6px 0' }}>No units loaded yet.</div>}
          {open.unitIds.map((id) => {
            const u = state.units.find((x) => x.id === id)
            if (!u) return null
            return (
              <div className="row" key={id} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="linkish" onClick={() => { close(); openUnit(id) }}>Unit {u.number}</span>
                <span className="muted grow">{u.tenant || '-'} · {u.pieces ?? '?'} pieces</span>
                <StagePill stage={u.stage} short />
              </div>
            )
          })}

          {open.flag && (
            <div className={`flagbox ${open.flag.open ? '' : 'closed'}`}>
              <b>{open.flag.open ? '⚑ Open flag' : '✓ Resolved flag'}</b>: {open.flag.message}
              {open.flag.open && currentUser?.role === 'admin' && (
                <div style={{ marginTop: 10 }}>
                  <input className="input" placeholder="How was it resolved?" value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} />
                  <button className="btn btn-dark btn-sm" style={{ marginTop: 8 }} disabled={busy || !resolveNote.trim()} onClick={async () => {
                    setBusy(true)
                    try {
                      const status = await submitWrite(dispatch({ type: 'resolveContainerFlag', p: { containerId: open.id, note: resolveNote.trim() } }))
                      setResolveNote(''); toast(status === 'queued' ? QUEUED_MESSAGE : 'Flag resolved ✓')
                    } catch (err) {
                      toast(err.message || SAVE_ERROR)
                    } finally {
                      setBusy(false)
                    }
                  }}>{busy ? 'Saving…' : 'Resolve flag'}</button>
                </div>
              )}
              {open.flag.open && currentUser?.role !== 'admin' && <div className="muted" style={{ marginTop: 6 }}>Only the admin can resolve flags.</div>}
            </div>
          )}

          {open.status === 'filling' && isMover && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busyIds.has(open.id)} onClick={async () => { if (await markFull(open)) close() }}>
                {busyIds.has(open.id) ? 'Saving…' : 'Full, ready for pickup'}
              </button>
            </div>
          )}

          {open.status === 'return_filling' && isWarehouse && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busyIds.has(open.id)} onClick={async () => { if (await markReturnFull(open)) close() }}>
                {busyIds.has(open.id) ? 'Saving…' : 'Mark full, ready for dispatch'}
              </button>
            </div>
          )}

          {open.status === 'return_full' && isWarehouse && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Dispatch for return</div>
              <div className="field"><label>Driver name / truck #</label>
                <input className="input" autoFocus placeholder="e.g. Mike, Truck 12" value={driverName} onChange={(e) => setDriverName(e.target.value)} /></div>
              <div className="field">
                <label>Photo <span className="muted">(required)</span></label>
                <label className="dropzone camera-capture" style={{ display: 'block' }}>
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files[0]; if (f) captureDispatchPhoto(f); e.target.value = '' }}
                  />
                  {drPreview ? (
                    <div className="inv-preview">
                      <img src={drPreview} alt="Container ready for return dispatch" className="inv-thumb" />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {drUploading ? 'Saving…' : drUrl ? '✓ Photo saved, tap to retake' : drError || 'Tap to retake'}
                      </div>
                    </div>
                  ) : <>📷 Tap to add a photo</>}
                </label>
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy || drUploading || !driverName.trim() || !drUrl} onClick={submitDispatchReturn}>
                {busy ? 'Logging…' : 'Confirm dispatch for return'}
              </button>
            </div>
          )}

          {open.status === 'picked_up' && (
            <div className="muted" style={{ marginTop: 16 }}>
              In transit to the warehouse. Use the receive button above to check it in (the number is confirmed blind, so it is not shown here).
            </div>
          )}

          <div className="section-title">Custody log</div>
          <div className="timeline">
            {state.events.filter((e) => e.containerId === open.id).sort((a, b) => b.ts - a.ts).map((e) => (
              <EventRow key={e.id} e={e} onOpenMedia={setLightbox} showTarget={false} />
            ))}
            {state.events.filter((e) => e.containerId === open.id).length === 0 && (
              <div className="muted" style={{ padding: '10px 0' }}>No activity logged against this container yet.</div>
            )}
          </div>
        </Modal>
      )}
      {manifest && (
        <Modal
          title="Vault manifest"
          sub={`${rows.length} vaults · ${state.project?.name || 'Trinity Manor'}`}
          onClose={() => setManifest(false)}
          wide
        >
          <div className="manifest-actions no-print">
            <button className="btn btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
            <button className="btn btn-ghost" onClick={copySheet}>Copy as text</button>
          </div>
          <VaultManifest
            rows={rows}
            stats={stats}
            project={state.project}
            statusLabel={statusLabel}
            generatedBy={currentUser?.name}
          />
        </Modal>
      )}
      <Lightbox media={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
