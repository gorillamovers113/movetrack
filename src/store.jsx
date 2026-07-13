import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react'
import { buildSeed, stageOf } from './seed.js'

const KEY = 'movetrack_state_v2'
const SESSION_KEY = 'movetrack_session_v1'

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* corrupted state falls through to reseed */ }
  return buildSeed()
}

let evCounter = Date.now() % 100000

function makeEvent(state, userId, type, action, extra = {}) {
  const u = state.users.find((x) => x.id === userId)
  return { id: `ev-live-${++evCounter}`, ts: Date.now(), userId, userName: u ? u.name : 'Unknown', role: u ? u.role || 'pending' : '?', type, action, ...extra }
}

function reducer(state, msg) {
  const { type, p } = msg
  const log = (userId, evType, action, extra) => [...state.events, makeEvent(state, userId, evType, action, extra)]
  const upUnit = (unitId, patch) => state.units.map((u) => (u.id === unitId ? { ...u, ...patch } : u))
  const upContainer = (contId, patch) => state.containers.map((c) => (c.id === contId ? { ...c, ...patch } : c))

  switch (type) {
    case 'reset':
      return buildSeed()

    case 'register': {
      const id = `u-reg-${Date.now()}`
      const user = { id, name: p.name, email: p.email, role: null, status: 'pending', requestedAt: Date.now(), via: p.via || 'email' }
      return { ...state, users: [...state.users, user], events: [...state.events, makeEvent({ users: [...state.users, user] }, id, 'system', `New account request: ${p.name} (${p.email}) — awaiting admin approval`)] }
    }
    case 'approveUser': {
      const users = state.users.map((u) => (u.id === p.userId ? { ...u, status: 'active', role: p.role } : u))
      const target = state.users.find((u) => u.id === p.userId)
      return { ...state, users, events: log(p.byId, 'system', `Approved ${target.name} as ${p.role}`) }
    }
    case 'denyUser': {
      const target = state.users.find((u) => u.id === p.userId)
      return { ...state, users: state.users.filter((u) => u.id !== p.userId), events: log(p.byId, 'system', `Denied account request from ${target.name}`) }
    }
    case 'changeRole': {
      const target = state.users.find((u) => u.id === p.userId)
      const users = state.users.map((u) => (u.id === p.userId ? { ...u, role: p.role } : u))
      return { ...state, users, events: log(p.byId, 'system', `Changed ${target.name}'s role to ${p.role}`) }
    }

    case 'startPacking': {
      const unit = state.units.find((u) => u.id === p.unitId)
      return {
        ...state,
        units: upUnit(p.unitId, { stage: 'packing', crew: { ...unit.crew, packer: p.byId } }),
        events: log(p.byId, 'stage', `Started packing unit ${unit.number}`, { unitId: unit.id, from: unit.stage, to: 'packing' }),
      }
    }
    case 'finishPacking': {
      const unit = state.units.find((u) => u.id === p.unitId)
      return {
        ...state,
        units: upUnit(p.unitId, { stage: 'packed', boxCount: p.boxCount }),
        events: log(p.byId, 'stage', `Finished packing unit ${unit.number} — ${p.boxCount} boxes sealed & labeled`, { unitId: unit.id, from: 'packing', to: 'packed', media: p.media }),
      }
    }
    case 'loadUnit': {
      const unit = state.units.find((u) => u.id === p.unitId)
      let cont = state.containers.find((c) => c.number.toUpperCase() === p.containerNumber.toUpperCase())
      let containers = state.containers
      if (!cont) {
        cont = { id: `cont-new-${Date.now()}`, number: p.containerNumber.toUpperCase(), location: 'site', bay: null, unitIds: [] }
        containers = [...containers, cont]
      }
      containers = containers.map((c) => (c.id === cont.id ? { ...c, location: 'site', unitIds: [...new Set([...c.unitIds, unit.id])] } : c))
      const mismatch = unit.boxCount != null && p.boxCount !== unit.boxCount
      let events = log(p.byId, 'stage', `Loaded unit ${unit.number} into container ${cont.number} — ${p.boxCount} of ${unit.boxCount ?? p.boxCount} boxes verified`, { unitId: unit.id, containerId: cont.id, from: unit.stage, to: 'staged', media: p.media })
      let flag = unit.flag
      if (mismatch) {
        const by = state.users.find((u) => u.id === p.byId)
        flag = { message: `Box count mismatch at load: ${p.boxCount} loaded vs ${unit.boxCount} packed. Recount pending.`, ts: Date.now(), by: by.name, open: true }
        events = [...events, makeEvent(state, p.byId, 'flag', `FLAG raised on unit ${unit.number}: box count mismatch (${p.boxCount}/${unit.boxCount})`, { unitId: unit.id })]
      }
      return {
        ...state,
        containers,
        units: upUnit(p.unitId, { stage: 'staged', containerIds: [...new Set([...unit.containerIds, cont.id])], crew: { ...unit.crew, mover: p.byId }, flag }),
        events,
      }
    }
    case 'containerMove': {
      // Driver moves a whole container; every unit inside moves with it.
      const cont = state.containers.find((c) => c.id === p.containerId)
      const map = {
        pickup: { loc: 'transit', to: 'in_transit', msg: (c) => `Container ${c.number} picked up from site` },
        checkin: { loc: 'warehouse', to: 'warehouse', msg: (c) => `Container ${c.number} checked into warehouse — ${p.bay || 'bay assigned'}` },
        dispatch: { loc: 'transit-return', to: 'return_transit', msg: (c) => `Container ${c.number} dispatched back to site` },
        arrive: { loc: 'site-return', to: 'unloading', msg: (c) => `Container ${c.number} arrived back on site — ready to unload` },
      }[p.move]
      const inside = state.units.filter((u) => cont.unitIds.includes(u.id))
      const unitNums = inside.map((u) => u.number).join(', ')
      const expected = inside.reduce((n, u) => n + (u.boxCount || 0), 0)
      const units = state.units.map((u) => (cont.unitIds.includes(u.id) && u.stage !== 'complete' ? { ...u, stage: map.to } : u))
      const verified = p.verifiedBoxes != null ? ` — ${p.verifiedBoxes} boxes verified on board` : ''
      let events = log(p.byId, 'stage', `${map.msg(cont)} (units ${unitNums})${verified}`, { containerId: cont.id, media: p.media })
      let flag = cont.flag
      if (p.verifiedBoxes != null && expected > 0 && p.verifiedBoxes !== expected) {
        const by = state.users.find((u) => u.id === p.byId)
        flag = { message: `Box count mismatch at ${p.move === 'pickup' ? 'pickup' : 'warehouse check-in'}: ${p.verifiedBoxes} counted vs ${expected} on record. Recount pending.`, ts: Date.now(), by: by.name, open: true }
        events = [...events, makeEvent(state, p.byId, 'flag', `FLAG raised on container ${cont.number}: box count mismatch (${p.verifiedBoxes}/${expected})`, { containerId: cont.id })]
      }
      return {
        ...state,
        containers: upContainer(p.containerId, { location: map.loc, bay: p.move === 'checkin' ? p.bay || cont.bay : cont.bay, flag }),
        units,
        events,
      }
    }
    case 'editUnit': {
      const unit = state.units.find((u) => u.id === p.unitId)
      const changed = Object.keys(p.patch).filter((k) => p.patch[k] !== unit[k])
      return {
        ...state,
        units: upUnit(p.unitId, p.patch),
        events: log(p.byId, 'system', `Admin edited unit ${unit.number} details (${changed.join(', ') || 'no changes'})`, { unitId: unit.id }),
      }
    }
    case 'resolveContainerFlag': {
      const cont = state.containers.find((c) => c.id === p.containerId)
      return {
        ...state,
        containers: upContainer(p.containerId, { flag: { ...cont.flag, open: false } }),
        events: log(p.byId, 'flag', `FLAG resolved on container ${cont.number}: ${p.note}`, { containerId: cont.id }),
      }
    }
    case 'finishUnload': {
      const unit = state.units.find((u) => u.id === p.unitId)
      return {
        ...state,
        units: upUnit(p.unitId, { stage: 'unpacking' }),
        events: log(p.byId, 'stage', `Unloaded unit ${unit.number} back into the unit — ${p.boxCount ?? unit.boxCount ?? '?'} boxes returned`, { unitId: unit.id, from: 'unloading', to: 'unpacking', media: p.media }),
      }
    }
    case 'signOff': {
      const unit = state.units.find((u) => u.id === p.unitId)
      return {
        ...state,
        units: upUnit(p.unitId, { stage: 'complete' }),
        events: log(p.byId, 'stage', `Unit ${unit.number} unpacked & signed off — complete`, { unitId: unit.id, from: 'unpacking', to: 'complete', media: p.media }),
      }
    }

    case 'addMedia': {
      const unit = state.units.find((u) => u.id === p.unitId)
      const n = p.media.length
      const kinds = p.media.some((m) => m.kind === 'video') ? (p.media.every((m) => m.kind === 'video') ? 'video' + (n > 1 ? 's' : '') : 'photos & video') : 'photo' + (n > 1 ? 's' : '')
      return { ...state, events: log(p.byId, 'media', `Added ${n} ${kinds}${p.note ? ' — ' + p.note : ''} (unit ${unit.number})`, { unitId: unit.id, media: p.media }) }
    }
    case 'addNote': {
      const extra = p.unitId ? { unitId: p.unitId } : { containerId: p.containerId }
      return { ...state, events: log(p.byId, 'note', p.text, extra) }
    }
    case 'resolveFlag': {
      const unit = state.units.find((u) => u.id === p.unitId)
      return {
        ...state,
        units: upUnit(p.unitId, { flag: { ...unit.flag, open: false } }),
        events: log(p.byId, 'flag', `FLAG resolved on unit ${unit.number}: ${p.note}`, { unitId: unit.id }),
      }
    }
    default:
      return state
  }
}

