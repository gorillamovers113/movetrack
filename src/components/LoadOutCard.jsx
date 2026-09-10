import React, { useEffect, useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { captureMedia, uploadFile } from '../lib/upload.js'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import {
  LOADING_STEPS, loadingChecklist, loadingProgress, loadingComplete,
  boxesOf, completeBoxes, boxNumberError, normalizeBoxNumber,
  stickerMismatch, unitNumberMismatch, STICKER_COLORS, stickerHex,
} from '../lib/mutations.js'

const SAVE_ERROR = "Couldn't save that. Check your signal and try again."

/* One camera slot: shoots, resizes, uploads to Storage, hands back a URL.
 *
 * Kept local to this card because the mover takes three or more photos per
 * unit and each needs its own independent state. Uploading as soon as the
 * shot is taken means the write at the end is a URL, not an image, so a box
 * gets logged in the time it takes to tap Save. */
function PhotoSlot({ label, path, url, setUrl, hint, setKind }) {
  const [preview, setPreview] = useState(null)
  const [isVideo, setIsVideo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const take = async (file) => {
    setErr(null)
    setIsVideo(file.type.startsWith('video'))
    setPreview(URL.createObjectURL(file))
    setUrl(null)
    setBusy(true)
    try {
      const video = file.type.startsWith('video')
      if (setKind) setKind(video ? 'video' : 'photo')
      const url = video
        ? await uploadFile(file, path('mp4'))
        : (await captureMedia(file, path('jpg'))).url
      setUrl(url)
    } catch (e) {
      setErr(e.message || 'Capture failed, try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <label>{label}</label>
      <label className="dropzone camera-capture" style={{ display: 'block' }}>
        <input
          type="file" accept="image/*,video/*" capture="environment" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files[0]; if (f) take(f); e.target.value = '' }}
        />
        {preview ? (
          <div className="inv-preview">
            {isVideo
              ? <video src={preview} className="inv-thumb" controls playsInline />
              : <img src={preview} alt={label} className="inv-thumb" />}
            <div className="muted" style={{ marginTop: 8 }}>
              {busy ? 'Saving…' : url ? '✓ Saved, tap to retake' : err || 'Tap to retake'}
            </div>
          </div>
        ) : <>📷 {hint}</>}
      </label>
    </div>
  )
}

/* The mover's load-out for one apartment.
 *
 * Deliberately the same shape as the packer's checklist, because the crew
 * swap roles day to day and a second thing to learn is a second thing to get
 * wrong. The one real difference is that boxes are repeatable: a unit averages
 * about two and a half BigBoxes, so "log the box" is a list, not a tick. */
export default function LoadOutCard({ unit, toast }) {
  const { dispatch, currentUser } = useStore()
  const [modal, setModal] = useState(null)     // step key, or 'box'
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [unitPhoto, setUnitPhoto] = useState(null)
  const [unitPhotoKind, setUnitPhotoKind] = useState('photo')
  const [afterPhoto, setAfterPhoto] = useState(null)
  const [afterPhotoKind, setAfterPhotoKind] = useState('photo')
  const [openUrl, setOpenUrl] = useState(null)
  const [closedUrl, setClosedUrl] = useState(null)

  const checklist = loadingChecklist(unit)
  const progress = loadingProgress(unit)
  const boxes = boxesOf(unit)
  const ready = loadingComplete(unit)

  const open = (key) => {
    setForm({}); setUnitPhoto(null); setAfterPhoto(null); setOpenUrl(null); setClosedUrl(null); setModal(key)
  }
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

  const saveStep = () => {
    if (modal === 'load_unit_photo') {
      if (!unitPhoto) return toast('Add a photo or video of the unit, fully packed.')
      return run(
        () => dispatch({ type: 'completeLoadStep', p: {
          unitId: unit.id, key: 'load_unit_photo',
          media: [{ id: `lu-${Date.now()}`, kind: unitPhotoKind, url: unitPhoto, label: 'packed unit', phase: 'load_unit_photo' }],
        } }),
        'Unit photo saved ✓',
      )
    }

    if (modal === 'load_after_photo') {
      if (!afterPhoto) return toast('Add a photo or video of the unit once it is empty.')
      return run(
        () => dispatch({ type: 'completeLoadStep', p: {
          unitId: unit.id, key: 'load_after_photo',
          media: [{ id: `la-${Date.now()}`, kind: afterPhotoKind, url: afterPhoto, label: 'unit after loading', phase: 'load_after_photo' }],
        } }),
        'After photo saved ✓',
      )
    }

    if (modal === 'load_sticker') {
      if (!form.sticker) return toast('Pick the sticker colour you can see on the cartons.')
      const bad = stickerMismatch(unit, form.sticker)
      return run(
        () => dispatch({ type: 'completeLoadStep', p: {
          unitId: unit.id, key: 'load_sticker', value: form.sticker,
          matched: !bad, expected: unit.stickerColor,
        } }),
        bad ? `⚑ Mismatch flagged: packer recorded ${bad.recorded}` : 'Sticker colour confirmed ✓',
      )
    }

    if (modal === 'load_number') {
      const typed = String(form.number || '').trim()
      if (!typed) return toast('Type the number on the apartment door.')
      const bad = unitNumberMismatch(unit, typed)
      return run(
        () => dispatch({ type: 'completeLoadStep', p: {
          unitId: unit.id, key: 'load_number', value: typed,
          matched: !bad, expected: unit.number,
        } }),
        bad ? `⚑ Mismatch flagged: this unit is ${bad.recorded}` : 'Unit number confirmed ✓',
      )
    }

    if (modal === 'box') {
      const err = boxNumberError(form.box, unit)
      if (err) return toast(err)
      if (!openUrl) return toast('Add a photo or video of the box with the door open.')
      if (!closedUrl) return toast('Add a photo or video of the box with the door closed.')
      return run(
        () => dispatch({ type: 'logBox', p: { unitId: unit.id, number: form.box, openUrl, closedUrl } }),
        `Box ${normalizeBoxNumber(form.box)} logged ✓`,
      )
    }
  }

  const finish = () => run(
    () => dispatch({ type: 'finishLoading', p: { unitId: unit.id } }),
    `Unit ${unit.number} is loaded and ready for pickup ✓`,
  )

  const label = LOADING_STEPS.find((s) => s.key === modal)
  const path = (kind) => (ext) => `units/${unit.id}/${kind}/${Date.now()}-${currentUser.uid}.${ext || 'jpg'}`

  return (
    <>
      <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <div className="section-title grow" style={{ margin: 0 }}>Loading checklist</div>
          <span className="muted" style={{ fontWeight: 700 }}>{progress.done}/{progress.total}</span>
        </div>

        {checklist.map((step, i) => {
          // The boxes row is never "finished" the way the others are: another
          // box can always be added, so it stays tappable once done.
          const tappable = !step.done || step.repeatable
          const Row = tappable ? 'button' : 'div'
          return (
            <Row
              key={step.key}
              type={tappable ? 'button' : undefined}
              onClick={tappable ? () => open(step.repeatable ? 'box' : step.key) : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
                padding: tappable ? '10px' : '8px 10px', marginBottom: 4, borderRadius: 10,
                fontFamily: 'inherit', fontSize: 13.5,
                background: tappable ? 'var(--card-2, rgba(127,127,127,.07))' : 'transparent',
                border: tappable ? '1px solid var(--border, rgba(127,127,127,.22))' : '1px solid transparent',
                cursor: tappable ? 'pointer' : 'default', color: 'inherit',
              }}
            >
              <span aria-hidden style={{ flex: 'none', width: 22, textAlign: 'center', fontWeight: 800, color: step.done ? '#16a34a' : 'var(--ink-3, #9aa1ab)' }}>
                {step.done ? '✓' : i + 1}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ color: step.done ? 'var(--ink-3, #6b7280)' : 'inherit', fontWeight: tappable && !step.done ? 600 : 400 }}>
                  {step.label}
                  {step.repeatable && step.count > 0 && (
                    <span className="muted" style={{ marginLeft: 7 }}>· {step.count}</span>
                  )}
                </span>
                {step.done && (step.by || step.at) && (
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3, #9aa1ab)' }}>
                    {step.by || 'Crew'}{step.at ? ` · ${fmtTime(step.at)}` : ''}
                    {step.value ? ` · ${step.value}` : ''}
                    {step.matched === false && <b style={{ color: '#b91c1c' }}> · did not match</b>}
                  </span>
                )}
              </span>
              {tappable && <span aria-hidden style={{ flex: 'none', color: 'var(--ink-3, #9aa1ab)', fontWeight: 700 }}>›</span>}
            </Row>
          )
        })}

        {boxes.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', marginBottom: 6 }}>
              BOXES ON THIS UNIT
            </div>
            {boxes.map((b) => (
              <div key={b.number} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0', fontSize: 13.5 }}>
                <span aria-hidden>📦</span>
                <span className="grow"><b>{b.number}</b></span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {b.userName || 'Crew'}{b.at ? ` · ${fmtTime(b.at)}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          className="btn btn-primary btn-lg"
          style={{ width: '100%', marginTop: 12 }}
          disabled={!ready || busy}
          onClick={finish}
        >
          {busy ? 'Saving…' : ready ? `Mark unit ${unit.number} fully loaded` : 'Finish the checklist to close this unit'}
        </button>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          {ready
            ? `${completeBoxes(unit).length} box${completeBoxes(unit).length === 1 ? '' : 'es'} logged. Only tap this once nothing else is going in.`
            : 'Add every box before you close the unit. Each item saves on its own under your name.'}
        </div>
      </div>

      {modal && (
        <Modal
          title={modal === 'box' ? 'Log a box' : label ? label.label : ''}
          sub={`Unit ${unit.number} · logged as ${currentUser.name}, ${fmtTime(Date.now())}`}
          onClose={close}
        >
          {modal === 'load_unit_photo' && (
            <PhotoSlot
              label="The unit, fully packed and ready to go"
              hint="Tap for a photo or video of the packed unit"
              path={path('load')} url={unitPhoto} setUrl={setUnitPhoto} setKind={setUnitPhotoKind}
            />
          )}

          {modal === 'load_after_photo' && (
            <PhotoSlot
              label="The unit once everything is out"
              hint="Tap for a photo or video of the empty unit"
              path={path('after')} url={afterPhoto} setUrl={setAfterPhoto} setKind={setAfterPhotoKind}
            />
          )}

          {modal === 'load_sticker' && (
            <div className="field">
              <label>Which colour are the stickers on these cartons?</label>
              <div className="pick-list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STICKER_COLORS.map((c) => (
                  <button
                    key={c.name} type="button"
                    className={`btn ${form.sticker === c.name ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    onClick={() => setForm({ ...form, sticker: c.name })}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: c.hex, border: '1px solid rgba(0,0,0,.25)' }} />
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
                Read it off the cartons in front of you, not off the paperwork. If it does not match what the packer
                recorded, that gets flagged for the office and you can carry on.
              </div>
            </div>
          )}

          {modal === 'load_number' && (
            <div className="field">
              <label>What number is on the apartment door?</label>
              <input
                className="input" type="text" inputMode="numeric" autoFocus placeholder="e.g. 906"
                value={form.number || ''}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
              <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
                Type what is on the door. This is the check that catches a load coming out of the wrong apartment.
              </div>
            </div>
          )}

          {modal === 'box' && (
            <>
              <div className="field">
                <label>Box number</label>
                <input
                  className="input" type="text" autoFocus placeholder="e.g. BB-1007"
                  value={form.box || ''}
                  onChange={(e) => setForm({ ...form, box: e.target.value })}
                />
                <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
                  Read it off the side of the box. A box that is not on the board yet is fine, it gets added.
                </div>
              </div>
              <PhotoSlot
                label="Doors open, showing what went in"
                hint="Tap for a photo or video, doors open"
                path={path('box-open')} url={openUrl} setUrl={setOpenUrl}
              />
              <PhotoSlot
                label="Doors closed"
                hint="Tap for a photo or video, doors closed"
                path={path('box-closed')} url={closedUrl} setUrl={setClosedUrl}
              />
            </>
          )}

          <button
            className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 6 }}
            disabled={busy}
            onClick={saveStep}
          >
            {busy ? 'Saving…' : modal === 'box' ? 'Log this box ✓' : 'Save this step ✓'}
          </button>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>
            Saves on its own, under {currentUser.name}, timestamped.
          </div>
        </Modal>
      )}
    </>
  )
}
