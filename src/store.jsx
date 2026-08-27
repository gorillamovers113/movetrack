import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile } from 'firebase/auth'
import { doc, setDoc, updateDoc, deleteDoc, addDoc, arrayUnion, onSnapshot, collection, query, orderBy, serverTimestamp } from 'firebase/firestore'
import { auth, db } from './firebase.js'
import { makeEvent, boxMismatch, nextReturnUnitAction, nextReturnContainerAction, nextReturnOverflowAction } from './lib/mutations.js'
import { DEFAULT_SCHEDULE, DEFAULT_RETURN_SCHEDULE, scheduleDocId } from './lib/schedule.js'
import { stageOf } from './seed.js'

// meta/project doc default, used whenever the doc is absent (brand-new
// project, or before an admin has touched return phase). Keeps name/address
// consistent with the hardcoded fallback App.jsx used before this doc existed.
const DEFAULT_PROJECT = { returnPhase: false, name: 'Trinity Manor', address: '3940 Park Blvd' }

const Ctx = createContext(null)

export function StoreProvider({ children }) {
  const [units, setUnits] = useState([])
  const [containers, setContainers] = useState([])
  const [overflow, setOverflow] = useState([])
  const [events, setEvents] = useState([])
  const [users, setUsers] = useState([])
  const [schedule, setSchedule] = useState([])
  const [project, setProject] = useState(null)
  const [currentUser, setCurrentUser] = useState(null)

  // Live Firestore state: collection (+ one singleton doc) subscriptions
  // replace the old localStorage-backed reducer state. Each array holds
  // `{ id, ...data }` docs.
  useEffect(() => {
    const subs = [
      onSnapshot(collection(db, 'units'), (s) => setUnits(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'containers'), (s) => setContainers(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'overflow'), (s) => setOverflow(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'events'), orderBy('ts', 'desc')), (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'users'), (s) => setUsers(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'schedule'), (s) => setSchedule(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(doc(db, 'meta', 'project'), (d) => setProject(d.exists() ? { id: d.id, ...d.data() } : null)),
    ]
    return () => subs.forEach((u) => u())
  }, [])

  const state = { units, containers, overflow, events, users, schedule, project: project || DEFAULT_PROJECT }

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
    const day0 = p.dateId ? state.schedule.find((d) => d.id === p.dateId) : null

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

      // ---- Return phase (docs/superpowers/specs/2026-08-26-return-phase-design.md) ----
      // Exact reverse of the outbound actions above: same piece-count
      // verification + photo trail at every handoff, same roles doing the
      // reverse of their outbound step, back into the same apartment. See
      // §3's mirror table for which outbound action each one undoes.

      case 'setReturnPhase': {
        // Admin toggle. Preserve name/address on the write (not just merge)
        // so a first-ever toggle doesn't create a meta/project doc missing
        // those fields, which would drop the project chip's fallback text.
        const current = state.project
        await setDoc(doc(db, 'meta', 'project'), { returnPhase: p.on, name: current.name, address: current.address }, { merge: true })
        return ev('system', `${p.on ? 'Began' : 'Ended'} the return phase`)
      }
      case 'loadForReturn': {
        // Mirror of loadUnit: warehouse loads a unit back into a return
        // container, piece-verifies against what it left with.
        const cont = state.containers.find((c) => c.id === p.containerId)
        // Abort BEFORE any write if the container can't accept this load:
        // gone, or already past return_filling (return_full/return_transit/
        // back_on_site/returned_empty). Checking first (instead of omitting
        // status on the later container write) avoids a partial write where
        // the unit gets promoted to return_loaded but the container update
        // then self-loops (e.g. return_full -> return_full) and the return
        // rules reject it as a no-op transition, leaving the unit orphaned.
        if (!cont || (cont.status !== 'at_warehouse' && cont.status !== 'return_filling')) {
          throw new Error('That BigBox is no longer accepting items for return. Refresh and pick another container.')
        }
        p.media = attributeMedia(p.media)
        const mismatch = boxMismatch(unit.pieces, p.pieces)
        const patch = { stage: 'return_loaded', containerIds: arrayUnion(p.containerId) }
        if (mismatch) patch.flag = { message: `Piece count mismatch at return load: ${p.pieces} loaded vs ${unit.pieces} packed. Recount pending.`, ts: Date.now(), by: currentUser.name, open: true }
        await updateDoc(doc(db, 'units', p.unitId), patch)
        // Status is always written explicitly here (never omitted), same as
        // outbound loadUnit: both at_warehouse->return_filling and
        // return_filling->return_filling are allowed by the rules, so this
        // can't self-loop into a deny the way omitting status could.
        await updateDoc(doc(db, 'containers', p.containerId), { status: 'return_filling', unitIds: arrayUnion(p.unitId) })
        await ev('stage', `Loaded unit ${unit.number} for return into container ${cont.number}: ${p.pieces} of ${unit.pieces ?? p.pieces} pieces verified`, { unitId: unit.id, containerId: p.containerId, from: unit.stage, to: 'return_loaded', media: p.media })
        if (mismatch) await ev('flag', `FLAG raised on unit ${unit.number}: piece count mismatch on return load (${p.pieces}/${unit.pieces})`, { unitId: unit.id })
        return
      }
      case 'markReturnFull': {
        await updateDoc(doc(db, 'containers', p.containerId), { status: 'return_full' })
        return ev('stage', `Container ${cont0.number} marked full for return, ready for dispatch`, { containerId: cont0.id })
      }
      case 'dispatchReturn': {
        // Mirror of bigboxSwap, but the return leg doesn't necessarily bring
        // new empties back (newEmptyNumbers is optional), and it hands off
        // one container at a time rather than a batch.
        const media = attributeMedia(p.media || [])
        const patch = { status: 'return_transit', driverName: p.driverName, dispatchedAt: Date.now(), handoffBy: currentUser.uid }
        if (media.length) patch.media = arrayUnion(...media)
        await updateDoc(doc(db, 'containers', p.containerId), patch)
        // cont0.unitIds is stale: it still holds every unit ever loaded onto
        // this physical container, including its outbound trip. Only
        // promote units actually loaded for THIS return trip (loadForReturn
        // already flipped them to return_loaded) so a sibling that was
        // never loaded for return (still at_warehouse) isn't force-promoted.
        const toDispatch = (cont0.unitIds || []).map((uid) => state.units.find((u) => u.id === uid)).filter((u) => u && u.stage === 'return_loaded')
        await Promise.all(toDispatch.map((u) => updateDoc(doc(db, 'units', u.id), { stage: 'return_transit' })))
        let addedMsg = ''
        if (p.newEmptyNumbers && p.newEmptyNumbers.length) {
          const newNumbers = p.newEmptyNumbers.map((n) => n.toUpperCase())
          await Promise.all(newNumbers.map((number) => addDoc(collection(db, 'containers'), { number, status: 'empty', unitIds: [], deliveredAt: Date.now() })))
          addedMsg = `, ${newNumbers.length} empty${newNumbers.length === 1 ? '' : 's'} in (${newNumbers.join(', ')})`
        }
        return ev('system', `Return dispatch with ${p.driverName}: container ${cont0.number} out for delivery back to site${addedMsg}`, { containerId: cont0.id, ...(media.length ? { media } : {}) })
      }
      case 'deliverReturn': {
        // Mirror of the BigBox drive to the warehouse (no dedicated outbound
        // action): the container and its units arrive back on site. Piece
        // verification happens per-unit at unloadReturn, not here.
        const media = attributeMedia(p.media || [])
        const patch = { status: 'back_on_site', receivedBy: currentUser.uid, backOnSiteAt: Date.now() }
        if (media.length) patch.media = arrayUnion(...media)
        await updateDoc(doc(db, 'containers', p.containerId), patch)
        // Same staleness guard as dispatchReturn: only promote units that
        // are actually in transit on this return trip (return_transit), not
        // every unit ever associated with this container.
        const toDeliver = (cont0.unitIds || []).map((uid) => state.units.find((u) => u.id === uid)).filter((u) => u && u.stage === 'return_transit')
        await Promise.all(toDeliver.map((u) => updateDoc(doc(db, 'units', u.id), { stage: 'back_on_site' })))
        return ev('stage', `Container ${cont0.number} delivered back on site`, { containerId: cont0.id, ...(media.length ? { media } : {}) })
      }
      case 'unloadReturn': {
        // Mirror of loadUnit's piece verify, reversed: the mover carries the
        // unit off the container and into its apartment. When this was the
        // last unit still owed to that container, the container is now
        // empty, so flip it to returned_empty (mirror of a container
        // emptying out, the return-side end of its lifecycle).
        p.media = attributeMedia(p.media)
        const mismatch = boxMismatch(unit.pieces, p.pieces)
        const patch = { stage: 'unloaded', 'crew.movers': arrayUnion(currentUser.uid) }
        if (mismatch) patch.flag = { message: `Piece count mismatch at return unload: ${p.pieces} unloaded vs ${unit.pieces} packed. Recount pending.`, ts: Date.now(), by: currentUser.name, open: true }
        await updateDoc(doc(db, 'units', p.unitId), patch)
        const cont = state.containers.find((c) => c.status === 'back_on_site' && (c.unitIds || []).includes(p.unitId))
        if (cont) {
          // cont.unitIds is stale (still carries the container's outbound
          // roster too), so "last unit unloaded" can't just mean every id in
          // that list: a sibling that was never loaded for this return trip
          // sits at at_warehouse forever and would block returned_empty from
          // ever firing. Only count siblings that actually entered the
          // return flow (anything past at_warehouse) toward "last one out".
          const others = cont.unitIds.filter((id) => id !== p.unitId).map((id) => state.units.find((u) => u.id === id)).filter((u) => u && u.stage !== 'at_warehouse')
          const allOthersUnloaded = others.every((u) => stageOf(u.stage).step >= stageOf('unloaded').step)
          if (allOthersUnloaded) await updateDoc(doc(db, 'containers', cont.id), { status: 'returned_empty' })
        }
        await ev('stage', `Unloaded unit ${unit.number} back into its apartment${cont ? `, from container ${cont.number}` : ''}: ${p.pieces} of ${unit.pieces ?? p.pieces} pieces verified`, { unitId: unit.id, containerId: cont?.id, from: unit.stage, to: 'unloaded', media: p.media })
        if (mismatch) await ev('flag', `FLAG raised on unit ${unit.number}: piece count mismatch on return unload (${p.pieces}/${unit.pieces})`, { unitId: unit.id })
        return
      }
      case 'unpackUnit': {
        // Mirror of finishPacking: unpack in the apartment, photo. Terminal:
        // the unit's full round trip is complete.
        p.media = attributeMedia(p.media)
        await updateDoc(doc(db, 'units', p.unitId), { stage: 'unpacked', 'crew.packers': arrayUnion(currentUser.uid), media: arrayUnion(...p.media) })
        return ev('stage', `Unpacked unit ${unit.number}, move complete (photo attached)`, { unitId: unit.id, from: 'unloaded', to: 'unpacked', media: p.media })
      }
      case 'transportOverflowBack': {
        // Mirror of transportOverflow / receiveOverflow combined: Gorilla
        // drives the overflow item from the warehouse back to the building.
        const media = attributeMedia(p.media || [])
        const patch = { stage: 'rt_transit', rtTransitAt: Date.now(), transportBy: currentUser.uid }
        if (media.length) patch.media = arrayUnion(...media)
        await updateDoc(doc(db, 'overflow', p.overflowId), patch)
        return ev('stage', `Gorilla loaded overflow item for return transport to site, unit ${over0.unitNumber}: ${over0.description}`, { unitId: over0.unitId, overflowId: over0.id, from: 'at_warehouse', to: 'rt_transit', ...(media.length ? { media } : {}) })
      }
      case 'returnOverflow': {
        // Mirror of prepOverflow: unwrap and place the item back in the
        // apartment, photo required as proof, same as the outbound wrap.
        p.media = attributeMedia(p.media)
        await updateDoc(doc(db, 'overflow', p.overflowId), { stage: 'returned', returnedAt: Date.now(), returnedBy: currentUser.uid, media: arrayUnion(...p.media) })
        return ev('media', `Overflow item unwrapped and placed back, unit ${over0.unitNumber}: ${over0.description}`, { unitId: over0.unitId, overflowId: over0.id, media: p.media })
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
      case 'seedSchedule': {
        // Doc id = date, so this is an idempotent upsert (setDoc + merge),
        // never a duplicate, whether it's the first load or an admin's
        // "Reset to default plan". Admin-only server-side (Firestore rules).
        // Explicitly tags phase: 'out' on every write, which also backfills
        // the field onto any pre-existing days seeded before phase existed.
        await Promise.all(DEFAULT_SCHEDULE.map((day) => setDoc(doc(db, 'schedule', day.date), { ...day, phase: 'out' }, { merge: true })))
        return ev('system', `Loaded the floor plan: ${DEFAULT_SCHEDULE.length} days, Sep 8 to Oct 8`)
      }
      case 'seedReturnSchedule': {
        // Same idempotent upsert as seedSchedule, but return days live at a
        // prefixed doc id (scheduleDocId) so an admin re-dating a return day
        // can never collide with an outbound day on the same calendar date.
        await Promise.all(DEFAULT_RETURN_SCHEDULE.map((day) => setDoc(doc(db, 'schedule', scheduleDocId(day.date, 'return')), { ...day, phase: 'return' }, { merge: true })))
        return ev('system', `Loaded the return floor plan: ${DEFAULT_RETURN_SCHEDULE.length} days`)
      }
      case 'editScheduleDay': {
        // Doc id is normally the date itself, so a date change means the old
        // doc id has to go and a new one gets written, not just an
        // updateDoc. Return days keep their phase (and its doc-id prefix)
        // across an edit, since they don't carry it in p.patch.
        const phase = day0?.phase || 'out'
        const next = {
          date: p.patch.date ?? day0.date,
          work: p.patch.work ?? day0.work,
          floor: p.patch.floor ?? day0.floor,
          unitCount: p.patch.unitCount ?? day0.unitCount,
          phase,
        }
        const nextId = scheduleDocId(next.date, phase)
        if (nextId !== p.dateId) await deleteDoc(doc(db, 'schedule', p.dateId))
        await setDoc(doc(db, 'schedule', nextId), next, { merge: true })
        const moved = nextId !== p.dateId ? ` (moved to ${next.date})` : ''
        return ev('system', `Admin edited schedule day ${p.dateId}${moved}: Floor ${next.floor}, ${next.work}, ${next.unitCount} units`)
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

export function canAct(user, unit, returnPhase = false) {
  // Returns the action available to this user on this unit right now, or null.
  // Outbound one-way lifecycle: not_started → packing → packed → loaded → picked_up → at_warehouse.
  // When returnPhase is on, at_warehouse/back_on_site/unloaded also try the
  // return-leg mirror first (nextReturnUnitAction); a unit still mid-outbound
  // (not yet at_warehouse) keeps getting its normal outbound action either
  // way, so a project can have units on both legs at once. returnPhase
  // defaults to false so every existing call site (canAct(user, unit)) keeps
  // behaving exactly like before this feature.
  if (!user) return null
  const role = user.role
  if (returnPhase) {
    const ret = nextReturnUnitAction(role, unit.stage)
    if (ret) return ret
  }
  const admin = role === 'admin'
  switch (unit.stage) {
    case 'not_started': return admin || role === 'packer' ? { key: 'startPacking', label: 'Start packing' } : null
    case 'packing': return admin || role === 'packer' ? { key: 'finishPacking', label: 'Finish packing' } : null
    case 'packed': return admin || role === 'mover' ? { key: 'loadUnit', label: 'Load into a BigBox' } : null
    default: return null
  }
}

export function containerAction(user, cont, returnPhase = false) {
  // Container status lifecycle: empty → filling → full → picked_up → at_warehouse.
  // The swap (full → picked_up) and warehouse receive (picked_up → at_warehouse)
  // are batch/dedicated screens, not a single-container quick action, so they
  // return null here rather than a one-tap action — this only covers the
  // simple in-place transition (filling → full). Same story on the return
  // leg: dispatchReturn/deliverReturn are dedicated screens, so only
  // return_filling gets a quick action here. returnPhase defaults to false
  // so existing call sites are unaffected.
  if (!user) return null
  if (returnPhase) {
    const ret = nextReturnContainerAction(user.role, cont.status)
    if (ret) return ret
  }
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
  // Return leg (cool-to-warm palette, distinct from the outbound colors
  // above, so the board reads direction at a glance).
  return_filling: { label: 'Filling for return', color: '#0891b2' },
  return_full: { label: 'Full · ready for dispatch', color: '#0ea5e9' },
  return_transit: { label: 'In transit to site', color: '#6366f1' },
  back_on_site: { label: 'Back on site', color: '#22c55e' },
  returned_empty: { label: 'Returned, empty', color: '#15803d' },
}

export function overflowAction(user, item, returnPhase = false) {
  // Overflow lifecycle: identified → prepped → in_transit → at_warehouse.
  // Only the prepped → in_transit hop is a simple one-tap transition (no
  // form): identify/prep/receive all need a bit of input (description,
  // required photo, warehouse location) so they get dedicated forms in
  // Overflow.jsx instead of a quick action here, matching how
  // containerAction() only covers container's filling → full hop. Same
  // return-leg mirror pattern as canAct/containerAction; returnPhase
  // defaults to false so existing call sites are unaffected.
  if (!user) return null
  if (returnPhase) {
    const ret = nextReturnOverflowAction(user.role, item.stage)
    if (ret) return ret
  }
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
  // Return leg, same cool-to-warm palette as CONT_STATUS above.
  rt_transit: { label: 'In transit to site', color: '#6366f1' },
  returned: { label: 'Returned', color: '#15803d' },
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
