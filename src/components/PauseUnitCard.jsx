import React, { useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import { isPaused, PAUSE_REASONS } from '../lib/focus.js'
import { mayPack, mayLoad } from '../lib/roles.js'

/* Parking a unit that cannot be finished yet.
 *
 * One apartment at a time stops a photo landing on the wrong unit, and it
 * works. What it could not express is the ordinary case where a unit cannot be
 * finished for reasons that have nothing to do with the crew: a resident who
 * will not give access until the move-out morning, or who is still sleeping in
 * the bed and eating off the plates. One of those sat open and blocked a whole
 * floor, which is a worse failure than the one the lock prevents.
 *
 * Pausing says "not finished, not being worked on, and here is why". It keeps
 * every bit of the partial work, does not advance the unit, and does not fake
 * a completion.
 */
export default function PauseUnitCard({ unit, toast }) {
  const { dispatch, currentUser } = useStore()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const paused = isPaused(unit)
  const canTouch = mayPack(currentUser.role) || mayLoad(currentUser.role)
  const pausable = ['not_started', 'packing', 'packed'].includes(unit.stage)
  if (!canTouch || (!pausable && !paused)) return null

  const run = async (fn, done) => {
    if (busy) return
    setBusy(true)
    try {
      const status = await submitWrite(fn())
      toast(status === 'queued' ? QUEUED_MESSAGE : done)
      setOpen(false); setReason('')
    } catch (err) {
      toast(err.message || "Couldn't save that.")
    } finally {
      setBusy(false)
    }
  }

  if (paused) {
    return (
      <div className="card" style={{ padding: '14px 20px', marginBottom: 14, borderLeft: '3px solid #f59e0b' }}>
        <div className="row" style={{ marginBottom: 2 }}>
          <span className="grow"><b>Paused</b></span>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {unit.paused.userName || 'Crew'}{unit.paused.at ? ` · ${fmtTime(unit.paused.at)}` : ''}
          </span>
        </div>
        <div style={{ fontSize: 13.5, marginBottom: 10 }}>{unit.paused.reason}</div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Nothing is lost. Everything already recorded is still here, and this unit is not holding anybody up.
        </div>
        <button
          className="btn btn-primary btn-sm" style={{ width: '100%' }} disabled={busy}
          onClick={() => run(() => dispatch({ type: 'resumeUnit', p: { unitId: unit.id } }), `Unit ${unit.number} picked back up ✓`)}
        >
          {busy ? 'Saving…' : 'Pick this unit back up'}
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        type="button" className="btn btn-ghost btn-sm"
        style={{ width: '100%', marginBottom: 14 }}
        onClick={() => { setReason(''); setOpen(true) }}
      >
        Pause this unit
      </button>

      {open && (
        <Modal
          title={`Pause unit ${unit.number}`}
          sub={`${currentUser.name}, ${fmtTime(Date.now())}`}
          onClose={() => !busy && setOpen(false)}
        >
          <div className="field">
            <label>Why can it not be finished now?</label>
            <div className="pick-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {PAUSE_REASONS.map((r) => (
                <button
                  key={r} type="button"
                  className={`btn btn-sm ${reason === r ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setReason(r)}
                >{r}</button>
              ))}
            </div>
            <textarea
              className="input" rows={2} placeholder="Or type what is holding it up"
              value={reason} onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            The unit stays exactly as it is and stops holding up your queue. Whoever picks it up next sees this
            reason, so say what you are actually waiting for.
          </div>
          <button
            className="btn btn-primary btn-lg" style={{ width: '100%' }}
            disabled={busy || !reason.trim()}
            onClick={() => run(
              () => dispatch({ type: 'pauseUnit', p: { unitId: unit.id, reason } }),
              `Unit ${unit.number} paused ✓`,
            )}
          >
            {busy ? 'Saving…' : 'Pause it'}
          </button>
        </Modal>
      )}
    </>
  )
}
