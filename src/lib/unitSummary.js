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
  PACKING_STEPS, LOADING_STEPS, STAGES, CARTON_TYPES, SUPPLY_TYPES, VAULT_PARTS,
  vaultsOf, vaultTouchedAt, completeVaults, vaultComplete,
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

/* Which phase an hour belongs to.
 *
 * The stamped role is the truth of who somebody was at the time, so it wins.
 * When it is missing, the unit's OWN timeline beats today's roster: packing is
 * over at packEnd by definition, so a session that started after it is
 * loading and one before it is packing.
 *
 * That ordering is not academic. Liv packed two apartments on the 8th, and on
 * the 10th her role was changed to mover for the move-out. Reading the roster
 * first reclassified two days of her packing as loading and moved 3h 20m into
 * the wrong column on a live report. The unit's timeline does not move when
 * somebody's job title does.
 */
export function sessionPhase(session, unit, users) {
  if (session && session.role === 'packer') return 'packing'
  if (session && session.role === 'mover') return 'loading'

  const packEnd = unit && unit.times && unit.times.packEnd
  if (packEnd && session && session.startedAt) {
    return session.startedAt >= packEnd ? 'loading' : 'packing'
  }

  // A unit that has not reached "packed" cannot be being loaded: the mover's
  // checklist does not open until then. So every hour on it is packing,
  // whatever the roster says. This is the case that caught Liv while she was
  // mid-pack on 901, where there is no packEnd to compare against yet.
  if (unit && STAGES.indexOf(unit.stage || 'not_started') < STAGES.indexOf('packed')) {
    return 'packing'
  }

  const role = sessionRole(session, users)
  if (role === 'mover') return 'loading'
  if (role === 'packer') return 'packing'
  return null
}

// Labour on one unit for one phase, broken down per person.
function labourFor(sessions, unit, users, phase, now, timeEntries) {
  const unitId = unit && unit.id
  const by = new Map()
  let totalMs = 0
  for (const s of sessions || []) {
    if (!s || s.unitId !== unitId) continue
    if (sessionPhase(s, unit, users) !== phase) continue
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
    ...labourFor(sessions, unit, users, 'packing', now, timeEntries),
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
    ...labourFor(sessions, unit, users, 'loading', now, timeEntries),
  }
}

/* Everything consumed on a unit as one list.
 *
 * Cartons and supplies are stored separately because a roll of tape must never
 * inflate the box count that billing and restock read. On the page they are
 * one question: what did this apartment use. So the split stays in the data
 * and the list is joined here.
 */
export const MATERIAL_TYPES = [...CARTON_TYPES, ...SUPPLY_TYPES]

export function materialLines(unit) {
  const counts = { ...((unit && unit.materials) || {}), ...((unit && unit.supplies) || {}) }
  return MATERIAL_TYPES
    .map((t) => {
      const v = Number(counts[t.key])
      return { key: t.key, label: t.label, count: Number.isFinite(v) && v > 0 ? Math.floor(v) : 0 }
    })
    .filter((r) => r.count > 0)
}

// Who actually handled a vault: whoever opened it and whoever shot either
// door. Usually one person, sometimes two when one crew fills it and another
// seals it, and both deserve the credit.
export function vaultCrew(vault) {
  const names = [vault && vault.userName, ...VAULT_PARTS.map((p) => vault && vault[p.key] && vault[p.key].userName)]
  return [...new Set(names.filter(Boolean))]
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
      // One list of everything used, which is the question people ask.
      lines: materialLines(unit),
      total: sumCartons(unit && unit.materials) + sumSupplies(unit && unit.supplies),
    },
    vaults: {
      started: vaults.length,
      complete: completeVaults(unit).length,
      numbers: vaults.map((v) => v.number).filter(Boolean),
      list: vaults.map((v) => ({
        number: v.number,
        complete: vaultComplete(v),
        by: vaultCrew(v),
        at: vaultTouchedAt(v),
      })),
    },
    media: {
      photos: media.filter((m) => m && m.kind !== 'video').length,
      videos: media.filter((m) => m && m.kind === 'video').length,
    },
    mismatches: mismatches(unit),
  }
}

/* ---------------------------------------------------------------------------
 * The whole job
 *
 * The same breakdown, rolled up across every apartment in the building.
 *
 * The averages are the part to be careful with. Dividing total packing hours
 * by fifty apartments when two are packed is not an average, it is a wrong
 * number that looks like an average. Every rate here is taken only over the
 * units that actually finished that phase AND have recorded labour, and each
 * one carries the count it was taken over so nobody reads a rate off a sample
 * of one without knowing it.
 * ------------------------------------------------------------------------- */

// A unit is past a phase once its stage has moved beyond it.
const stageIndex = (unit) => STAGES.indexOf((unit && unit.stage) || 'not_started')
const packingDone = (unit) => stageIndex(unit) >= STAGES.indexOf('packed')
const loadingDone = (unit) => stageIndex(unit) >= STAGES.indexOf('loaded')

// A rate and the sample it came from, together, always. `per` is null rather
// than zero when nothing qualifies, so the UI can say "not enough yet" instead
// of showing a confident zero.
function rate(total, n) {
  return { per: n > 0 ? total / n : null, n }
}

