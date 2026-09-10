import { describe, it, expect } from 'vitest'
import { unitSummary, packingPhase, loadingPhase, sessionRole, mismatches } from '../unitSummary.js'

const H = 3600000
const at = (iso) => Date.parse(iso)

const LIV = { uid: 'liv', name: 'Liv Post', role: 'packer' }
const AARON = { uid: 'aaron', name: 'Aaron Soto', role: 'packer' }
const VIC = { uid: 'vic', name: 'Víctor Mendez', role: 'mover' }
const USERS = [LIV, AARON, VIC]

const sess = (uid, startIso, endIso, over = {}) => ({
  unitId: 'u1', uid, userName: USERS.find((u) => u.uid === uid).name,
  day: '2026-09-10', startedAt: at(startIso), endedAt: endIso ? at(endIso) : null, ...over,
})

const shot = (ts) => ({ url: 'u', kind: 'photo', uid: 'vic', userName: 'Víctor Mendez', at: ts })

const UNIT = {
  id: 'u1', number: '906', tenant: 'Maria Ochoa', stage: 'packed',
  pieces: 23, stickerColor: 'Orange', inventoryFrom: 1, inventoryTo: 23,
  materials: { small: 15, medium: 4 },
  supplies: { paper: 2, tape: 6 },
  crew: { packers: ['liv', 'aaron'], movers: ['vic'] },
  times: { packStart: at('2026-09-08T16:00:00Z'), packEnd: at('2026-09-08T21:00:00Z') },
  steps: {
    door: { userName: 'Liv Post', at: at('2026-09-08T16:00:00Z') },
    packed: { userName: 'Liv Post', at: at('2026-09-08T21:00:00Z') },
    load_unit_photo: { userName: 'Víctor Mendez', at: at('2026-09-10T16:47:00Z') },
    load_number: { userName: 'Víctor Mendez', at: at('2026-09-10T16:48:00Z'), value: '906', matched: true },
  },
  vaults: [{ number: 'BB-1', uid: 'vic', userName: 'Víctor Mendez', at: at('2026-09-10T17:00:00Z'), open: shot(at('2026-09-10T17:30:00Z')) }],
  media: [{ kind: 'photo' }, { kind: 'video' }, { kind: 'photo' }],
}

describe('which role an hour belongs to', () => {
  it('prefers what the session recorded', () => {
    expect(sessionRole({ uid: 'liv', role: 'mover' }, USERS)).toBe('mover')
  })

  it('falls back to the roster for sessions written before roles were stamped', () => {
    expect(sessionRole({ uid: 'liv' }, USERS)).toBe('packer')
    expect(sessionRole({ uid: 'vic' }, USERS)).toBe('mover')
  })

  it('says nothing rather than guessing for an unknown person', () => {
    expect(sessionRole({ uid: 'ghost' }, USERS)).toBe(null)
    expect(sessionRole(null, USERS)).toBe(null)
  })
})

describe('the packing phase', () => {
  const sessions = [
    sess('liv', '2026-09-08T16:00:00Z', '2026-09-08T21:00:00Z'),   // 5h
    sess('aaron', '2026-09-08T18:00:00Z', '2026-09-08T21:00:00Z'), // 3h
    sess('vic', '2026-09-10T16:45:00Z', '2026-09-10T17:45:00Z'),   // mover, not packing
  ]

  it('uses the recorded start and finish', () => {
    const p = packingPhase(UNIT, sessions, USERS, 0)
    expect(p.startedAt).toBe(at('2026-09-08T16:00:00Z'))
    expect(p.finishedAt).toBe(at('2026-09-08T21:00:00Z'))
    expect(p.elapsedMs).toBe(5 * H)
  })

  // The distinction the whole card turns on.
  it('adds every packer up, so labour exceeds wall clock when two work together', () => {
    const p = packingPhase(UNIT, sessions, USERS, 0)
    expect(p.totalMs).toBe(8 * H)
    expect(p.elapsedMs).toBe(5 * H)
    expect(p.people.map((r) => [r.userName, r.ms])).toEqual([['Liv Post', 5 * H], ['Aaron Soto', 3 * H]])
  })

  it('leaves the mover hours out of it', () => {
    expect(packingPhase(UNIT, sessions, USERS, 0).people.find((r) => r.uid === 'vic')).toBeUndefined()
  })

  it('falls back to step stamps on a unit with no recorded times', () => {
    const { times, ...noTimes } = UNIT
    const p = packingPhase(noTimes, [], USERS, 0)
    expect(p.startedAt).toBe(at('2026-09-08T16:00:00Z'))
    expect(p.finishedAt).toBe(at('2026-09-08T21:00:00Z'))
  })

  it('reports nothing rather than zero on an untouched unit', () => {
    const p = packingPhase({ id: 'x' }, [], USERS, 0)
    expect(p).toMatchObject({ startedAt: null, finishedAt: null, elapsedMs: 0, totalMs: 0, people: [] })
  })
})

