/* One Studio 15 unit: five photographs, in order, and nothing in the way.
 *
 * The whole screen is five cards. A card is a camera button until it holds a
 * photo, then it is a thumbnail with a "shoot another" underneath. There is
 * no "save", no "next", no confirmation dialog and no step that has to be
 * ticked after the photo is taken - taking the photo IS taking the step. That
 * is the single biggest difference from Trinity Manor, where the photograph
 * and the tick were two separate taps on every item.
 *
 * `capture="environment"` opens the rear camera straight from the tap on a
 * phone, so the crew member goes from standing at the door to having the
 * record in two taps: the card, then the shutter.
 */
import React, { useRef, useState } from 'react'
import {
  shotsFor, stepDone, doneCount, readyToFinish, canEdit, isAdmin,
  addShot, removeShot, setDestination, addNote, removeNote, finishUnit,
  reopenUnit, setService, deleteUnit,
  stepsFor, stepTotal, photoCount, weArePacking, materialsAnswered, setMaterials, setPackMinutes,
  phaseOf, earlierSteps, readyToFinishPacking, finishPacking, reopenPacking, canSetService,
  PACKED_Q, UNPACK_Q, packedAnswered, unpackAnswered, weAreUnpacking,
  answerPacked, answerUnpack, blockedBy,
  CARTON_TYPES, SUPPLY_TYPES,
} from './s15.js'

