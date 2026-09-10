import React, { useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import {
  RECEIVING_STEPS, receivingChecklist, receivingProgress, receivingComplete,
  lastNameMismatch, unitNumberMismatch, vaultSetDiff, parseVaultNumbers, completeVaults,
} from '../lib/mutations.js'

const SAVE_ERROR = "Couldn't save that. Check your signal and try again."

/* The warehouse manager's arrival check for one apartment.
 *
 * All three answers are typed from what is physically on the dock, never
 * confirmed against something already on screen. This is the last point where
 * a vault left on the truck, or a load out of the wrong apartment, can be caught
 * while the truck is still in the yard and the crew who loaded it are still
 * reachable. Nothing here blocks: a mismatch is recorded, flagged and passed
 * to the office, because refusing to book in a unit that is physically sitting
 * on the dock helps nobody. */
export default function ReceiveCard({ unit, toast }) {
  const { dispatch, currentUser } = useStore()
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  const checklist = receivingChecklist(unit)
  const progress = receivingProgress(unit)
  const ready = receivingComplete(unit)
  const expected = completeVaults(unit)

  const open = (key) => { setForm({}); setModal(key) }
  const close = () => { if (!busy) setModal(null) }

  const run = async (fn, done) => {
    if (busy) return
    setBusy(true)
    try {
      const status = await submitWrite(fn())
      setModal(null)
      toast(status === 'queued' ? QUEUED_MESSAGE : done)
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    if (modal === 'recv_number') {
      const typed = String(form.number || '').trim()
      if (!typed) return toast('Type the unit number from the paperwork on the vaults.')
      const bad = unitNumberMismatch(unit, typed)
      return run(
        () => dispatch({ type: 'completeReceiveStep', p: { unitId: unit.id, key: 'recv_number', value: typed, matched: !bad, expected: unit.number } }),
        bad ? `⚑ Mismatch flagged: the record says ${bad.recorded}` : 'Unit number verified ✓',
      )
    }

    if (modal === 'recv_lastname') {
      const typed = String(form.lastName || '').trim()
      if (!typed) return toast("Type the tenant's last name.")
      const bad = lastNameMismatch(unit, typed)
      return run(
        () => dispatch({ type: 'completeReceiveStep', p: { unitId: unit.id, key: 'recv_lastname', value: typed, matched: !bad, expected: bad ? bad.recorded : typed } }),
        bad ? `⚑ Mismatch flagged: the record says ${bad.recorded}` : 'Last name verified ✓',
      )
    }

    if (modal === 'recv_vaults') {
      const typed = parseVaultNumbers(form.vaults)
      if (typed.length === 0) return toast('Type the number off each vault you have received.')
      const diff = vaultSetDiff(unit, typed)
      const parts = []
      if (diff.missing.length) parts.push(`missing ${diff.missing.join(', ')}`)
      if (diff.unexpected.length) parts.push(`unexpected ${diff.unexpected.join(', ')}`)
      return run(
        () => dispatch({ type: 'completeReceiveStep', p: {
          unitId: unit.id, key: 'recv_vaults', value: typed.join(', '),
          matched: diff.ok, expected: diff.expected.join(', '),
        } }),
        diff.ok ? `All ${typed.length} vault${typed.length === 1 ? '' : 's'} verified ✓` : `⚑ Vault mismatch flagged: ${parts.join(', ')}`,
      )
    }
  }

  const finish = () => run(
    () => dispatch({ type: 'receiveUnit', p: { unitId: unit.id } }),
    `Unit ${unit.number} booked into the warehouse ✓`,
  )

  const step = RECEIVING_STEPS.find((s) => s.key === modal)
  const typedVaults = parseVaultNumbers(form.vaults)
  const liveDiff = modal === 'recv_vaults' && typedVaults.length ? vaultSetDiff(unit, typedVaults) : null

  return (
    <>
      <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <div className="section-title grow" style={{ margin: 0 }}>Warehouse arrival check</div>
          <span className="muted" style={{ fontWeight: 700 }}>{progress.done}/{progress.total}</span>
        </div>

        {checklist.map((row, i) => {
          const tappable = !row.done
          const Row = tappable ? 'button' : 'div'
          return (
            <Row
              key={row.key}
              type={tappable ? 'button' : undefined}
              onClick={tappable ? () => open(row.key) : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                padding: tappable ? '10px' : '8px 10px', marginBottom: 4, borderRadius: 10,
                fontFamily: 'inherit', fontSize: 13.5,
                background: tappable ? 'var(--card-2, rgba(127,127,127,.07))' : 'transparent',
                border: tappable ? '1px solid var(--border, rgba(127,127,127,.22))' : '1px solid transparent',
                cursor: tappable ? 'pointer' : 'default', color: 'inherit',
              }}
            >
              <span aria-hidden style={{ flex: 'none', width: 22, textAlign: 'center', fontWeight: 800, color: row.done ? (row.matched === false ? '#b91c1c' : '#16a34a') : 'var(--ink-3, #9aa1ab)' }}>
                {row.done ? (row.matched === false ? '⚑' : '✓') : i + 1}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ color: row.done ? 'var(--ink-3, #6b7280)' : 'inherit', fontWeight: tappable ? 600 : 400 }}>{row.label}</span>
                {row.done && (
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3, #9aa1ab)' }}>
                    {row.by || 'Crew'}{row.at ? ` · ${fmtTime(row.at)}` : ''}{row.value ? ` · ${row.value}` : ''}
                    {row.matched === false && <b style={{ color: '#b91c1c' }}> · did not match</b>}
                  </span>
                )}
              </span>
              {tappable && <span aria-hidden style={{ flex: 'none', color: 'var(--ink-3, #9aa1ab)', fontWeight: 700 }}>›</span>}
            </Row>
          )
        })}

        <button
          className="btn btn-primary btn-lg"
          style={{ width: '100%', marginTop: 12 }}
          disabled={!ready || busy}
          onClick={finish}
        >
          {busy ? 'Saving…' : ready ? `Book unit ${unit.number} into the warehouse` : 'Verify all three to book it in'}
        </button>
      </div>

      {modal && (
        <Modal
          title={step ? step.label : ''}
          sub={`Unit ${unit.number} · checked by ${currentUser.name}, ${fmtTime(Date.now())}`}
          onClose={close}
        >
          {modal === 'recv_number' && (
            <div className="field">
              <label>What unit number is on the paperwork?</label>
              <input
                className="input" type="text" inputMode="numeric" autoFocus placeholder="e.g. 906"
                value={form.number || ''} onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
            </div>
          )}

          {modal === 'recv_lastname' && (
            <div className="field">
              <label>Tenant&rsquo;s last name</label>
              <input
                className="input" type="text" autoFocus placeholder="e.g. Ochoa"
                value={form.lastName || ''} onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
          )}

          {modal === 'recv_vaults' && (
            <div className="field">
              <label>Every vault number you have received</label>
              <textarea
                className="input" rows={3} autoFocus placeholder="BB-1007, BB-1008"
                value={form.vaults || ''} onChange={(e) => setForm({ ...form, boxes: e.target.value })}
              />
              <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
                Read them off the vaults on the dock. Commas, spaces or new lines all work.
                {expected.length > 0 && ` The movers logged ${expected.length} on this unit.`}
              </div>
              {liveDiff && !liveDiff.ok && (
                <div style={{ marginTop: 10, fontSize: 13, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '9px 12px' }}>
                  {liveDiff.missing.length > 0 && <div><b>Not here yet:</b> {liveDiff.missing.join(', ')} — still on the truck or on site.</div>}
                  {liveDiff.unexpected.length > 0 && <div style={{ marginTop: liveDiff.missing.length ? 4 : 0 }}><b>Not on this unit:</b> {liveDiff.unexpected.join(', ')} — find out whose before it is put away.</div>}
                </div>
              )}
              {liveDiff && liveDiff.ok && (
                <div className="muted" style={{ marginTop: 10, fontSize: 13, color: '#15803d' }}>
                  ✓ All {liveDiff.expected.length} vault{liveDiff.expected.length === 1 ? '' : 's'} accounted for.
                </div>
              )}
            </div>
          )}

          <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
            Type what is actually in front of you. If it does not match the record that gets flagged for the office,
            and you can still book the unit in.
          </div>

          <button
            className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 10 }}
            disabled={busy} onClick={save}
          >
            {busy ? 'Saving…' : 'Save this check ✓'}
          </button>
        </Modal>
      )}
    </>
  )
}
