import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SCHEDULE, DEFAULT_RETURN_SCHEDULE, todayKey, parseDateKey, fmtScheduleDate,
  findScheduleDay, nextScheduleDay, targetStageForWork, atOrPastStage, progressForDay,
  scheduleDocId, scheduleForPhase,
} from '../schedule.js'

describe('DEFAULT_SCHEDULE', () => {
  it('has all 27 days, Sep 8 to Oct 8', () => {
    expect(DEFAULT_SCHEDULE).toHaveLength(27)
    expect(DEFAULT_SCHEDULE[0].date).toBe('2026-09-08')
    expect(DEFAULT_SCHEDULE.at(-1).date).toBe('2026-10-08')
  })
  it('runs floor 9 down to floor 1', () => {
    expect(DEFAULT_SCHEDULE[0].floor).toBe(9)
    expect(DEFAULT_SCHEDULE.at(-1).floor).toBe(1)
  })
})

describe('todayKey', () => {
  it('formats a local date as YYYY-MM-DD without UTC drift', () => {
    expect(todayKey(new Date(2026, 8, 8))).toBe('2026-09-08')
    expect(todayKey(new Date(2026, 0, 1))).toBe('2026-01-01')
  })
})

describe('parseDateKey / fmtScheduleDate', () => {
  it('round-trips a date key to the same local calendar day', () => {
    const d = parseDateKey('2026-09-08')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(8)
  })
  it('formats with weekday, month, day', () => {
    expect(fmtScheduleDate('2026-09-08')).toMatch(/^\w+, Sep 8$/)
  })
})

describe('findScheduleDay', () => {
  it('finds an existing day', () => {
    expect(findScheduleDay(DEFAULT_SCHEDULE, '2026-09-10')).toMatchObject({ work: 'MOVEOUT', floor: 9 })
  })
  it('returns null when missing', () => {
    expect(findScheduleDay(DEFAULT_SCHEDULE, '2026-09-13')).toBe(null)
  })
  it('never crashes on an empty schedule', () => {
    expect(findScheduleDay([], '2026-09-08')).toBe(null)
  })
})

describe('nextScheduleDay', () => {
  it('finds the next day after a weekend gap', () => {
    // Sep 13 (Sun) has no entry; Sep 12 is the last PACK before the gap.
    expect(nextScheduleDay(DEFAULT_SCHEDULE, '2026-09-12')).toMatchObject({ date: '2026-09-14' })
  })
  it('returns null after the last day', () => {
    expect(nextScheduleDay(DEFAULT_SCHEDULE, '2026-10-08')).toBe(null)
  })
  it('never crashes on an empty schedule', () => {
    expect(nextScheduleDay([], '2026-09-08')).toBe(null)
  })
})

describe('targetStageForWork / atOrPastStage', () => {
  it('PACK targets packed, MOVEOUT targets loaded, RETURN targets unpacked', () => {
    expect(targetStageForWork('PACK')).toBe('packed')
    expect(targetStageForWork('MOVEOUT')).toBe('loaded')
    expect(targetStageForWork('RETURN')).toBe('unpacked')
  })
  it('at-or-past is inclusive and lifecycle-ordered', () => {
    expect(atOrPastStage('packed', 'packed')).toBe(true)
    expect(atOrPastStage('loaded', 'packed')).toBe(true)
    expect(atOrPastStage('packing', 'packed')).toBe(false)
    expect(atOrPastStage('at_warehouse', 'loaded')).toBe(true)
  })
})

describe('progressForDay', () => {
  const units = [
    { floor: 9, stage: 'packed' },
    { floor: 9, stage: 'loaded' },
    { floor: 9, stage: 'packing' },
    { floor: 8, stage: 'packed' },
  ]
  it('counts packed-or-later units on a PACK day', () => {
    const day = { date: '2026-09-08', work: 'PACK', floor: 9, unitCount: 4 }
    expect(progressForDay(day, units)).toEqual({ done: 2, planned: 4 })
  })
  it('counts loaded-or-later units on a MOVEOUT day', () => {
    const day = { date: '2026-09-10', work: 'MOVEOUT', floor: 9, unitCount: 4 }
    expect(progressForDay(day, units)).toEqual({ done: 1, planned: 4 })
  })
  it('never crashes with no matching day', () => {
    expect(progressForDay(null, units)).toEqual({ done: 0, planned: 0 })
  })
  it('counts unpacked-or-later units on a RETURN day', () => {
    const day = { date: '2026-10-12', work: 'RETURN', floor: 1, unitCount: 3 }
    const returnUnits = [
      { floor: 1, stage: 'unpacked' },
      { floor: 1, stage: 'unloaded' },
      { floor: 1, stage: 'back_on_site' },
      { floor: 2, stage: 'unpacked' },
    ]
    expect(progressForDay(day, returnUnits)).toEqual({ done: 1, planned: 3 })
  })
})

describe('DEFAULT_RETURN_SCHEDULE', () => {
  it('has one day per floor, 1 through 9', () => {
    expect(DEFAULT_RETURN_SCHEDULE).toHaveLength(9)
    expect(DEFAULT_RETURN_SCHEDULE.map((d) => d.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
  it('starts after the outbound plan ends (Oct 8)', () => {
    expect(DEFAULT_RETURN_SCHEDULE[0].date > '2026-10-08').toBe(true)
  })
  it('every day is RETURN work with a positive unitCount', () => {
    for (const d of DEFAULT_RETURN_SCHEDULE) {
      expect(d.work).toBe('RETURN')
      expect(d.unitCount).toBeGreaterThan(0)
    }
  })
})

describe('scheduleDocId', () => {
  it('uses the plain date for the outbound phase (default)', () => {
    expect(scheduleDocId('2026-09-08')).toBe('2026-09-08')
    expect(scheduleDocId('2026-09-08', 'out')).toBe('2026-09-08')
  })
  it('prefixes the date for the return phase, so it cannot collide with an outbound day', () => {
    expect(scheduleDocId('2026-10-12', 'return')).toBe('return-2026-10-12')
  })
})

describe('scheduleForPhase', () => {
  const mixed = [
    { date: '2026-09-08', phase: 'out' },
    { date: '2026-09-09' }, // legacy doc, no phase field: counts as 'out'
    { date: '2026-10-12', phase: 'return' },
  ]
  it('defaults missing phase to out', () => {
    expect(scheduleForPhase(mixed, 'out')).toHaveLength(2)
  })
  it('filters to return days', () => {
    expect(scheduleForPhase(mixed, 'return')).toEqual([{ date: '2026-10-12', phase: 'return' }])
  })
  it('never crashes on a missing/empty schedule', () => {
    expect(scheduleForPhase(undefined, 'out')).toEqual([])
    expect(scheduleForPhase([], 'return')).toEqual([])
  })
})
