import { describe, it, expect } from 'vitest'
import {
  unitSummary, packingPhase, loadingPhase, sessionRole, mismatches,
  jobSummary, projection, materialLines, vaultCrew, sessionPhase,
} from '../unitSummary.js'

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

  it('keeps cartons and supplies separate in the data, so tape never inflates a box count', () => {
    expect(s.materials.cartons).toBe(19)
    expect(s.materials.supplies).toBe(8)
  })

  it('and joins them into one list, which is the question people actually ask', () => {
    expect(s.materials.total).toBe(27)
    expect(s.materials.lines).toEqual([
      { key: 'small', label: 'Small', count: 15 },
      { key: 'medium', label: 'Medium', count: 4 },
      { key: 'paper', label: 'Packing paper', count: 2 },
      { key: 'tape', label: 'Tape', count: 6 },
    ])
  })

  it('names whoever handled each vault, opener and sealer alike', () => {
    expect(s.vaults.list).toEqual([
      { number: 'BB-1', complete: false, by: ['Víctor Mendez'], at: at('2026-09-10T17:30:00Z') },
    ])
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
    expect(empty.vaults).toEqual({ started: 0, complete: 0, numbers: [], list: [] })
    expect(empty.materials.lines).toEqual([])
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

/* The whole building.
 *
 * The averages are the part that can lie. Dividing total packing hours by
 * fifty apartments when two are packed is not an average, it is a wrong number
 * that looks like one. These tests exist to keep that from happening. */
describe('the job roll-up', () => {
  const unit = (over) => ({
    id: over.id, number: over.number, tenant: 'A Tenant', floor: 9,
    stage: over.stage || 'not_started', pieces: over.pieces,
    materials: over.materials, supplies: over.supplies, crew: { packers: [], movers: [] },
    steps: over.steps || {}, vaults: over.vaults || [], media: [],
  })

  const packedVault = (n) => ({ number: n, uid: 'vic', userName: 'Víctor Mendez', at: 1, open: shot(2), closed: shot(3) })

  const units = [
    unit({ id: 'a', number: '901', stage: 'loaded', pieces: 20, materials: { small: 10 }, supplies: { tape: 4 }, vaults: [packedVault('BB-1')] }),
    unit({ id: 'b', number: '902', stage: 'packed', pieces: 30, materials: { small: 20 } }),
    unit({ id: 'c', number: '903', stage: 'not_started' }),
  ]
  const sessions = [
    { unitId: 'a', uid: 'liv', userName: 'Liv Post', role: 'packer', day: '2026-09-08', startedAt: at('2026-09-08T16:00:00Z'), endedAt: at('2026-09-08T18:00:00Z') },
    { unitId: 'a', uid: 'vic', userName: 'Víctor Mendez', role: 'mover', day: '2026-09-10', startedAt: at('2026-09-10T16:00:00Z'), endedAt: at('2026-09-10T17:00:00Z') },
    { unitId: 'b', uid: 'liv', userName: 'Liv Post', role: 'packer', day: '2026-09-08', startedAt: at('2026-09-08T18:00:00Z'), endedAt: at('2026-09-08T22:00:00Z') },
  ]
  const job = jobSummary({ units, sessions, users: USERS, now: 0 })

  it('splits the building total into packing and loading', () => {
    expect(job.labour.packingMs).toBe(6 * H)
    expect(job.labour.loadingMs).toBe(H)
    expect(job.labour.totalMs).toBe(7 * H)
  })

  it('counts where the building actually is', () => {
    expect(job.units).toMatchObject({ total: 3, packed: 2, loaded: 1, started: 2, notStarted: 1 })
  })

  // The one that matters: three units, two packed. Dividing by three is wrong.
  it('averages over the units that finished the phase, never over the building', () => {
    expect(job.averages.packingMs).toEqual({ per: 3 * H, n: 2 })
    expect(job.averages.loadingMs).toEqual({ per: H, n: 1 })
  })

  it('carries the sample size on every rate, so a guess cannot pass as a forecast', () => {
    for (const r of Object.values(job.averages)) expect(r).toHaveProperty('n')
  })

  it('says nothing rather than zero when no unit has finished a phase', () => {
    const early = jobSummary({ units: [unit({ id: 'z', number: '900' })], sessions: [], users: USERS })
    expect(early.averages.packingMs).toEqual({ per: null, n: 0 })
    expect(early.averages.vaults).toEqual({ per: null, n: 0 })
  })

  it('adds each person up across every unit they touched, split by phase', () => {
    const liv = job.crew.find((c) => c.uid === 'liv')
    expect(liv).toMatchObject({ packingMs: 6 * H, loadingMs: 0, totalMs: 6 * H, units: 2 })
    expect(job.crew.find((c) => c.uid === 'vic')).toMatchObject({ loadingMs: H, units: 1 })
    expect(job.crew[0].uid).toBe('liv')  // biggest contribution first
  })

  it('merges cartons and supplies into one materials list for the building', () => {
    expect(job.totals.materials.total).toBe(34)
    expect(job.totals.materials.lines).toEqual([
      { key: 'small', label: 'Small', count: 30 },
      { key: 'tape', label: 'Tape', count: 4 },
    ])
  })

  it('totals pieces and vaults across the job', () => {
    expect(job.totals.pieces).toBe(50)
    expect(job.totals).toMatchObject({ vaultsStarted: 1, vaultsComplete: 1 })
  })

  it('keeps a row per unit so the table and the CSV read off the same numbers', () => {
    expect(job.rows).toHaveLength(3)
    expect(job.rows.find((r) => r.unit.id === 'a').packing.totalMs).toBe(2 * H)
  })

  it('does not fall over on an empty building', () => {
    const none = jobSummary()
    expect(none.units.total).toBe(0)
    expect(none.labour.totalMs).toBe(0)
    expect(none.crew).toEqual([])
  })
})

describe('projecting the rest of the building', () => {
  const job = (over) => ({
    units: { total: 50, packed: 2, loaded: 1 },
    averages: {
      packingMs: { per: 3 * H, n: 2 }, loadingMs: { per: H, n: 1 },
      materials: { per: 20, n: 2 }, vaults: { per: 2, n: 1 }, pieces: { per: 25, n: 2 },
    },
    ...over,
  })

  it('multiplies the rate by what is left, per phase', () => {
    const p = projection(job())
    expect(p.remainingToPack).toBe(48)
    expect(p.remainingToLoad).toBe(49)
    expect(p.packingMs).toBe(48 * 3 * H)
    expect(p.loadingMs).toBe(49 * H)
    expect(p.materials).toBe(960)
    expect(p.vaults).toBe(98)
  })

  // A projection off one unit and one off forty are both numbers on a screen.
  // Reporting the sample is the only thing that tells them apart.
  it('carries a sample on every line, because they rest on different evidence', () => {
    const p = projection(job())
    expect(p).toMatchObject({ packSample: 2, loadSample: 1, materialSample: 2, vaultSample: 1 })
    // basedOn only decides how loudly to hedge, so it takes the strongest.
    expect(p.basedOn).toBe(2)
  })

  it('projects nothing rather than zero before anything has finished', () => {
    const cold = projection(job({ averages: {
      packingMs: { per: null, n: 0 }, loadingMs: { per: null, n: 0 },
      materials: { per: null, n: 0 }, vaults: { per: null, n: 0 }, pieces: { per: null, n: 0 },
    } }))
    expect(cold.packingMs).toBe(null)
    expect(cold.loadingMs).toBe(null)
    expect(cold.materials).toBe(null)
  })
})

/* The bug this shipped with, caught on a live report.
 *
 * Liv packed two apartments on the 8th. On the 10th her role was changed to
 * mover for the move-out. Her old sessions carry no stamped role, so reading
 * today's roster moved 3h 20m of her packing into the loading column. */
describe('a person whose role changed after the work', () => {
  const packedOn8th = {
    id: 'u1', stage: 'packed',
    times: { packStart: at('2026-09-08T16:00:00Z'), packEnd: at('2026-09-08T21:00:00Z') },
    steps: {}, vaults: [], media: [],
  }
  // No role on the session, and the roster now says mover.
  const oldPacking = [{ unitId: 'u1', uid: 'liv', userName: 'Liv Post', day: '2026-09-08', startedAt: at('2026-09-08T17:00:00Z'), endedAt: at('2026-09-08T20:00:00Z') }]
  const nowAMover = [{ uid: 'liv', name: 'Liv Post', role: 'mover' }]

  it('keeps the hours in the phase they were actually worked', () => {
    const s = unitSummary({ unit: packedOn8th, sessions: oldPacking, users: nowAMover })
    expect(s.packing.totalMs).toBe(3 * H)
    expect(s.loading.totalMs).toBe(0)
  })

  it('reads work after packing finished as loading, same person, same unit', () => {
    const after = [{ ...oldPacking[0], startedAt: at('2026-09-10T16:00:00Z'), endedAt: at('2026-09-10T17:00:00Z'), day: '2026-09-10' }]
    const s = unitSummary({ unit: packedOn8th, sessions: after, users: nowAMover })
    expect(s.loading.totalMs).toBe(H)
    expect(s.packing.totalMs).toBe(0)
  })

  it('lets a stamped role override the timeline, for a packer back to fix something', () => {
    const late = [{ ...oldPacking[0], role: 'packer', startedAt: at('2026-09-10T16:00:00Z'), endedAt: at('2026-09-10T17:00:00Z') }]
    expect(sessionPhase(late[0], packedOn8th, nowAMover)).toBe('packing')
  })

  // The roster is the last resort, reachable only on a unit that is past
  // packing but carries no packEnd to compare against.
  const noTimeline = { id: 'u1', stage: 'packed' }

  it('falls back to the roster only when there is no timeline left to read', () => {
    expect(sessionPhase(oldPacking[0], noTimeline, nowAMover)).toBe('loading')
    expect(sessionPhase(oldPacking[0], noTimeline, [{ uid: 'liv', role: 'packer' }])).toBe('packing')
  })

  it('classifies nothing rather than guessing for a stranger with no signal at all', () => {
    expect(sessionPhase({ uid: 'ghost' }, noTimeline, [])).toBe(null)
  })
})

/* The second half of the same bug, caught on the same live report.
 *
 * A unit still being packed has no packEnd to compare against, so the fix
 * above fell straight through to the roster and put Liv's in-progress packing
 * back in the loading column. Nothing can be loaded off a unit that is not
 * packed: the mover's checklist does not open until then. */
describe('a unit that is still being packed', () => {
  const midPack = { id: 'u9', stage: 'packing', times: { packStart: at('2026-09-10T16:00:00Z') }, steps: {}, vaults: [], media: [] }
  const live = [{ unitId: 'u9', uid: 'liv', userName: 'Liv Post', day: '2026-09-10', startedAt: at('2026-09-10T16:00:00Z'), endedAt: at('2026-09-10T18:00:00Z') }]
  const nowAMover = [{ uid: 'liv', name: 'Liv Post', role: 'mover' }]

  it('counts the time as packing whatever the roster says today', () => {
    const s = unitSummary({ unit: midPack, sessions: live, users: nowAMover })
    expect(s.packing.totalMs).toBe(2 * H)
    expect(s.loading.totalMs).toBe(0)
  })

  it('holds for a unit nobody has started, where somebody is just looking', () => {
    expect(sessionPhase(live[0], { id: 'u9', stage: 'not_started' }, nowAMover)).toBe('packing')
  })

  it('stops applying the moment the unit is packed', () => {
    expect(sessionPhase(live[0], { id: 'u9', stage: 'packed' }, nowAMover)).toBe('loading')
  })
})