const Ctx = createContext(null)

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, load)
  const [session, setSession] = React.useState(() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) } catch { return null }
  })

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* quota exceeded: keep running in memory */ }
    }, 300)
    return () => clearTimeout(t)
  }, [state])

  const currentUser = state.users.find((u) => u.id === session) || null
  const api = useMemo(() => ({
    state,
    dispatch,
    currentUser,
    login: (userId) => { setSession(userId); try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(userId)) } catch { /* ignore */ } },
    logout: () => { setSession(null); try { sessionStorage.removeItem(SESSION_KEY) } catch { /* ignore */ } },
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
  if (!user) return null
  const role = user.role
  const admin = role === 'admin'
  switch (unit.stage) {
    case 'not_started': return admin || role === 'packer' ? { key: 'startPacking', label: 'Start packing' } : null
    case 'packing': return admin || role === 'packer' ? { key: 'finishPacking', label: 'Finish packing' } : null
    case 'packed': return admin || role === 'mover' ? { key: 'loadUnit', label: 'Load into container' } : null
    case 'unloading': return admin || role === 'mover' ? { key: 'finishUnload', label: 'Finish unloading' } : null
    case 'unpacking': return admin || role === 'packer' ? { key: 'signOff', label: 'Unpacked — sign off' } : null
    default: return null
  }
}

export function containerAction(user, cont) {
  if (!user || !['admin', 'driver'].includes(user.role)) return null
  if (!cont.unitIds.length) return null
  switch (cont.location) {
    case 'site': return { move: 'pickup', label: 'Pick up from site' }
    case 'transit': return { move: 'checkin', label: 'Check into warehouse' }
    case 'warehouse': return { move: 'dispatch', label: 'Dispatch back to site' }
    case 'transit-return': return { move: 'arrive', label: 'Arrived on site' }
    default: return null
  }
}

export const CONT_LOC = {
  unassigned: { label: 'Not in use', color: '#8a93a2' },
  site: { label: 'On site', color: '#8b5cf6' },
  transit: { label: 'In transit', color: '#f97316' },
  warehouse: { label: 'In warehouse', color: '#3b82f6' },
  'transit-return': { label: 'Returning', color: '#ec4899' },
  'site-return': { label: 'Back on site', color: '#6366f1' },
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
