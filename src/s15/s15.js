/* Studio 15 - the data layer.
 *
 * Casey, 2026-10-22: "THIS APP NEEDS TO BE ULTRA SIMPLE AND EASY FOR MY
 * MOVERS/PACKERS TO USE. THE ONE FOR TRINITY MANNOR DID TAKE THE USER EXTRA
 * TIME TO USE IT."
 *
 * WHY THIS IS NOT THE TRINITY MANOR MODEL. A Trinity Manor unit costs the
 * crew thirteen checklist items: seven to pack, six to load. Only six of the
 * thirteen are photographs. The other seven ask a tired person to type
 * something they are already looking at - sticker colour, inventory numbers,
 * materials, unit number, vault numbers, vault count - and every one of them
 * exists to defend a sealed box count across a hand-off to somebody outside
 * the building.
 *
 * Studio 15 has no such hand-off. The tenant's belongings move from one door
 * to another inside the same building: no container, no driver, no
 * warehouse, no Gorilla storage. There is no chain of custody to defend, so
 * the apparatus that defends one comes out, and the photographs stand as the
 * whole record.
 *
 * Five steps. Nothing to type on the normal path except the destination unit
 * number, which nobody knows until the day.
 *
 * SEPARATE COLLECTIONS, ON PURPOSE. These write to `s15Units` / `s15Events`
 * rather than `units` / `events`. Trinity Manor is a finished job whose
 * records are the proof of work for a client, and this was built in two
 * hours with a crew already packing. Nothing here can reach that data.
 */
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy,
  serverTimestamp, arrayUnion, arrayRemove, writeBatch, getDocs,
} from 'firebase/firestore'
import { db } from '../firebase.js'
import { captureMedia } from '../lib/upload.js'

export const S15_UNITS = 's15Units'
export const S15_EVENTS = 's15Events'

/* The five shots, in the order the crew walks them.
 *
 * `multi` is the difference between "a picture of the door" and "a few
 * pictures of the unit". Both are stored as arrays either way, so a retake is
 * an append rather than a destructive overwrite - the crew can always shoot
 * again, and the earlier frame stays in the record for the admin to see. */
export const S15_STEPS = [
  { key: 'door', label: 'Front door, unit number showing', hint: 'The door you are starting at.', multi: false, side: 'from' },
  { key: 'before', label: 'The unit before we touch anything', hint: 'A few. Every room you can see.', multi: true, side: 'from' },
  { key: 'empty', label: 'The unit once everything is out', hint: 'Proves nothing was left behind.', multi: false, side: 'from' },
  { key: 'newDoor', label: 'New front door, unit number showing', hint: 'The door you are moving them to.', multi: false, side: 'to' },
  { key: 'newFull', label: 'Everything in the new unit', hint: 'A few. Show where it all landed.', multi: true, side: 'to' },
]

export const S15_STEP_KEYS = S15_STEPS.map((s) => s.key)

/** Shots taken for one step, oldest first. Tolerates a doc written before a
 *  step existed, which is what makes adding a sixth step later safe. */
export function shotsFor(unit, key) {
  const v = unit && unit.shots && unit.shots[key]
  return Array.isArray(v) ? v : []
}

/** A step counts as done once it holds at least one photo. There is no
 *  separate "mark this step finished" tap: the photograph IS the step, and
 *  asking for a confirmation on top of it is exactly the kind of extra tap
 *  that made the last app slow. */
export function stepDone(unit, key) {
  return shotsFor(unit, key).length > 0
}

export function doneCount(unit) {
  return S15_STEP_KEYS.filter((k) => stepDone(unit, k)).length
}

/** Every step shot. The destination number is deliberately NOT required:
 *  step 4 is a photograph of that door with its number on it, so the record
 *  is complete without anybody typing. Typing it only makes it searchable. */
export function readyToFinish(unit) {
  return doneCount(unit) === S15_STEPS.length
}

/** Who may still change this unit.
 *
 *  Casey: "after a user makes it as compleated other user (not inculding
 *  admins) its locked out." So completion is a lock, and admin is the key. */
export function canEdit(unit, user) {
  if (!user || user.status !== 'active') return false
  if (user.role === 'admin') return true
  return !(unit && unit.done)
}

export const isAdmin = (user) => !!user && user.role === 'admin'

/* ── reads ──────────────────────────────────────────────────────── */