function stamp(ts) {
  if (!ts) return ''
  const d = new Date(typeof ts === 'number' ? ts : ts.seconds * 1000)
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function StepCard({ step, index, unit, user, editable, onToast }) {
  const shots = shotsFor(unit, step.key)
  const done = shots.length > 0
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const admin = isAdmin(user)

  async function onPick(e) {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    try {
      for (const f of files) await addShot(unit, step.key, f, user)
    } catch (err) {
      onToast(err.message || 'That photo did not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 12, borderLeft: `4px solid ${done ? '#16a34a' : '#d8dae2'}` }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 30, height: 30, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center',
          fontWeight: 700, fontSize: 14, background: done ? '#16a34a' : '#eceef3', color: done ? '#fff' : '#6b7280',
        }}>{done ? '✓' : index + 1}</div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 15, lineHeight: 1.3 }}>{step.label}</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{step.hint}</div>
        </div>
      </div>

      {shots.length > 0 && (
        <div className="media-row" style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {shots.map((s, i) => (
            <div key={`${s.ts}-${i}`} style={{ position: 'relative' }}>
              <a href={s.url} target="_blank" rel="noopener">
                <img
                  src={s.url}
                  alt={step.label}
                  style={{ width: 94, height: 94, objectFit: 'cover', borderRadius: 10, display: 'block', border: '1px solid var(--line, #e4e7ee)' }}
                />
              </a>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 3, maxWidth: 94, lineHeight: 1.25 }}>
                {s.name}<br />{stamp(s.ts)}
                {s.stored === false && (
                  <><br /><span title="Saved on the phone because there was no signal. It stays in the record either way." style={{ color: '#b45309' }}>no signal</span></>
                )}
              </div>
              {admin && (
                <button
                  className="btn-icon-sm"
                  title="Remove this photo"
                  onClick={() => removeShot(unit, step.key, s, user).catch((e) => onToast(e.message))}
                  style={{
                    position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%',
                    background: '#dc2626', color: '#fff', border: 'none', fontSize: 13, lineHeight: '22px', padding: 0, cursor: 'pointer',
                  }}
                >×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {editable && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={onPick}
            style={{ display: 'none' }}
          />
          <button
            className={done ? 'btn btn-sm' : 'btn btn-primary btn-lg'}
            disabled={busy}
            onClick={() => fileRef.current && fileRef.current.click()}
            style={{ marginTop: 12, width: done ? 'auto' : '100%', minHeight: done ? 36 : 52, fontSize: done ? 13 : 16 }}
          >
            {busy ? 'Saving…' : done ? '+ Another photo' : `📷 Take ${step.multi ? 'photos' : 'the photo'}`}
          </button>
        </>
      )}
    </div>
  )
}

/* What Gorilla used, and how long it took.
 *
 * Shown only on a unit we pack. Thirteen of Casey's sixteen are tenant-packed
 * and must never see any of this: the crew's complaint about the last app was
 * the number of boxes to fill in, and these are exactly that kind of box.
 *
 * Cartons and supplies are kept apart because MoveTrack already bills and
 * restocks from that split, and a roll of tape must not land in the carton
 * count. Saved on blur rather than behind a Save button, so a packer who
 * closes the app mid-count has not lost it.
 */
function PackingExtras({ unit, user, editable, toast }) {
  const [counts, setCounts] = useState(() => ({ ...(unit.materials || {}) }))
  const [mins, setMins] = useState(() => (unit.packMinutes ? String(unit.packMinutes) : ''))
  const [busy, setBusy] = useState(false)
  const answered = materialsAnswered(unit)
  const anyCount = Object.values(counts).some((v) => Number(v) > 0)

  async function save(none = false) {
    setBusy(true)
    try { await setMaterials(unit, counts, none, user) } catch (e) { toast(e.message) } finally { setBusy(false) }
  }

  const Field = ({ t }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span className="grow" style={{ fontSize: 13, minWidth: 0 }}>
        {t.label}
        {t.hint && <span className="muted" style={{ fontSize: 11, display: 'block' }}>{t.hint}</span>}
      </span>
      <input
        className="input"
        type="number" min="0" inputMode="numeric"
        value={counts[t.key] ?? ''}
        disabled={!editable}
        placeholder="0"
        onChange={(e) => setCounts({ ...counts, [t.key]: e.target.value })}
        onBlur={() => save(false)}
        style={{ width: 72, minHeight: 44, textAlign: 'center', fontSize: 16 }}
      />
    </label>
  )

  return (
    <div
      className="card"
      style={{
        padding: 16, marginBottom: 12,
        borderLeft: `4px solid ${answered ? '#16a34a' : '#efa91f'}`,
        background: answered ? undefined : '#fffbeb',
      }}
    >
      <div style={{ fontWeight: 650 }}>We packed this one</div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 2, marginBottom: 12 }}>
        {answered
          ? unit.materialsNone && anyCount
            ? 'Recorded as the property\'s materials. Change them any time before the unit is finished.'
            : 'Materials recorded. Change them any time before the unit is finished.'
          : 'What did you use? Count it whoever supplied it, and say below whose it was.'}
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        {CARTON_TYPES.map((t) => <Field key={t.key} t={t} />)}
      </div>

      <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', margin: '14px 0 8px' }}>SUPPLIES</div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        {SUPPLY_TYPES.map((t) => <Field key={t.key} t={t} />)}
      </div>

      {/* ALWAYS AVAILABLE, and it never clears the counts.
          Casey, 2026-10-22: the property supplies the cartons on this job,
          we do the packing, and he still wants the count. Ticking this says
          whose they were; it does not say there was nothing to count. */}
      {editable && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 16, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!unit.materialsNone}
            disabled={busy}
            onChange={(e) => save(e.target.checked)}
            style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
          />
          <span style={{ fontSize: 13 }}>
            We used none of our own materials
            <span className="muted" style={{ display: 'block', fontSize: 11.5, marginTop: 1 }}>
              {unit.materialsNone
                ? anyCount
                  ? 'Counted above as the property\'s. Tracked, not restocked to us.'
                  : 'Nothing used, or the property supplied it. Add counts above if you want them tracked.'
                : 'Tick this if the property supplied them. You can still count them above.'}
            </span>
          </span>
        </label>
      )}

      <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 650 }}>Packing time</span>
        <input
          className="input"
          type="number" min="0" inputMode="numeric"
          value={mins}
          disabled={!editable}
          placeholder="minutes"
          onChange={(e) => setMins(e.target.value)}
          onBlur={() => setPackMinutes(unit, mins, user).catch((e) => toast(e.message))}
          style={{ width: 110, minHeight: 44, fontSize: 16 }}
        />
        <span className="muted" style={{ fontSize: 12 }}>minutes, all packers together</span>
      </div>

      {unit.materialsBy && (
        <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          Last set by {unit.materialsBy}
        </div>
      )}
    </div>
  )
}

