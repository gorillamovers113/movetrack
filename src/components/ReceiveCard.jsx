import React, { useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import {
  RECEIVING_STEPS, receivingChecklist, receivingProgress, receivingComplete,
  lastNameMismatch, unitNumberMismatch, completeVaults,
  receivedVaults, receivingDiff, receivedVaultError, normalizeVaultNumber,
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
  const diff = receivingDiff(unit)

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
      const typed = String(form.vault || '').trim()
      const err = receivedVaultError(typed, unit)
      if (err) return toast(err)
      const known = diff.expected.includes(normalizeVaultNumber(typed))
      return run(
        () => dispatch({ type: 'receiveVault', p: { unitId: unit.id, number: typed } }),
        known
          ? `Vault ${normalizeVaultNumber(typed)} booked in ✓`
          : `⚑ Flagged: ${normalizeVaultNumber(typed)} is not on this unit's load-out`,
      )
    }

    if (modal === 'short') {
      return run(
        () => dispatch({ type: 'receiveVaultsShort', p: { unitId: unit.id, note: form.note } }),
        `⚑ ${diff.missing.length} vault${diff.missing.length === 1 ? '' : 's'} reported short`,
      )
    }
  }

  const finish = () => run(
    () => dispatch({ type: 'receiveUnit', p: { unitId: unit.id } }),
    `Unit ${unit.number} booked into the warehouse ✓`,
  )

  const step = RECEIVING_STEPS.find((s) => s.key === modal)
  const booked = receivedVaults(unit).slice().sort((a, b) => (a.at || 0) - (b.at || 0))

  return (
    <>
      <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <div className="section-title grow" style={{ margin: 0 }}>Warehouse arrival check</div>
          <span className="muted" style={{ fontWeight: 700 }}>{progress.done}/{progress.total}</span>
        </div>

        {checklist.map((row, i) => {
          // The vaults row stays open once done: a vault that turns up an hour
          // later still has to be bookable, and a closed row would send the
          // manager looking for somewhere else to put it.
          const tappable = !row.done || row.repeatable
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
                <span style={{ color: row.done ? 'var(--ink-3, #6b7280)' : 'inherit', fontWeight: tappable && !row.done ? 600 : 400 }}>
                  {row.label}
                  {row.repeatable && row.expected > 0 && (
                    <span className="muted" style={{ marginLeft: 7 }}>· {row.count} of {row.expected}</span>
                  )}
                </span>
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

        {booked.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', marginBottom: 6 }}>
              ON THE DOCK
            </div>
            {booked.map((r) => (
              <div key={r.number} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0', fontSize: 13.5 }}>
                <span aria-hidden>{r.matched === false ? '⚑' : '📦'}</span>
                <span className="grow">
                  <b>{r.number}</b>
                  {r.matched === false && <b style={{ color: '#b91c1c' }}> · not on this unit</b>}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {r.userName || 'Crew'}{r.at ? ` · ${fmtTime(r.at)}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {diff.missing.length > 0 && !checklist.find((r) => r.repeatable)?.short && (
          <button
            type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 10 }}
            onClick={() => open('short')}
          >
            {diff.missing.length} did not arrive
          </button>
        )}

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
              <label>Read the number off the vault in front of you</label>
              <input
                className="input" type="text" autoFocus placeholder="e.g. 8038"
                value={form.vault || ''} onChange={(e) => setForm({ ...form, vault: e.target.value })}
              />
              <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
                One at a time, as each comes off the truck. The movers logged {diff.expected.length} on this unit
                and {diff.got.length} {diff.got.length === 1 ? 'is' : 'are'} booked in.
              </div>
              {diff.missing.length > 0 && (
                <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
                  Still to come: {diff.missing.join(', ')}
                </div>
              )}
            </div>
          )}

          {modal === 'short' && (
            <div className="field">
              <label>What did not arrive</label>
              <div style={{ fontSize: 13.5, marginBottom: 8 }}>
                <b>{diff.missing.join(', ')}</b>
                <span className="muted"> · {diff.missing.length} of {diff.expected.length} vault{diff.expected.length === 1 ? '' : 's'}</span>
              </div>
              <textarea
                className="input" rows={2} autoFocus placeholder="Still on the truck, driver coming back tomorrow"
                value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
              <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
                This raises a flag for the office and lets you book in what is physically here. Say what you know:
                whoever chases it will have nothing else to go on.
              </div>
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
