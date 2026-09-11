import { describe, it, expect } from 'vitest'
import {
  EARLIEST_CLOCK_IN_HOUR, LUNCH_MINUTES, businessDayKey, earliestClockInMs,
  canClockInAt, lunchMinutesFor, workedMs, usesClock,
  sessionMs, openSessionFor, unitLabourMs, unitLabourByPerson, dayLabourMs,
} from '../timeclock.js'

const at = (iso) => Date.parse(iso)
const H = 3600000

describe('business day key', () => {
  it('uses Pacific time, not the machine timezone', () => {
    // 06:30 UTC on the 11th is still the evening of the 10th in California.
    expect(businessDayKey(at('2026-09-11T06:30:00Z'))).toBe('2026-09-10')
  })

  it('rolls over at Pacific midnight, not UTC midnight', () => {
    expect(businessDayKey(at('2026-09-11T06:59:59Z'))).toBe('2026-09-10')
    expect(businessDayKey(at('2026-09-11T07:00:00Z'))).toBe('2026-09-11')
  })

  it('is right in winter too, when the offset changes', () => {
    // Standard time: UTC-8, so midnight local is 08:00Z.
    expect(businessDayKey(at('2026-01-15T07:59:00Z'))).toBe('2026-01-14')
    expect(businessDayKey(at('2026-01-15T08:00:00Z'))).toBe('2026-01-15')
  })
})

describe('the 8am floor', () => {
  it('is eight', () => {
    expect(EARLIEST_CLOCK_IN_HOUR).toBe(8)
  })

  it('refuses before 08:00 Pacific and allows from 08:00', () => {
    expect(canClockInAt(at('2026-09-10T14:59:59Z'))).toBe(false) // 07:59:59 PT
    expect(canClockInAt(at('2026-09-10T15:00:00Z'))).toBe(true) // 08:00:00 PT
  })

  it('reports the exact moment the clock unlocks for a day', () => {
    const ms = earliestClockInMs('2026-09-10')
    expect(businessDayKey(ms)).toBe('2026-09-10')
    expect(canClockInAt(ms)).toBe(true)
    expect(canClockInAt(ms - 1)).toBe(false)
  })

  it('unlocks at the right instant in winter as well as summer', () => {
    // A fixed UTC hour would be wrong for one of these two.
    expect(earliestClockInMs('2026-09-10')).toBe(at('2026-09-10T15:00:00Z'))
    expect(earliestClockInMs('2026-01-15')).toBe(at('2026-01-15T16:00:00Z'))
  })
})

describe('lunch', () => {
  it('deducts nothing at or under five hours gross', () => {
    expect(lunchMinutesFor(5 * H, false)).toBe(0)
    expect(lunchMinutesFor(5 * H - 60000, false)).toBe(0)
  })

  it('deducts thirty minutes once the gross span passes five hours', () => {
    expect(lunchMinutesFor(5 * H + 1000, false)).toBe(LUNCH_MINUTES)
    expect(lunchMinutesFor(9 * H, false)).toBe(LUNCH_MINUTES)
  })

  it('deducts nothing when the person says they worked through it', () => {
    expect(lunchMinutesFor(9 * H, true)).toBe(0)
  })

  it('measures the threshold on the gross span, before any deduction', () => {
    // 5h10m gross stays over the line and pays 4h40m.
    const entry = { clockIn: at('2026-09-10T15:00:00Z'), clockOut: at('2026-09-10T20:10:00Z'), lunchMinutes: 30 }
    expect(workedMs(entry)).toBe(4 * H + 40 * 60000)
  })
})

describe('worked time', () => {
  it('is zero while the day is still open, never a guess', () => {
    expect(workedMs({ clockIn: at('2026-09-10T15:00:00Z'), clockOut: null, lunchMinutes: 0 })).toBe(0)
  })

  it('never goes negative on a malformed entry', () => {
    expect(workedMs({ clockIn: 1000, clockOut: 500, lunchMinutes: 30 })).toBe(0)
    expect(workedMs(null)).toBe(0)
  })
})