/* A question, asked at the door, answered by whoever is standing at it.
 *
 * Casey, 2026-10-22: "wouldnt it be easyer, to have a steep 'is the customer
 * packed and ready for this move'?"
 *
 * It is, and it replaces a control only a supervisor could reach - which
 * meant a crew at an unpacked apartment had to telephone somebody before the
 * app would let them record what was in front of them.
 *
 * Two buttons, neither preselected. A default answer is the one that gets
 * tapped through, and the whole value of asking is that the schedule is
 * sometimes wrong. Once answered it collapses to one line with the name
 * against it and a way to change it, because a wrong tap at a door must not
 * be something you need an admin to undo.
 */
function Ask({ question, hint, yes, no, answered, answerText, onYes, onNo, onReopen, busy, tone }) {
  if (answered) {
    return (
      <div className="card" style={{ padding: '12px 14px', marginBottom: 12 }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>
          <span className="grow" style={{ fontSize: 13, minWidth: 160 }}>{answerText}</span>
          {onReopen && <button className="btn btn-sm" disabled={busy} onClick={onReopen}>Change</button>}
        </div>
      </div>
    )
  }
  return (
    <div
      className="card"
      style={{ padding: 16, marginBottom: 12, background: tone || '#fffbeb', border: '1px solid #fde68a' }}
    >
      <div style={{ fontSize: 15, fontWeight: 650 }}>{question}</div>
      {hint && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{hint}</div>}
      <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy} onClick={onYes} style={{ minHeight: 50, fontSize: 16, flex: '1 1 140px' }}>{yes}</button>
        <button className="btn" disabled={busy} onClick={onNo} style={{ minHeight: 50, fontSize: 16, flex: '1 1 140px' }}>{no}</button>
      </div>
    </div>
  )
}

/** "Is the customer packed and ready?" plus, when the answer is no, how many
 *  of us are packing it. */
function AskPacked({ unit, user, toast }) {
  const [busy, setBusy] = useState(false)
  const [howMany, setHowMany] = useState(false)
  const [n, setN] = useState('2')

  async function answer(ready, packers) {
    setBusy(true)
    try { await answerPacked(unit, ready, packers, user); setHowMany(false) }
    catch (e) { toast(e.message) } finally { setBusy(false) }
  }

  if (howMany && !packedAnswered(unit)) {
    return (
      <div className="card" style={{ padding: 16, marginBottom: 12, background: '#fffaf0', border: '1px solid #fde68a' }}>
        <div style={{ fontSize: 15, fontWeight: 650 }}>How many of us are packing it?</div>
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="input" value={n} onChange={(e) => setN(e.target.value)} style={{ width: 130, minHeight: 48, fontSize: 16 }}>
            {[1, 2, 3, 4, 5].map((k) => <option key={k} value={String(k)}>{k} packer{k === 1 ? '' : 's'}</option>)}
          </select>
          <button className="btn btn-primary" disabled={busy} onClick={() => answer(false, n)} style={{ minHeight: 48 }}>
            {busy ? 'Saving…' : 'Start packing'}
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => setHowMany(false)}>Back</button>
        </div>
      </div>
    )
  }

  return (
    <Ask
      question={PACKED_Q}
      hint="Look inside first. This decides whether we pack it."
      yes="Yes, ready to move"
      no="No, we pack it"
      busy={busy}
      answered={packedAnswered(unit)}
      answerText={
        weArePacking(unit)
          ? `We are packing this one${unit.packers ? `, ${unit.packers} packer${unit.packers === 1 ? '' : 's'}` : ''}. Said by ${unit.packedConfirmedBy || 'someone'}.`
          : `Customer packed and ready. Said by ${unit.packedConfirmedBy || 'someone'}.`
      }
      onYes={() => answer(true, 0)}
      onNo={() => setHowMany(true)}
      onReopen={canSetService(unit, user) ? () => answer(!weArePacking(unit), 2) : null}
    />
  )
}

