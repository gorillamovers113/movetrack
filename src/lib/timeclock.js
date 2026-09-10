/* Time clock domain logic.
 *
 * Pure: no Firebase, no Date.now(). Every moment is passed in, so the whole
 * thing is testable and cannot drift with the machine clock. Spec:
 * docs/superpowers/specs/2026-09-10-time-clock-design.md
 *
 * Nothing here rounds. California's Camp v. Home Depot holds that an employer
 * who CAN capture the exact time worked must use it, and an app captures exact
 * time by definition, so every value is milliseconds and formatting happens
 * only at the edge.
 */

// The crew work in San Diego. A day key from the browser's timezone would put
// an evening shift on the wrong date for anyone whose phone is set elsewhere,
// and a UTC key would do it for everyone after 5pm. The dispatch lockouts in
// the sister project hit exactly this once already.
const BUSINESS_TZ = 'America/Los_Angeles'

export const EARLIEST_CLOCK_IN_HOUR = 8
export const LUNCH_MINUTES = 30
export const LUNCH_THRESHOLD_MS = 5 * 60 * 60 * 1000

// Only these two roles keep time. Everyone else is either off the clock or is
// the person reviewing it.
export const CLOCK_ROLES = ['packer', 'mover', 'crew']

export function usesClock(role) {
  return CLOCK_ROLES.indexOf(role) !== -1
}

export function businessDayKey(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms))
}

// The wall-clock hour in California at a given instant. hourCycle h23 rather
// than hour12:false, which reports midnight as 24 in some locales.
function businessHour(ms) {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ, hour: '2-digit', hourCycle: 'h23',
  }).format(new Date(ms)))
}

export function canClockInAt(ms) {
  return businessHour(ms) >= EARLIEST_CLOCK_IN_HOUR
}

// The exact instant a day's clock unlocks.
//
// Derived from the offset observed at noon UTC on that date rather than from a
// hard-coded -7 or -8, because the offset changes twice a year and a constant
// would be wrong for half of it. Noon UTC is a safe anchor: it is 4am or 5am
// local, well clear of the 2am DST transition, so the offset it reports is the
// one that applies at 8am the same morning.
export function earliestClockInMs(dayKey) {
  const noonUtc = Date.parse(`${dayKey}T12:00:00Z`)
  if (!Number.isFinite(noonUtc)) return NaN
  const localHourAtNoonUtc = businessHour(noonUtc)
  return noonUtc + (EARLIEST_CLOCK_IN_HOUR - localHourAtNoonUtc) * 3600000
}

// Thirty minutes come off any day whose GROSS span passes five hours, because
// that is the period California's meal-break rule is written against. A 5h10m
// day therefore pays 4h40m. Ticking "worked through lunch" removes the
// deduction, which is the whole point: a record asserting a break nobody took
// is the thing that creates a presumption of a violation.
export function lunchMinutesFor(grossMs, workedThroughLunch) {
  if (workedThroughLunch) return 0
  return grossMs > LUNCH_THRESHOLD_MS ? LUNCH_MINUTES : 0
}

export function workedMs(entry) {
  if (!entry || !entry.clockIn || !entry.clockOut) return 0
  const gross = entry.clockOut - entry.clockIn
  const net = gross - (Number(entry.lunchMinutes) || 0) * 60000
  return net > 0 ? net : 0
}

/* ---------------------------------------------------------------------------
 * Unit sessions
 *
 * A person is checked into at most one unit at a time, so sessions never
 * overlap and their totals can be added without double counting. That
 * constraint is the only reason the numbers mean anything: on the first pack
 * day two units held open at once produced 7h44m of unit time out of about
 * five and a half hours of actual work.
 * ------------------------------------------------------------------------- */

export function sessionMs(session, now = 0) {
  if (!session || !session.startedAt) return 0
  const end = session.endedAt || now
  const ms = end - session.startedAt
  return ms > 0 ? ms : 0
}

export function openSessionFor(sessions, uid) {
  return (sessions || []).find((s) => s && s.uid === uid && !s.endedAt) || null
}

export function unitLabourMs(sessions, unitId, now = 0) {
  return (sessions || [])
    .filter((s) => s && s.unitId === unitId)
    .reduce((n, s) => n + sessionMs(s, now), 0)
}

export function unitLabourByPerson(sessions, unitId, now = 0) {
  const by = new Map()
  for (const s of sessions || []) {
    if (!s || s.unitId !== unitId) continue
    const row = by.get(s.uid) || { uid: s.uid, userName: s.userName || 'Crew', ms: 0, sessions: 0 }
    row.ms += sessionMs(s, now)
    row.sessions += 1
    by.set(s.uid, row)
  }
  return [...by.values()].sort((a, b) => b.ms - a.ms)
}

export function dayLabourMs(sessions, uid, dayKey, now = 0) {
  return (sessions || [])
    .filter((s) => s && s.uid === uid && s.day === dayKey)
    .reduce((n, s) => n + sessionMs(s, now), 0)
}
