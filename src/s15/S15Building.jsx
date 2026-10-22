/* Studio 15, 1475 Imperial Avenue - drawn the way it actually looks.
 *
 * Trinity Manor got an elevation of its own (terracotta stair tower, greige
 * body, stepped balcony bays) and Casey asked for the same here rather than
 * a generic block. Studio 15 is the opposite building: a 2007 contemporary
 * infill in the East Village whose whole character is flat panels of hard
 * colour - a crimson strip at the west end, a gold bay, a deep cobalt slab
 * right of the entrance, a charcoal block closing the east end, all held in
 * a pale concrete frame, with a recessed glass entry running full height and
 * a canted gold canopy along the roof.
 *
 * Five storeys, 275 units. The unit numbers are floor-prefixed, so 578 is on
 * the fifth, which is where Casey's first sixteen are and why the top floor
 * is the busy one.
 *
 * Only units actually on the board are drawn. The building is a way to find
 * a door, not a model of the property: a floor nobody is working stays an
 * empty band rather than inventing 50 cells for units that do not exist in
 * the app.
 */
import React from 'react'
import { doneCount, S15_STEPS } from './s15.js'

const TOP = 86
const FLOOR_H = 46
const FLOORS = [5, 4, 3, 2, 1]

/* Unit numbers here are floor-prefixed: 578 -> 5. Falls back to the top
 * floor rather than dropping a unit off the drawing entirely, because a
 * tile you cannot see is worse than one in the wrong band. */
export function floorOf(number) {
  const n = String(number || '').trim()
  const f = parseInt(n[0], 10)
  return Number.isFinite(f) && f >= 1 && f <= 5 ? f : 5
}

function cellFill(unit) {
  if (unit.done) return '#16a34a'
  return doneCount(unit) > 0 ? '#f0a81e' : 'rgba(255,255,255,0.72)'
}

export default function S15Building({ units, selected, onSelect }) {
  const bottom = TOP + FLOORS.length * FLOOR_H
  const byFloor = FLOORS.map((f) => ({ f, units: units.filter((u) => floorOf(u.number) === f) }))

  return (
    <svg viewBox="0 0 360 400" width="100%" role="img" aria-label="Studio 15: live progress by floor">
      <text x="180" y="30" textAnchor="middle" fontSize="9.5" letterSpacing="3.5" fill="#8a93a2" fontWeight="600">STUDIO 15</text>
      <text x="180" y="44" textAnchor="middle" fontSize="8" letterSpacing="1.4" fill="#aab2bf">1475 IMPERIAL AVE</text>

      {/* pale concrete frame the colour panels are set into */}
      <rect x="18" y={TOP - 14} width="324" height={bottom - TOP + 14} fill="#d9d6ce" />

      {/* west end: the crimson strip */}
      <rect x="18" y={TOP - 14} width="26" height={bottom - TOP + 14} fill="#c8372c" />
      {/* the gold bay */}
      <rect x="62" y={TOP + 8} width="62" height={bottom - TOP - 8} fill="#efa91f" />
      {/* recessed glass entry, full height, left of centre */}
      <rect x="128" y={TOP - 14} width="40" height={bottom - TOP + 14} fill="#8fa0ad" />
      <rect x="134" y={TOP - 8} width="28" height={bottom - TOP + 2} fill="#b9ccd8" opacity="0.75" />
      {/* the cobalt slab */}
      <rect x="172" y={TOP - 4} width="92" height={bottom - TOP + 4} fill="#23409f" />
      {/* charcoal block closing the east end */}
      <rect x="268" y={TOP - 14} width="74" height={bottom - TOP + 14} fill="#3a3f45" />

      {/* the canted gold canopy along the roofline */}
      <path d={`M 62 ${TOP - 18} L 266 ${TOP - 30} L 266 ${TOP - 22} L 62 ${TOP - 10} Z`} fill="#efa91f" opacity="0.95" />

      {/* floors */}
      {byFloor.map(({ f, units: us }, i) => {
        const y = TOP + i * FLOOR_H
        const active = selected === f
        return (
          <g key={f} onClick={() => onSelect && onSelect(active ? null : f)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
            {/* floor band, lifted when selected */}
            <rect
              x="18" y={y} width="324" height={FLOOR_H - 4}
              fill={active ? 'rgba(255,255,255,0.22)' : 'transparent'}
              stroke={active ? '#fff' : 'transparent'} strokeWidth="1.5"
            />
            <text x="10" y={y + 24} textAnchor="middle" fontSize="10" fontWeight="700" fill="#6b7280">{f}</text>

            {/* One cell per unit on the board for this floor, sized to fit.
                A fixed pitch overflowed the facade at sixteen units and this
                building runs to about fifty-five a floor, so the pitch is
                computed from the count instead of assumed. */}
            {(() => {
              const LEFT = 26, RIGHT = 334
              const span = RIGHT - LEFT
              const pitch = us.length ? Math.min(22, span / us.length) : 22
              const cw = Math.max(4, pitch - Math.min(5, pitch * 0.22))
              return us.map((u, j) => (
                <rect
                  key={u.id}
                  x={LEFT + j * pitch} y={y + 12} width={cw} height="15" rx={cw > 8 ? 2 : 1}
                  fill={cellFill(u)}
                  stroke="rgba(0,0,0,0.25)" strokeWidth="0.5"
                >
                  <title>{`Unit ${u.number} — ${u.done ? 'complete' : `${doneCount(u)} of ${S15_STEPS.length} photos`}`}</title>
                </rect>
              ))
            })()}
          </g>
        )
      })}

      {/* street level: glazing and the sidewalk */}
      <rect x="18" y={bottom} width="324" height="22" fill="#2b3036" />
      {Array.from({ length: 11 }).map((_, i) => (
        <rect key={i} x={26 + i * 29} y={bottom + 5} width="20" height="12" rx="1" fill="#9fd3e8" opacity="0.5" />
      ))}
      <rect x="10" y={bottom + 22} width="340" height="5" fill="#cfd4da" />
    </svg>
  )
}