/** "Will Gorilla Movers unpack?" - two more photographs if yes. */
function AskUnpack({ unit, user, toast }) {
  const [busy, setBusy] = useState(false)
  async function answer(v) {
    setBusy(true)
    try { await answerUnpack(unit, v, user) } catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  return (
    <Ask
      question={UNPACK_Q}
      hint="Yes adds two photos: before we unpack, and once it is put away."
      yes="Yes, we unpack"
      no="No unpacking"
      tone="#f5f8ff"
      busy={busy}
      answered={unpackAnswered(unit)}
      answerText={weAreUnpacking(unit)
        ? `We are unpacking this one. Said by ${unit.unpackAnsweredBy || 'someone'}.`
        : `No unpacking. Said by ${unit.unpackAnsweredBy || 'someone'}.`}
      onYes={() => answer(true)}
      onNo={() => answer(false)}
      onReopen={() => answer(!weAreUnpacking(unit))}
    />
  )
}

export default function S15Unit({ unit, goBack, toast }) {
  const user = unit && unit.__user
  const [dest, setDest] = useState(unit ? unit.destination || '' : '')
  const [note, setNote] = useState('')
  const [savingDest, setSavingDest] = useState(false)
  // Two taps rather than window.confirm: a native dialog blocks the whole
  // page, and this is the one button that cannot be undone.
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!unit) return null
  const editable = canEdit(unit, user)
  const admin = isAdmin(user)
  const steps = stepsFor(unit)
  const total = stepTotal(unit)
  const packing = weArePacking(unit)
  const phase = phaseOf(unit)
  const onPackDay = phase === 'packing'
  const earlier = earlierSteps(unit)
  const packReady = readyToFinishPacking(unit)
  const n = doneCount(unit)
  const shotTotal = photoCount(unit)
  const ready = readyToFinish(unit)
  const notes = Array.isArray(unit.notes) ? [...unit.notes].sort((a, b) => b.ts - a.ts) : []
  // Every shot at the old door taken, which is the moment the destination
  // stops being a guess.
  const fromDone = steps.filter((s) => s.side === 'from').every((s) => stepDone(unit, s.key))
  // Casey: "any user at any time can add notes in. or multiable times."
  // Notes sit OUTSIDE the completion lock on purpose - the thing you need to
  // say about an apartment is often the thing you realise afterwards.
  const canNote = !!user && user.status === 'active'

  async function saveDest() {
    if ((unit.destination || '') === dest.trim()) return
    setSavingDest(true)
    try { await setDestination(unit, dest, user) } catch (e) { toast(e.message) } finally { setSavingDest(false) }
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto' }}>
      <button className="btn btn-sm" onClick={goBack} style={{ marginBottom: 14 }}>← All units</button>

      <div className="row" style={{ alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Unit {unit.number}</h1>
        {unit.done && <span className="badge" style={{ background: '#16a34a', color: '#fff' }}>✓ Complete</span>}
        {unit.packers > 0 && (
          <span className="chip" style={{ background: '#fef3c7', color: '#92400e', fontWeight: 650 }}>
            {unit.packers} packer{unit.packers === 1 ? '' : 's'} needed
          </span>
        )}
        {unit.service === 'gorilla' && <span className="chip">Gorilla packs</span>}
      </div>
      {unit.note && <div className="muted" style={{ marginTop: 2 }}>{unit.note}</div>}

      {packing && !unit.done && (
        <div
          className="card"
          style={{
            padding: '10px 14px', marginTop: 12, fontSize: 13,
            background: onPackDay ? '#fffbeb' : '#eff6ff',
            border: `1px solid ${onPackDay ? '#fde68a' : '#bfdbfe'}`,
          }}
        >
          <b>{onPackDay ? 'Packing day' : 'Move day'}</b>
          {onPackDay
            ? ' — pack it and photograph it. The move happens on a later visit.'
            : ` — packed by ${unit.packingDoneBy || 'the pack crew'}. Move it out and into the new unit.`}
        </div>
      )}

      {unit.done && !admin && (
        <div className="card" style={{ padding: 12, marginTop: 12, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          Finished by {unit.doneByName || 'someone'}. Ask Casey if something needs changing.
        </div>
      )}

      {/* What the packers left. Read only, and above the mover's own list,
          because a mover arriving at a packed apartment wants to see what was
          boxed without any of it sitting in their list of things to do. */}
      {earlier.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 650 }}>
            From packing day · {earlier.reduce((n, st) => n + shotsFor(unit, st.key).length, 0)} photos
            {unit.materials && Object.keys(unit.materials).length > 0 && ' · materials recorded'}
          </summary>
          <div className="card" style={{ padding: 14, marginTop: 8 }}>
            {earlier.map((st) => (
              <div key={st.key} style={{ marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{st.label}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {shotsFor(unit, st.key).map((sh, i) => (
                    <a key={i} href={sh.url} target="_blank" rel="noopener">
                      <img src={sh.url} alt={st.label} style={{ width: 62, height: 62, objectFit: 'cover', borderRadius: 7 }} />
                    </a>
                  ))}
                  {!shotsFor(unit, st.key).length && <span className="muted" style={{ fontSize: 12 }}>none</span>}
                </div>
              </div>
            ))}
            {unit.packMinutes > 0 && (
              <div className="muted" style={{ fontSize: 12 }}>Packing took {unit.packMinutes} min</div>
            )}
          </div>
        </details>
      )}

      <div className="row" style={{ alignItems: 'center', margin: '18px 0 10px' }}>
        <div className="section-title grow" style={{ margin: 0 }}>
          {n} OF {total} DONE
          {shotTotal > 0 && <span className="muted" style={{ fontWeight: 500 }}> · {shotTotal} photo{shotTotal === 1 ? '' : 's'}</span>}
        </div>
      </div>

      {/* The three at the old door, then where they are going, then the two
          at the new one.

          Casey, 2026-10-22: the destination belongs "more twards the bottom
          after the starting unit is complated". It used to sit at the top,
          which asked for a number nobody has yet - the crew find out which
          apartment the tenant is going to somewhere between emptying the old
          one and walking to the new one. So it sits exactly there, between
          step 3 and step 4, and the next thing after typing it is
          photographing that door. */}
      {/* The packed question sits right after the rooms shot, because that
          is the first moment anybody can answer it: you cannot tell from the
          corridor whether a tenant has really packed. */}
      {steps.filter((s) => s.side === 'from').map((s, i) => (
        <React.Fragment key={s.key}>
          <StepCard step={s} index={i} unit={unit} user={user} editable={editable} onToast={toast} />
          {s.key === 'before' && editable && <AskPacked unit={unit} user={user} toast={toast} />}
        </React.Fragment>
      ))}

      {packing && onPackDay && (
        <PackingExtras unit={unit} user={user} editable={editable} toast={toast} />
      )}

      <div
        className="card"
        style={{
          padding: 16, marginBottom: 12,
          borderLeft: `4px solid ${unit.destination ? '#16a34a' : '#d8dae2'}`,
          background: fromDone && !unit.destination ? '#fffbeb' : undefined,
        }}
      >
        <div style={{ fontWeight: 650, marginBottom: 2 }}>Moving to unit</div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          {fromDone
            ? 'The old unit is empty. Which one are they going to?'
            : 'Fill this in when you know it.'}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input grow"
            inputMode="numeric"
            placeholder="New unit number"
            value={dest}
            disabled={!editable}
            onChange={(e) => setDest(e.target.value)}
            onBlur={saveDest}
            style={{ fontSize: 17, minHeight: 46 }}
          />
          {editable && (
            <button className="btn" onClick={saveDest} disabled={savingDest} style={{ minHeight: 46 }}>
              {savingDest ? '…' : 'Save'}
            </button>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Not required. The photo of the new door is the record either way.
        </div>
      </div>

      {/* And the unpack question after everything is in the new unit, which
          is when it is actually settled with the customer. */}
      {steps.filter((s) => s.side === 'to').map((s, i) => (
        <React.Fragment key={s.key}>
          <StepCard
            step={s}
            index={steps.filter((x) => x.side === 'from').length + i}
            unit={unit} user={user} editable={editable} onToast={toast}
          />
          {s.key === 'newFull' && editable && <AskUnpack unit={unit} user={user} toast={toast} />}
        </React.Fragment>
      ))}

      {/* Notes: time, date and user stamped, same as everything else. */}
      <div className="card" style={{ padding: 16, marginTop: 6 }}>
        <div style={{ fontWeight: 650, marginBottom: 8 }}>Notes</div>
        {canNote && (
          <div className="row" style={{ gap: 8, marginBottom: notes.length ? 12 : 0 }}>
            <input
              className="input grow"
              placeholder="Anything the office should know"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ minHeight: 44 }}
            />
            <button
              className="btn"
              disabled={!note.trim()}
              onClick={async () => { try { await addNote(unit, note, user); setNote('') } catch (e) { toast(e.message) } }}
              style={{ minHeight: 44 }}
            >Add</button>
          </div>
        )}
        {notes.map((nt, i) => (
          <div key={`${nt.ts}-${i}`} className="row" style={{ alignItems: 'flex-start', gap: 8, padding: '8px 0', borderTop: i ? '1px solid var(--line, #eceef3)' : 'none' }}>
            <div className="grow">
              <div style={{ fontSize: 14 }}>{nt.text}</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{nt.name} · {stamp(nt.ts)}</div>
            </div>
            {admin && (
              <button className="btn-sm" onClick={() => removeNote(unit, nt, user).catch((e) => toast(e.message))}>Remove</button>
            )}
          </div>
        ))}
        {!notes.length && !canNote && <div className="muted" style={{ fontSize: 13 }}>No notes.</div>}
      </div>

      {/* Finish. Only offered once all five are in, so the button cannot be
          the thing that produces a half-recorded unit. */}
      {onPackDay && editable && (
        <button
          className="btn btn-primary btn-lg"
          disabled={!packReady}
          onClick={async () => {
            try { await finishPacking(unit, user); toast(`Unit ${unit.number} packed. Ready for move day.`); goBack() }
            catch (e) { toast(e.message) }
          }}
          style={{ width: '100%', minHeight: 56, fontSize: 17, marginTop: 16 }}
        >
          {packReady ? '✓ Packing finished' : blockedBy(unit)}
        </button>
      )}

      {!unit.done && !onPackDay && editable && (
        <button
          className="btn btn-primary btn-lg"
          disabled={!ready}
          onClick={async () => { try { await finishUnit(unit, user); toast(`Unit ${unit.number} complete.`); goBack() } catch (e) { toast(e.message) } }}
          style={{ width: '100%', minHeight: 56, fontSize: 17, marginTop: 16 }}
        >
          {ready ? '✓ Mark this unit complete' : blockedBy(unit)}
        </button>
      )}

      {unit.done && admin && (
        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={() => reopenUnit(unit, user).catch((e) => toast(e.message))}>Reopen this unit</button>
        </div>
      )}

      {packing && !onPackDay && !unit.done && admin && (
        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <button className="btn btn-sm" onClick={() => reopenPacking(unit, user).catch((e) => toast(e.message))}>
            Send back to packing
          </button>
        </div>
      )}

      {admin && (
        <div className="card" style={{ padding: 14, marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>ADMIN</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {confirmDelete ? (
              <>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    try { await deleteUnit(unit, user); toast(`Unit ${unit.number} deleted.`); goBack() }
                    catch (e) { toast(e.message) }
                  }}
                >Yes, delete unit {unit.number} and its photos</button>
                <button className="btn btn-sm" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn btn-sm" onClick={() => setConfirmDelete(true)}>Delete this unit</button>
            )}
          </div>
        </div>
      )}

      <div style={{ height: 40 }} />
    </div>
  )
}