export function jobSummary({ units = [], sessions = [], users = [], timeEntries = [], now = 0 } = {}) {
  const rows = units.map((unit) => ({
    unit,
    ...unitSummary({ unit, sessions, users, timeEntries, now }),
    packingDone: packingDone(unit),
    loadingDone: loadingDone(unit),
  }))

  const sum = (fn) => rows.reduce((n, r) => n + (fn(r) || 0), 0)
  const packingMs = sum((r) => r.packing.totalMs)
  const loadingMs = sum((r) => r.loading.totalMs)

  // Everyone who put time into the building, with their split.
  const crew = new Map()
  for (const r of rows) {
    for (const [phase, people] of [['packing', r.packing.people], ['loading', r.loading.people]]) {
      for (const p of people) {
        const row = crew.get(p.uid) || { uid: p.uid, userName: p.userName, packingMs: 0, loadingMs: 0, totalMs: 0, units: new Set() }
        row[`${phase}Ms`] += p.ms
        row.totalMs += p.ms
        row.units.add(r.unit.id)
        crew.set(p.uid, row)
      }
    }
  }

  const bounds = rows
    .flatMap((r) => [r.totals.startedAt, r.totals.finishedAt])
    .filter((n) => typeof n === 'number' && n > 0)

  // Rates come only from units that finished the phase and recorded labour.
  const packedWithTime = rows.filter((r) => r.packingDone && r.packing.totalMs > 0)
  const loadedWithTime = rows.filter((r) => r.loadingDone && r.loading.totalMs > 0)
  const packedUnits = rows.filter((r) => r.packingDone)

  const stageCounts = {}
  for (const s of STAGES) stageCounts[s] = 0
  for (const r of rows) {
    const s = (r.unit && r.unit.stage) || 'not_started'
    if (s in stageCounts) stageCounts[s] += 1
  }

  return {
    rows,
    units: {
      total: rows.length,
      byStage: stageCounts,
      packed: packedUnits.length,
      loaded: rows.filter((r) => r.loadingDone).length,
      started: rows.filter((r) => stageIndex(r.unit) > 0).length,
      notStarted: rows.filter((r) => stageIndex(r.unit) <= 0).length,
    },
    labour: { packingMs, loadingMs, totalMs: packingMs + loadingMs },
    span: span(bounds),
    crew: [...crew.values()]
      .map((r) => ({ ...r, units: r.units.size }))
      .sort((a, b) => b.totalMs - a.totalMs),
    totals: {
      pieces: sum((r) => r.inventory.pieces),
      materials: {
        total: sum((r) => r.materials.total),
        lines: MATERIAL_TYPES
          .map((t) => ({
            key: t.key,
            label: t.label,
            count: sum((r) => (r.materials.lines.find((m) => m.key === t.key) || {}).count),
          }))
          .filter((r) => r.count > 0),
      },
      vaultsStarted: sum((r) => r.vaults.started),
      vaultsComplete: sum((r) => r.vaults.complete),
      photos: sum((r) => r.media.photos),
      videos: sum((r) => r.media.videos),
      mismatches: sum((r) => r.mismatches.length),
    },
    averages: {
      packingMs: rate(packingMs, packedWithTime.length),
      loadingMs: rate(loadingMs, loadedWithTime.length),
      pieces: rate(packedUnits.reduce((n, r) => n + (r.inventory.pieces || 0), 0), packedUnits.length),
      materials: rate(packedUnits.reduce((n, r) => n + r.materials.total, 0), packedUnits.length),
      vaults: rate(
        rows.filter((r) => r.loadingDone).reduce((n, r) => n + r.vaults.complete, 0),
        rows.filter((r) => r.loadingDone).length,
      ),
    },
  }
}

/* What the rest of the building is likely to take.
 *
 * Deliberately separate from jobSummary and deliberately explicit about its
 * own sample. A projection off two apartments is a guess, and calling it one
 * in the return value is the only thing that keeps it honest as the building
 * fills in and the number gets good.
 */
export function projection(job) {
  const remainingToPack = job.units.total - job.units.packed
  const remainingToLoad = job.units.total - job.units.loaded
  const pack = job.averages.packingMs
  const load = job.averages.loadingMs
  return {
    remainingToPack,
    remainingToLoad,
    packingMs: pack.per == null ? null : pack.per * remainingToPack,
    loadingMs: load.per == null ? null : load.per * remainingToLoad,
    materials: job.averages.materials.per == null ? null : Math.round(job.averages.materials.per * remainingToPack),
    vaults: job.averages.vaults.per == null ? null : Math.round(job.averages.vaults.per * remainingToLoad),
    // Every projection carries its own sample. basedOn is the strongest of
    // them, used only to decide how loudly to hedge, because a single number
    // cannot describe four lines resting on different amounts of evidence.
    basedOn: Math.max(pack.n || 0, load.n || 0),
    packSample: pack.n,
    loadSample: load.n,
    materialSample: job.averages.materials.n,
    vaultSample: job.averages.vaults.n,
  }
}
