import { describe, it, expect } from 'vitest'
import { computeUserReport, computeAllReports, summarizeRoster, fmtDuration, reportsToCSV } from '../reports.js'

const packer = { id: 'u-packer', name: 'Sam Packer', role: 'packer', status: 'active' }
const mover = { id: 'u-mover', name: 'Ali Mover', role: 'mover', status: 'active' }
const warehouse = { id: 'u-wh', name: 'Robin Warehouse', role: 'warehouse', status: 'active' }
const idle = { id: 'u-idle', name: 'Jo Idle', role: 'viewer', status: 'active' }

function baseState(overrides = {}) {
  return { units: [], containers: [], overflow: [], events: [], users: [], ...overrides }
}

describe('computeUserReport: packer', () => {
  const units = [
    { id: 'unit-1', pieces: 12, crew: { packers: ['u-packer'], movers: [] }, times: { packStart: 1000, packEnd: 4000 } },
    { id: 'unit-2', pieces: 8, crew: { packers: ['u-packer'], movers: [] }, times: { packStart: 2000, packEnd: 5000 } },
    { id: 'unit-3', pieces: 5, crew: { packers: ['u-mover'], movers: [] } }, // not this packer
  ]
  const state = baseState({ units })
  const r = computeUserReport(state, packer)

  it('counts distinct units packed', () => expect(r.unitsPackedCount).toBe(2))
  it('sums pieces over packed units only', () => expect(r.piecesPacked).toBe(20))
  it('sums pack time across units', () => expect(r.packTimeMs).toBe(3000 + 3000))
  it('averages pack time per unit', () => expect(r.avgPackTimeMs).toBe(3000))
  it('does not count loads', () => expect(r.unitsLoadedCount).toBe(0))
})

describe('computeUserReport: mover (loads)', () => {
  const units = [
    { id: 'unit-1', pieces: 10, crew: { packers: [], movers: ['u-mover'] } },
    { id: 'unit-2', pieces: 6, crew: { packers: [], movers: ['u-mover'] } },
  ]
  const state = baseState({ units })
  const r = computeUserReport(state, mover)

  it('counts distinct units loaded', () => expect(r.unitsLoadedCount).toBe(2))
  it('sums pieces over loaded units', () => expect(r.piecesLoaded).toBe(16))
  it('reports no packing time (loads have no start/stop)', () => {
    expect(r.packTimeMs).toBe(0)
    expect(r.avgPackTimeMs).toBe(0)
  })
  it('does not count packs', () => expect(r.unitsPackedCount).toBe(0))
})

// Return-leg crew: unpackUnit/unloadReturn credit crew.unpackers/crew.unloaders
// (not crew.packers/crew.movers), so return-only work must never show up as
// outbound packing/loading, and outbound counts must never pick up return
// work (docs/superpowers/specs/2026-08-27-return-leg-correctness-fixes.md #4).
describe('computeUserReport: return-leg crew (unpackers/unloaders)', () => {
  const units = [
    { id: 'unit-1', pieces: 10, crew: { packers: [], movers: [], unpackers: ['u-packer'], unloaders: [] } },
    { id: 'unit-2', pieces: 6, crew: { packers: [], movers: [], unpackers: [], unloaders: ['u-mover'] } },
    { id: 'unit-3', pieces: 4, crew: { packers: [], movers: [], unpackers: ['u-packer'], unloaders: ['u-mover'] } },
  ]
  const state = baseState({ units })
  const packerReport = computeUserReport(state, packer)
  const moverReport = computeUserReport(state, mover)

  it('counts distinct units unpacked, separate from units packed', () => {
    expect(packerReport.unitsUnpackedCount).toBe(2)
    expect(packerReport.unitsPackedCount).toBe(0)
  })
  it('counts distinct units unloaded, separate from units loaded', () => {
    expect(moverReport.unitsUnloadedCount).toBe(2)
    expect(moverReport.unitsLoadedCount).toBe(0)
  })
  it('outbound counts are unaffected by units with no outbound crew, only return crew', () => {
    const outboundOnly = baseState({
      units: [{ id: 'unit-1', pieces: 10, crew: { packers: ['u-packer'], movers: ['u-mover'], unpackers: ['u-packer'], unloaders: ['u-mover'] } }],
    })
    const p = computeUserReport(outboundOnly, packer)
    const m = computeUserReport(outboundOnly, mover)
    expect(p.unitsPackedCount).toBe(1)
    expect(p.unitsUnpackedCount).toBe(1)
    expect(m.unitsLoadedCount).toBe(1)
    expect(m.unitsUnloadedCount).toBe(1)
  })
  it('handles units missing the unpackers/unloaders arrays without crashing', () => {
    const legacy = baseState({ units: [{ id: 'unit-x', crew: { packers: [], movers: [] } }] })
    expect(() => computeUserReport(legacy, packer)).not.toThrow()
    const r = computeUserReport(legacy, packer)
    expect(r.unitsUnpackedCount).toBe(0)
    expect(r.unitsUnloadedCount).toBe(0)
  })
})

