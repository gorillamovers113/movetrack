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
/* The same carton and supply vocabulary Trinity Manor bills and restocks
 * from. Reused rather than redefined: a second list would drift, and the
 * separation it encodes matters - a roll of tape is not a carton and must
 * never inflate the box count. */
import { CARTON_TYPES, SUPPLY_TYPES } from '../lib/mutations.js'
export { CARTON_TYPES, SUPPLY_TYPES }

export const S15_UNITS = 's15Units'
export const S15_EVENTS = 's15Events'

/* The five shots, in the order the crew walks them.
 *
 * `multi` is the difference between "a picture of the door" and "a few
 * pictures of the unit". Both are stored as arrays either way, so a retake is
 * an append rather than a destructive overwrite - the crew can always shoot
 * again, and the earlier frame stays in the record for the admin to see. */
/* TWO VISITS, NOT ONE, WHEN WE PACK.
 *
 * Casey, 2026-10-22: "when we do packing, its usualy done before the move. so
 * for the units 508 they are packing today, and tomorrow will be the move ...
 * when the packers finish today, now the movers will need to do that same
 * steps again."
 *
 * A tenant-packed unit is one visit: the crew arrive, it is already boxed,
 * they move it. Thirteen of the sixteen work that way and are unchanged.
 *
 * A unit we pack is two visits on two different days, by two different
 * crews. Putting all of it on one screen would show a packer four steps they
 * cannot do today and a mover three that were done without them. So the unit
 * has a PHASE, and each crew sees only their own half:
 *
 *   packing   door, the unit untouched, packed and ready, materials, time
 *   moving    door again, empty, new door, everything in the new unit
 *
 * The door is photographed on both days on purpose. It is the cheapest proof
 * of which apartment and which day, and the two visits are a night apart.
 *
 * `phase` is absent on every unit that already exists, so phaseOf() derives
 * it: a unit we pack that has not finished packing is packing, everything
 * else is moving. Nothing had to be migrated under a crew mid-shift. */
export const S15_STEPS = [
  { key: 'door', label: 'Front door, unit number showing', hint: 'The door you are starting at. More than one is fine.', multi: false, side: 'from', phase: 'packing' },
  { key: 'before', label: 'The unit before we touch anything', hint: 'A few. Every room you can see.', multi: true, side: 'from', phase: 'packing' },
  /* Only when Gorilla did the packing. Casey, 2026-10-22: "if gorilla is
     packing, make sure to add extra steps."

     It sits between the untouched shot and the empty one because that is
     when it exists: boxed, labelled, still in the apartment. It is the only
     evidence of how the pack was done, and on a disability unit - which is
     every unit we pack here - it is the shot that answers a complaint. */
  { key: 'packed', label: 'Packed and ready, before it moves', hint: 'A few. Boxes stacked, labels showing.', multi: true, side: 'from', packingOnly: true, phase: 'packing' },
  { key: 'moveDoor', label: 'Front door, unit number showing', hint: 'Move day. Shows which door and which day.', multi: false, side: 'from', phase: 'moving', movingOnly: true },
  { key: 'empty', label: 'The unit once everything is out', hint: 'Proves nothing was left behind. Add as many as you need.', multi: false, side: 'from', phase: 'moving' },
  { key: 'newDoor', label: 'New front door, unit number showing', hint: 'The door you are moving them to. More than one is fine.', multi: false, side: 'to', phase: 'moving' },
  { key: 'newFull', label: 'Everything in the new unit', hint: 'A few. Show where it all landed.', multi: true, side: 'to', phase: 'moving' },
]

export const S15_STEP_KEYS = S15_STEPS.map((s) => s.key)

/** Whether Gorilla is packing this unit rather than the tenant.
 *  97% of Studio 15 tenants pack themselves; the exceptions are the
 *  disability units, and they are the ones that need the extra record. */
export function weArePacking(unit) {
  return !!unit && unit.service === 'gorilla'
}

/** Which visit this unit is on.
 *
 *  Derived, not stored, so the units already on the board did not need
 *  migrating while a crew was standing in one of them. */
export function phaseOf(unit) {
  if (!weArePacking(unit)) return 'moving'
  return unit && unit.packingDoneAt ? 'moving' : 'packing'
}

/** The steps THIS unit asks for RIGHT NOW.
 *
 *  A tenant-packed unit: the five, one visit, no phases involved - the
 *  move-day door shot would be a second photograph of the same door on the
 *  same morning, so it is left out.
 *  A unit we pack: three today, four tomorrow. */
export function stepsFor(unit) {
  if (!weArePacking(unit)) return S15_STEPS.filter((s) => !s.packingOnly && !s.movingOnly)
  const phase = phaseOf(unit)
  return S15_STEPS.filter((s) => s.phase === phase)
}

/** Everything already shot on the visit before this one, so a mover can see
 *  what the packers left without any of it cluttering their own list. */
export function earlierSteps(unit) {
  if (!weArePacking(unit) || phaseOf(unit) !== 'moving') return []
  return S15_STEPS.filter((s) => s.phase === 'packing')
}

/** Packing is finished when its three shots are in and the materials are
 *  answered. The move cannot start before that, which is the whole point. */
export function readyToFinishPacking(unit) {
  if (phaseOf(unit) !== 'packing') return false
  return S15_STEPS.filter((s) => s.phase === 'packing').every((s) => stepDone(unit, s.key))
    && materialsAnswered(unit)
}

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
  return stepsFor(unit).filter((s) => stepDone(unit, s.key)).length
}

export function stepTotal(unit) {
  return stepsFor(unit).length
}

