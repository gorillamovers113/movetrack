export const STAGES = ['not_started', 'packing', 'packed', 'loaded', 'picked_up', 'at_warehouse']

export function nextStage(stage) {
  const i = STAGES.indexOf(stage)
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null
}

export function boxMismatch(expected, counted) {
  return typeof expected === 'number' && typeof counted === 'number' && expected !== counted
}

export function makeEvent(user, type, action, extra = {}) {
  return { ts: Date.now(), uid: user.uid, userName: user.userName || user.name || 'Unknown', role: user.role || 'pending', type, action, ...extra }
}

// Overflow items (Gorilla-transported, too big for a BigBox container) run a
// separate, shorter one-way lifecycle than units/containers. See
// docs/superpowers/specs/2026-08-26-overflow-items-design.md.
export const OVERFLOW_STAGES = ['identified', 'prepped', 'in_transit', 'at_warehouse']

export function nextOverflowStage(stage) {
  const i = OVERFLOW_STAGES.indexOf(stage)
  return i >= 0 && i < OVERFLOW_STAGES.length - 1 ? OVERFLOW_STAGES[i + 1] : null
}

// Return phase (docs/superpowers/specs/2026-08-26-return-phase-design.md): a
// unit continues forward from at_warehouse, walking the same steps backward.
// at_warehouse is shared with the outbound STAGES array on purpose (it is
// both the outbound terminal stage and the return starting point).
export const RETURN_STAGES = ['at_warehouse', 'return_loaded', 'return_transit', 'back_on_site', 'unloaded', 'unpacked']

export function nextReturnStage(stage) {
  const i = RETURN_STAGES.indexOf(stage)
  return i >= 0 && i < RETURN_STAGES.length - 1 ? RETURN_STAGES[i + 1] : null
}

// Return-leg mirror of OVERFLOW_STAGES: at_warehouse is shared with the
// outbound overflow lifecycle (its terminal stage, and the return start).
export const RETURN_OVERFLOW_STAGES = ['at_warehouse', 'rt_transit', 'returned']

export function nextReturnOverflowStage(stage) {
  const i = RETURN_OVERFLOW_STAGES.indexOf(stage)
  return i >= 0 && i < RETURN_OVERFLOW_STAGES.length - 1 ? RETURN_OVERFLOW_STAGES[i + 1] : null
}

// Pure "what's the next return action, and who can do it" tables, mirroring
// the outbound canAct/containerAction/overflowAction switches in store.jsx
// one level down so they're unit-testable without Firebase. store.jsx's
// canAct/containerAction/overflowAction call these first (when returnPhase is
// on) and fall back to the outbound switch otherwise.
//
// Only stages that get a single-tap, per-item action are covered here, same
// as the outbound switches: return_full/return_transit (container-level,
// form-heavy: dispatchReturn/deliverReturn) mirror how outbound's
// full/picked_up return null from containerAction (handled by dedicated
// screens, not a quick action) and are intentionally left uncovered.
export function nextReturnUnitAction(role, stage) {
  const admin = role === 'admin'
  switch (stage) {
    case 'at_warehouse': return admin || role === 'warehouse' ? { key: 'loadForReturn', label: 'Load for return' } : null
    case 'back_on_site': return admin || role === 'mover' ? { key: 'unloadReturn', label: 'Unload into apartment' } : null
    case 'unloaded': return admin || role === 'packer' ? { key: 'unpackUnit', label: 'Unpack' } : null
    default: return null
  }
}

export function nextReturnContainerAction(role, status) {
  const admin = role === 'admin'
  switch (status) {
    case 'return_filling': return admin || role === 'warehouse' ? { key: 'markReturnFull', label: 'Mark full, ready for dispatch' } : null
    default: return null
  }
}

export function nextReturnOverflowAction(role, stage) {
  const admin = role === 'admin'
  switch (stage) {
    case 'at_warehouse': return admin || role === 'mover' ? { key: 'transportOverflowBack', label: 'Load & transport back to site' } : null
    case 'rt_transit': return admin || role === 'mover' || role === 'packer' ? { key: 'returnOverflow', label: 'Unwrap & place back' } : null
    default: return null
  }
}

