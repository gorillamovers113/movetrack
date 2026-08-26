// Stage/role vocabulary + photo-placeholder generator for MoveTrack.
// (The old deterministic demo-data generator, buildSeed(), lived here and is
// gone — see M1 in the final review: it was dead code, unimported, and
// modeled the stale round-trip stage strings. Real data now comes from
// Firestore; scripts/seed-schedule.mjs seeds only `schedule` + the admin.)

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

// Phase-1 one-way lifecycle (matches src/lib/mutations.js STAGES): the project
// ends at the BigBox warehouse — no return trip / unload / sign-off yet.
export const STAGES = [
  { key: 'not_started', label: 'Not started', short: 'Not started', color: '#8a93a2', step: 0 },
  { key: 'packing', label: 'Packing & prep', short: 'Packing', color: '#14b8a6', step: 1 },
  { key: 'packed', label: 'Packed — ready to load', short: 'Packed', color: '#0d9488', step: 2 },
  { key: 'loaded', label: 'Loaded in container on site', short: 'Loaded', color: '#8b5cf6', step: 3 },
  { key: 'picked_up', label: 'Picked up — en route to warehouse', short: 'Picked up', color: '#f97316', step: 4 },
  { key: 'at_warehouse', label: 'In warehouse', short: 'Warehouse', color: '#3b82f6', step: 5 },
]
// Safe fallback for an unrecognized/typo'd stage string — callers can rely on
// stageOf() always returning a renderable stage object instead of undefined.
const UNKNOWN_STAGE = { key: 'unknown', label: 'Unknown stage', short: 'Unknown', color: '#8a93a2', step: 0 }
export const stageOf = (key) => STAGES.find((s) => s.key === key) || UNKNOWN_STAGE

// Units per floor — 9 floors, 100 units total, matching the real building's massing.
export const FLOOR_UNITS = { 1: 12, 2: 12, 3: 12, 4: 12, 5: 11, 6: 11, 7: 11, 8: 11, 9: 8 }

export const ROLES = {
  admin: { label: 'Admin', color: '#f59e0b' },
  packer: { label: 'Packer / prep', color: '#14b8a6' },
  mover: { label: 'Mover', color: '#8b5cf6' },
  warehouse: { label: 'Warehouse', color: '#3b82f6' },
  driver: { label: 'Pickup & delivery (legacy)', color: '#f97316' },
  viewer: { label: 'Viewer (read-only)', color: '#3b82f6' },
}

// NOTE on unit doc shape: the resident/occupant name field is `tenant`
// (a plain string, e.g. "James Johnson"), not `lastName`. Every live view
// (Dashboard, BuildingView, UnitDetail, Containers, MyWork) and the CSV
// export read `unit.tenant`, and the forthcoming create-unit UI will write
// it too. Until that UI ships, units are hand-created in the Firestore
// console — always include `tenant` on the doc: `{ number, floor, tenant,
// stage: 'not_started' }`. Reads of `tenant` are null-guarded anyway (a
// missing field degrades to a placeholder instead of crashing).