describe('who uses the clock', () => {
  /* Everybody who works. This started as packers and movers only, which was
   * wrong twice: the warehouse manager works a shift like anybody else, and
   * an admin who lost their clock lost an afternoon's hours with it, because
   * an open shift had nowhere to be closed from. */
  it('is everybody who works a shift', () => {
    for (const r of ['packer', 'mover', 'crew', 'warehouse', 'driver', 'admin']) {
      expect(usesClock(r)).toBe(true)
    }
  })

  // The one exception, and deliberate: read-only by definition, held by the
  // building's people rather than the crew.
  it('is not the viewer', () => {
    expect(usesClock('viewer')).toBe(false)
  })

  it('is nobody without a role', () => {
    for (const r of ['', null, undefined, 'pending']) expect(usesClock(r)).toBe(false)
  })
})

const S = (over = {}) => ({
  unitId: 'u1', uid: 'liv', userName: 'Liv Post', day: '2026-09-10',
  startedAt: at('2026-09-10T16:00:00Z'), endedAt: at('2026-09-10T17:00:00Z'), ...over,
})

describe('unit sessions', () => {
  it('measures a closed session exactly', () => {
    expect(sessionMs(S(), 0)).toBe(H)
  })

  it('measures an open session up to now, and not into the future', () => {
    const open = S({ endedAt: null })
    expect(sessionMs(open, at('2026-09-10T16:30:00Z'))).toBe(1800000)
    expect(sessionMs(open, at('2026-09-10T15:00:00Z'))).toBe(0)
  })

  it('treats a backwards session as zero, never negative', () => {
    expect(sessionMs(S({ endedAt: at('2026-09-10T15:00:00Z') }), 0)).toBe(0)
  })

  it('finds the one open session for a person', () => {
    const list = [S(), S({ unitId: 'u2', endedAt: null })]
    expect(openSessionFor(list, 'liv').unitId).toBe('u2')
    expect(openSessionFor(list, 'ana')).toBe(null)
    expect(openSessionFor([], 'liv')).toBe(null)
  })

  it('sums every session on a unit, including repeat visits', () => {
    const list = [
      S({ startedAt: at('2026-09-10T16:00:00Z'), endedAt: at('2026-09-10T17:00:00Z') }),
      S({ startedAt: at('2026-09-10T19:00:00Z'), endedAt: at('2026-09-10T19:30:00Z') }),
      S({ unitId: 'other', startedAt: at('2026-09-10T18:00:00Z'), endedAt: at('2026-09-10T18:30:00Z') }),
    ]
    expect(unitLabourMs(list, 'u1', 0)).toBe(5400000)
  })

  it('breaks a unit down by person, biggest contribution first', () => {
    const list = [
      S({ uid: 'liv', userName: 'Liv Post' }),
      S({ uid: 'ana', userName: 'Ana Ruiz', startedAt: at('2026-09-10T18:00:00Z'), endedAt: at('2026-09-10T20:00:00Z') }),
    ]
    const rows = unitLabourByPerson(list, 'u1', 0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ userName: 'Ana Ruiz', ms: 2 * H, sessions: 1 })
    expect(rows[1]).toMatchObject({ userName: 'Liv Post', ms: H, sessions: 1 })
  })

  it('counts repeat visits by the same person as one row', () => {
    const list = [S(), S({ startedAt: at('2026-09-10T19:00:00Z'), endedAt: at('2026-09-10T20:00:00Z') })]
    const rows = unitLabourByPerson(list, 'u1', 0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ms: 2 * H, sessions: 2 })
  })

  it('sums a person day across units, which is what reconciles against the clock', () => {
    const list = [S({ unitId: 'u1' }), S({ unitId: 'u2', startedAt: at('2026-09-10T18:00:00Z'), endedAt: at('2026-09-10T18:30:00Z') })]
    expect(dayLabourMs(list, 'liv', '2026-09-10', 0)).toBe(5400000)
    expect(dayLabourMs(list, 'liv', '2026-09-11', 0)).toBe(0)
  })

  it('does not crash on junk', () => {
    expect(unitLabourMs(undefined, 'u1', 0)).toBe(0)
    expect(unitLabourByPerson([null, {}], 'u1', 0)).toEqual([])
    expect(dayLabourMs(null, 'liv', '2026-09-10', 0)).toBe(0)
  })
})