// Blind container-number check (docs/superpowers/specs/2026-08-26-return-phase-design.md,
// "Blind container-number check on deliverReturn"). The mover reads the
// number off the physical container, cold, and types it in; nothing in the
// UI shows or pre-fills any container numbers, so a genuine misread gets
// caught instead of silently rubber-stamped. Matches case-insensitively and
// trims whitespace (a typed "bb-1007 " should still match "BB-1007"), and
// only counts a hit if the container is also in the expected status, so a
// container that already moved on (or one still mid-transit for a different
// leg) can't be accidentally confirmed. Returns the single matching
// container, or null when nothing qualifies. Pure and general on purpose:
// this same helper is meant to be reused for the outbound warehouse-receive
// blind check (a separate task), not just the return-leg deliver step.
export function matchContainerByNumber(containers, typedNumber, expectedStatus) {
  const typed = String(typedNumber ?? '').trim().toLowerCase()
  if (!typed) return null
  return (containers || []).find((c) => c.status === expectedStatus && String(c.number ?? '').trim().toLowerCase() === typed) || null
}

// The surname to show on a unit tile. The tile is small, so it carries one
// word, and the crew reads it against a door: it has to be the family name.
//
// This takes the LAST word, not the second. Real tenant lists carry middle
// initials and multi-word names, and taking word two rendered "Wendell P.
// Round" as "P." and "Fang Jing Yang" as "Jing". A single-word entry (a
// placeholder like VACANT) falls through to itself.
export function surnameOf(tenant) {
  const parts = String(tenant || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '-'
  return parts[parts.length - 1]
}

// Inventory sticker colours. Each unit gets its own roll so a stray box found
// in a stairwell can be traced to an apartment by colour alone, before anyone
// reads a number. A fixed palette beats free text on a phone: one tap, no
// spelling variants ("lt blue" vs "light blue") to reconcile in a report.
export const STICKER_COLORS = [
  { name: 'Red', hex: '#dc2626' },
  { name: 'Orange', hex: '#ea580c' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Purple', hex: '#7c3aed' },
  { name: 'Pink', hex: '#db2777' },
  { name: 'White', hex: '#f8fafc' },
]

export function stickerHex(name) {
  return STICKER_COLORS.find((c) => c.name === name)?.hex || null
}

// "1-42" for display, or null when the unit has no range recorded yet.
export function inventoryRangeLabel(unit) {
  const from = unit?.inventoryFrom
  const to = unit?.inventoryTo
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return from === to ? String(from) : `${from}-${to}`
}

// Validates the range a packer types when finishing a unit. Returns an error
// string to show, or null when it is good.
export function inventoryRangeError(from, to) {
  const f = Number(from)
  const t = Number(to)
  if (!Number.isInteger(f) || !Number.isInteger(t)) return 'Enter the first and last inventory number.'
  if (f < 1 || t < 1) return 'Inventory numbers start at 1.'
  if (t < f) return 'The last number cannot be lower than the first.'
  return null
}

// Ranges are meant to be unique per unit: two apartments sharing sticker
// numbers is exactly the mix-up the numbers exist to prevent. Returns the
// units whose recorded range overlaps this one, ignoring the unit being
// edited. Colour is part of the identity, since the same numbers on a
// different colour roll are not a collision.
export function overlappingUnits(units, { unitId, stickerColor, from, to }) {
  const f = Number(from)
  const t = Number(to)
  if (!Number.isInteger(f) || !Number.isInteger(t)) return []
  return (units || []).filter((u) => {
    if (!u || u.id === unitId) return false
    if (!Number.isFinite(u.inventoryFrom) || !Number.isFinite(u.inventoryTo)) return false
    if (stickerColor && u.stickerColor && u.stickerColor !== stickerColor) return false
    return f <= u.inventoryTo && t >= u.inventoryFrom
  })
}

// Carton breakdown a packer submits when they finish a unit. `pieces` stays
// the total count of everything handled (furniture included, since that is
// what gets verified against at load); this is specifically how many of each
// box went in, which is what materials billing and restock run off.
export const CARTON_TYPES = [
  { key: 'small', label: 'Small', hint: '1.5 cu ft, book box' },
  { key: 'medium', label: 'Medium', hint: '3.0 cu ft' },
  { key: 'large', label: 'Large', hint: '4.5 cu ft' },
  { key: 'xlarge', label: 'Extra large', hint: '6.0 cu ft' },
  { key: 'wardrobe', label: 'Wardrobe', hint: 'hanging' },
  { key: 'dishpack', label: 'Dish pack', hint: 'china / glassware' },
  { key: 'mirror', label: 'Mirror / picture', hint: 'flat, framed art' },
]

// Total cartons across the breakdown. Tolerates missing keys, strings from
// form inputs, and junk, because it feeds a count shown to crew.
export function sumCartons(materials) {
  if (!materials) return 0
  return CARTON_TYPES.reduce((n, t) => {
    const v = Number(materials[t.key])
    return n + (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
  }, 0)
}

// Form values -> the map stored on the unit. Drops blanks and zeroes so a
// unit doc carries only the box types it actually used.
export function cartonsFromForm(form) {
  const out = {}
  for (const t of CARTON_TYPES) {
    const v = Number(form?.[`carton_${t.key}`])
    if (Number.isFinite(v) && v > 0) out[t.key] = Math.floor(v)
  }
  return out
}

// "12 small, 8 medium, 2 wardrobe" for the unit page and reports.
export function cartonSummary(materials) {
  if (!materials) return null
  const parts = CARTON_TYPES
    .filter((t) => Number(materials[t.key]) > 0)
    .map((t) => `${Math.floor(Number(materials[t.key]))} ${t.label.toLowerCase()}`)
  return parts.length ? parts.join(', ') : null
}

// The six things a unit needs before it is genuinely packed, in the order a
// packer does them. Casey's list, made visible: it was previously enforced
// only as validation messages inside two separate modals, so a packer could
// not see what was still outstanding without trying to submit.
//
// Each item is proved by something actually on the unit doc, never by a
// "done" flag someone could tick. Media carries a `phase` so a front-door
// shot is distinguishable from a room shot from the packed-and-ready shot.
export const PACKING_STEPS = [
  { key: 'door', label: 'Front door photo with the unit number' },
  { key: 'rooms', label: 'Photos or video of the rooms' },
  { key: 'sticker', label: 'Inventory sticker colour' },
  { key: 'inventory', label: 'Inventory sheet photo' },
  { key: 'numbers', label: 'Inventory numbers' },
  { key: 'materials', label: 'Packing materials used' },
  { key: 'packed', label: 'Photos or video, packed and ready' },
  // Optional, and deliberately last: anything worth telling the office about
  // this apartment. A unit is finished without it, so it never blocks a
  // packer, but when it is filled in it is attributed and timed like the
  // rest. Its text lives in the activity log as a note event.
  { key: 'notes', label: 'Notes', optional: true },
]

// The seven that actually have to happen. Optional items are shown on the
// checklist and attributed when done, but never gate a unit's progress.
export const REQUIRED_STEPS = PACKING_STEPS.filter((s) => !s.optional)

// Each item reports WHO completed it and WHEN.
//
// The primary source is unit.steps, written by the packer as each item is
// ticked off: one write per item, so each carries the name and time of the
// person who actually did that item, not of whoever happened to finish the
// unit. A packer who shoots the door at 8:10 and a mate who shoots the packed
// rooms at 11:40 each show against their own line.
//
// Everything below unit.steps is a fallback for units packed before per-item
// ticking existed, where the only evidence is the media (which carries
// uid/userName/ts) and the two stage events. Those units still read correctly
// instead of showing an empty checklist.
export function packingChecklist(unit, events = []) {
  const media = (unit && unit.media) || []
  const steps = (unit && unit.steps) || {}
  const recorded = (key) => {
    const s = steps[key]
    if (!s) return null
    return { done: true, by: s.userName || null, at: typeof s.at === 'number' ? s.at : null }
  }
  const stageEvent = (to) => (events || [])
    .filter((e) => e && e.type === 'stage' && e.to === to && typeof e.ts === 'number')
    .sort((a, b) => a.ts - b.ts)[0] || null

  // Earliest item of a phase: the moment the task was actually completed,
  // not whenever someone last added another shot.
  const firstOfPhase = (phase) => media
    .filter((m) => m && m.phase === phase && typeof m.ts === 'number')
    .sort((a, b) => a.ts - b.ts)[0]
    || media.find((m) => m && m.phase === phase)
    || null

  const fromMedia = (phase) => {
    const m = firstOfPhase(phase)
    return m ? { done: true, by: m.userName || null, at: typeof m.ts === 'number' ? m.ts : null } : { done: false }
  }
  const fromEvent = (to, done) => {
    if (!done) return { done: false }
    const e = stageEvent(to)
    return { done: true, by: e ? e.userName || null : null, at: e ? e.ts : null }
  }

  const results = {
    door: recorded('door') || fromMedia('door'),
    rooms: recorded('rooms') || fromMedia('rooms'),
    sticker: recorded('sticker') || fromEvent('packing', !!(unit && unit.stickerColor)),
    inventory: recorded('inventory') || fromMedia('inventory'),
    numbers: recorded('numbers') || fromEvent('packed', Number.isFinite(unit && unit.inventoryFrom) && Number.isFinite(unit && unit.inventoryTo)),
    materials: recorded('materials') || fromEvent('packed', sumCartons(unit && unit.materials) > 0),
    packed: recorded('packed') || fromMedia('packed'),
    // Notes has no evidence to derive from: it is done when a packer says it
    // is, which is exactly what the recorded tick means.
    notes: recorded('notes'),
  }
  return PACKING_STEPS.map((s) => ({ ...s, ...(results[s.key] || { done: false }) }))
}

// The item a packer should do next: the first one still outstanding, in
// checklist order. Drives the big primary button on the unit page, so a packer
// standing in a doorway is told the next thing rather than having to choose.
export function nextPackingStep(unit, events = []) {
  return packingChecklist(unit, events).find((s) => !s.done && !s.optional) || null
}

// True once every item is ticked. This is what promotes the unit to "packed":
// the unit is finished because the checklist is finished, not because someone
// pressed a separate Finish button that could disagree with it.
export function packingComplete(unit, events = []) {
  return packingChecklist(unit, events).every((s) => s.done || s.optional)
}

// Would ticking `key` be the thing that finishes this unit?
//
// The seven required items may be done in any order, skipping around as the
// packer works, so "finished" cannot mean "reached the last item in the list".
// It means every required item is now accounted for, whichever one happened to
// be last. This is the rule the unit's stage follows, kept here as a pure
// function so it is testable rather than buried in a Firestore write.
export function wouldCompletePacking(unit, events = [], key) {
  const done = new Set(packingChecklist(unit, events).filter((s) => s.done).map((s) => s.key))
  done.add(key)
  return REQUIRED_STEPS.every((s) => done.has(s.key))
}

// Progress counts only the required items, so a unit reads 7/7 when it is
// genuinely finished rather than 7/8 forever because nobody had anything to
// say about it.
export function packingProgress(unit, events = []) {
  const list = packingChecklist(unit, events).filter((s) => !s.optional)
  return { done: list.filter((s) => s.done).length, total: list.length }
}

// ---------------------------------------------------------------------------
// Mover load-out
// ---------------------------------------------------------------------------

// What a mover records against one apartment. Same shape as the packing
// checklist so the unit page reads the same way for both roles, with one
// difference that matters: the boxes item is not one task, it is a repeatable
// one. A unit averages about two and a half BigBoxes, so "log the box" happens
// more than once and cannot be a single tick.
export const LOADING_STEPS = [
  { key: 'load_unit_photo', label: 'Photo of the unit, fully packed' },
  { key: 'load_sticker', label: 'Inventory sticker colour' },
  { key: 'load_number', label: 'Unit number' },
  { key: 'load_boxes', label: 'Boxes loaded, logged and photographed', repeatable: true },
]

// The colour and the number are entered by the mover and checked against what
// the packer recorded, rather than shown for them to agree with. A mover who
// is handed the wrong apartment's boxes types the colour they can actually
// see on the cartons, and the mismatch surfaces there and then, at the last
// moment anyone is standing in front of both the boxes and the door.
//
// A mismatch warns and flags, it never blocks. The mover is on site and the
// app is not: they may well be right and the packer wrong.
export function stickerMismatch(unit, entered) {
  const recorded = unit && unit.stickerColor
  const typed = String(entered || '').trim()
  if (!recorded || !typed) return null
  return recorded.toLowerCase() === typed.toLowerCase() ? null : { recorded, entered: typed }
}

export function unitNumberMismatch(unit, entered) {
  const recorded = normalizeBoxNumber(unit && unit.number)
  const typed = normalizeBoxNumber(entered)
  if (!recorded || !typed) return null
  return recorded === typed ? null : { recorded, entered: typed }
}

// One BigBox as the mover records it: the number off the side of the box, a
// shot with the door open showing what went in, and a shot with it closed.
// Both photos are required before the box counts, because the open-door shot
// is the only record of what is inside and the closed-door shot is what shows
// it was sealed in that state.
export function boxComplete(box) {
  return !!(box && String(box.number || '').trim() && box.openUrl && box.closedUrl)
}

export function boxesOf(unit) {
  return ((unit && unit.boxes) || []).filter(Boolean)
}

export function completeBoxes(unit) {
  return boxesOf(unit).filter(boxComplete)
}

// A box number is written on the side of a physical container, so it is
// matched the way a person would read it: case and surrounding space are not
// part of the identity. "bb-1007 " and "BB-1007" are the same box.
export function normalizeBoxNumber(n) {
  return String(n ?? '').trim().toUpperCase()
}

export function boxNumberError(n, unit) {
  const v = normalizeBoxNumber(n)
  if (!v) return 'Enter the number on the side of the box.'
  if (v.length < 2) return 'That looks too short to be a box number.'
  if (boxesOf(unit).some((b) => normalizeBoxNumber(b.number) === v)) {
    return `Box ${v} is already logged on this unit.`
  }
  return null
}

// The mover's checklist, mirroring packingChecklist: done, by whom, when.
// The photo item comes from unit.steps like every packer item. The boxes item
// is done once at least one box is fully logged, and reports the person and
// time of the FIRST completed box, since that is the moment the item was
// genuinely satisfied.
export function loadingChecklist(unit) {
  const steps = (unit && unit.steps) || {}
  const recorded = (key) => {
    const s = steps[key]
    return s ? { done: true, by: s.userName || null, at: typeof s.at === 'number' ? s.at : null } : { done: false }
  }
  const boxes = completeBoxes(unit).slice().sort((a, b) => (a.at || 0) - (b.at || 0))
  const first = boxes[0]
  return LOADING_STEPS.map((s) => {
    if (s.key === 'load_boxes') {
      return {
        ...s,
        done: boxes.length > 0,
        by: first ? first.userName || null : null,
        at: first ? first.at || null : null,
        count: boxes.length,
      }
    }
    const r = recorded(s.key)
    const raw = steps[s.key]
    return { ...s, ...r, value: raw ? raw.value : undefined, matched: raw ? raw.matched : undefined }
  })
}

export function loadingProgress(unit) {
  const list = loadingChecklist(unit)
  return { done: list.filter((s) => s.done).length, total: list.length }
}

// A unit is ready to hand to the driver once the photo is taken and at least
// one box is fully logged. The mover still says when they are finished, since
// only they know whether another box is coming.
export function loadingComplete(unit) {
  return loadingChecklist(unit).every((s) => s.done)
}
