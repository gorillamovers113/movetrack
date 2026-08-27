import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile } from 'firebase/auth'
import { doc, setDoc, updateDoc, addDoc, arrayUnion, onSnapshot, collection, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './firebase.js'
import { makeEvent, boxMismatch } from './lib/mutations.js'

const Ctx = createContext(null)

export function StoreProvider({ children }) {
  const [units, setUnits] = useState([])
  const [containers, setContainers] = useState([])
  const [overflow, setOverflow] = useState([])
  const [events, setEvents] = useState([])
  const [users, setUsers] = useState([])
  const [schedule, setSchedule] = useState([])
  const [currentUser, setCurrentUser] = useState(null)

  // Live Firestore state: six collection subscriptions replace the old
  // localStorage-backed reducer state. Each array holds `{ id, ...data }` docs.
  useEffect(() => {
    const subs = [
      onSnapshot(collection(db, 'units'), (s) => setUnits(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'containers'), (s) => setContainers(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'overflow'), (s) => setOverflow(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'events'), orderBy('ts', 'desc')), (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'users'), (s) => setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'schedule'), (s) => setSchedule(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
    ]
    return () => subs.forEach((u) => u())
  }, [])

  const state = { units, containers, overflow, events, users, schedule }

  // Auth session: subscribe to the signed-in user's Firestore profile doc so
  // role/status changes (e.g. admin approval) show up live without a re-login.
  useEffect(() => {
    let unsubProfile = null
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubProfile) { unsubProfile(); unsubProfile = null }
      if (!user) { setCurrentUser(null); return }
      unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
        setCurrentUser(snap.exists() ? snap.data() : null)
      })
    })
    return () => { unsubAuth(); if (unsubProfile) unsubProfile() }
  }, [])

  // Targeted Firestore writes per action, mirroring the old reducer's logic —
  // every action ends with an `event` doc so the activity log stays complete.
  const actor = () => ({ uid: currentUser.uid, userName: currentUser.name, role: currentUser.role })
  const ev = (type, action, extra) => addDoc(collection(db, 'events'), makeEvent(actor(), type, action, extra))

  // Stamps who-submitted-it + when onto every media object before it's
  // persisted, so photo/video attribution is consistent everywhere (Activity
  // feed, unit timeline, My queue, Overflow) instead of each capture site
  // stamping (or forgetting to stamp) it separately. Idempotent: a value
  // already on the object (e.g. media stamped upstream) is preserved.
  const attributeMedia = (arr = []) => arr.map((m) => ({
    ...m,
    uid: m.uid || currentUser.uid,
    userName: m.userName || currentUser.name,
    ts: m.ts || Date.now(),
  }))

  async function dispatch({ type, p }) {
    const unit = p.unitId ? state.units.find((u) => u.id === p.unitId) : null
    const cont0 = p.containerId ? state.containers.find((c) => c.id === p.containerId) : null
    const over0 = p.overflowId ? state.overflow.find((o) => o.id === p.overflowId) : null
    const targetUser = p.userId ? state.users.find((u) => u.id === p.userId) : null
    const name = targetUser ? targetUser.name : 'user'

    switch (type) {
      case 'startPacking': {
        await updateDoc(doc(db, 'units', p.unitId), { stage: 'packing', 'crew.packers': arrayUnion(currentUser.uid), 'times.packStart': Date.now() })
        return ev('stage', `Started packing unit ${unit.number}`, { unitId: unit.id, from: unit.stage, to: 'packing' })
      }
      case 'finishPacking': {
        // Packer captures a photo of the handwritten paper inventory sheet
        // plus a total piece count — units move via BigBox containers whose
        // loads mix beds, dressers, boxes, etc., so a single "box count"
        // never fit; p.media carries the inventory photo (arrayUnion'd onto
        // the unit's media so it shows in the unit's photo record).
        p.media = attributeMedia(p.media)
        await updateDoc(doc(db, 'units', p.unitId), { stage: 'packed', pieces: p.pieces, 'times.packEnd': Date.now(), media: arrayUnion(...p.media) })
        return ev('stage', `Finished packing unit ${unit.number} — ${p.pieces} pieces inventoried (inventory photo attached)`, { unitId: unit.id, from: 'packing', to: 'packed', media: p.media })
      }
      case 'logEmpties': {
        // BigBox drops off empty containers before any loading happens.
        const numbers = p.numbers.map((n) => n.toUpperCase())
        await Promise.all(numbers.map((number) => addDoc(collection(db, 'containers'), { number, status: 'empty', unitIds: [], deliveredAt: Date.now() })))
        return ev('system', `${numbers.length} empty BigBox container${numbers.length === 1 ? '' : 's'} delivered: ${numbers.join(', ')}`)
      }
      case 'loadUnit': {
        p.media = attributeMedia(p.media)
        const cont = state.containers.find((c) => c.id === p.containerId)
        const mismatch = boxMismatch(unit.pieces, p.pieces)
        const patch = { stage: 'loaded', containerIds: arrayUnion(p.containerId), 'crew.movers': arrayUnion(currentUser.uid) }
        if (mismatch) patch.flag = { message: `Piece count mismatch at load: ${p.pieces} loaded vs ${unit.pieces} packed. Recount pending.`, ts: Date.now(), by: currentUser.name, open: true }
        await updateDoc(doc(db, 'units', p.unitId), patch)
        await updateDoc(doc(db, 'containers', p.containerId), { status: 'filling', unitIds: arrayUnion(p.unitId) })
        await ev('stage', `Loaded unit ${unit.number} into container ${cont.number} — ${p.pieces} of ${unit.pieces ?? p.pieces} pieces verified`, { unitId: unit.id, containerId: p.containerId, from: unit.stage, to: 'loaded', media: p.media })
        if (mismatch) await ev('flag', `FLAG raised on unit ${unit.number}: piece count mismatch (${p.pieces}/${unit.pieces})`, { unitId: unit.id })
        return
      }
      case 'markContainerFull': {
        await updateDoc(doc(db, 'containers', p.containerId), { status: 'full' })
        return ev('stage', `Container ${cont0.number} marked full — ready for BigBox pickup`, { containerId: cont0.id })
      }
      case 'bigboxSwap': {
        // Mover logs the hand-off to the BigBox driver: selected full containers
        // go out (with the driver's name recorded), new empties come in — the
        // driver never touches the app; the mover is the custody witness.
        // p.media (optional) is the handoff photo, already uploaded to Storage
        // by the caller via uploadImage() — stored on each outgoing container
        // and on the swap event so it shows in both the container's custody
        // log and the global activity feed.
        const fulls = p.fullIds.map((id) => state.containers.find((c) => c.id === id)).filter(Boolean)
        const media = attributeMedia(p.media || [])
        await Promise.all(fulls.map(async (c) => {
          const patch = { status: 'picked_up', driverName: p.driverName, pickedUpAt: Date.now(), handoffBy: currentUser.uid }
          if (media.length) patch.media = arrayUnion(...media)
          await updateDoc(doc(db, 'containers', c.id), patch)
          await Promise.all(c.unitIds.map((uid) => updateDoc(doc(db, 'units', uid), { stage: 'picked_up' })))
        }))
        const newNumbers = p.newEmptyNumbers.map((n) => n.toUpperCase())
        await Promise.all(newNumbers.map((number) => addDoc(collection(db, 'containers'), { number, status: 'empty', unitIds: [], deliveredAt: Date.now() })))
        const fullNums = fulls.map((c) => c.number).join(', ')
        return ev('system', `BigBox swap with ${p.driverName}: ${fulls.length} full container${fulls.length === 1 ? '' : 's'} out (${fullNums}), ${newNumbers.length} empty${newNumbers.length === 1 ? '' : 's'} in (${newNumbers.join(', ')})`, media.length ? { media } : {})
      }
      case 'warehouseReceive': {
        // Warehouse closes the custody loop: verify piece count against what the
        // container's units were packed with, assign a bay. p.media (optional)
        // is the received-condition photo, already uploaded via uploadImage().
        const insideUnits = cont0.unitIds.map((id) => state.units.find((u) => u.id === id)).filter(Boolean)
        const expected = insideUnits.reduce((n, u) => n + (u.pieces || 0), 0)
        const mismatch = boxMismatch(expected, p.verifiedPieces)
        const media = attributeMedia(p.media || [])
        const patch = { status: 'at_warehouse', bay: p.bay, verifiedPieces: p.verifiedPieces, receivedBy: currentUser.uid, warehouseAt: Date.now() }
        if (media.length) patch.media = arrayUnion(...media)
        if (mismatch) patch.flag = { message: `Piece count mismatch at warehouse receive: ${p.verifiedPieces} verified vs ${expected} on record. Recount pending.`, ts: Date.now(), by: currentUser.name, open: true }
        await updateDoc(doc(db, 'containers', p.containerId), patch)
        await Promise.all(insideUnits.map((u) => updateDoc(doc(db, 'units', u.id), { stage: 'at_warehouse' })))
        await ev('stage', `Container ${cont0.number} received at warehouse — ${p.bay}, ${p.verifiedPieces} pieces verified`, { containerId: cont0.id, ...(media.length ? { media } : {}) })
        if (mismatch) await ev('flag', `FLAG raised on container ${cont0.number}: piece count mismatch (${p.verifiedPieces}/${expected})`, { containerId: cont0.id })
        return
      }
      case 'createOverflow': {
        // Oversized piece that won't fit a BigBox container, so Gorilla
        // Movers transports it to the warehouse directly, on its own chain
        // of custody. Denormalize unit info at creation for display on the
        // pool card without a join.
        const ref = await addDoc(collection(db, 'overflow'), {
          unitId: unit.id, unitNumber: unit.number, unitTenant: unit.tenant, floor: unit.floor,
          description: p.description,
          stage: 'identified',
          media: [],
          createdBy: currentUser.uid,
          createdAt: Date.now(),
        })
        return ev('system', `Logged overflow item on unit ${unit.number}: ${p.description}`, { unitId: unit.id, overflowId: ref.id })
      }
      case 'prepOverflow': {
        // Padded, wrapped, labeled: the photo (required by the UI) is the
        // proof of prep and the label. p.media is already uploaded to
        // Storage by the caller via uploadImage(); attribution is stamped
        // here so every capture site (not just Overflow) stays consistent.
        p.media = attributeMedia(p.media)
        await updateDoc(doc(db, 'overflow', p.overflowId), { stage: 'prepped', preppedAt: Date.now(), prepBy: currentUser.uid, media: arrayUnion(...p.media) })
        return ev('media', `Overflow item padded, wrapped & labeled, unit ${over0.unitNumber}: ${over0.description}`, { unitId: over0.unitId, overflowId: over0.id, media: p.media })
      }
      case 'transportOverflow': {
        await updateDoc(doc(db, 'overflow', p.overflowId), { stage: 'in_transit', transitAt: Date.now(), transportBy: currentUser.uid })
        return ev('stage', `Gorilla loaded overflow item for transport to warehouse, unit ${over0.unitNumber}: ${over0.description}`, { unitId: over0.unitId, overflowId: over0.id, from: 'prepped', to: 'in_transit' })
      }
      case 'receiveOverflow': {
        // Warehouse closes the custody loop: assign a specific per-item
        // location. p.media (optional) is the received-condition photo,
        // already uploaded via uploadImage().
        const media = attributeMedia(p.media || [])
        const patch = { stage: 'at_warehouse', warehouseAt: Date.now(), receivedBy: currentUser.uid, warehouseLocation: p.warehouseLocation }
        if (media.length) patch.media = arrayUnion(...media)
        await updateDoc(doc(db, 'overflow', p.overflowId), patch)
        return ev('stage', `Overflow item received at warehouse, ${p.warehouseLocation} (unit ${over0.unitNumber}: ${over0.description})`, { unitId: over0.unitId, overflowId: over0.id, ...(media.length ? { media } : {}) })
      }
      case 'editOverflow': {
        const changed = Object.keys(p.patch).filter((k) => p.patch[k] !== over0[k])
        await updateDoc(doc(db, 'overflow', p.overflowId), p.patch)
        return ev('system', `Admin edited overflow item details (unit ${over0.unitNumber}): ${changed.join(', ') || 'no changes'}`, { unitId: over0.unitId, overflowId: over0.id })
      }
      case 'addOverflowNote': {
        return ev('note', p.text, { overflowId: p.overflowId, unitId: p.unitId })
      }
      case 'resolveOverflowFlag': {
        await updateDoc(doc(db, 'overflow', p.overflowId), { 'flag.open': false })
        return ev('flag', `FLAG resolved on overflow item (unit ${over0.unitNumber}): ${p.note}`, { overflowId: over0.id, unitId: over0.unitId })
      }
      case 'createUnit': {
        const ref = await addDoc(collection(db, 'units'), {
          number: p.number, tenant: p.tenant, floor: p.floor,
          stage: 'not_started',
          crew: { packers: [], movers: [] },
          containerIds: [], media: [], inventory: [], materials: {},
          createdAt: Date.now(),
        })
        return ev('system', `Created unit ${p.number} for ${p.tenant} (floor ${p.floor})`, { unitId: ref.id })
      }
      case 'editUnit': {
        const changed = Object.keys(p.patch).filter((k) => p.patch[k] !== unit[k])
        await updateDoc(doc(db, 'units', p.unitId), p.patch)
        return ev('system', `Admin edited unit ${unit.number} details (${changed.join(', ') || 'no changes'})`, { unitId: unit.id })
      }
      case 'addMedia': {
        p.media = attributeMedia(p.media)
        const n = p.media.length
        const kinds = p.media.some((m) => m.kind === 'video') ? (p.media.every((m) => m.kind === 'video') ? 'video' + (n > 1 ? 's' : '') : 'photos & video') : 'photo' + (n > 1 ? 's' : '')
        return ev('media', `Added ${n} ${kinds}${p.note ? ' — ' + p.note : ''} (unit ${unit.number})`, { unitId: unit.id, media: p.media })
      }
      case 'addNote': {
        const extra = p.unitId ? { unitId: p.unitId } : { containerId: p.containerId }
        return ev('note', p.text, extra)
      }
      case 'resolveFlag': {
        await updateDoc(doc(db, 'units', p.unitId), { 'flag.open': false })
        return ev('flag', `FLAG resolved on unit ${unit.number}: ${p.note}`, { unitId: unit.id })
      }
      case 'resolveContainerFlag': {
        await updateDoc(doc(db, 'containers', p.containerId), { 'flag.open': false })
        return ev('flag', `FLAG resolved on container ${cont0.number}: ${p.note}`, { containerId: cont0.id })
      }
      case 'approveUser': {
        await updateDoc(doc(db, 'users', p.userId), { status: 'active', role: p.role })
        return ev('system', `Approved ${name} as ${p.role}`)
      }
      case 'changeRole': {
        await updateDoc(doc(db, 'users', p.userId), { role: p.role })
        return ev('system', `Changed ${name}'s role to ${p.role}`)
      }
      case 'removeUser': {
        await updateDoc(doc(db, 'users', p.userId), { status: 'removed', role: null })
        return ev('system', `Removed ${name}'s access`)
      }
      case 'denyUser': {
        await updateDoc(doc(db, 'users', p.userId), { status: 'removed' })
        return ev('system', `Denied ${name}'s request`)
      }
      default:
        console.warn(`dispatch: unhandled action "${type}" (not part of the Phase-1 action set)`)
        return
    }
  }

  const signup = async ({ name, email, password }) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName: name })
    await setDoc(doc(db, 'users', cred.user.uid), { uid: cred.user.uid, name, email, role: null, status: 'pending', createdAt: serverTimestamp() })
  }
  const login = (email, password) => signInWithEmailAndPassword(auth, email, password)
  const resetPassword = (email) => sendPasswordResetEmail(auth, email)
  const logout = () => signOut(auth)

  const api = useMemo(() => ({
    state,
    dispatch,
    currentUser,
    signup,
    login,
    resetPassword,
    logout,
  }), [state, currentUser])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export const useStore = () => useContext(Ctx)

