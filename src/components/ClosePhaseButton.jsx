import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { isUnitLocked } from '../lib/mutations.js'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'

/* Closing a finished phase, and reopening it for the move back.
 *
 * Phase 1 is the left half of Trinity Manor. When the last floor goes out its
 * apartments sit in storage for five to seven months while phase 2 runs on the
 * other half with fresh crew in the same app, so they are locked rather than
 * badged: somebody will open 305 looking for 307 otherwise.
 *
 * Deliberately NOT a filter the admin has to get right. It closes every unit
 * currently open, which while phase 2 does not exist yet IS exactly phase 1,
 * and the confirm says the number out loud before anything moves. Self-gates
 * for admin, like ReturnPhaseToggle and NewUnitButton.
 */
export default function ClosePhaseButton({ toast }) {
  const { state, currentUser, dispatch } = useStore()
  const [busy, setBusy] = useState(false)

  if (!currentUser || currentUser.role !== 'admin') return null

  const open = state.units.filter((u) => !isUnitLocked(u))
  const closed = state.units.filter(isUnitLocked)
  // Nothing to say on a project where every unit is still live and nothing has
  // ever been closed: this is a milestone control, not everyday furniture.
  if (!closed.length && !open.length) return null

  const unfinished = open.filter((u) => u.stage !== 'loaded' && u.stage !== 'picked_up' && u.stage !== 'at_warehouse')

  const run = async (on, ids, msg) => {
    if (!confirm(msg)) return
    setBusy(true)
    try {
      const status = await submitWrite(dispatch({ type: 'setUnitsLocked', p: { unitIds: ids, on } }))
      toast(status === 'queued' ? QUEUED_MESSAGE : `${ids.length} unit${ids.length === 1 ? '' : 's'} ${on ? 'closed' : 'reopened'} ✓`)
    } catch (err) {
      toast(err.message || "Couldn't save that. Check your signal and try again.")
    } finally {
      setBusy(false)
    }
  }

  if (!open.length) {
    return (
      <button className="btn btn-ghost" disabled={busy} onClick={() => run(false, closed.map((u) => u.id),
        `Reopen all ${closed.length} closed units? Do this when the move back begins. Crew will be able to edit them again.`)}>
        {busy ? 'Saving…' : `🔓 Reopen ${closed.length} units`}
      </button>
    )
  }

  return (
    <button className="btn btn-ghost" disabled={busy} onClick={() => run(true, open.map((u) => u.id),
      unfinished.length
        // Said plainly rather than blocked. Casey knows which apartments were
        // skipped and why far better than a stage check does, and refusing
        // would just mean closing the phase somewhere the app cannot see.
        ? `Close ${open.length} units? ${unfinished.length} ${unfinished.length === 1 ? 'is' : 'are'} not loaded yet (${unfinished.slice(0, 4).map((u) => u.number).join(', ')}${unfinished.length > 4 ? '…' : ''}). Closing seals every one of them read-only until you reopen for the move back.`
        : `Close all ${open.length} units? They go read-only, for supervisors too, until you reopen them for the move back.`)}>
      {busy ? 'Saving…' : `🔒 Close ${open.length} units`}
    </button>
  )
}
