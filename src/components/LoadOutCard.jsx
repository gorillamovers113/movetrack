import React, { useEffect, useRef, useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { Modal, CaptureButtons } from '../ui.jsx'
import { captureMedia, uploadFile } from '../lib/upload.js'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import {
  LOADING_STEPS, loadingChecklist, loadingProgress, loadingComplete,
  VAULT_PARTS, vaultsOf, completeVaults, vaultComplete, vaultProgress, vaultTouchedAt,
  vaultNumberError, normalizeVaultNumber, vaultCountMismatch,
  stickerMismatch, unitNumberMismatch, STICKER_COLORS,
} from '../lib/mutations.js'

const SAVE_ERROR = "Couldn't save that. Check your signal and try again."

/* A camera slot that takes as many shots as the job needs.
 *
 * It was one photo per step, which is wrong for what these photos are for. A
 * full vault shot from a single angle hides whatever is behind the front row,
 * and an apartment does not fit in one frame. Each shot uploads to Storage the
 * moment it is taken, so the write at the end is a list of URLs rather than a
 * pile of images, and a step saves in the time it takes to tap Save.
 */
function PhotoSlot({ label, path, shots, setShots, hint }) {
  const [previews, setPreviews] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  /* Revoke on unmount only, and read the list from a ref rather than the dep.
   *
   * With [previews] as the dependency, React runs the CLEANUP before each
   * re-run, so adding a second photo revoked the first one's blob URL while it
   * was still on screen. The first preview went blank the instant a second was
   * taken, which looks exactly like the app refusing to accept more than one
   * photo. It was reported as that.
   */
  const live = useRef([])
  useEffect(() => {
    live.current = previews
  }, [previews])
  useEffect(() => () => { live.current.forEach((p) => URL.revokeObjectURL(p.src)) }, [])

  const take = async (files) => {
    setErr(null)
    const list = [...files]
    setPreviews((prev) => [...prev, ...list.map((f) => ({ src: URL.createObjectURL(f), video: f.type.startsWith('video') }))])
    setBusy(true)
    try {
      // Sequential, not parallel: a phone on a stairwell signal uploading four
      // videos at once finishes none of them.
      for (const file of list) {
        const video = file.type.startsWith('video')
        const url = video
          ? await uploadFile(file, path(video ? 'mp4' : 'jpg'))
          : (await captureMedia(file, path('jpg'))).url
        setShots((prev) => [...prev, { url, kind: video ? 'video' : 'photo' }])
      }
    } catch (e) {
      setErr(e.message || 'Capture failed, try again.')
    } finally {
      setBusy(false)
    }
  }

  const clear = () => {
    previews.forEach((p) => URL.revokeObjectURL(p.src))
    live.current = []
    setPreviews([])
    setShots([])
    setErr(null)
  }

  return (
    <div className="field">
      <label>{label}</label>
      {previews.length > 0 ? (
        <div className="dropzone camera-capture" style={{ display: 'block', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {previews.map((p) => (
              p.video
                ? <video key={p.src} src={p.src} className="inv-thumb" style={{ maxWidth: 110 }} controls playsInline />
                : <img key={p.src} src={p.src} alt={label} className="inv-thumb" style={{ maxWidth: 110 }} />
            ))}
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            {busy
              ? `Saving… ${shots.length} of ${previews.length}`
              : err || `${shots.length} saved. Tap Photo or Video again to add another, as many as you need.`}
          </div>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{hint}</div>
      )}
      <CaptureButtons onFiles={take} multiple busy={busy} compact />
      {previews.length > 0 && !busy && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={clear}>
          Start over
        </button>
      )}
    </div>
  )
}

/* The mover's load-out for one apartment.
 *
 * Deliberately the same shape as the packer's checklist, because the crew
 * swap roles day to day and a second thing to learn is a second thing to get
 * wrong.
 *
 * Vaults are the one place it differs. A unit takes two or three of them, and
 * each is logged in three separate acts: the number when it is opened, a shot
 * with the door open once it is full, and a shot with the door closed once it
 * is sealed. Those happen far enough apart that a single form asking for all
 * three at once was either abandoned half-filled or answered by taking both
 * photos back to back, which defeats the point of having two.
 */
export default function LoadOutCard({ unit, toast }) {
  const { dispatch, currentUser } = useStore()
  const [modal, setModal] = useState(null)     // a step key, or 'vault'
  const [shot, setShot] = useState(null)       // { number, part } for one vault photo
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [unitShots, setUnitShots] = useState([])
  const [afterShots, setAfterShots] = useState([])
  const [vaultShots, setVaultShots] = useState([])

  const checklist = loadingChecklist(unit)
  const progress = loadingProgress(unit)
  const vaults = vaultsOf(unit).slice().sort((a, b) => vaultTouchedAt(a) - vaultTouchedAt(b))
  const ready = loadingComplete(unit)
  const countOff = vaultCountMismatch(unit, unit.steps?.load_vault_count?.value)

  const reset = () => {
    setForm({}); setUnitShots([]); setAfterShots([]); setVaultShots([])
  }
  const open = (key) => { reset(); setShot(null); setModal(key) }
  const openShot = (number, part) => { reset(); setModal(null); setShot({ number, part }) }
  const close = () => { if (!busy) { setModal(null); setShot(null) } }

  const run = async (fn, done) => {
    if (busy) return
    setBusy(true)
    try {
      const status = await submitWrite(fn())
      setModal(null); setShot(null)
      toast(status === 'queued' ? QUEUED_MESSAGE : done)
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const saveShot = () => {
    if (vaultShots.length === 0) return toast('Add a photo or video first.')
    const part = VAULT_PARTS.find((v) => v.key === shot.part)
    return run(
      () => dispatch({ type: 'logVaultPhoto', p: {
        unitId: unit.id, number: shot.number, part: shot.part, shots: vaultShots,
      } }),
      `Vault ${shot.number} · ${part.label.toLowerCase()} saved ✓ (${vaultShots.length})`,
    )
  }

  const saveStep = () => {
    if (modal === 'load_unit_photo') {
      if (unitShots.length === 0) return toast('Add a photo or video of the unit, fully packed.')
      const at = Date.now()
      return run(
        () => dispatch({ type: 'completeLoadStep', p: {
          unitId: unit.id, key: 'load_unit_photo',
          media: unitShots.map((sh, i) => ({ id: `lu-${at}-${i}`, kind: sh.kind, url: sh.url, label: 'packed unit', phase: 'load_unit_photo' })),
        } }),
        `Unit photo saved ✓ (${unitShots.length})`,
      )
    }

    if (modal === 'load_after_photo') {
      if (afterShots.length === 0) return toast('Add a photo or video of the unit once it is empty.')
      const at = Date.now()
      return run(
        () => dispatch({ type: 'completeLoadStep', p: {
          unitId: unit.id, key: 'load_after_photo',
          media: afterShots.map((sh, i) => ({ id: `la-${at}-${i}`, kind: sh.kind, url: sh.url, label: 'unit after loading', phase: 'load_after_photo' })),
        } }),
        `After photo saved ✓ (${afterShots.length})`,
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

    if (modal === 'load_vault_count') {
      const typed = Number(form.count)
      if (!Number.isInteger(typed) || typed < 1) return toast('Enter how many vaults this unit went into.')
      const logged = completeVaults(unit).length
      const bad = typed !== logged
      return run(
        () => dispatch({ type: 'completeLoadStep', p: {
          unitId: unit.id, key: 'load_vault_count', value: typed,
          matched: !bad, expected: logged,
        } }),
        bad
          ? `⚑ Count flagged: ${typed} counted, ${logged} fully logged`
          : `${typed} vault${typed === 1 ? '' : 's'} confirmed ✓`,
      )
    }

    if (modal === 'vault') {
      const err = vaultNumberError(form.vault, unit)
      if (err) return toast(err)
      return run(
        () => dispatch({ type: 'startVault', p: { unitId: unit.id, number: form.vault } }),
        `Vault ${normalizeVaultNumber(form.vault)} added ✓`,
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
          // The vaults row is never "finished" the way the others are: another
          // vault can always be added, so it stays tappable once done. The
          // count row stays tappable too, because correcting a miscount is the
          // whole point of asking.
          const tappable = !step.done || step.repeatable || step.key === 'load_vault_count'
          const Row = tappable ? 'button' : 'div'
          return (
            <Row
              key={step.key}
              type={tappable ? 'button' : undefined}
              onClick={tappable ? () => open(step.repeatable ? 'vault' : step.key) : undefined}
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
                  {step.repeatable && step.started > 0 && (
                    <span className="muted" style={{ marginLeft: 7 }}>
                      · {step.count} of {step.started} finished
                    </span>
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

        {vaults.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', marginBottom: 6 }}>
              VAULTS ON THIS UNIT
            </div>
            {vaults.map((v) => {
              const vp = vaultProgress(v)
              return (
                <div key={v.number} style={{ padding: '7px 0', borderTop: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5 }}>
                    <span aria-hidden>{vaultComplete(v) ? '🔒' : '🚪'}</span>
                    <span className="grow"><b>{v.number}</b></span>
                    <span className="muted" style={{ fontSize: 12 }}>{vp.done}/{vp.total}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginLeft: 26 }}>
                    Opened by {v.userName || 'Crew'}{v.at ? ` · ${fmtTime(v.at)}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, marginLeft: 26, flexWrap: 'wrap' }}>
                    {VAULT_PARTS.map((part) => {
                      const got = v[part.key]
                      return (
                        <button
                          key={part.key} type="button"
                          className={`btn btn-sm ${got ? 'btn-ghost' : 'btn-primary'}`}
                          onClick={() => openShot(v.number, part.key)}
                          title={got ? `${got.userName || 'Crew'} · ${fmtTime(got.at)}` : undefined}
                        >
                          {got ? '✓ ' : '📷 '}{part.label}
                          {/* The running total, so it is obvious the door can
                              take more than one and that earlier ones are still
                              there. Tapping a done door adds to it. */}
                          {got && got.count > 1 && <span className="muted"> · {got.count}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
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
          {countOff
            ? `You counted ${countOff.said} vault${countOff.said === 1 ? '' : 's'} off the truck, but ${countOff.logged} ${countOff.logged === 1 ? 'is' : 'are'} fully logged. Finish the missing one, or tap "How many vaults" to correct the count.`
            : ready
              ? `${completeVaults(unit).length} vault${completeVaults(unit).length === 1 ? '' : 's'} logged. Only tap this once nothing else is going in.`
              : 'Add every vault before you close the unit. Each photo saves on its own under your name.'}
        </div>
      </div>

      {modal && (
        <Modal
          title={modal === 'vault' ? 'Add a vault' : label ? label.label : ''}
          sub={`Unit ${unit.number} · logged as ${currentUser.name}, ${fmtTime(Date.now())}`}
          onClose={close}
        >
          {modal === 'load_unit_photo' && (
            <PhotoSlot
              label="The unit, fully packed and ready to go"
              hint="Tap for a photo or video of the packed unit"
              path={path('load')} shots={unitShots} setShots={setUnitShots}
            />
          )}

          {modal === 'load_after_photo' && (
            <PhotoSlot
              label="The unit once everything is out"
              hint="Tap for a photo or video of the empty unit"
              path={path('after')} shots={afterShots} setShots={setAfterShots}
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

          {modal === 'load_vault_count' && (
            <div className="field">
              <label>How many vaults did this apartment go into?</label>
              <input
                className="input" type="number" min="1" inputMode="numeric" autoFocus placeholder="e.g. 3"
                value={form.count || ''}
                onChange={(e) => setForm({ ...form, count: e.target.value })}
              />
              <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
                Count them off the truck, not off this screen. If your count does not match what is logged here, that
                gets flagged and the unit stays open until it is sorted.
              </div>
            </div>
          )}

          {modal === 'vault' && (
            <div className="field">
              <label>Vault number</label>
              <input
                className="input" type="text" autoFocus placeholder="e.g. BB-1007"
                value={form.vault || ''}
                onChange={(e) => setForm({ ...form, vault: e.target.value })}
              />
              <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
                Read it off the side of the vault. A vault that is not on the board yet is fine, it gets added.
                The two photos come after, once it is full and once it is shut.
              </div>
            </div>
          )}

          <button
            className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 6 }}
            disabled={busy}
            onClick={saveStep}
          >
            {busy ? 'Saving…' : modal === 'vault' ? 'Add this vault ✓' : 'Save this step ✓'}
          </button>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>
            Saves on its own, under {currentUser.name}, timestamped.
          </div>
        </Modal>
      )}

      {shot && (
        <Modal
          title={`Vault ${shot.number}`}
          sub={`${VAULT_PARTS.find((v) => v.key === shot.part).label} · ${currentUser.name}, ${fmtTime(Date.now())}`}
          onClose={close}
        >
          <PhotoSlot
            label={shot.part === 'open' ? 'Door open, showing what went in' : 'Door closed and sealed'}
            hint={VAULT_PARTS.find((v) => v.key === shot.part).hint}
            path={path(`vault-${shot.part}`)}
            shots={vaultShots} setShots={setVaultShots}
          />
          <button
            className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 6 }}
            disabled={busy}
            onClick={saveShot}
          >
            {busy ? 'Saving…' : 'Save this photo ✓'}
          </button>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>
            Saves on its own, under {currentUser.name}, timestamped.
          </div>
        </Modal>
      )}
    </>
  )
}