// ---- helpers ----

export function fmtTime(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
export function fmtAgo(ts) {
  const s = (Date.now() - ts) / 1000
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function canAct(user, unit) {
  // Returns the action available to this user on this unit right now, or null.
  // One-way Phase-1 lifecycle: not_started → packing → packed → loaded → picked_up → at_warehouse.
  if (!user) return null
  const role = user.role
  const admin = role === 'admin'
  switch (unit.stage) {
    case 'not_started': return admin || role === 'packer' ? { key: 'startPacking', label: 'Start packing' } : null
    case 'packing': return admin || role === 'packer' ? { key: 'finishPacking', label: 'Finish packing' } : null
    case 'packed': return admin || role === 'mover' ? { key: 'loadUnit', label: 'Load into a BigBox' } : null
    default: return null
  }
}

export function containerAction(user, cont) {
  // Container status lifecycle: empty → filling → full → picked_up → at_warehouse.
  // The swap (full → picked_up) and warehouse receive (picked_up → at_warehouse)
  // are batch/dedicated screens, not a single-container quick action, so they
  // return null here rather than a one-tap action — this only covers the
  // simple in-place transition (filling → full).
  if (!user) return null
  const admin = user.role === 'admin'
  switch (cont.status) {
    case 'filling':
      return admin || user.role === 'mover' ? { key: 'markContainerFull', label: 'Mark full — ready for pickup' } : null
    default:
      return null
  }
}

export const CONT_STATUS = {
  empty: { label: 'Empty on site', color: '#8a93a2' },
  filling: { label: 'Filling', color: '#8b5cf6' },
  full: { label: 'Full · ready', color: '#f59e0b' },
  picked_up: { label: 'In transit', color: '#f97316' },
  at_warehouse: { label: 'At warehouse', color: '#3b82f6' },
}

export function overflowAction(user, item) {
  // Overflow lifecycle: identified → prepped → in_transit → at_warehouse.
  // Only the prepped → in_transit hop is a simple one-tap transition (no
  // form): identify/prep/receive all need a bit of input (description,
  // required photo, warehouse location) so they get dedicated forms in
  // Overflow.jsx instead of a quick action here, matching how
  // containerAction() only covers container's filling → full hop.
  if (!user) return null
  const admin = user.role === 'admin'
  switch (item.stage) {
    case 'prepped':
      return admin || user.role === 'mover' ? { key: 'transportOverflow', label: 'Load & transport to warehouse' } : null
    default:
      return null
  }
}

export const OVERFLOW_STATUS = {
  identified: { label: 'Needs prep', color: '#8a93a2' },
  prepped: { label: 'Ready to transport', color: '#8b5cf6' },
  in_transit: { label: 'In transit', color: '#f97316' },
  at_warehouse: { label: 'At warehouse', color: '#3b82f6' },
}

export async function filesToMedia(fileList, labelPrefix = '') {
  const files = Array.from(fileList)
  const out = []
  for (const f of files) {
    if (f.type.startsWith('video')) {
      if (f.size > 12 * 1024 * 1024) { alert(`${f.name} is over 12 MB — video skipped (demo build keeps uploads small).`); continue }
      out.push({ id: `up-${Date.now()}-${out.length}`, kind: 'video', label: labelPrefix || f.name, url: await readAsDataURL(f) })
    } else if (f.type.startsWith('image')) {
      out.push({ id: `up-${Date.now()}-${out.length}`, kind: 'photo', label: labelPrefix || f.name, url: await resizeImage(f) })
    }
  }
  return out
}
const readAsDataURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f) })
async function resizeImage(file, max = 1400) {
  const url = await readAsDataURL(file)
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  if (scale === 1 && file.size < 400000) return url
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

export function exportActivityCSV(events, units, containers) {
  const uById = Object.fromEntries(units.map((u) => [u.id, u]))
  const cById = Object.fromEntries(containers.map((c) => [c.id, c]))
  const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"'
  const rows = [['Date', 'Time', 'User', 'Role', 'Action', 'Unit', 'Tenant', 'Container'].join(',')]
  for (const e of [...events].sort((a, b) => b.ts - a.ts)) {
    const d = new Date(e.ts)
    const u = e.unitId ? uById[e.unitId] : null
    rows.push([
      esc(d.toLocaleDateString('en-US')), esc(d.toLocaleTimeString('en-US')),
      esc(e.userName), esc(e.role), esc(e.action),
      esc(u ? u.number : ''), esc(u ? u.tenant : ''), esc(e.containerId && cById[e.containerId] ? cById[e.containerId].number : ''),
    ].join(','))
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `movetrack-activity-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
