import React, { useEffect, useMemo, useState } from 'react'
import { STAGES, stageOf } from '../seed.js'
import { useStore, canAct, filesToMedia, fmtTime, CONT_STATUS } from '../store.jsx'
import { Modal, Lightbox, Uploader, EventRow, Avatar, StagePill } from '../ui.jsx'
import { captureMedia } from '../lib/upload.js'
import { surnameOf, STICKER_COLORS, inventoryRangeError, overlappingUnits, inventoryRangeLabel, stickerHex, CARTON_TYPES, cartonsFromForm, sumCartons, cartonSummary, packingChecklist, packingProgress, nextPackingStep, PACKING_STEPS } from '../lib/mutations.js'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import ReportOverflowButton from '../components/ReportOverflowButton.jsx'

const WAIT_HINTS = {
  loaded: 'Waiting on driver: container pickup from site.',
  picked_up: 'On the truck, driver will check it into the warehouse.',
  at_warehouse: 'Safely stored in the warehouse. Full history preserved below.',
  return_loaded: 'Waiting on the warehouse to dispatch the return container back to site.',
  return_transit: 'On the truck, heading back to the building.',
  back_on_site: 'Back on site. Waiting on a mover to unload it into the apartment.',
  unloaded: 'Unloaded into the apartment. Waiting on a packer to unpack it.',
  unpacked: 'Complete. This unit has made its full round trip.',
}

