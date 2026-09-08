import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal, StagePill } from '../ui.jsx'
import { surnameOf, stickerHex, inventoryRangeLabel, readyToReceive } from '../lib/mutations.js'

/* "Start a unit" for crew on the floor.
 *
 * Every apartment in the building is already on the board, so crew never
 * create one: they walk up to a door, type the number, and the app finds it.
 * Typing the number also confirms they are at the right door, because the
 * tenant's surname appears as soon as the number matches.
 *
 * This deliberately replaces the browse-the-board approach for crew. The
 * roster is fifty tenants' names and apartment numbers, and a packer needs
 * exactly one of them at a time: the one they are standing in front of.
 */
export default function FindUnitButton({ openUnit, toast, fullWidth }) {
  const { state, currentUser } = useStore()
  const [open, setOpen] = useState(false)
  const [number, setNumber] = useState('')

  const typed = number.trim()
  const match = useMemo(
    () => (typed ? state.units.find((u) => String(u.number).trim() === typed) : null),
    [state.units, typed],
  )
  // Only complain once they've typed something that could plausibly be a
  // full unit number, so the form isn't red while they're still typing.
  const noMatch = typed.length >= 3 && !match

  // A mover loads what the packers have finished, and nothing else. Without
  // this they could check in to an apartment still being packed, take a photo
  // of a half-packed room, and find every write refused by the rules. Better
  // to say so at the door than to let them start.
  const tooEarly = !!match && (
    (currentUser.role === 'mover' && (match.stage === 'not_started' || match.stage === 'packing'))
    // The warehouse books in what the movers have loaded, nothing earlier.
    || (currentUser.role === 'warehouse' && !readyToReceive(match) && match.stage !== 'at_warehouse')
  )
  const canOpen = !!match && !tooEarly

  const go = () => {
    if (!canOpen) return
    setOpen(false)
    setNumber('')
    openUnit(match.id)
  }

  if (!currentUser) return null

  return (
    <>
      <button
        className="btn btn-primary btn-lg"
        style={fullWidth ? { width: '100%' } : undefined}
        onClick={() => { setNumber(''); setOpen(true) }}
      >
        🔎 Start a unit
      </button>

      {open && (
        <Modal
          title="Which unit are you at?"
          sub="Type the number on the door"
          onClose={() => setOpen(false)}
        >
          <div className="field">
            <label>Unit number</label>
            <input
              className="input"
              autoFocus
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="e.g. 901"
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && go()}
            />
          </div>

          {match && (
            <div className="card" style={{ padding: '14px 16px', marginBottom: 12 }}>
              <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                <span className="cont-num grow">Unit {match.number}</span>
                <StagePill stage={match.stage} short />
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 6 }}>{surnameOf(match.tenant)}</div>
              <div className="muted" style={{ marginTop: 2 }}>
                {match.tenant} · Floor {match.floor}
              </div>
              {match.stickerColor && (
                <div className="muted" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: stickerHex(match.stickerColor) || '#888', border: '1px solid rgba(0,0,0,.25)' }} />
                  {match.stickerColor} stickers{inventoryRangeLabel(match) ? ` · #${inventoryRangeLabel(match)}` : ''}
                </div>
              )}
            </div>
          )}

          {tooEarly && (
            <div className="card" style={{ padding: '14px 16px', marginBottom: 12, borderLeft: '3px solid var(--brand)' }}>
              <b>Unit {match.number} is not ready yet.</b>
              <div className="muted" style={{ marginTop: 4 }}>
                {currentUser.role === 'warehouse'
                  ? 'It has not been loaded out yet. It shows up here once the movers close it out on site.'
                  : `The packers are still on it${match.stage === 'not_started' ? ', they have not started' : ''}. It turns green on the board the moment it is ready to load.`}
              </div>
            </div>
          )}

          {noMatch && (
            <div className="card" style={{ padding: '14px 16px', marginBottom: 12 }}>
              <b>No unit {typed} on this project.</b>
              <div className="muted" style={{ marginTop: 4 }}>
                Check the number on the door. If it really is missing, ask Casey to add it.
              </div>
            </div>
          )}

          <button
            className="btn btn-primary btn-lg"
            style={{ width: '100%' }}
            disabled={!canOpen}
            onClick={go}
          >
            {tooEarly ? 'Still being packed' : match ? `Open unit ${match.number}` : 'Enter a unit number'}
          </button>
        </Modal>
      )}
    </>
  )
}