describe('computeUserReport: warehouse user (receives)', () => {
  const containers = [
    { id: 'c-1', receivedBy: 'u-wh' },
    { id: 'c-2', receivedBy: 'u-wh' },
    { id: 'c-3', receivedBy: 'someone-else' },
  ]
  const overflow = [
    { id: 'o-1', receivedBy: 'u-wh' },
  ]
  const state = baseState({ containers, overflow })
  const r = computeUserReport(state, warehouse)

  it('counts containers received', () => expect(r.containersReceived).toBe(2))
  it('counts overflow items received', () => expect(r.overflowReceived).toBe(1))
  it('does not count handoffs it did not do', () => expect(r.containersHandedOff).toBe(0))
})

describe('computeUserReport: zero-activity user', () => {
  const state = baseState({
    units: [{ id: 'unit-1', pieces: 4, crew: { packers: ['someone-else'], movers: [] } }],
  })
  const r = computeUserReport(state, idle)

  it('is all zeros, never NaN or undefined', () => {
    expect(r.unitsPackedCount).toBe(0)
    expect(r.unitsLoadedCount).toBe(0)
    expect(r.unitsUnpackedCount).toBe(0)
    expect(r.unitsUnloadedCount).toBe(0)
    expect(r.piecesPacked).toBe(0)
    expect(r.piecesLoaded).toBe(0)
    expect(r.piecesHandled).toBe(0)
    expect(r.photosSubmitted).toBe(0)
    expect(r.videosSubmitted).toBe(0)
    expect(r.packTimeMs).toBe(0)
    expect(r.avgPackTimeMs).toBe(0)
    expect(r.totalActions).toBe(0)
    expect(r.activeDays).toBe(0)
    expect(r.firstActivityTs).toBe(null)
    expect(r.lastActivityTs).toBe(null)
    for (const v of Object.values(r)) {
      expect(Number.isNaN(v)).toBe(false)
    }
  })

  it('does not crash on units missing pieces/times/crew fields', () => {
    const messy = baseState({ units: [{ id: 'unit-x' }, { id: 'unit-y', crew: {} }] })
    expect(() => computeUserReport(messy, idle)).not.toThrow()
    const r2 = computeUserReport(messy, idle)
    expect(r2.unitsPackedCount).toBe(0)
    expect(r2.piecesPacked).toBe(0)
  })
})

describe('media counting by kind', () => {
  const events = [
    { id: 'e1', uid: 'u-packer', type: 'media', ts: 1000, media: [{ id: 'm1', kind: 'photo', uid: 'u-packer' }, { id: 'm2', kind: 'video', uid: 'u-packer' }] },
    // old data: media object has no uid of its own, falls back to event uid
    { id: 'e2', uid: 'u-packer', type: 'media', ts: 2000, media: [{ id: 'm3', kind: 'photo' }] },
    // media attributed to a different user than the event actor (e.g. handoff photo)
    { id: 'e3', uid: 'u-mover', type: 'system', ts: 3000, media: [{ id: 'm4', kind: 'photo', uid: 'u-packer' }] },
    // someone else's media, should not count
    { id: 'e4', uid: 'u-mover', type: 'media', ts: 4000, media: [{ id: 'm5', kind: 'photo', uid: 'u-mover' }] },
  ]
  const state = baseState({ events })
  const r = computeUserReport(state, packer)

  it('counts photos, preferring media uid, falling back to event uid', () => expect(r.photosSubmitted).toBe(3))
  it('counts videos', () => expect(r.videosSubmitted).toBe(1))
  it('combines into a media total', () => expect(r.mediaSubmitted).toBe(4))
})

