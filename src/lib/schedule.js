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
// loaded-or-later. Mirrors the "at or past a stage" idiom from stageOf().
export function targetStageForWork(work) {
  return work === 'MOVEOUT' ? 'loaded' : 'packed'
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