export function subscribeUnits(onUnits, onError) {
  const q = query(collection(db, S15_UNITS), orderBy('number'))
  return onSnapshot(q, (snap) => {
    onUnits(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  }, onError)
}

export function subscribeEvents(onEvents, onError) {
  const q = query(collection(db, S15_EVENTS), orderBy('ts', 'desc'))
  return onSnapshot(q, (snap) => {
    onEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  }, onError)
}

/* ── writes ─────────────────────────────────────────────────────── */

/** Every change lands in the log with who and when, which is the whole
 *  reason the app exists rather than a shared camera roll. */
async function logEvent(user, unit, action) {
  await addDoc(collection(db, S15_EVENTS), {
    ts: serverTimestamp(),
    uid: user.uid,
    name: user.name || user.email || 'someone',
    role: user.role || '',
    unitId: unit ? unit.id : null,
    unitNumber: unit ? unit.number : null,
    action,
  })
}

/** A photo for one step.
 *
 *  captureMedia() resizes and tries Storage first, falling back to an
 *  embedded data URL when the upload fails or times out - a Firestore write
 *  queues offline, a Storage upload does not. Studio 15 is a concrete
 *  high-rise, so that fallback is the difference between a crew member
 *  finishing a unit in a stairwell and being stuck on "Saving...". */
export async function addShot(unit, stepKey, file, user) {
  const stamp = Date.now()
  // The uid is in the FILENAME because storage.rules' pathHasOwnUid() greps
  // the object path for it. Drop it and every upload is denied, captureMedia
  // silently falls back to a base64 data URL on the Firestore doc, and the
  // unit dies at the 1 MiB document ceiling somewhere around photo five -
  // which is exactly how many this flow takes.
  const path = `studio15/${unit.id}/${stepKey}-${user.uid}-${stamp}.jpg`
  const media = await captureMedia(file, path)
  const shot = {
    url: media.url,
    // captureMedia returns { url, storage }. This read media.stored, which
    // is undefined, so every photo was filed as an offline fallback - even
    // the ones that went straight to Storage. The flag is how anyone later
    // tells an uploaded photo from one living inside the Firestore document.
    stored: media.storage === true,
    uid: user.uid,
    name: user.name || user.email || 'someone',
    ts: stamp,
  }
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    [`shots.${stepKey}`]: arrayUnion(shot),
    updatedAt: serverTimestamp(),
  })
  const step = S15_STEPS.find((s) => s.key === stepKey)
  await logEvent(user, unit, `Photo: ${step ? step.label : stepKey}`)
  return shot
}

/** Admin only, enforced in the rules too. Casey: "the admin, can go back
 *  edit, change, delete, remove, etc." */
export async function removeShot(unit, stepKey, shot, user) {
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    [`shots.${stepKey}`]: arrayRemove(shot),
    updatedAt: serverTimestamp(),
  })
  await logEvent(user, unit, `Removed a photo from "${stepKey}"`)
}

export async function setDestination(unit, destination, user) {
  const clean = String(destination || '').trim()
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    destination: clean,
    updatedAt: serverTimestamp(),
  })
  await logEvent(user, unit, clean ? `Moving to unit ${clean}` : 'Cleared the destination unit')
}

export async function addNote(unit, text, user) {
  const clean = String(text || '').trim()
  if (!clean) return
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    notes: arrayUnion({
      text: clean,
      uid: user.uid,
      name: user.name || user.email || 'someone',
      ts: Date.now(),
    }),
    updatedAt: serverTimestamp(),
  })
  await logEvent(user, unit, `Note: ${clean.slice(0, 80)}`)
}

export async function removeNote(unit, note, user) {
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    notes: arrayRemove(note),
    updatedAt: serverTimestamp(),
  })
  await logEvent(user, unit, 'Removed a note')
}

export async function finishUnit(unit, user) {
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    done: true,
    doneBy: user.uid,
    doneByName: user.name || user.email || 'someone',
    doneAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await logEvent(user, unit, 'Marked the unit complete')
}

/** Admin only. The way back out of the lock. */
export async function reopenUnit(unit, user) {
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    done: false,
    reopenedBy: user.uid,
    reopenedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await logEvent(user, unit, 'Reopened the unit')
}

export async function setService(unit, service, user) {
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    service,
    updatedAt: serverTimestamp(),
  })
  await logEvent(user, unit, service === 'gorilla' ? 'Gorilla is packing this unit' : 'Tenant packs this unit')
}

export async function addUnit({ number, packers = 0, service = 'tenant' }, user) {
  const ref = await addDoc(collection(db, S15_UNITS), {
    number: String(number).trim(),
    destination: '',
    packers: Number(packers) || 0,
    service,
    shots: {},
    notes: [],
    done: false,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
  })
  await logEvent(user, { id: ref.id, number }, `Added unit ${number}`)
  return ref.id
}

export async function deleteUnit(unit, user) {
  await deleteDoc(doc(db, S15_UNITS, unit.id))
  await logEvent(user, null, `Deleted unit ${unit.number}`)
}

/** One-time seed of Casey's scheduled list. Skips numbers already present so
 *  pressing it twice cannot double the board. */
export async function seedUnits(list, user) {
  const existing = await getDocs(collection(db, S15_UNITS))
  const have = new Set(existing.docs.map((d) => String(d.data().number)))
  const fresh = list.filter((u) => !have.has(String(u.number)))
  if (!fresh.length) return 0
  const batch = writeBatch(db)
  for (const u of fresh) {
    batch.set(doc(collection(db, S15_UNITS)), {
      number: String(u.number),
      destination: '',
      packers: u.packers || 0,
      service: u.packers ? 'gorilla' : 'tenant',
      note: u.note || '',
      shots: {},
      notes: [],
      done: false,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    })
  }
  await batch.commit()
  await logEvent(user, null, `Loaded ${fresh.length} units onto the board`)
  return fresh.length
}

/* Casey's scheduled list, 2026-10-22. The three with a packer count are the
 * disability units Gorilla packs; the rest the tenant packs themselves. The
 * count matters before anybody opens the unit - it decides who gets sent - so
 * it rides on the tile. */
export const STUDIO15_SCHEDULED = [
  { number: '578' },
  { number: '577', packers: 1, note: 'Disability unit' },
  { number: '544', packers: 2, note: 'Disability unit' },
  { number: '536' },
  { number: '531' },
  { number: '530' },
  { number: '529' },
  { number: '528' },
  { number: '526' },
  { number: '524' },
  { number: '522' },
  { number: '518' },
  { number: '517' },
  { number: '513' },
  { number: '509' },
  { number: '508', packers: 3, note: 'Disability unit' },
]
