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
