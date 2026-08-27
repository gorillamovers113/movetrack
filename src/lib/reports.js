// Per-user productivity analytics, computed from existing state (units,
// containers, overflow, events). Pure and deterministic: no Date.now() or
// other ambient state is read in here, so the same `state` always produces
// the same report. See docs/superpowers/specs/2026-08-26-per-user-reports-design.md
// for what is and isn't computable from the current data model.
//
// Every numeric field is guarded to a zero-fallback: old/partial docs
// (missing `pieces`, missing `times`, missing `media`) must never surface as
// NaN or undefined on screen.

const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

// Distinct units where `uid` appears in the given crew array field
// (`crew.packers` or `crew.movers`). Units is already a deduped array of
// docs, so filtering it can never double-count a unit the way scanning the
// events log could (a unit with two "finishPacking" events, for example).
function unitsWithCrew(units, uid, field) {
  return (units || []).filter((u) => Array.isArray(u?.crew?.[field]) && u.crew[field].includes(uid))
}

function sumPieces(units) {
  return units.reduce((n, u) => n + num(u.pieces), 0)
}

// Sum of times.packEnd - times.packStart over the units this uid packed.
// Only counts a unit toward the sum/average when both timestamps are
// present and numeric and packEnd is not before packStart (guards bad or
// half-written data instead of producing a negative or NaN duration).
function packTimeStats(unitsPacked) {
  let totalMs = 0
  let countedUnits = 0
  for (const u of unitsPacked) {
    const start = u?.times?.packStart
    const end = u?.times?.packEnd
    if (typeof start === 'number' && typeof end === 'number' && end >= start) {
      totalMs += end - start
      countedUnits += 1
    }
  }
  const avgMs = countedUnits > 0 ? Math.round(totalMs / countedUnits) : 0
  return { totalMs, avgMs, countedUnits }
}

// Photos/videos attributed to `uid`, counted across every event's media
// array (not just events the uid authored) since a media object's own
// attribution (m.uid, stamped by store.jsx's attributeMedia) is the source
// of truth for "who submitted it." Old media saved before attribution
// existed falls back to the event's uid.
function mediaByKind(events, uid) {
  const byKind = { photo: 0, video: 0 }
  for (const e of events || []) {
    for (const m of e.media || []) {
      const attributedUid = m.uid || e.uid
      if (attributedUid !== uid) continue
      const kind = m.kind === 'video' ? 'video' : 'photo'
      byKind[kind] += 1
    }
  }
  return byKind
}

function actionTypeBreakdown(userEvents) {
  const breakdown = { stage: 0, media: 0, note: 0, flag: 0, system: 0 }
  for (const e of userEvents) {
    const t = breakdown.hasOwnProperty(e.type) ? e.type : 'system'
    breakdown[t] += 1
  }
  return breakdown
}

function activeDaySet(userEvents) {
  const days = new Set()
  for (const e of userEvents) {
    if (typeof e.ts === 'number') days.add(new Date(e.ts).toISOString().slice(0, 10))
  }
  return days
}

// Full metrics object for a single user. `user` is a users/{uid} doc
// ({ id, name, role, ... }); `state` is the store's { units, containers,
// overflow, events } shape.
export function computeUserReport(state, user) {
  const uid = user.id
  const units = state.units || []
  const containers = state.containers || []
  const overflow = state.overflow || []
  const events = state.events || []

  const unitsPacked = unitsWithCrew(units, uid, 'packers')
  const unitsLoaded = unitsWithCrew(units, uid, 'movers')
  const piecesPacked = sumPieces(unitsPacked)
  const piecesLoaded = sumPieces(unitsLoaded)
  const pack = packTimeStats(unitsPacked)

  const overflowPrepped = overflow.filter((o) => o.prepBy === uid).length
  const overflowTransported = overflow.filter((o) => o.transportBy === uid).length
  const overflowReceived = overflow.filter((o) => o.receivedBy === uid).length
  const containersHandedOff = containers.filter((c) => c.handoffBy === uid).length
  const containersReceived = containers.filter((c) => c.receivedBy === uid).length

  const media = mediaByKind(events, uid)
  const userEvents = events.filter((e) => e.uid === uid)
  const actionTypes = actionTypeBreakdown(userEvents)
  const days = activeDaySet(userEvents)
  const timestamps = userEvents.map((e) => e.ts).filter((ts) => typeof ts === 'number')

  return {
    uid,
    name: user.name || 'Unknown',
    role: user.role || null,

    unitsPackedCount: unitsPacked.length,
    unitsLoadedCount: unitsLoaded.length,
    piecesPacked,
    piecesLoaded,
    piecesHandled: piecesPacked + piecesLoaded,

    overflowPrepped,
    overflowTransported,
    overflowReceived,
    containersHandedOff,
    containersReceived,

    photosSubmitted: media.photo,
    videosSubmitted: media.video,
    mediaSubmitted: media.photo + media.video,

    packTimeMs: pack.totalMs,
    avgPackTimeMs: pack.avgMs,
    packTimeUnitCount: pack.countedUnits,

    totalActions: userEvents.length,
    actionTypes,

    firstActivityTs: timestamps.length ? Math.min(...timestamps) : null,
    lastActivityTs: timestamps.length ? Math.max(...timestamps) : null,
    activeDays: days.size,
  }
}

