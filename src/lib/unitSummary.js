/* Everything known about one apartment, gathered into one shape.
 *
 * Pure: no Firebase, no Date.now(). The moment is passed in, same as
 * timeclock.js, so this is testable and cannot drift with the machine clock.
 *
 * Two numbers here look like they should agree and never will:
 *
 *   elapsed  is wall clock, first touch to last.
 *   labour   is the sum of what each person was checked into the unit for.
 *
 * Two packers working three hours together is three hours elapsed and six
 * hours of labour. Labour is the one that costs money, elapsed is the one that
 * answers "how long was the apartment tied up". Reporting either alone gives a
 * wrong answer to half the questions, so both are here and both are labelled.
 */
import {
  PACKING_STEPS, LOADING_STEPS, vaultsOf, vaultTouchedAt, completeVaults,
  sumCartons, cartonSummary, sumSupplies, supplySummary, inventoryRangeLabel,
} from './mutations.js'
import { sessionMs } from './timeclock.js'

// A person's role at the time, preferring what the session recorded. Sessions
// written before roles were stamped fall back to the roster, which is right
// unless somebody changed role mid-job, and stamping the new ones means that
// gap closes on its own rather than growing.
export function sessionRole(session, users = []) {
  if (session && session.role) return session.role
  const u = (users || []).find((x) => x && (x.uid || x.id) === (session && session.uid))
  return (u && u.role) || null
}

function stamps(unit, keys) {
  const steps = (unit && unit.steps) || {}
  return keys
    .map((k) => steps[k] && steps[k].at)
    .filter((n) => typeof n === 'number' && n > 0)
}

/* When an open session stops counting.
 *
 * Opening a unit checks you into it, and you stay checked in until you open
 * another one or clock out. Clocking out closes the session, so in the normal
 * case this changes nothing. It matters when a day ends some other way: an
 * admin closing somebody's entry, or a phone that went flat before anyone
 * tapped clock out. Without this an abandoned session keeps accruing against
 * the apartment forever, and the unit's cost quietly grows overnight.
 */
export function sessionEndsBy(session, timeEntries, now) {
  if (!session || session.endedAt) return now
  const entry = (timeEntries || []).find((e) => e && e.uid === session.uid && e.day === session.day)
  if (entry && entry.clockOut) return Math.min(now, entry.clockOut)
  return now
}

// Labour on one unit, split by the crew's role and broken down per person.
function labourFor(sessions, unitId, users, roles, now, timeEntries) {
  const by = new Map()
  let totalMs = 0
  for (const s of sessions || []) {
    if (!s || s.unitId !== unitId) continue
    if (!roles.includes(sessionRole(s, users))) continue
    const ms = sessionMs(s, sessionEndsBy(s, timeEntries, now))
    totalMs += ms
    const row = by.get(s.uid) || { uid: s.uid, userName: s.userName || 'Crew', ms: 0, sessions: 0, open: false }
    row.ms += ms
    row.sessions += 1
    if (!s.endedAt) row.open = true
    by.set(s.uid, row)
  }
  return { totalMs, people: [...by.values()].sort((a, b) => b.ms - a.ms) }
}

function span(list) {
  if (list.length === 0) return { startedAt: null, finishedAt: null, elapsedMs: 0 }
  const startedAt = Math.min(...list)
  const finishedAt = Math.max(...list)
  return { startedAt, finishedAt, elapsedMs: finishedAt - startedAt }
}

/* The packing phase: when it ran, and who spent what on it.
 *
 * The recorded times win when they are there, because packStart and packEnd
 * are written at the moment the phase actually opened and closed. Step stamps
 * are the fallback, which is what makes this work on a unit packed before
 * those times were being written. */
export function packingPhase(unit, sessions, users, now = 0, timeEntries = []) {
  const times = (unit && unit.times) || {}
  const derived = span(stamps(unit, PACKING_STEPS.map((s) => s.key)))
  const startedAt = times.packStart || derived.startedAt
  const finishedAt = times.packEnd || derived.finishedAt
  return {
    startedAt: startedAt || null,
    finishedAt: finishedAt || null,
    elapsedMs: startedAt && finishedAt && finishedAt > startedAt ? finishedAt - startedAt : 0,
    ...labourFor(sessions, unit && unit.id, users, ['packer'], now, timeEntries),
  }
}