/* HOW MANY PHOTOGRAPHS ARE ACTUALLY ON THIS UNIT.
 *
 * Casey, 2026-10-22: "i just noticed you have 0 of 5 photos on each card,
 * there should be no limit on how many photos are uploaded."
 *
 * There never was one. The five are the five SHOTS the record needs - door,
 * rooms, empty, new door, new rooms - and each holds as many frames as the
 * crew take; Rogelio put two on one of them this morning. But "0 of 5
 * photos" reads as a quota, and the owner of the company read it that way,
 * so the crew certainly would. The cards now say how many steps are done AND
 * how many photographs exist, which are two different numbers and both
 * worth knowing. */
export function photoCount(unit) {
  return S15_STEP_KEYS.reduce((n, k) => n + shotsFor(unit, k).length, 0)
}

/* MATERIALS HAVE TO BE ANSWERED, NOT REMEMBERED.
 *
 * They are what the pack is billed and restocked from, and the one thing
 * nobody can reconstruct afterwards from photographs. So finishing a unit we
 * packed asks for them - but "we used nothing" is a real answer and gets its
 * own tick, because forcing a false number is worse than an honest zero. */
/* WHOSE MATERIALS, AND HOW MANY, ARE TWO SEPARATE FACTS.
 *
 * Casey, 2026-10-22: "the management has all of there own matterials. so
 * click the box, should still allow us to add the matterials becuse i still
 * want to track what was used."
 *
 * The first version treated them as one, and the storage enforced it:
 * materialsNone was written as `none && no counts`, so ticking the box threw
 * the counts away and typing a count silently unticked the box. That was
 * wrong for the commonest case on this job - the property supplies the
 * cartons, we do the packing, and Casey still wants to know that forty of
 * them went into 508.
 *
 * So `materialsNone` now means only "none of these were OURS", and the
 * counts stand on their own. Both can be true at once. What it drives:
 *
 *   counts, box clear      our stock. Bill it, restock it.
 *   counts, box ticked     the property's. Tracked, not restocked.
 *   no counts, box ticked  nothing used at all.
 *   no counts, box clear   nobody has answered yet.
 */
export function materialsAnswered(unit) {
  if (!weArePacking(unit)) return true
  if (unit && unit.materialsNone === true) return true
  const m = (unit && unit.materials) || {}
  return Object.values(m).some((v) => Number(v) > 0)
}

/** True when there is a count to bill and restock against our own stock. */
export function materialsAreOurs(unit) {
  if (!unit || unit.materialsNone === true) return false
  return Object.values(unit.materials || {}).some((v) => Number(v) > 0)
}

/** Every step shot. The destination number is deliberately NOT required:
 *  step 4 is a photograph of that door with its number on it, so the record
 *  is complete without anybody typing. Typing it only makes it searchable. */
export function readyToFinish(unit) {
  if (phaseOf(unit) === 'packing') return false
  return doneCount(unit) === stepTotal(unit) && materialsAnswered(unit)
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

/* Who may put a NEW unit on the board.
 *
 * Casey, 2026-10-22: "there is a supervisor check box in the admin setttings.
 * maybe the admin and supervisor will only have the ability to add a unit."
 *
 * The problem it solves: the list is Casey's, and until now only Casey could
 * add to it, so an apartment that turns up unlisted stopped the crew dead on
 * site. Opening it to everyone invites a board full of typos, since a unit is
 * created from a free-typed number.
 *
 * Supervisor is already the flag MoveTrack uses for exactly this shape of
 * trust - a crew member with reach over the record, granted by Casey one
 * person at a time - so it is the flag here too rather than a new one.
 *
 * Deleting stays admin-only. Adding a wrong unit leaves a tile to ignore;
 * deleting the right one takes its photographs with it. */
export function canAddUnit(user) {
  if (!user || user.status !== 'active') return false
  return user.role === 'admin' || user.supervisor === true
}

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

export async function setMaterials(unit, counts, none, user) {
  const clean = {}
  for (const t of [...CARTON_TYPES, ...SUPPLY_TYPES]) {
    const v = Math.max(0, Math.floor(Number(counts && counts[t.key]) || 0))
    if (v > 0) clean[t.key] = v
  }
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    materials: clean,
    /* Independent of the counts, on purpose. Tying them together is what
       made the box destroy what the packer had just typed. */
    materialsNone: !!none,
    materialsBy: user.name || user.email || 'someone',
    materialsAt: Date.now(),
    updatedAt: serverTimestamp(),
  })
  const summary = Object.keys(clean).length
    ? [...CARTON_TYPES, ...SUPPLY_TYPES].filter((t) => clean[t.key]).map((t) => `${clean[t.key]} ${t.label.toLowerCase()}`).join(', ')
    : 'nothing'
  const whose = Object.keys(clean).length && none ? ' (the property\'s, not ours)' : ''
  await logEvent(user, unit, `Materials: ${summary}${whose}`)
}

export async function setPackMinutes(unit, minutes, user) {
  const m = Math.max(0, Math.floor(Number(minutes) || 0))
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    packMinutes: m,
    packTimeBy: user.name || user.email || 'someone',
    packTimeAt: Date.now(),
    updatedAt: serverTimestamp(),
  })
  await logEvent(user, unit, `Packing time: ${m} min`)
}

/** Packing done. The unit changes hands: tomorrow's crew open it and find
 *  their own four steps, with today's work shown above, read only. */
export async function finishPacking(unit, user) {
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    packingDoneAt: Date.now(),
    packingDoneBy: user.name || user.email || 'someone',
    updatedAt: serverTimestamp(),
  })
  await logEvent(user, unit, 'Packing finished, ready for move day')
}

/** Admin only: put it back on the packers. */
export async function reopenPacking(unit, user) {
  await updateDoc(doc(db, S15_UNITS, unit.id), {
    packingDoneAt: null,
    updatedAt: serverTimestamp(),
  })
  await logEvent(user, unit, 'Reopened packing')
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
