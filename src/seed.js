// Deterministic demo dataset for MoveTrack.
// Everything is generated from a fixed seed so the demo looks the same on every reset.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = ['James', 'Maria', 'Robert', 'Linda', 'Ahmed', 'Susan', 'Carlos', 'Karen', 'Wei', 'Nancy', 'Miguel', 'Lisa', 'David', 'Sandra', 'Omar', 'Ashley', 'Kevin', 'Emily', 'Brian', 'Michelle', 'Jorge', 'Amanda', 'Frank', 'Melissa', 'Tony', 'Stephanie', 'Raj', 'Rebecca', 'Sean', 'Laura', 'Victor', 'Anna', 'Derek', 'Julia', 'Hassan', 'Grace', 'Peter', 'Diane', 'Marcus', 'Helen']
const LAST = ['Johnson', 'Chen', 'Garcia', 'Smith', 'Patel', 'Brown', 'Rodriguez', 'Kim', 'Williams', 'Nguyen', 'Jones', 'Martinez', 'Davis', 'Ali', 'Miller', 'Lopez', 'Wilson', 'Torres', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Petrov', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams']

const UNIT_NOTES = [
  '', '', '', '', '', '', '',
  'Fragile: glass display cabinet in living room',
  'Tenant requests morning time slot',
  'Upright piano — needs 4-person crew',
  'Cat in unit — keep front door closed',
  'Tenant has mobility issues, coordinate with PM',
  'Extra wardrobe boxes needed',
  'Artwork on walls — use picture crates',
  'Tenant works nights — no entry before 11am',
  'Large sectional, may need hoisting straps',
]

