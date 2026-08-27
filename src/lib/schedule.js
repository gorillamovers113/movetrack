// Floor-by-floor relocation schedule: canonical 27-day plan + pure date/
// progress helpers shared by the store (dispatch actions), the Dashboard
// today banner, and the Schedule view. No React/Firebase imports here so
// this stays trivially testable and importable from the Node seed script.
import { stageOf } from '../seed.js'

// 27 scheduled days, Sep 8 -> Oct 8 2026, floor 9 down to floor 1.
// Source: spec §10 ("Schedule seed data (from Casey's calendar, Sept-Oct 2026)").
// Pattern per floor: PACK, PACK, MOVEOUT, then the next floor down.
// This is the single source of truth: scripts/seed-schedule.mjs imports it
// rather than keeping its own copy.
export const DEFAULT_SCHEDULE = [
  { date: '2026-09-08', work: 'PACK', floor: 9, unitCount: 4 },
  { date: '2026-09-09', work: 'PACK', floor: 9, unitCount: 4 },
  { date: '2026-09-10', work: 'MOVEOUT', floor: 9, unitCount: 4 },
  { date: '2026-09-11', work: 'PACK', floor: 8, unitCount: 6 },
  { date: '2026-09-12', work: 'PACK', floor: 8, unitCount: 6 },
  { date: '2026-09-14', work: 'MOVEOUT', floor: 8, unitCount: 6 },
  { date: '2026-09-15', work: 'PACK', floor: 7, unitCount: 6 },
  { date: '2026-09-16', work: 'PACK', floor: 7, unitCount: 6 },
  { date: '2026-09-17', work: 'MOVEOUT', floor: 7, unitCount: 6 },
  { date: '2026-09-18', work: 'PACK', floor: 6, unitCount: 6 },
  { date: '2026-09-19', work: 'PACK', floor: 6, unitCount: 6 },
  { date: '2026-09-21', work: 'MOVEOUT', floor: 6, unitCount: 6 },
  { date: '2026-09-22', work: 'PACK', floor: 5, unitCount: 6 },
  { date: '2026-09-23', work: 'PACK', floor: 5, unitCount: 6 },
  { date: '2026-09-24', work: 'MOVEOUT', floor: 5, unitCount: 6 },
  { date: '2026-09-25', work: 'PACK', floor: 4, unitCount: 5 },
  { date: '2026-09-26', work: 'PACK', floor: 4, unitCount: 5 },
  { date: '2026-09-28', work: 'MOVEOUT', floor: 4, unitCount: 5 },
  { date: '2026-09-29', work: 'PACK', floor: 3, unitCount: 6 },
  { date: '2026-09-30', work: 'PACK', floor: 3, unitCount: 6 },
  { date: '2026-10-01', work: 'MOVEOUT', floor: 3, unitCount: 6 },
  { date: '2026-10-02', work: 'PACK', floor: 2, unitCount: 6 },
  { date: '2026-10-03', work: 'PACK', floor: 2, unitCount: 6 },
  { date: '2026-10-05', work: 'MOVEOUT', floor: 2, unitCount: 6 },
  { date: '2026-10-06', work: 'PACK', floor: 1, unitCount: 4 },
  { date: '2026-10-07', work: 'PACK', floor: 1, unitCount: 4 },
  { date: '2026-10-08', work: 'MOVEOUT', floor: 1, unitCount: 4 },
]

// Per-floor unit count actually scheduled to move OUT (the MOVEOUT day's
// unitCount for that floor), derived from DEFAULT_SCHEDULE itself so there is
// exactly one source of truth. Only ~49 units ever really move (not the
// FLOOR_UNITS building-massing figures, 8-12/floor, 100 total, this used to
// be built from), so this is what the return leg needs to mirror for its
// progress to ever reach 100%
// (docs/superpowers/specs/2026-08-27-return-leg-correctness-fixes.md #5).
const MOVEOUT_UNIT_COUNT_BY_FLOOR = Object.fromEntries(
  DEFAULT_SCHEDULE.filter((d) => d.work === 'MOVEOUT').map((d) => [d.floor, d.unitCount])
)