/* The loading phase.
 *
 * Nothing writes a loadStart or loadEnd, so both come from the stamps the
 * mover leaves: the checklist items, plus every vault and every door photo.
 * That is not a shortcut. The last of those IS the end of loading, because the
 * empty-apartment shot is by definition the final act, and deriving it means
 * the number is right for units loaded before anybody thought to record it. */
export function loadingPhase(unit, sessions, users, now = 0, timeEntries = []) {
  const vaultStamps = vaultsOf(unit).flatMap((v) => [v.at, vaultTouchedAt(v)])
  const all = [...stamps(unit, LOADING_STEPS.map((s) => s.key)), ...vaultStamps]
    .filter((n) => typeof n === 'number' && n > 0)
  const s = span(all)
  // Only call it finished once the unit has actually left the packed stage.
  // Until then the newest stamp is the last thing that happened, not the end.
  const closed = unit && unit.stage && unit.stage !== 'packed' && unit.stage !== 'packing' && unit.stage !== 'not_started'
  return {
    startedAt: s.startedAt,
    finishedAt: closed ? s.finishedAt : null,
    lastActivityAt: s.finishedAt,
    elapsedMs: s.elapsedMs,
    ...labourFor(sessions, unit && unit.id, users, ['mover'], now, timeEntries),
  }
}

function nameFor(uid, users, sessions) {
  const u = (users || []).find((x) => x && (x.uid || x.id) === uid)
  if (u && u.name) return u.name
  const s = (sessions || []).find((x) => x && x.uid === uid && x.userName)
  return (s && s.userName) || 'Crew'
}

// Everything the mover typed that did not agree with the packer's record, or
// a vault count that did not agree with what was logged. These are already
// raised as flags when they happen; carrying them on the summary means a unit
// that went out wrong reads as wrong forever, not just on the day.
export function mismatches(unit) {
  const steps = (unit && unit.steps) || {}
  return LOADING_STEPS
    .filter((s) => steps[s.key] && steps[s.key].matched === false)
    .map((s) => ({ key: s.key, label: s.label, value: steps[s.key].value, by: steps[s.key].userName, at: steps[s.key].at }))
}

export function unitSummary({ unit, sessions = [], users = [], timeEntries = [], now = 0 } = {}) {
  const packing = packingPhase(unit, sessions, users, now, timeEntries)
  const loading = loadingPhase(unit, sessions, users, now, timeEntries)
  const crew = (unit && unit.crew) || {}
  const media = (unit && unit.media) || []
  const vaults = vaultsOf(unit)

  const bounds = [packing.startedAt, packing.finishedAt, loading.startedAt, loading.lastActivityAt]
    .filter((n) => typeof n === 'number' && n > 0)

  return {
    packing,
    loading,
    totals: {
      labourMs: packing.totalMs + loading.totalMs,
      ...span(bounds),
    },
    crew: {
      packers: (crew.packers || []).map((uid) => ({ uid, name: nameFor(uid, users, sessions) })),
      movers: (crew.movers || []).map((uid) => ({ uid, name: nameFor(uid, users, sessions) })),
    },
    inventory: {
      pieces: unit && typeof unit.pieces === 'number' ? unit.pieces : null,
      stickerColor: (unit && unit.stickerColor) || null,
      range: inventoryRangeLabel(unit),
    },
    materials: {
      cartons: sumCartons(unit && unit.materials),
      cartonSummary: cartonSummary(unit && unit.materials),
      supplies: sumSupplies(unit && unit.supplies),
      supplySummary: supplySummary(unit && unit.supplies),
    },
    vaults: {
      started: vaults.length,
      complete: completeVaults(unit).length,
      numbers: vaults.map((v) => v.number).filter(Boolean),
    },
    media: {
      photos: media.filter((m) => m && m.kind !== 'video').length,
      videos: media.filter((m) => m && m.kind === 'video').length,
    },
    mismatches: mismatches(unit),
  }
}