describe('the loading phase', () => {
  const sessions = [sess('vic', '2026-09-10T16:45:00Z', '2026-09-10T17:45:00Z')]

  it('spans every mover stamp, the vaults and the door photos included', () => {
    const l = loadingPhase(UNIT, sessions, USERS, 0)
    expect(l.startedAt).toBe(at('2026-09-10T16:47:00Z'))
    expect(l.lastActivityAt).toBe(at('2026-09-10T17:30:00Z'))
    expect(l.totalMs).toBe(H)
  })

  // A unit sitting at "packed" is still being loaded, so the newest stamp is
  // the last thing that happened, not the end of the job.
  it('does not claim a finish time while the unit is still open', () => {
    expect(loadingPhase(UNIT, sessions, USERS, 0).finishedAt).toBe(null)
  })

  it('reports a finish once the unit has moved on', () => {
    const l = loadingPhase({ ...UNIT, stage: 'loaded' }, sessions, USERS, 0)
    expect(l.finishedAt).toBe(at('2026-09-10T17:30:00Z'))
  })

  it('counts an open session up to now, so a live unit does not read as done', () => {
    const live = [sess('vic', '2026-09-10T16:45:00Z', null)]
    const l = loadingPhase(UNIT, live, USERS, at('2026-09-10T18:45:00Z'))
    expect(l.totalMs).toBe(2 * H)
    expect(l.people[0].open).toBe(true)
  })
})

describe('the whole card', () => {
  const sessions = [
    sess('liv', '2026-09-08T16:00:00Z', '2026-09-08T21:00:00Z'),
    sess('aaron', '2026-09-08T18:00:00Z', '2026-09-08T21:00:00Z'),
    sess('vic', '2026-09-10T16:45:00Z', '2026-09-10T17:45:00Z'),
  ]
  const s = unitSummary({ unit: UNIT, sessions, users: USERS, now: 0 })

  it('totals packing and loading labour together', () => {
    expect(s.totals.labourMs).toBe(9 * H)
  })

  it('spans the whole job, first touch to last, across both days', () => {
    expect(s.totals.startedAt).toBe(at('2026-09-08T16:00:00Z'))
    expect(s.totals.finishedAt).toBe(at('2026-09-10T17:30:00Z'))
  })

  it('names the crew rather than showing their ids', () => {
    expect(s.crew.packers.map((p) => p.name)).toEqual(['Liv Post', 'Aaron Soto'])
    expect(s.crew.movers.map((p) => p.name)).toEqual(['Víctor Mendez'])
  })

  it('falls back to the name on the session for somebody off the roster', () => {
    const gone = { ...UNIT, crew: { packers: ['ghost'], movers: [] } }
    const withGhost = [{ unitId: 'u1', uid: 'ghost', userName: 'Old Hand', startedAt: 1, endedAt: 2 }]
    expect(unitSummary({ unit: gone, sessions: withGhost, users: USERS }).crew.packers[0].name).toBe('Old Hand')
  })

  it('counts cartons and materials separately, because they are billed differently', () => {
    expect(s.materials.cartons).toBe(19)
    expect(s.materials.cartonSummary).toMatch(/15/)
    expect(s.materials.supplies).toBe(8)
  })

  it('reports vaults as finished out of started', () => {
    expect(s.vaults).toMatchObject({ started: 1, complete: 0, numbers: ['BB-1'] })
  })

  it('splits photos from videos', () => {
    expect(s.media).toEqual({ photos: 2, videos: 1 })
  })

  it('carries the inventory the packer recorded', () => {
    expect(s.inventory).toEqual({ pieces: 23, stickerColor: 'Orange', range: '1-23' })
  })

  it('does not fall over on a unit nobody has touched', () => {
    const empty = unitSummary({ unit: { id: 'x' }, sessions: [], users: [] })
    expect(empty.totals.labourMs).toBe(0)
    expect(empty.crew).toEqual({ packers: [], movers: [] })
    expect(empty.vaults).toEqual({ started: 0, complete: 0, numbers: [] })
    expect(empty.mismatches).toEqual([])
  })

  it('survives being called with nothing at all', () => {
    expect(() => unitSummary()).not.toThrow()
  })
})

