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
// Casey's list, 2026-09-08, after day one. Extra-large and mirror cartons came
// out because the crew does not stock them; add them back here if that changes.
export const CARTON_TYPES = [
  { key: 'small', label: 'Small', hint: '1.5 cu ft, book box' },
  { key: 'medium', label: 'Medium', hint: '3.0 cu ft' },
  { key: 'large', label: 'Large', hint: '4.5 cu ft' },
  { key: 'dishpack', label: 'Dish pack', hint: 'china / glassware' },
  { key: 'wardrobe', label: 'Wardrobe', hint: 'hanging' },
]

// Everything that is not a box. Kept separate rather than folded in with the
// cartons, because a roll of tape is not a carton and must never inflate the
// box count that billing and restock read. Liv had to type "A roll of shrink
// wrap used" into the notes field on unit 906, which is exactly the gap this
// closes.
export const SUPPLY_TYPES = [
  { key: 'paper', label: 'Packing paper', hint: 'newsprint bundles' },
  { key: 'paperpad', label: 'Paper pad', hint: '3 ply furniture pad' },
  { key: 'tape', label: 'Tape', hint: 'rolls' },
  { key: 'plasticwrap', label: 'Plastic wrap', hint: 'stretch wrap rolls' },
]

// Total cartons across the breakdown. Tolerates missing keys, strings from
// form inputs, and junk, because it feeds a count shown to crew.
function sumOf(types, counts) {
  if (!counts) return 0
  return types.reduce((n, t) => {
    const v = Number(counts[t.key])
    return n + (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
  }, 0)
}

export function sumCartons(materials) {
  return sumOf(CARTON_TYPES, materials)
}

export function sumSupplies(supplies) {
  return sumOf(SUPPLY_TYPES, supplies)
}

// Form values -> the map stored on the unit. Drops blanks and zeroes so a
// unit doc carries only the box types it actually used.
function countsFromForm(types, form, prefix) {
  const out = {}
  for (const t of types) {
    const v = Number(form?.[`${prefix}${t.key}`])
    if (Number.isFinite(v) && v > 0) out[t.key] = Math.floor(v)
  }
  return out
}

export function cartonsFromForm(form) {
  return countsFromForm(CARTON_TYPES, form, 'carton_')
}

export function suppliesFromForm(form) {
  return countsFromForm(SUPPLY_TYPES, form, 'supply_')
}

// "12 small, 8 medium, 2 wardrobe" for the unit page and reports.
function summaryOf(types, counts) {
  if (!counts) return null
  const parts = types
    .filter((t) => Number(counts[t.key]) > 0)
    .map((t) => `${Math.floor(Number(counts[t.key]))} ${t.label.toLowerCase()}`)
  return parts.length ? parts.join(', ') : null
}

export function cartonSummary(materials) {
  return summaryOf(CARTON_TYPES, materials)
}

export function supplySummary(supplies) {
  return summaryOf(SUPPLY_TYPES, supplies)
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
  { key: 'door', label: 'Front door with the unit number' },
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
  { key: 'load_vaults', label: 'Vaults loaded', repeatable: true },
  // Counted off the truck at the end, not read back off the app. This only
  // catches a vault nobody logged if the mover answers from what is in front
  // of them, which is the same reason the sticker and the unit number are
  // asked blind.
  { key: 'load_vault_count', label: 'How many vaults' },
  // The empty apartment, once everything is out. This is the shot that answers
  // "was anything left behind" and "what condition was it left in", and it can
  // only be taken at one moment: after the last box goes and before the crew
  // walk away.
  { key: 'load_after_photo', label: 'Photo of the unit after loading, empty' },
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
  const recorded = normalizeCode(unit && unit.number)
  const typed = normalizeCode(entered)
  if (!recorded || !typed) return null
  return recorded === typed ? null : { recorded, entered: typed }
}

/* One vault, logged in three separate acts.
 *
 * The number, the door-open shot and the door-closed shot used to be a single
 * form the mover had to fill in one sitting. On a real load those moments are
 * far apart: you number the vault, you fill it, and only then can you shut it.
 * Asking for all three at once meant either standing there holding a
 * half-finished form or shooting both photos back to back, which makes the
 * closed-door shot worthless as a record of what actually went in.
 *
 * So each part saves on its own, under its own name and time, and a vault
 * counts as a record only when all three are in.
 */
export const VAULT_PARTS = [
  { key: 'open', label: 'Photo, door open', hint: 'Tap for a photo or video, door open' },
  { key: 'closed', label: 'Photo, door closed', hint: 'Tap for a photo or video, door closed' },
]

export function vaultComplete(vault) {
  return !!(vault && String(vault.number || '').trim()
    && vault.open && vault.open.url && vault.closed && vault.closed.url)
}

/* Vaults on a unit, including any written by a phone still on the old build.
 *
 * A crew phone left open does not reload, so after a deploy it keeps running
 * the bundle it launched with. Víctor was mid-load when the vault split
 * shipped: his app still wrote the old single-shot `boxes` shape, the rules no
 * longer allowed that key, and he got "Missing or insufficient permissions"
 * standing at a sealed vault.
 *
 * Re-allowing the key alone would have been worse than the error, because his
 * work would have landed somewhere nothing reads. So the old shape is mapped
 * forward here instead: one write, one record, visible everywhere.
 */
function fromLegacyBox(box) {
  const who = { uid: box.uid, userName: box.userName, at: box.at }
  return {
    number: box.number,
    containerId: box.containerId,
    uid: box.uid,
    userName: box.userName,
    at: box.at,
    ...(box.openUrl ? { open: { url: box.openUrl, kind: 'photo', ...who } } : {}),
    ...(box.closedUrl ? { closed: { url: box.closedUrl, kind: 'photo', ...who } } : {}),
    legacy: true,
  }
}

export function vaultsOf(unit) {
  const vaults = ((unit && unit.vaults) || []).filter(Boolean)
  const legacy = ((unit && unit.boxes) || []).filter(Boolean)
  if (legacy.length === 0) return vaults

  // A vault logged both ways keeps the new record: it is the richer one.
  const seen = new Set(vaults.map((v) => normalizeCode(v.number)))
  return [...vaults, ...legacy.filter((b) => !seen.has(normalizeCode(b.number))).map(fromLegacyBox)]
}

export function completeVaults(unit) {
  return vaultsOf(unit).filter(vaultComplete)
}

// How far through one vault the crew are. The number always counts as done: a
// vault does not exist on the unit until somebody types it.
export function vaultProgress(vault) {
  const shot = VAULT_PARTS.filter((part) => vault && vault[part.key] && vault[part.key].url).length
  return { done: 1 + shot, total: VAULT_PARTS.length + 1 }
}

// The last moment anybody touched this vault. Orders the list on the mover's
// card and tells the dashboard who is holding the unit right now.
export function vaultTouchedAt(vault) {
  if (!vault) return 0
  return VAULT_PARTS.reduce(
    (n, part) => Math.max(n, (vault[part.key] && vault[part.key].at) || 0),
    vault.at || 0,
  )
}

// A vault number is painted on the side of a physical container, so it is
// matched the way a person reads it: case and surrounding space are not part
// of the identity. "bb-1007 " and "BB-1007" are the same vault.
export function normalizeCode(n) {
  return String(n ?? '').trim().toUpperCase()
}

export const normalizeVaultNumber = normalizeCode

export function vaultNumberError(n, unit) {
  const v = normalizeVaultNumber(n)
  if (!v) return 'Enter the number on the side of the vault.'
  if (v.length < 2) return 'That looks too short to be a vault number.'
  if (vaultsOf(unit).some((b) => normalizeVaultNumber(b.number) === v)) {
    return `Vault ${v} is already logged on this unit.`
  }
  return null
}

// What the mover counted off the truck against what they actually logged.
// Same blind-check shape as stickerMismatch and unitNumberMismatch: null when
// the two agree, and the two numbers when they do not.
export function vaultCountMismatch(unit, typed) {
  // Number('') is 0, not NaN. Without this guard a blank answer reads as
  // "zero vaults" and flags a mismatch against a unit nobody has counted yet.
  if (typed == null || String(typed).trim() === '') return null
  const said = Number(typed)
  if (!Number.isFinite(said)) return null
  const logged = completeVaults(unit).length
  return said === logged ? null : { said, logged }
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
  // A vault that is started but not finished must keep the row open, so the
  // row reports against complete vaults while the count reports every vault
  // the crew have opened.
  const started = vaultsOf(unit)
  const done = completeVaults(unit).slice().sort((a, b) => vaultTouchedAt(a) - vaultTouchedAt(b))
  const first = done[0]
  return LOADING_STEPS.map((s) => {
    if (s.key === 'load_vaults') {
      return {
        ...s,
        done: done.length > 0 && done.length === started.length,
        by: first ? first.userName || null : null,
        at: first ? vaultTouchedAt(first) : null,
        count: done.length,
        started: started.length,
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
  if (!loadingChecklist(unit).every((s) => s.done)) return false
  // Every step can be ticked and the unit still be wrong: the mover counted
  // three vaults off the truck and logged two. That is the one gap this whole
  // count step exists to catch, so it also has to block the close.
  const steps = (unit && unit.steps) || {}
  return !vaultCountMismatch(unit, steps.load_vault_count && steps.load_vault_count.value)
}

// ---------------------------------------------------------------------------
// Warehouse receiving
// ---------------------------------------------------------------------------

// What the warehouse manager checks off as a unit's boxes come off the truck.
//
// All three are typed from what is physically in front of them, never
// confirmed against something the screen already shows. That is the whole
// point: this is the last moment anyone can catch a box that stayed on the
// truck, or a load that came out of the wrong apartment, while the truck is
// still in the yard and the crew who packed it are still reachable.
export const RECEIVING_STEPS = [
  { key: 'recv_number', label: 'Unit number' },
  { key: 'recv_lastname', label: "Tenant's last name" },
  { key: 'recv_vaults', label: 'Vault numbers received' },
]

export function lastNameMismatch(unit, entered) {
  const recorded = surnameOf(unit && unit.tenant)
  const typed = String(entered || '').trim()
  if (!recorded || recorded === '-' || !typed) return null
  return recorded.toLowerCase() === typed.toLowerCase() ? null : { recorded, entered: typed }
}

// Reconciles the boxes the warehouse actually received against the boxes the
// mover logged onto this unit. Reports both directions, because they mean
// different things: a missing box is still on the truck or still on site, an
// unexpected one belongs to another apartment and someone needs to find out
// whose before it is put away.
export function vaultSetDiff(unit, typedNumbers = []) {
  const expected = completeVaults(unit).map((b) => normalizeVaultNumber(b.number))
  const got = (typedNumbers || []).map(normalizeVaultNumber).filter(Boolean)
  const expectedSet = new Set(expected)
  const gotSet = new Set(got)
  const missing = expected.filter((n) => !gotSet.has(n))
  const unexpected = [...gotSet].filter((n) => !expectedSet.has(n))
  return { expected, got: [...gotSet], missing, unexpected, ok: missing.length === 0 && unexpected.length === 0 }
}

// Free text off a phone keyboard: people separate box numbers with commas,
// spaces, or new lines depending on the phone and the person.
export function parseVaultNumbers(text) {
  return String(text || '')
    .split(/[\s,;]+/)
    .map(normalizeVaultNumber)
    .filter(Boolean)
}

export function receivingChecklist(unit) {
  const steps = (unit && unit.steps) || {}
  return RECEIVING_STEPS.map((s) => {
    const raw = steps[s.key]
    if (!raw) return { ...s, done: false }
    return {
      ...s,
      done: true,
      by: raw.userName || null,
      at: typeof raw.at === 'number' ? raw.at : null,
      value: raw.value,
      matched: raw.matched,
    }
  })
}

export function receivingProgress(unit) {
  const list = receivingChecklist(unit)
  return { done: list.filter((s) => s.done).length, total: list.length }
}

export function receivingComplete(unit) {
  return receivingChecklist(unit).every((s) => s.done)
}

// A unit is the warehouse's to receive once the movers have finished loading
// it. Deliberately accepts 'loaded' as well as 'picked_up': the drivers do not
// use the app, so nothing ever marks a unit picked up, and waiting for that
// would strand every unit one step short of the warehouse forever. The driver
// step is left in place for the day someone does use it.
export function readyToReceive(unit) {
  return !!unit && (unit.stage === 'loaded' || unit.stage === 'picked_up')
}