// Reports for every active user, ordered by total actions (busiest first)
// so the roster reads like a leaderboard on first load. Ties keep the
// users' existing relative order (Array#sort is stable).
export function computeAllReports(state, users) {
  const active = (users || state.users || []).filter((u) => u.status === 'active')
  return active.map((u) => computeUserReport(state, u)).sort((a, b) => b.totalActions - a.totalActions)
}

// Roster-level totals, e.g. for a summary strip above the per-user list.
export function summarizeRoster(reports) {
  const init = {
    people: reports.length,
    unitsPackedCount: 0, unitsLoadedCount: 0, piecesHandled: 0,
    photosSubmitted: 0, videosSubmitted: 0, mediaSubmitted: 0,
    packTimeMs: 0, totalActions: 0,
  }
  return reports.reduce((sum, r) => ({
    people: sum.people,
    unitsPackedCount: sum.unitsPackedCount + r.unitsPackedCount,
    unitsLoadedCount: sum.unitsLoadedCount + r.unitsLoadedCount,
    piecesHandled: sum.piecesHandled + r.piecesHandled,
    photosSubmitted: sum.photosSubmitted + r.photosSubmitted,
    videosSubmitted: sum.videosSubmitted + r.videosSubmitted,
    mediaSubmitted: sum.mediaSubmitted + r.mediaSubmitted,
    packTimeMs: sum.packTimeMs + r.packTimeMs,
    totalActions: sum.totalActions + r.totalActions,
  }), init)
}

// Human-readable "Xh Ym" (or "Ym", or "0m") for a millisecond duration.
// Kept here (not in a component) so both the view and the CSV export can
// share one formatting rule.
export function fmtDuration(ms) {
  const totalMin = Math.round(num(ms) / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m}m`
  return `${h}h ${m}m`
}

// One row per user, matching the headline metrics shown in the view. Mirrors
// the small CSV-building pattern in store.jsx's exportActivityCSV, but lives
// here (not store.jsx) since this is read-only reporting, not a store write.
export function reportsToCSV(reports) {
  const esc = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"'
  const header = [
    'Name', 'Role', 'Units packed', 'Units loaded', 'Pieces packed', 'Pieces loaded',
    'Photos submitted', 'Videos submitted', 'Packing time (min)', 'Avg packing time (min)',
    'Total actions', 'Active days', 'First activity', 'Last activity',
  ]
  const rows = [header.map(esc).join(',')]
  for (const r of reports) {
    rows.push([
      esc(r.name), esc(r.role), r.unitsPackedCount, r.unitsLoadedCount, r.piecesPacked, r.piecesLoaded,
      r.photosSubmitted, r.videosSubmitted, Math.round(r.packTimeMs / 60000), Math.round(r.avgPackTimeMs / 60000),
      r.totalActions, r.activeDays,
      esc(r.firstActivityTs ? new Date(r.firstActivityTs).toLocaleString('en-US') : ''),
      esc(r.lastActivityTs ? new Date(r.lastActivityTs).toLocaleString('en-US') : ''),
    ].join(','))
  }
  return rows.join('\n')
}