describe('mismatches carried on the summary', () => {
  it('lists what the mover typed when it disagreed', () => {
    const bad = { steps: { load_number: { value: '905', matched: false, userName: 'Víctor Mendez', at: 5 } } }
    expect(mismatches(bad)).toEqual([
      { key: 'load_number', label: 'Unit number', value: '905', by: 'Víctor Mendez', at: 5 },
    ])
  })

  it('says nothing when everything matched', () => {
    expect(mismatches(UNIT)).toEqual([])
  })
})

/* An open session is bounded by the person's clock-out.
 *
 * Opening a unit checks you in and you stay checked in until you open another
 * or clock out. Clocking out closes the session, so this only bites when a day
 * ends some other way. Without it an abandoned session keeps billing the
 * apartment overnight. */
describe('an open session that nobody closed', () => {
  const openSess = [sess('vic', '2026-09-10T16:00:00Z', null)]
  const entry = (clockOut) => [{ uid: 'vic', day: '2026-09-10', clockIn: at('2026-09-10T15:00:00Z'), clockOut }]

  it('stops at the clock-out rather than running to now', () => {
    const l = loadingPhase(UNIT, openSess, USERS, at('2026-09-11T20:00:00Z'), entry(at('2026-09-10T18:00:00Z')))
    expect(l.totalMs).toBe(2 * H)
  })

  it('still counts up to now while the shift is genuinely open', () => {
    const l = loadingPhase(UNIT, openSess, USERS, at('2026-09-10T18:00:00Z'), entry(null))
    expect(l.totalMs).toBe(2 * H)
  })

  it('never runs backwards when the clock-out precedes the session', () => {
    const l = loadingPhase(UNIT, openSess, USERS, at('2026-09-10T20:00:00Z'), entry(at('2026-09-10T15:30:00Z')))
    expect(l.totalMs).toBe(0)
  })

  it('leaves a closed session alone whatever the entry says', () => {
    const closed = [sess('vic', '2026-09-10T16:00:00Z', '2026-09-10T17:00:00Z')]
    const l = loadingPhase(UNIT, closed, USERS, at('2026-09-11T20:00:00Z'), entry(at('2026-09-10T16:10:00Z')))
    expect(l.totalMs).toBe(H)
  })

  it('falls back to now when the person has no entry for that day', () => {
    const l = loadingPhase(UNIT, openSess, USERS, at('2026-09-10T18:00:00Z'), [])
    expect(l.totalMs).toBe(2 * H)
  })

  it('marks the row as still open either way, so the number is never read as final', () => {
    const l = loadingPhase(UNIT, openSess, USERS, at('2026-09-11T20:00:00Z'), entry(at('2026-09-10T18:00:00Z')))
    expect(l.people[0].open).toBe(true)
  })
})