describe('distinct-unit counting (no double count)', () => {
  it('counts a unit once even with multiple events logged against it', () => {
    const units = [{ id: 'unit-1', pieces: 10, crew: { packers: ['u-packer'], movers: [] } }]
    const events = [
      { id: 'e1', uid: 'u-packer', type: 'stage', ts: 1000, unitId: 'unit-1' },
      { id: 'e2', uid: 'u-packer', type: 'stage', ts: 2000, unitId: 'unit-1' },
      { id: 'e3', uid: 'u-packer', type: 'note', ts: 3000, unitId: 'unit-1' },
    ]
    const state = baseState({ units, events })
    const r = computeUserReport(state, packer)
    expect(r.unitsPackedCount).toBe(1)
    // action count is a separate metric and does count each event
    expect(r.totalActions).toBe(3)
  })
})

describe('action-type breakdown and active window', () => {
  const events = [
    { id: 'e1', uid: 'u-packer', type: 'stage', ts: Date.UTC(2026, 7, 1, 9) },
    { id: 'e2', uid: 'u-packer', type: 'stage', ts: Date.UTC(2026, 7, 1, 15) },
    { id: 'e3', uid: 'u-packer', type: 'flag', ts: Date.UTC(2026, 7, 3, 10) },
  ]
  const state = baseState({ events })
  const r = computeUserReport(state, packer)

  it('breaks down actions by type', () => {
    expect(r.actionTypes.stage).toBe(2)
    expect(r.actionTypes.flag).toBe(1)
    expect(r.actionTypes.note).toBe(0)
  })
  it('counts distinct active days, not events', () => expect(r.activeDays).toBe(2))
  it('tracks first/last activity', () => {
    expect(r.firstActivityTs).toBe(events[0].ts)
    expect(r.lastActivityTs).toBe(events[2].ts)
  })
})

describe('computeAllReports', () => {
  it('only includes active users, sorted by total actions descending', () => {
    const users = [
      { id: 'u1', name: 'A', role: 'packer', status: 'active' },
      { id: 'u2', name: 'B', role: 'mover', status: 'active' },
      { id: 'u3', name: 'C', role: 'packer', status: 'pending' },
    ]
    const events = [
      { id: 'e1', uid: 'u1', type: 'stage', ts: 1 },
      { id: 'e2', uid: 'u2', type: 'stage', ts: 2 },
      { id: 'e3', uid: 'u2', type: 'stage', ts: 3 },
    ]
    const state = baseState({ users, events })
    const reports = computeAllReports(state, users)
    expect(reports.map((r) => r.uid)).toEqual(['u2', 'u1'])
  })

  it('returns an empty array, never throws, on a brand-new project', () => {
    expect(() => computeAllReports(baseState(), [])).not.toThrow()
    expect(computeAllReports(baseState(), [])).toEqual([])
  })
})

describe('summarizeRoster', () => {
  it('sums fields across reports without crashing on an empty roster', () => {
    expect(summarizeRoster([])).toMatchObject({ people: 0, totalActions: 0, piecesHandled: 0 })
  })
  it('adds up reports', () => {
    const state = baseState({
      users: [packer, mover],
      units: [
        { id: 'unit-1', pieces: 10, crew: { packers: ['u-packer'], movers: [] } },
        { id: 'unit-2', pieces: 5, crew: { packers: [], movers: ['u-mover'] } },
      ],
    })
    const reports = computeAllReports(state, [packer, mover])
    const s = summarizeRoster(reports)
    expect(s.people).toBe(2)
    expect(s.piecesHandled).toBe(15)
  })
})

describe('fmtDuration', () => {
  it('formats minutes only under an hour', () => expect(fmtDuration(25 * 60000)).toBe('25m'))
  it('formats hours and minutes', () => expect(fmtDuration(90 * 60000)).toBe('1h 30m'))
  it('never NaNs on missing input', () => expect(fmtDuration(undefined)).toBe('0m'))
})

describe('reportsToCSV', () => {
  it('produces a header row plus one row per report', () => {
    const reports = computeAllReports(baseState({ users: [packer] }), [packer])
    const csv = reportsToCSV(reports)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Name')
    expect(lines[1]).toContain('Sam Packer')
  })
  it('handles an empty report list', () => {
    expect(reportsToCSV([]).split('\n')).toHaveLength(1)
  })
})
