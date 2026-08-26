import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile } from 'firebase/auth'
import { doc, setDoc, updateDoc, addDoc, arrayUnion, onSnapshot, collection, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './firebase.js'
import { makeEvent, boxMismatch } from './lib/mutations.js'

const Ctx = createContext(null)

export function StoreProvider({ children }) {
  const [units, setUnits] = useState([])
  const [containers, setContainers] = useState([])
  const [events, setEvents] = useState([])
  const [users, setUsers] = useState([])
  const [schedule, setSchedule] = useState([])
  const [currentUser, setCurrentUser] = useState(null)

  // Live Firestore state: five collection subscriptions replace the old
  // localStorage-backed reducer state. Each array holds `{ id, ...data }` docs.
  useEffect(() => {
    const subs = [
      onSnapshot(collection(db, 'units'), (s) => setUnits(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'containers'), (s) => setContainers(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'events'), orderBy('ts', 'desc')), (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'users'), (s) => setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'schedule'), (s) => setSchedule(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
    ]
    return () => subs.forEach((u) => u())
  }, [])

  const state = { units, containers, events, users, schedule }

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

  async function dispatch({ type, p }) {
    const unit = p.unitId ? state.units.find((u) => u.id === p.unitId) : null
    const cont0 = p.containerId ? state.containers.find((c) => c.id === p.containerId) : null
    const targetUser = p.userId ? state.users.find((u) => u.id === p.userId) : null
    const name = targetUser ? targetUser.name : 'user'

    switch (type) {
      case 'startPacking': {
        await updateDoc(doc(db, 'units', p.unitId), { stage: 'packing', 'crew.packers': arrayUnion(currentUser.uid), 'times.packStart': Date.now() })
        return ev('stage', `Started packing unit ${unit.number}`, { unitId: unit.id, from: unit.stage, to: 'packing' })
      }
      case 'finishPacking': {
        await updateDoc(doc(db, 'units', p.unitId), { stage: 'packed', boxCount: p.boxCount, 'times.packEnd': Date.now() })
        return ev('stage', `Finished packing unit ${unit.number} — ${p.boxCount} boxes sealed & labeled`, { unitId: unit.id, from: 'packing', to: 'packed', media: p.media })
      }
      case 'loadUnit': {
        let cont = state.containers.find((c) => c.number.toUpperCase() === p.containerNumber.toUpperCase())
        if (!cont) {
          const ref = await addDoc(collection(db, 'containers'), { number: p.containerNumber.toUpperCase(), location: 'site', bay: null, unitIds: [p.unitId], flag: null })
          cont = { id: ref.id, number: p.containerNumber.toUpperCase() }
        } else {
          await updateDoc(doc(db, 'containers', cont.id), { location: 'site', unitIds: arrayUnion(p.unitId) })
        }
        const mismatch = boxMismatch(unit.boxCount, p.boxCount)
        const patch = { stage: 'loaded', containerIds: arrayUnion(cont.id), 'crew.movers': arrayUnion(currentUser.uid) }
        if (mismatch) patch.flag = { message: `Box count mismatch at load: ${p.boxCount} loaded vs ${unit.boxCount} packed. Recount pending.`, ts: Date.now(), by: currentUser.name, open: true }
        await updateDoc(doc(db, 'units', p.unitId), patch)
        await ev('stage', `Loaded unit ${unit.number} into container ${cont.number} — ${p.boxCount} of ${unit.boxCount ?? p.boxCount} boxes verified`, { unitId: unit.id, containerId: cont.id, from: unit.stage, to: 'loaded', media: p.media })
        if (mismatch) await ev('flag', `FLAG raised on unit ${unit.number}: box count mismatch (${p.boxCount}/${unit.boxCount})`, { unitId: unit.id })
        return
      }
      case 'containerMove': {
        // Driver moves a whole container; every unit inside moves with it.
        // One-way lifecycle only: pickup (site → transit) and checkin (transit → warehouse).
        const map = {
          pickup: { loc: 'transit', to: 'picked_up', msg: (c) => `Container ${c.number} picked up from site` },
          checkin: { loc: 'warehouse', to: 'at_warehouse', msg: (c) => `Container ${c.number} checked into warehouse — ${p.bay || 'bay assigned'}` },
        }[p.move]
        const inside = state.units.filter((u) => cont0.unitIds.includes(u.id))
        const unitNums = inside.map((u) => u.number).join(', ')
        const expected = inside.reduce((n, u) => n + (u.boxCount || 0), 0)
        const mismatch = p.verifiedBoxes != null && expected > 0 && boxMismatch(expected, p.verifiedBoxes)
        const contPatch = { location: map.loc }
        if (p.move === 'checkin') contPatch.bay = p.bay || cont0.bay || null
        if (mismatch) contPatch.flag = { message: `Box count mismatch at ${p.move === 'pickup' ? 'pickup' : 'warehouse check-in'}: ${p.verifiedBoxes} counted vs ${expected} on record. Recount pending.`, ts: Date.now(), by: currentUser.name, open: true }
        await updateDoc(doc(db, 'containers', p.containerId), contPatch)
        await Promise.all(inside.map((u) => updateDoc(doc(db, 'units', u.id), { stage: map.to })))
        const verified = p.verifiedBoxes != null ? ` — ${p.verifiedBoxes} boxes verified on board` : ''
        await ev('stage', `${map.msg(cont0)} (units ${unitNums})${verified}`, { containerId: cont0.id, media: p.media })
        if (mismatch) await ev('flag', `FLAG raised on container ${cont0.number}: box count mismatch (${p.verifiedBoxes}/${expected})`, { containerId: cont0.id })
        return
      }
      case 'editUnit': {
        const changed = Object.keys(p.patch).filter((k) => p.patch[k] !== unit[k])
        await updateDoc(doc(db, 'units', p.unitId), p.patch)
        return ev('system', `Admin edited unit ${unit.number} details (${changed.join(', ') || 'no changes'})`, { unitId: unit.id })
      }
      case 'addMedia': {
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
    case 'packed': return admin || role === 'mover' ? { key: 'loadUnit', label: 'Load into container' } : null
    default: return null
  }
}

export function containerAction(user, cont) {
  // One-way lifecycle only: driver pickup (site → transit) then checkin (transit → warehouse).
  if (!user || !['admin', 'driver'].includes(user.role)) return null
  if (!cont.unitIds.length) return null
  switch (cont.location) {
    case 'site': return { move: 'pickup', label: 'Pick up from site' }
    case 'transit': return { move: 'checkin', label: 'Check into warehouse' }
    default: return null
  }
}

export const CONT_LOC = {
  unassigned: { label: 'Not in use', color: '#8a93a2' },
  site: { label: 'On site', color: '#8b5cf6' },
  transit: { label: 'In transit', color: '#f97316' },
  warehouse: { label: 'In warehouse', color: '#3b82f6' },
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