// Return-phase template (docs/superpowers/specs/2026-08-26-return-phase-design.md
// §7). Return runs on its own October timeline, floors coming back in reverse
// of the outbound order (floor 1, the last one moved out, comes back first;
// floor 9, moved out first, comes back last) since that is the natural "rewind"
// reading of Casey's "exact reverse" framing. Exact dates are TBD; these are
// placeholder weekdays starting after the outbound plan's last day (Oct 8) to
// leave room for the building work, and are meant to be edited by the admin
// once real dates are known. Each floor gets a single RETURN work day
// (deliver + unload + unpack all happen on-site the same visit; there is no
// return equivalent of the two-day outbound PACK prep). unitCount matches the
// real MOVEOUT count for that floor (MOVEOUT_UNIT_COUNT_BY_FLOOR above), not
// the building's full per-floor capacity, so return progress can actually
// reach 100%.
export const DEFAULT_RETURN_SCHEDULE = [
  { date: '2026-10-12', work: 'RETURN', floor: 1, unitCount: MOVEOUT_UNIT_COUNT_BY_FLOOR[1] },
  { date: '2026-10-13', work: 'RETURN', floor: 2, unitCount: MOVEOUT_UNIT_COUNT_BY_FLOOR[2] },
  { date: '2026-10-14', work: 'RETURN', floor: 3, unitCount: MOVEOUT_UNIT_COUNT_BY_FLOOR[3] },
  { date: '2026-10-15', work: 'RETURN', floor: 4, unitCount: MOVEOUT_UNIT_COUNT_BY_FLOOR[4] },
  { date: '2026-10-16', work: 'RETURN', floor: 5, unitCount: MOVEOUT_UNIT_COUNT_BY_FLOOR[5] },
  { date: '2026-10-19', work: 'RETURN', floor: 6, unitCount: MOVEOUT_UNIT_COUNT_BY_FLOOR[6] },
  { date: '2026-10-20', work: 'RETURN', floor: 7, unitCount: MOVEOUT_UNIT_COUNT_BY_FLOOR[7] },
  { date: '2026-10-21', work: 'RETURN', floor: 8, unitCount: MOVEOUT_UNIT_COUNT_BY_FLOOR[8] },
  { date: '2026-10-22', work: 'RETURN', floor: 9, unitCount: MOVEOUT_UNIT_COUNT_BY_FLOOR[9] },
]

// A schedule day's Firestore doc id is normally just its date (outbound,
// phase 'out', matching the existing collection). Return days are prefixed so
// an admin editing/re-dating a return day can never collide with an outbound
// day that happens to land on the same calendar date.
export function scheduleDocId(date, phase = 'out') {
  return phase === 'return' ? `return-${date}` : date
}

// Filters the schedule array down to one phase. Existing docs written before
// this feature have no `phase` field at all, so they default to 'out' here
// too (the spec's "backfilled for existing days"), same as the other schedule
// helpers below which keep operating on whatever array they're handed.
export function scheduleForPhase(schedule, phase = 'out') {
  return (schedule || []).filter((d) => (d.phase || 'out') === phase)
}

// Client-local YYYY-MM-DD, built from getFullYear/getMonth/getDate (never
// toISOString, which is UTC and can land on the wrong day near midnight).
export function todayKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Parses a 'YYYY-MM-DD' doc-id string into a local Date at midnight (not
// UTC), so display formatting never drifts a day off in negative-UTC-offset
// timezones.
export function parseDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function fmtScheduleDate(dateKey) {
  return parseDateKey(dateKey).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function findScheduleDay(schedule, dateKey) {
  return schedule.find((d) => d.date === dateKey) || null
}

// First scheduled day strictly after dateKey, or null if none (schedule
// empty, or dateKey is at/after the last day).
export function nextScheduleDay(schedule, dateKey) {
  const upcoming = schedule.filter((d) => d.date > dateKey).sort((a, b) => a.date.localeCompare(b.date))
  return upcoming[0] || null
}

// PACK days track packed-or-later units on the floor; MOVEOUT days track
// loaded-or-later; RETURN days (return phase) track unpacked, the terminal
// return stage. Mirrors the "at or past a stage" idiom from stageOf().
export function targetStageForWork(work) {
  if (work === 'MOVEOUT') return 'loaded'
  if (work === 'RETURN') return 'unpacked'
  return 'packed'
}

export function atOrPastStage(stageKey, targetKey) {
  return stageOf(stageKey).step >= stageOf(targetKey).step
}

// Live done-vs-plan for one schedule day: how many units on that floor have
// reached (or passed) the day's target stage, out of the planned unitCount.
export function progressForDay(day, units) {
  if (!day) return { done: 0, planned: 0 }
  const target = targetStageForWork(day.work)
  const done = units.filter((u) => u.floor === day.floor && atOrPastStage(u.stage, target)).length
  return { done, planned: day.unitCount || 0 }
}