export default function UnitDetail({ unitId, goBack, openContainer, toast }) {
  const { state, dispatch, currentUser } = useStore()
  const unit = state.units.find((u) => u.id === unitId)
  const [modal, setModal] = useState(null) // 'action' | 'media' | 'note' | 'resolve'
  // Which single packing checklist item is open, if any. Separate from `modal`
  // because it is a different flow: one item, one save, one event.
  const [stepKey, setStepKey] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [form, setForm] = useState({})
  const [pending, setPending] = useState([])
  // The front-door shot and the room walkthrough are two checklist items, so
  // they are captured separately rather than as one undifferentiated pile.
  const [pendingDoor, setPendingDoor] = useState([])
  const [pendingRooms, setPendingRooms] = useState([])
  // Guards every dispatch below from a double-tap firing the same write
  // twice, and gates the confirm buttons while a write is in flight.
  const [busy, setBusy] = useState(false)
  const SAVE_ERROR = "Couldn't save that. Check your signal and try again."

  // Packer "Finish packing" inventory-sheet photo: captured via the device
  // camera, resized + uploaded to Storage as soon as it's picked so the
  // upload runs while the packer is still filling in the piece count.
  const [invPreview, setInvPreview] = useState(null)
  const [invUploading, setInvUploading] = useState(false)
  const [invUrl, setInvUrl] = useState(null)
  const [invError, setInvError] = useState(null)

  useEffect(() => () => { if (invPreview) URL.revokeObjectURL(invPreview) }, [invPreview])

  const resetInventoryCapture = () => {
    setInvPreview(null)
    setInvUploading(false)
    setInvUrl(null)
    setInvError(null)
  }

  const captureInventoryPhoto = async (file) => {
    setInvError(null)
    setInvPreview(URL.createObjectURL(file))
    setInvUrl(null)
    setInvUploading(true)
    try {
      const path = `units/${unitId}/inventory/${Date.now()}-${currentUser.uid}.jpg`
      const { url } = await captureMedia(file, path)
      setInvUrl(url)
    } catch (err) {
      setInvError(err.message || 'Capture failed, try again.')
    } finally {
      setInvUploading(false)
    }
  }

  const events = useMemo(() => state.events.filter((e) => e.unitId === unitId).sort((a, b) => b.ts - a.ts), [state.events, unitId])
  // Warn, never block: two units sharing sticker numbers on the same colour
  // is the exact mix-up the numbers prevent, but the packer is standing in
  // the apartment and knows better than we do. Declared above the !unit
  // guard: a hook after an early return changes hook order between renders.
  const cartonTotal = useMemo(
    () => sumCartons(Object.fromEntries(CARTON_TYPES.map((t) => [t.key, form[`carton_${t.key}`]]))),
    [form],
  )
  const rangeClash = useMemo(
    () => overlappingUnits(state.units, { unitId, stickerColor: unit?.stickerColor, from: form.invFrom, to: form.invTo }),
    [state.units, unitId, unit?.stickerColor, form.invFrom, form.invTo],
  )
  if (!unit) return null

  const action = canAct(currentUser, unit, state.project?.returnPhase)
  const stage = stageOf(unit.stage)
  const conts = (unit.containerIds || []).map((id) => state.containers.find((c) => c.id === id)).filter(Boolean)
  // On-site containers still available to load into, mover picks from
  // this list instead of typing a container number.
  const loadableContainers = state.containers.filter((c) => c.status === 'empty' || c.status === 'filling')
  // Return-leg mirror: return containers still open to load a unit back into
  // at the warehouse (docs/superpowers/specs/2026-08-26-return-phase-design.md §3).
  const returnLoadableContainers = state.containers.filter((c) => c.status === 'at_warehouse' || c.status === 'return_filling')
  // Outbound-only stepper (packing..at_warehouse) unless the return phase is
  // on, so the unit page looks exactly like it does today until the return
  // leg is actually in play.
  const stepperStages = STAGES.slice(1).filter((s) => state.project?.returnPhase || s.step <= 5)
  const crewName = (uid) => state.users.find((u) => u.id === uid)?.name
  const crewNames = (uids) => (uids || []).map(crewName).filter(Boolean).join(', ')

  const openAction = () => { setForm({}); setPending([]); setPendingDoor([]); setPendingRooms([]); resetInventoryCapture(); setModal('action') }
  const closeActionModal = () => { setModal(null); resetInventoryCapture() }

  // Packing is driven by the checklist, one item at a time, rather than by two
  // big all-or-nothing modals. Each item is a separate tap, a separate save,
  // and a separate line in the activity feed carrying the name and time of
  // whoever did it. Every other stage (loading, warehouse, the return leg)
  // keeps the single-action flow it already had.
  const onChecklist = (currentUser.role === 'packer' || currentUser.role === 'admin')
    && (unit.stage === 'not_started' || unit.stage === 'packing')
  const checklist = packingChecklist(unit, events)
  const progress = packingProgress(unit, events)
  const upNext = onChecklist ? nextPackingStep(unit, events) : null

  // View-only: crew can always look back at a unit they worked on, but once it
  // has moved past their part of the job they can no longer change it. That is
  // already what the security rules enforce, so offering an upload button here
  // only produced a permission error after the photo had been taken. An admin
  // is never view-only; they can correct anything at any stage.
  const viewOnly = currentUser.role !== 'admin' && !onChecklist && !action
  const canContribute = currentUser.role !== 'viewer' && !viewOnly
  // A viewer is view-only on every unit by design and knows it, so the lock
  // banner would be noise. It is for crew, who could edit this unit until
  // moments ago and need to know why they no longer can.
  const showLockBanner = viewOnly && currentUser.role !== 'viewer'

  const openStep = (key) => { setForm({}); setPending([]); resetInventoryCapture(); setStepKey(key) }
  const closeStep = () => { setStepKey(null); resetInventoryCapture() }
  const openStepLabel = stepKey ? (PACKING_STEPS.find((s) => s.key === stepKey) || {}).label : ''

  const submitStep = async () => {
    if (busy || !stepKey) return
    const p = { unitId, key: stepKey }

    // Each item validates only its own evidence. A packer is never blocked on
    // something belonging to a different item, which is the whole point of
    // splitting them: the door photo saves at the door, not at the end.
    if (stepKey === 'door') {
      if (!pending.some((m) => m.kind === 'photo')) return toast('Take the front door photo showing the unit number.')
      p.media = pending.map((m) => ({ ...m, phase: 'door', label: m.label || 'front door' }))
    }
    if (stepKey === 'rooms') {
      if (pending.length === 0) return toast('Add photos or video of the rooms before anything moves.')
      p.media = pending.map((m) => ({ ...m, phase: 'rooms', label: m.label || 'room' }))
    }
    if (stepKey === 'sticker') {
      if (!form.stickerColor) return toast('Pick the inventory sticker colour for this unit.')
      p.stickerColor = form.stickerColor
    }
    if (stepKey === 'inventory') {
      if (invUploading) return toast('Still uploading the inventory sheet photo, wait a moment and try again.')
      if (!invUrl) return toast('Take a photo of the paper inventory sheet.')
      p.media = [{ id: `inv-${Date.now()}`, kind: 'photo', url: invUrl, label: 'inventory', phase: 'inventory' }]
    }
    if (stepKey === 'numbers') {
      const rangeErr = inventoryRangeError(form.invFrom, form.invTo)
      if (rangeErr) return toast(rangeErr)
      const n = parseInt(form.pieces, 10)
      if (!n || n < 1) return toast('Enter the total pieces packed.')
      p.inventoryFrom = parseInt(form.invFrom, 10)
      p.inventoryTo = parseInt(form.invTo, 10)
      p.pieces = n
    }
    if (stepKey === 'materials') {
      if (cartonTotal < 1) return toast('Enter how many of each carton you used.')
      p.materials = cartonsFromForm(form)
    }
    if (stepKey === 'packed') {
      if (!pending.some((m) => m.kind === 'photo')) return toast('Add at least one photo of the unit packed and ready.')
      p.media = pending.map((m) => ({ ...m, phase: 'packed', label: m.label || 'packed' }))
    }
    if (stepKey === 'notes') {
      const text = (form.note || '').trim()
      if (!text) return toast('Type the note, or close this if there is nothing to add.')
      p.text = text
    }

    setBusy(true)
    try {
      const status = await submitWrite(dispatch({ type: 'completeStep', p }))
      const label = openStepLabel
      closeStep()
      toast(status === 'queued' ? QUEUED_MESSAGE : `${label} ✓ logged under your name`)
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const submitAction = async () => {
    if (busy) return
    const media = pending
    // Start and finish now carry photos too: the before record (front door
    // with the unit number, then the rooms) and the packed-and-ready state
    // are the two halves of the evidence a damage claim turns on.
    const needsPhoto = ['startPacking', 'finishPacking', 'loadUnit', 'loadForReturn', 'unloadReturn', 'unpackUnit'].includes(action.key)
    if (action.key === 'startPacking') {
      if (!pendingDoor.some((m) => m.kind === 'photo')) return toast('Take the front door photo showing the unit number.')
      if (pendingRooms.length === 0) return toast('Add photos or video of the rooms before anything moves.')
      if (!form.stickerColor) return toast('Pick the inventory sticker colour for this unit.')
    } else if (needsPhoto && !media.some((m) => m.kind === 'photo')) {
      if (action.key === 'finishPacking') return toast('Add at least one photo of the unit packed and ready.')
      return toast('At least one photo is required to complete this step, the photo record is the whole point.')
    }
    // Client-side validation up front, same as before: nothing here talks to
    // Firestore, so it stays outside the busy/try below.
    const n = parseInt(form.pieces)
    if (action.key === 'finishPacking') {
      if (!n || n < 1) return toast('Enter the total pieces packed.')
      if (invUploading) return toast('Still uploading the inventory sheet photo, wait a moment and try again.')
      if (!invUrl) return toast('Take a photo of the paper inventory sheet to finish packing.')
      const rangeErr = inventoryRangeError(form.invFrom, form.invTo)
      if (rangeErr) return toast(rangeErr)
      // Required, otherwise a finished unit sits at 6 of 7 on the checklist
      // forever and the materials record has a hole in it.
      if (cartonTotal < 1) return toast('Enter how many of each carton you used.')
    }
    if (action.key === 'loadUnit') {
      if (!form.containerId) return toast('Pick a container to load into.')
      if (!n || n < 1) return toast('Enter the piece count you verified while loading.')
    }
    if (action.key === 'loadForReturn') {
      if (!form.containerId) return toast('Pick a return container to load into.')
      if (!n || n < 1) return toast('Enter the piece count you verified while loading.')
    }
    if (action.key === 'unloadReturn') {
      if (!n || n < 1) return toast('Enter the piece count you verified while unloading.')
    }

    setBusy(true)
    try {
      let status = 'synced'
      if (action.key === 'startPacking') {
        // Phase-tagged so the checklist can tell a door shot from a room shot.
        const beforeMedia = [
          ...pendingDoor.map((m) => ({ ...m, phase: 'door', label: m.label || 'front door' })),
          ...pendingRooms.map((m) => ({ ...m, phase: 'rooms', label: m.label || 'room' })),
        ]
        status = await submitWrite(dispatch({ type: 'startPacking', p: { unitId, stickerColor: form.stickerColor, media: beforeMedia } }))
      }
      if (action.key === 'finishPacking') {
        const invMedia = [{ id: `inv-${Date.now()}`, kind: 'photo', url: invUrl, label: 'inventory', phase: 'inventory', uid: currentUser.uid, ts: Date.now() }]
        // The inventory sheet plus whatever the packer shot of the finished unit.
        status = await submitWrite(dispatch({ type: 'finishPacking', p: {
          unitId, pieces: n,
          media: [...invMedia, ...media.map((m) => ({ ...m, phase: 'packed' }))],
          inventoryFrom: parseInt(form.invFrom, 10), inventoryTo: parseInt(form.invTo, 10),
          materials: cartonsFromForm(form),
        } }))
      }
      if (action.key === 'loadUnit') {
        // loadUnit can throw if the picked container was just filled or
        // swapped out by someone else in the meantime (a real race, not a
        // bug): the catch below toasts instead of leaving the crew member
        // staring at a form that silently did nothing. That throw happens
        // synchronously before any write, so submitWrite still surfaces it
        // even offline (see src/lib/submit.js).
        status = await submitWrite(dispatch({ type: 'loadUnit', p: { unitId, containerId: form.containerId, pieces: n, media } }))
      }
      if (action.key === 'loadForReturn') {
        // loadForReturn can throw if the picked container was just filled or
        // dispatched by someone else in the meantime (a real race, not a
        // bug): catch it and toast so the warehouse worker can refresh and
        // pick another container instead of the form silently doing nothing.
        status = await submitWrite(dispatch({ type: 'loadForReturn', p: { unitId, containerId: form.containerId, pieces: n, media } }))
      }
      if (action.key === 'unloadReturn') {
        status = await submitWrite(dispatch({ type: 'unloadReturn', p: { unitId, pieces: n, media } }))
      }
      if (action.key === 'unpackUnit') {
        status = await submitWrite(dispatch({ type: 'unpackUnit', p: { unitId, media } }))
      }
      closeActionModal()
      if (status === 'queued') {
        toast(QUEUED_MESSAGE)
      } else {
        const pieceCheckKeys = ['loadUnit', 'unloadReturn', 'loadForReturn']
        if (pieceCheckKeys.includes(action.key) && unit.pieces != null && n !== unit.pieces) {
          toast(`⚑ Piece count mismatch flagged (${n} vs ${unit.pieces})`)
        } else {
          toast('Logged, timestamped under your name ✓')
        }
      }
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" onClick={goBack}>← Back</button>
      </div>

      <div className="page-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="row" style={{ gap: 12 }}>
            <h1>Unit {unit.number}</h1>
            <StagePill stage={unit.stage} />
          </div>
          <p>{unit.tenant || '-'} · Floor {unit.floor}{unit.pieces ? ` · ${unit.pieces} pieces` : ''}</p>
          {(unit.stickerColor || inventoryRangeLabel(unit)) && (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              {unit.stickerColor && (
                <span className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: (stickerHex(unit.stickerColor) || '#888') + '22', color: 'var(--ink)' }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, background: stickerHex(unit.stickerColor) || '#888', border: '1px solid rgba(0,0,0,.25)' }} />
                  {unit.stickerColor} stickers
                </span>
              )}
              {inventoryRangeLabel(unit) && <span className="muted">#{inventoryRangeLabel(unit)}</span>}
            </p>
          )}
        </div>
        <div className="row">
          {onChecklist && upNext && (
            <button className="btn btn-primary btn-lg" onClick={() => openStep(upNext.key)}>
              {upNext.label}
            </button>
          )}
          {!onChecklist && action && <button className="btn btn-primary btn-lg" onClick={openAction}>{action.label}</button>}
          {!onChecklist && !action && WAIT_HINTS[unit.stage] && <span className="muted" style={{ maxWidth: 300, textAlign: 'right' }}>{WAIT_HINTS[unit.stage]}</span>}
        </div>
      </div>

      {showLockBanner && (
        <div
          className="card"
          style={{
            padding: '11px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10,
            background: 'color-mix(in srgb, var(--ink) 5%, var(--panel))',
          }}
        >
          <span aria-hidden style={{ fontSize: 16 }}>🔒</span>
          <span style={{ fontSize: 13.5 }}>
            <b>View only.</b>{' '}
            {(unit.crew?.packers || []).includes(currentUser.uid)
              ? 'You finished this unit. Everything you recorded is below, and it can no longer be changed.'
              : 'This unit has moved past your part of the job, so it is a record now rather than a task.'}
          </span>
        </div>
      )}

      <div className="card" style={{ padding: '14px 20px 16px', marginBottom: 18 }}>
        <div className="stepper">
          {stepperStages.map((s) => (
            <div key={s.key} className={`step ${stage.step >= s.step ? 'done' : ''} ${stage.step === s.step ? 'now' : ''}`} style={{ '--stage-c': s.color }}>
              <div className="bar" />
              <div className="cap">{s.short}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <div className="card" style={{ padding: '6px 20px' }}>
            <div className="section-title" style={{ marginTop: 14 }}>Activity: who, what, when</div>
            <div className="timeline">
              {events.length === 0 && <div className="empty"><div className="big">🗂️</div>No activity yet. It starts when a packer opens this unit.</div>}
              {events.map((e) => <EventRow key={e.id} e={e} onOpenMedia={setLightbox} showTarget={false} />)}
            </div>
          </div>
        </div>

        <div>
          {/* The six things this unit needs, ticked off from what is actually
              on the doc. Previously these existed only as validation messages
              inside two modals, so a packer could not see what was still
              outstanding without trying to submit and being told no. */}
          <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <div className="section-title grow" style={{ margin: 0 }}>Packing checklist</div>
              <span className="muted" style={{ fontWeight: 700 }}>
                {progress.done}/{progress.total}
              </span>
            </div>
            {checklist.map((step, i) => {
              // Every outstanding item is its own tap target, in any order:
              // whatever the packer is standing in front of is the one they
              // can do. A finished item stops being a button so it cannot be
              // re-ticked, overwriting someone else's name on it.
              // Optional items stay tappable after they are done: a packer may
              // have a second thing to report about the same apartment. The
              // seven required ones lock once complete so nobody re-ticks an
              // item and overwrites the name of whoever actually did it.
              const tappable = onChecklist && (!step.done || step.optional)
              const Row = tappable ? 'button' : 'div'
              return (
                <Row
                  key={step.key}
                  type={tappable ? 'button' : undefined}
                  onClick={tappable ? () => openStep(step.key) : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                    padding: tappable ? '10px 10px' : '8px 10px',
                    marginBottom: 4, borderRadius: 10, fontFamily: 'inherit', fontSize: 13.5,
                    background: tappable ? 'var(--card-2, rgba(127,127,127,.07))' : 'transparent',
                    border: tappable ? '1px solid var(--border, rgba(127,127,127,.22))' : '1px solid transparent',
                    cursor: tappable ? 'pointer' : 'default',
                    color: 'inherit',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flex: 'none', width: 22, textAlign: 'center', fontWeight: 800,
                      color: step.done ? '#16a34a' : 'var(--ink-3, #9aa1ab)',
                    }}
                  >{step.done ? '✓' : i + 1}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ color: step.done ? 'var(--ink-3, #6b7280)' : 'inherit', fontWeight: tappable && !step.done ? 600 : 400 }}>
                      {step.label}
                      {step.optional && (
                        <span className="muted" style={{ fontWeight: 600, fontSize: 11.5, marginLeft: 7, opacity: 0.85 }}>OPTIONAL</span>
                      )}
                    </span>
                    {step.done && (step.by || step.at) && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3, #9aa1ab)' }}>
                        {step.by || 'Crew'}{step.at ? ` · ${fmtTime(step.at)}` : ''}
                      </span>
                    )}
                  </span>
                  {tappable && <span aria-hidden style={{ flex: 'none', color: 'var(--ink-3, #9aa1ab)', fontWeight: 700 }}>›</span>}
                </Row>
              )
            })}
            {onChecklist && (
              <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                {upNext
                  ? 'Do these in any order, whatever you are doing at the time. Each one saves on its own under your name, and the unit is finished once all seven are ticked.'
                  : 'All seven done. This unit is packed and ready for the movers.'}
              </div>
            )}
          </div>

          <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
            <div className="row" style={{ marginBottom: 2 }}>
              <div className="section-title grow" style={{ margin: 0 }}>Details</div>
              {currentUser.role === 'admin' && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ tenant: unit.tenant, phone: unit.phone, note: unit.note }); setModal('edit') }}>✎ Edit</button>
              )}
            </div>
            <dl className="info-rows">
              <dt>Tenant</dt><dd>{unit.tenant || '-'}</dd>
              <dt>Phone</dt><dd>{unit.phone}</dd>
              <dt>Floor</dt><dd>{unit.floor}</dd>
              <dt>Pieces packed</dt><dd>{unit.pieces ?? '-'}</dd>
              <dt>Cartons</dt>
              <dd>{cartonSummary(unit.materials)
                ? `${sumCartons(unit.materials)} · ${cartonSummary(unit.materials)}`
                : '-'}</dd>
              <dt>Stickers</dt>
              <dd>{unit.stickerColor
                ? `${unit.stickerColor}${inventoryRangeLabel(unit) ? ` · #${inventoryRangeLabel(unit)}` : ''}`
                : '-'}</dd>
              <dt>Container</dt>
              <dd>
                {conts.length === 0 && '-'}
                {conts.map((c) => (
                  <span key={c.id} className="linkish" onClick={() => openContainer(c.id)} style={{ marginRight: 10 }}>{c.number}{c.bay ? ` (${c.bay})` : ''}</span>
                ))}
              </dd>
              <dt>Packer</dt><dd>{crewNames(unit.crew?.packers) || '-'}</dd>
              <dt>Mover</dt><dd>{crewNames(unit.crew?.movers) || '-'}</dd>
            </dl>
            {unit.note && <div style={{ marginTop: 10, fontSize: 13.5, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '9px 12px' }}>⚠️ {unit.note}</div>}

            {unit.flag && (
              <div className={`flagbox ${unit.flag.open ? '' : 'closed'}`}>
                <b>{unit.flag.open ? '⚑ Open flag' : '✓ Resolved flag'}</b>: {unit.flag.message}
                <div className="muted" style={{ marginTop: 4 }}>Raised by {unit.flag.by} · {fmtTime(unit.flag.ts)}</div>
                {unit.flag.open && currentUser.role === 'admin' && (
                  <button className="btn btn-dark btn-sm" style={{ marginTop: 10 }} onClick={() => { setForm({}); setModal('resolve') }}>Resolve flag</button>
                )}
                {unit.flag.open && currentUser.role !== 'admin' && <div className="muted" style={{ marginTop: 8 }}>Only the admin can resolve flags.</div>}
              </div>
            )}
          </div>

          {canContribute && (
            <div className="card" style={{ padding: '16px 20px' }}>
              <div className="section-title" style={{ marginTop: 0 }}>Add to the record</div>
              <Uploader onFiles={async (files) => {
                const media = await filesToMedia(files, '', `units/${unitId}/added`)
                if (!media.length) return
                try {
                  const status = await submitWrite(dispatch({ type: 'addMedia', p: { unitId, media } }))
                  toast(status === 'queued' ? QUEUED_MESSAGE : `${media.length} file${media.length > 1 ? 's' : ''} added to unit ${unit.number} ✓`)
                } catch (err) {
                  toast(err.message || SAVE_ERROR)
                }
              }} />
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => { setForm({}); setModal('note') }}>📝 Add a note</button>
              <div style={{ marginTop: 10 }}>
                <ReportOverflowButton unitId={unitId} toast={toast} fullWidth />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* One checklist item at a time. The modal asks for exactly the evidence
          that item needs and nothing else, so a packer is never made to hold
          six things in their head to save one of them. */}
      {stepKey && (
        <Modal
          title={openStepLabel}
          sub={`Unit ${unit.number} · ${surnameOf(unit.tenant)}, logged as ${currentUser.name}, ${fmtTime(Date.now())}`}
          onClose={() => { if (!busy) closeStep() }}
        >
          {stepKey === 'door' && (
            <div className="field">
              <label>Front door, showing the unit number {pending.length > 0 && <span className="muted">✓ {pending.length}</span>}</label>
              <Uploader
                label={pending.length ? 'Retake or add another' : 'Photograph the front door'}
                onFiles={async (files) => setPending([...pending, ...(await filesToMedia(files, 'front door', `units/${unitId}/door`))])}
              />
            </div>
          )}

          {stepKey === 'rooms' && (
            <div className="field">
              <label>The rooms, before anything moves {pending.length > 0 && <span className="muted">✓ {pending.length}</span>}</label>
              <Uploader
                label={pending.length ? 'Add another room' : 'Photos or video of every room'}
                onFiles={async (files) => setPending([...pending, ...(await filesToMedia(files, 'room', `units/${unitId}/rooms`))])}
              />
            </div>
          )}

          {stepKey === 'sticker' && (
            <div className="field">
              <label>Which sticker roll is this unit on?</label>
              <div className="pick-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STICKER_COLORS.map((c) => (
                  <button
                    key={c.name} type="button"
                    className={`btn ${form.stickerColor === c.name ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    onClick={() => setForm({ ...form, stickerColor: c.name })}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: c.hex, border: '1px solid rgba(0,0,0,.25)' }} />
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {stepKey === 'inventory' && (
            <div className="field">
              <label>Photo of the paper inventory sheet</label>
              <label className="dropzone camera-capture" style={{ display: 'block' }}>
                <input
                  type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files[0]; if (f) captureInventoryPhoto(f); e.target.value = '' }}
                />
                {invPreview ? (
                  <div className="inv-preview">
                    <img src={invPreview} alt="Inventory sheet" className="inv-thumb" />
                    <div className="muted" style={{ marginTop: 8 }}>
                      {invUploading ? 'Saving…' : invUrl ? '✓ Photo saved, tap to retake' : invError || 'Tap to retake'}
                    </div>
                  </div>
                ) : <>📷 Tap to photograph the inventory sheet</>}
              </label>
            </div>
          )}

          {stepKey === 'numbers' && (
            <>
              <div className="field">
                <label>Sticker numbers used{unit.stickerColor ? ` (${unit.stickerColor} roll)` : ''}</label>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input className="input" type="number" min="1" inputMode="numeric" autoFocus placeholder="first" style={{ flex: 1 }}
                    value={form.invFrom || ''} onChange={(e) => setForm({ ...form, invFrom: e.target.value })} />
                  <span className="muted">to</span>
                  <input className="input" type="number" min="1" inputMode="numeric" placeholder="last" style={{ flex: 1 }}
                    value={form.invTo || ''} onChange={(e) => setForm({ ...form, invTo: e.target.value })} />
                </div>
                {rangeClash.length > 0 && (
                  <div className="muted" style={{ marginTop: 6, color: 'var(--warn, #b45309)' }}>
                    Heads up: {rangeClash.map((u) => `unit ${u.number}`).join(', ')} already used these numbers on the same colour.
                  </div>
                )}
              </div>
              <div className="field">
                <label>Total pieces packed</label>
                <input className="input" type="number" min="1" inputMode="numeric" placeholder="e.g. 42"
                  value={form.pieces || ''} onChange={(e) => setForm({ ...form, pieces: e.target.value })} />
              </div>
            </>
          )}

          {stepKey === 'materials' && (
            <div className="field">
              <label>How many of each did you use?{cartonTotal > 0 ? ` · ${cartonTotal} cartons` : ''}</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 8 }}>
                {CARTON_TYPES.map((t) => (
                  <label key={t.key} style={{ display: 'block' }}>
                    <span className="muted" style={{ display: 'block', fontSize: 12.5, marginBottom: 3 }}>{t.label}</span>
                    <input
                      className="input" type="number" min="0" inputMode="numeric" placeholder="0"
                      value={form[`carton_${t.key}`] || ''}
                      onChange={(e) => setForm({ ...form, [`carton_${t.key}`]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {stepKey === 'packed' && (
            <div className="field">
              <label>Everything packed and ready to go {pending.length > 0 && <span className="muted">✓ {pending.length}</span>}</label>
              <Uploader
                label={pending.length ? 'Add another' : 'Photos or video, packed and ready'}
                onFiles={async (files) => setPending([...pending, ...(await filesToMedia(files, 'packed', `units/${unitId}/packed`))])}
              />
              {progress.done === PACKING_STEPS.length - 1 && (
                <div className="muted" style={{ marginTop: 8 }}>
                  Last item. Saving this marks unit {unit.number} packed and hands it to the movers.
                </div>
              )}
            </div>
          )}

          {stepKey === 'notes' && (
            <div className="field">
              <label>Anything the office should know about this apartment?</label>
              <textarea
                className="input" rows={4} autoFocus
                placeholder="Tenant not home, piano in the back bedroom, lift out of service..."
                value={form.note || ''}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
              <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
                Optional. The unit is finished without it, and the note goes straight into this unit's activity log.
              </div>
            </div>
          )}

          <button
            className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 6 }}
            disabled={busy || (stepKey === 'inventory' && invUploading)}
            onClick={submitStep}
          >
            {busy ? 'Saving…' : stepKey === 'notes' ? 'Save note ✓' : 'Save this step ✓'}
          </button>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>
            Saves on its own, under {currentUser.name}, timestamped.
          </div>
        </Modal>
      )}

      {modal === 'action' && action && (
        <Modal title={action.label} sub={`Unit ${unit.number} · ${unit.tenant}, logged as ${currentUser.name}, ${fmtTime(Date.now())}`} onClose={() => { if (!busy) closeActionModal() }}>
          {action.key === 'startPacking' && (
            <>
            <div className="field">
              <label>1. Front door, showing the unit number {pendingDoor.length > 0 && <span className="muted">✓ {pendingDoor.length}</span>}</label>
              <Uploader
                label={pendingDoor.length ? 'Retake or add another' : 'Photograph the front door'}
                onFiles={async (files) => setPendingDoor([...pendingDoor, ...(await filesToMedia(files, 'front door', `units/${unitId}/door`))])}
              />
            </div>
            <div className="field">
              <label>2. The rooms, before anything moves {pendingRooms.length > 0 && <span className="muted">✓ {pendingRooms.length}</span>}</label>
              <Uploader
                label={pendingRooms.length ? 'Add more rooms' : 'Photos or video of every room'}
                onFiles={async (files) => setPendingRooms([...pendingRooms, ...(await filesToMedia(files, 'room', `units/${unitId}/rooms`))])}
              />
            </div>
            <div className="field">
              <label>3. Inventory sticker colour for this unit</label>
              <div className="pick-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STICKER_COLORS.map((c) => (
                  <button
                    key={c.name} type="button"
                    className={`btn ${form.stickerColor === c.name ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    onClick={() => setForm({ ...form, stickerColor: c.name })}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: c.hex, border: '1px solid rgba(0,0,0,.25)' }} />
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
            </>
          )}
          {action.key === 'finishPacking' && (
            <>
              <div className="field"><label>Total pieces packed</label>
                <input className="input" type="number" min="1" inputMode="numeric" autoFocus placeholder="e.g. 42" value={form.pieces || ''} onChange={(e) => setForm({ ...form, pieces: e.target.value })} /></div>
              <div className="field">
                <label>4. Photo of the paper inventory sheet</label>
                <label className="dropzone camera-capture" style={{ display: 'block' }}>
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files[0]; if (f) captureInventoryPhoto(f); e.target.value = '' }}
                  />
                  {invPreview ? (
                    <div className="inv-preview">
                      <img src={invPreview} alt="Inventory sheet" className="inv-thumb" />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {invUploading ? 'Saving…' : invUrl ? '✓ Photo saved, tap to retake' : invError || 'Tap to retake'}
                      </div>
                    </div>
                  ) : <>📷 Tap to photograph the inventory sheet</>}
                </label>
              </div>
              <div className="field">
                <label>5. Inventory sticker numbers{unit.stickerColor ? ` (${unit.stickerColor} roll)` : ''}</label>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input className="input" type="number" min="1" inputMode="numeric" placeholder="first" style={{ flex: 1 }}
                    value={form.invFrom || ''} onChange={(e) => setForm({ ...form, invFrom: e.target.value })} />
                  <span className="muted">to</span>
                  <input className="input" type="number" min="1" inputMode="numeric" placeholder="last" style={{ flex: 1 }}
                    value={form.invTo || ''} onChange={(e) => setForm({ ...form, invTo: e.target.value })} />
                </div>
                {rangeClash.length > 0 && (
                  <div className="muted" style={{ marginTop: 6, color: 'var(--warn, #b45309)' }}>
                    Heads up: {rangeClash.map((u) => `unit ${u.number}`).join(', ')} already used these numbers on the same colour.
                  </div>
                )}
              </div>
              <div className="field">
                <label>6. Packing materials used{cartonTotal > 0 ? ` · ${cartonTotal} cartons` : ''}</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 8 }}>
                  {CARTON_TYPES.map((t) => (
                    <label key={t.key} style={{ display: 'block' }}>
                      <span className="muted" style={{ display: 'block', fontSize: 12.5, marginBottom: 3 }}>{t.label}</span>
                      <input
                        className="input" type="number" min="0" inputMode="numeric" placeholder="0"
                        value={form[`carton_${t.key}`] || ''}
                        onChange={(e) => setForm({ ...form, [`carton_${t.key}`]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          {action.key === 'loadUnit' && (
            <>
              <div className="field">
                <label>Load into which container?</label>
                {loadableContainers.length === 0 ? (
                  <div className="empty" style={{ padding: '22px 10px' }}>
                    <div className="big">📦</div>No containers on site yet, log empties in from the Containers page first.
                  </div>
                ) : (
                  <div className="pick-list">
                    {loadableContainers.map((c) => (
                      <button
                        type="button" key={c.id}
                        className={`pick-row ${form.containerId === c.id ? 'sel' : ''}`}
                        onClick={() => setForm({ ...form, containerId: c.id })}
                      >
                        <span className="cont-num grow">{c.number}</span>
                        <span className="badge" style={{ background: CONT_STATUS[c.status].color + '22', color: CONT_STATUS[c.status].color }}>{CONT_STATUS[c.status].label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="field"><label>Pieces counted while loading {unit.pieces != null && <span className="muted">(packer recorded {unit.pieces})</span>}</label>
                <input className="input" type="number" min="1" inputMode="numeric" placeholder={unit.pieces ?? 'count'} value={form.pieces || ''} onChange={(e) => setForm({ ...form, pieces: e.target.value })} /></div>
            </>
          )}
          {action.key === 'loadForReturn' && (
            <>
              <div className="field">
                <label>Load into which return container?</label>
                {returnLoadableContainers.length === 0 ? (
                  <div className="empty" style={{ padding: '22px 10px' }}>
                    <div className="big">📦</div>No return containers available yet at the warehouse.
                  </div>
                ) : (
                  <div className="pick-list">
                    {returnLoadableContainers.map((c) => (
                      <button
                        type="button" key={c.id}
                        className={`pick-row ${form.containerId === c.id ? 'sel' : ''}`}
                        onClick={() => setForm({ ...form, containerId: c.id })}
                      >
                        <span className="cont-num grow">{c.number}</span>
                        <span className="badge" style={{ background: CONT_STATUS[c.status].color + '22', color: CONT_STATUS[c.status].color }}>{CONT_STATUS[c.status].label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="field"><label>Pieces counted while loading for return {unit.pieces != null && <span className="muted">(left with {unit.pieces})</span>}</label>
                <input className="input" type="number" min="1" inputMode="numeric" placeholder={unit.pieces ?? 'count'} value={form.pieces || ''} onChange={(e) => setForm({ ...form, pieces: e.target.value })} /></div>
            </>
          )}
          {action.key === 'unloadReturn' && (
            <div className="field"><label>Pieces counted while unloading {unit.pieces != null && <span className="muted">(packed with {unit.pieces})</span>}</label>
              <input className="input" type="number" min="1" inputMode="numeric" autoFocus placeholder={unit.pieces ?? 'count'} value={form.pieces || ''} onChange={(e) => setForm({ ...form, pieces: e.target.value })} /></div>
          )}
          {action.key !== 'startPacking' && (
            <div className="field">
              <label>{
                action.key === 'finishPacking'
                  ? '7. Packed and ready: photos or video of the finished unit'
                  : 'Photos required, video encouraged'
              }</label>
              <Uploader onFiles={async (files) => setPending([...pending, ...(await filesToMedia(files, '', `units/${unitId}/added`))])} />
              {pending.length > 0 && <div className="muted" style={{ marginTop: 6 }}>{pending.length} file{pending.length > 1 ? 's' : ''} attached</div>}
            </div>
          )}
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy || (action.key === 'finishPacking' && invUploading)} onClick={submitAction}>{busy ? 'Saving…' : `Confirm: ${action.label}`}</button>
        </Modal>
      )}

      {modal === 'note' && (
        <Modal title="Add a note" sub={`Unit ${unit.number}, logged as ${currentUser.name} with date & time`} onClose={() => { if (!busy) setModal(null) }}>
          <div className="field">
            <textarea className="input" rows="4" autoFocus placeholder="e.g. Tenant asked us to keep the bikes accessible…" value={form.text || ''} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !form.text?.trim()} onClick={async () => {
            setBusy(true)
            try {
              const status = await submitWrite(dispatch({ type: 'addNote', p: { unitId, text: form.text.trim() } }))
              setModal(null); toast(status === 'queued' ? QUEUED_MESSAGE : 'Note added ✓')
            } catch (err) {
              toast(err.message || SAVE_ERROR)
            } finally {
              setBusy(false)
            }
          }}>{busy ? 'Saving…' : 'Save note'}</button>
        </Modal>
      )}

      {modal === 'edit' && (
        <Modal title={`Edit unit ${unit.number}`} sub="Admin only, the change itself gets logged in the activity record." onClose={() => { if (!busy) setModal(null) }}>
          <div className="field"><label>Tenant name</label>
            <input className="input" value={form.tenant || ''} onChange={(e) => setForm({ ...form, tenant: e.target.value })} /></div>
          <div className="field"><label>Phone</label>
            <input className="input" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field"><label>Special notes</label>
            <textarea className="input" rows="2" value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Piano, needs 4-person crew" /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !(form.tenant || '').trim()} onClick={async () => {
            setBusy(true)
            try {
              const status = await submitWrite(dispatch({ type: 'editUnit', p: { unitId, patch: { tenant: (form.tenant || '').trim(), phone: (form.phone || '').trim(), note: (form.note || '').trim() } } }))
              setModal(null); toast(status === 'queued' ? QUEUED_MESSAGE : 'Unit updated, edit logged ✓')
            } catch (err) {
              toast(err.message || SAVE_ERROR)
            } finally {
              setBusy(false)
            }
          }}>{busy ? 'Saving…' : 'Save changes'}</button>
        </Modal>
      )}

      {modal === 'resolve' && (
        <Modal title="Resolve flag" sub={unit.flag?.message} onClose={() => { if (!busy) setModal(null) }}>
          <div className="field"><label>How was it resolved?</label>
            <textarea className="input" rows="3" autoFocus value={form.text || ''} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="e.g. Recounted at warehouse, all 18 pieces present." /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !form.text?.trim()} onClick={async () => {
            setBusy(true)
            try {
              const status = await submitWrite(dispatch({ type: 'resolveFlag', p: { unitId, note: form.text.trim() } }))
              setModal(null); toast(status === 'queued' ? QUEUED_MESSAGE : 'Flag resolved ✓')
            } catch (err) {
              toast(err.message || SAVE_ERROR)
            } finally {
              setBusy(false)
            }
          }}>{busy ? 'Saving…' : 'Mark resolved'}</button>
        </Modal>
      )}

      <Lightbox media={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
