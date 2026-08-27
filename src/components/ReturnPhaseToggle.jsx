import React, { useState } from 'react'
import { useStore } from '../store.jsx'

// Admin-only "Begin / End return phase" switch
// (docs/superpowers/specs/2026-08-26-return-phase-design.md section 2).
// Confirms before flipping either direction since it changes which actions
// every crew member sees across the whole board, not just this screen.
// Self-gates for admin so callers can drop it in without checking the role
// first (same pattern as EmptiesInButton, BigBoxSwapButton, NewUnitButton).
export default function ReturnPhaseToggle({ toast }) {
  const { state, currentUser, dispatch } = useStore()
  const [busy, setBusy] = useState(false)

  if (!currentUser || currentUser.role !== 'admin') return null

  const on = !!state.project?.returnPhase

  const flip = async () => {
    const msg = on
      ? 'End the return phase? Everyone goes back to seeing only the outbound actions.'
      : 'Begin the return phase? Warehouse, movers and packers will start seeing the return actions (load for return, dispatch, deliver, unload, unpack) for anything already at the warehouse.'
    if (!confirm(msg)) return
    setBusy(true)
    try {
      await dispatch({ type: 'setReturnPhase', p: { on: !on } })
      toast?.(on ? 'Return phase ended ✓' : 'Return phase begun. The board now shows return actions ✓')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button className={`btn ${on ? 'btn-danger' : 'btn-dark'} btn-sm`} disabled={busy} onClick={flip}>
      {busy ? 'Working…' : on ? '↩ End return phase' : '↩ Begin return phase'}
    </button>
  )
}