const ROOMS = ['Living room', 'Kitchen', 'Main bedroom', 'Second bedroom', 'Bathroom', 'Hall closet', 'Balcony items', 'Dining area']
const ROOM_HUES = { 'Living room': 174, 'Kitchen': 32, 'Main bedroom': 258, 'Second bedroom': 285, 'Bathroom': 199, 'Hall closet': 20, 'Balcony items': 130, 'Dining area': 340 }

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function photoThumb(label, sub = '') {
  const hue = ROOM_HUES[label] ?? 210
  label = xml(label); sub = xml(sub)
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
<stop offset='0' stop-color='hsl(${hue},45%,26%)'/><stop offset='1' stop-color='hsl(${hue},55%,14%)'/></linearGradient></defs>
<rect width='400' height='300' fill='url(#g)'/>
<g opacity='0.5' stroke='hsl(${hue},60%,70%)' stroke-width='3' fill='none'>
<rect x='140' y='120' width='70' height='55' rx='4'/><rect x='215' y='135' width='55' height='40' rx='4'/>
<rect x='165' y='85' width='60' height='32' rx='4'/><path d='M140 147h70M175 120v55'/></g>
<text x='200' y='225' font-family='Arial' font-size='21' font-weight='bold' fill='hsl(${hue},50%,85%)' text-anchor='middle'>${label}</text>
<text x='200' y='250' font-family='Arial' font-size='14' fill='hsl(${hue},40%,70%)' text-anchor='middle'>${sub}</text>
<text x='388' y='290' font-family='Arial' font-size='11' fill='hsl(${hue},30%,60%)' text-anchor='end'>DEMO PHOTO · GM MoveTrack</text>
</svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

export const STAGES = [
  { key: 'not_started', label: 'Not started', short: 'Not started', color: '#8a93a2', step: 0 },
  { key: 'packing', label: 'Packing & prep', short: 'Packing', color: '#14b8a6', step: 1 },
  { key: 'packed', label: 'Packed — ready to load', short: 'Packed', color: '#0d9488', step: 2 },
  { key: 'staged', label: 'In container on site', short: 'In container', color: '#8b5cf6', step: 3 },
  { key: 'in_transit', label: 'En route to warehouse', short: 'In transit', color: '#f97316', step: 4 },
  { key: 'warehouse', label: 'In warehouse', short: 'Warehouse', color: '#3b82f6', step: 5 },
  { key: 'return_transit', label: 'Returning to site', short: 'Returning', color: '#ec4899', step: 6 },
  { key: 'unloading', label: 'Back on site — unloading', short: 'Unloading', color: '#6366f1', step: 7 },
  { key: 'unpacking', label: 'Unpacking', short: 'Unpacking', color: '#06b6d4', step: 8 },
  { key: 'complete', label: 'Complete — signed off', short: 'Complete', color: '#22c55e', step: 9 },
]
export const stageOf = (key) => STAGES.find((s) => s.key === key)

// Units per floor — 9 floors, 100 units total, matching the real building's massing.
export const FLOOR_UNITS = { 1: 12, 2: 12, 3: 12, 4: 12, 5: 11, 6: 11, 7: 11, 8: 11, 9: 8 }

export const ROLES = {
  admin: { label: 'Admin', color: '#f59e0b' },
  packer: { label: 'Packer / prep', color: '#14b8a6' },
  mover: { label: 'Mover', color: '#8b5cf6' },
  driver: { label: 'Pickup & delivery', color: '#f97316' },
  viewer: { label: 'Viewer (read-only)', color: '#3b82f6' },
}

export function buildSeed() {
  const rnd = mulberry32(20260713)
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
  const now = Date.now()
  const DAY = 86400000
  const projectStart = now - 21 * DAY

  const users = [
    { id: 'u-casey', name: 'Casey', email: 'casey@gorillamovers.com', role: 'admin', status: 'active' },
    { id: 'u-maria', name: 'Maria Lopez', email: 'maria@gorillamovers.com', role: 'packer', status: 'active' },
    { id: 'u-dev', name: 'Dev Patel', email: 'dev@gorillamovers.com', role: 'packer', status: 'active' },
    { id: 'u-tasha', name: 'Tasha Reed', email: 'tasha@gorillamovers.com', role: 'packer', status: 'active' },
    { id: 'u-jake', name: 'Jake Sullivan', email: 'jake@gorillamovers.com', role: 'mover', status: 'active' },
    { id: 'u-andre', name: 'Andre Brooks', email: 'andre@gorillamovers.com', role: 'mover', status: 'active' },
    { id: 'u-sam', name: 'Sam Ortiz', email: 'sam@gorillamovers.com', role: 'mover', status: 'active' },
    { id: 'u-mike', name: 'Mike Turner', email: 'mike@gorillamovers.com', role: 'driver', status: 'active' },
    { id: 'u-dana', name: 'Dana Whitfield', email: 'dana@parkviewpm.com', role: 'viewer', status: 'active', title: 'Property manager' },
    { id: 'u-robbie', name: 'Robbie Nguyen', email: 'robbie.n@gmail.com', role: null, status: 'pending', requestedAt: now - 0.6 * DAY },
  ]
  const byId = Object.fromEntries(users.map((u) => [u.id, u]))
  const packers = ['u-maria', 'u-dev', 'u-tasha']
  const movers = ['u-jake', 'u-andre', 'u-sam']

  // 100 units across 9 floors (like the real Trinity Manor): bigger floors low,
  // fewer units up top. Story: project is ~3 weeks in — low floors already in the
  // warehouse, middle floors mid-pipeline, top floors not started.
  const units = []
  const usedNames = new Set()
  let idx = 0
  for (let f = 1; f <= 9; f++) {
    for (let n = 1; n <= FLOOR_UNITS[f]; n++) {
      const number = `${f}${String(n).padStart(2, '0')}`
      let tenant
      do { tenant = `${pick(FIRST)} ${pick(LAST)}` } while (usedNames.has(tenant))
      usedNames.add(tenant)
      let stage
      if (idx < 26) stage = 'warehouse'
      else if (idx < 34) stage = 'in_transit'
      else if (idx < 46) stage = 'staged'
      else if (idx < 52) stage = 'packed'
      else if (idx < 62) stage = 'packing'
      else stage = 'not_started'
      units.push({
        id: `unit-${number}`,
        number,
        floor: f,
        tenant,
        phone: `(555) ${String(200 + Math.floor(rnd() * 700))}-${String(1000 + Math.floor(rnd() * 9000))}`,
        note: pick(UNIT_NOTES),
        stage,
        boxCount: null,
        containerIds: [],
        crew: {},
        flag: null,
      })
      idx++
    }
  }

  // Containers: C-01..C-40. Assign to units that are staged or beyond (~2 units per container).
  const containers = []
  for (let i = 1; i <= 40; i++) {
    containers.push({ id: `cont-${i}`, number: `C-${String(i).padStart(2, '0')}`, location: 'unassigned', bay: null, unitIds: [], flag: null })
  }
  const containedUnits = units.filter((u) => ['staged', 'in_transit', 'warehouse'].includes(u.stage))
  let ci = 0
  for (const u of containedUnits) {
    const c = containers[Math.floor(ci / 2)]
    c.unitIds.push(u.id)
    u.containerIds = [c.id]
    ci++
  }
  for (const c of containers) {
    if (!c.unitIds.length) continue
    const stages = c.unitIds.map((uid) => units.find((u) => u.id === uid).stage)
    if (stages.includes('warehouse')) { c.location = 'warehouse'; c.bay = `Bay ${1 + (parseInt(c.id.split('-')[1]) % 9)}` }
    else if (stages.includes('in_transit')) c.location = 'transit'
    else c.location = 'site'
  }

  // Activity history. Every event: who, what, when — the audit trail.
  const events = []
  let eid = 0
  const ev = (ts, userId, type, action, extra = {}) => {
    events.push({ id: `ev-${++eid}`, ts: Math.round(ts), userId, userName: byId[userId].name, role: byId[userId].role || 'pending', type, action, ...extra })
  }

  ev(projectStart, 'u-casey', 'system', 'Project created: Trinity Manor relocation — 100 units')
  ev(projectStart + 0.1 * DAY, 'u-casey', 'system', 'Crew roster approved: 3 packers, 3 movers, 1 driver, 1 viewer')

  for (const u of units) {
    const s = stageOf(u.stage).step
    if (s < 1) continue
    const idx = units.indexOf(u)
    const base = projectStart + 0.5 * DAY + idx * 0.16 * DAY
    const packer = packers[idx % 3]
    const mover = movers[idx % 3]
    u.crew.packer = packer

    ev(base, packer, 'stage', `Started packing unit ${u.number}`, { unitId: u.id, from: 'not_started', to: 'packing' })
    const nPhotos = 3 + Math.floor(rnd() * 3)
    const media = []
    for (let p = 0; p < nPhotos; p++) {
      const room = ROOMS[(idx + p) % ROOMS.length]
      media.push({ id: `m-${eid}-${p}`, kind: 'photo', label: room, url: photoThumb(room, `Unit ${u.number} — before packing`) })
    }
    ev(base + 0.02 * DAY, packer, 'media', `Added ${nPhotos} photos — pre-pack condition, unit ${u.number}`, { unitId: u.id, media })
    if (rnd() < 0.4) {
      ev(base + 0.05 * DAY, packer, 'note', pick([
        'Kitchen fragile items double-wrapped.',
        'Tenant present during packing, walked through inventory together.',
        'TV boxed in original packaging tenant kept.',
        'Two wardrobe boxes used for closet.',
        'Mirror crated. Marked FRAGILE on all sides.',
      ]), { unitId: u.id })
    }

    if (s < 2) continue
    const boxes = 12 + Math.floor(rnd() * 22)
    u.boxCount = boxes
    const packedMedia = [{ id: `m-${eid}-p`, kind: 'photo', label: 'Boxes stacked', url: photoThumb('Hall closet', `${boxes} boxes sealed & labeled`) }]
    ev(base + 0.3 * DAY, packer, 'stage', `Finished packing unit ${u.number} — ${boxes} boxes sealed & labeled`, { unitId: u.id, from: 'packing', to: 'packed', media: packedMedia })

    if (s < 3) continue
    u.crew.mover = mover
    const cont = containers.find((c) => c.id === u.containerIds[0])
    const mismatch = u.number === '305'
    const loaded = mismatch ? boxes - 1 : boxes
    ev(base + 0.55 * DAY, mover, 'stage', `Loaded unit ${u.number} into container ${cont.number} — ${loaded} of ${boxes} boxes verified`, { unitId: u.id, containerId: cont.id, from: 'packed', to: 'staged' })
    if (mismatch) {
      u.flag = { message: `Box count mismatch at load: ${loaded} loaded vs ${boxes} packed. Recount pending.`, ts: Math.round(base + 0.56 * DAY), by: byId[mover].name, open: true }
      ev(base + 0.56 * DAY, mover, 'flag', `FLAG raised on unit ${u.number}: box count mismatch (${loaded}/${boxes})`, { unitId: u.id })
    }

    if (s < 4) continue
    ev(base + 1.1 * DAY, 'u-mike', 'stage', `Container ${cont.number} picked up from site (incl. unit ${u.number})`, { unitId: u.id, containerId: cont.id, from: 'staged', to: 'in_transit' })

    if (s < 5) continue
    ev(base + 1.25 * DAY, 'u-mike', 'stage', `Container ${cont.number} checked into warehouse — ${cont.bay || 'Bay 3'} (incl. unit ${u.number})`, { unitId: u.id, containerId: cont.id, from: 'in_transit', to: 'warehouse' })
  }

  // A resolved flag for the demo story (unit 205 is safely in the warehouse).
  const u205 = units.find((u) => u.number === '205')
  if (u205) {
    u205.flag = { message: 'Tenant reported missing lamp — found labeled under wrong room. Resolved.', ts: now - 2 * DAY, by: 'Casey', open: false }
    ev(now - 2.1 * DAY, 'u-dana', 'note', 'PM relayed tenant concern: table lamp not on inventory for unit 205.', { unitId: u205.id })
    ev(now - 2 * DAY, 'u-casey', 'flag', 'FLAG resolved on unit 205: lamp located in Hall closet box 205-14. Photo confirmed with tenant.', { unitId: u205.id })
  }

  events.sort((a, b) => a.ts - b.ts)
  return { users, units, containers, events, project: { name: 'Trinity Manor', address: '3940 Park Blvd', startedAt: projectStart } }
}
