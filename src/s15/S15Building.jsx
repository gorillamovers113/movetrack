/* Studio 15, 1475 Imperial Avenue - drawn from the building.
 *
 * Casey, 2026-10-22: "i think you can do a bettter job with the building
 * mockup too ... and just so you know, each floor has 50 unts and its 5
 * storys tall."
 *
 * FIFTY UNITS A FLOOR IS WHY THIS IS WIDE. A five-storey block with fifty
 * apartments on each floor is a long building, not a tall one, and the first
 * version drew it as a squat tower because it was sized to the sixteen units
 * on the board rather than to the property. At this width fifty window bays
 * per floor is simply what the elevation looks like.
 *
 * WHICH MEANS THE WINDOWS CAN BE THE UNITS. Fifty bays, five floors, two
 * hundred and fifty slots - the building IS the board. A unit on Casey's
 * list takes a slot and carries its colour; the rest stay glass. Slots fill
 * from the left in number order because the real mapping of unit number to
 * window is not something the app knows, and inventing one would be a
 * drawing that lies.
 *
 * What the photograph actually shows, west to east: pale concrete with a
 * crimson strip near the west end, a gold horizontal-slatted bay carrying
 * the vertical STUDIO FIFTEEN sign, a recessed full-height glass entry, a
 * cobalt slatted slab over the upper floors, then a charcoal wing with red
 * accent panels at its far end. A canted gold brise-soleil runs the roofline
 * and the street level is glazed.
 */
import React from 'react'
import { doneCount, S15_STEPS } from './s15.js'

export const UNITS_PER_FLOOR = 50
export const FLOORS = [5, 4, 3, 2, 1]

const X0 = 24          // west face
const X1 = 596         // east face
const TOP = 54         // underside of the parapet
const FLOOR_H = 38
const BODY_W = X1 - X0
const PITCH = BODY_W / UNITS_PER_FLOOR

/* Unit numbers are floor-prefixed: 578 -> 5. Falls back to the top floor
 * rather than dropping a unit off the drawing, because a tile you cannot see
 * is worse than one in the wrong band. */
export function floorOf(number) {
  const n = String(number || '').trim()
  const f = parseInt(n[0], 10)
  return Number.isFinite(f) && f >= 1 && f <= 5 ? f : 5
}

function slotFill(unit) {
  if (!unit) return null
  if (unit.done) return '#16a34a'
  return doneCount(unit) > 0 ? '#f0a81e' : '#ffffff'
}

/** Horizontal slat texture, the thing that makes the colour panels read as
 *  siding rather than as flat blocks of paint. */
function Slats({ x, y, w, h, step = 5, opacity = 0.16 }) {
  const rows = []
  for (let i = y + step; i < y + h; i += step) {
    rows.push(<line key={i} x1={x} y1={i} x2={x + w} y2={i} stroke="#000" strokeWidth="0.7" opacity={opacity} />)
  }
  return <g>{rows}</g>
}

export default function S15Building({ units, selected, onSelect }) {
  const bottom = TOP + FLOORS.length * FLOOR_H

  // Units on the board, per floor, in number order.
  const byFloor = {}
  for (const f of FLOORS) {
    byFloor[f] = units
      .filter((u) => floorOf(u.number) === f)
      .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))
  }

  return (
    <svg viewBox="0 0 620 300" width="100%" role="img" aria-label="Studio 15: five floors, fifty units each, coloured by progress">
      <defs>
        <linearGradient id="s15sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d1b3e" /><stop offset="100%" stopColor="#1b3566" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="620" height="300" fill="url(#s15sky)" rx="10" />

      {/* ── the mass: pale concrete ───────────────────────────── */}
      <rect x={X0} y={TOP - 12} width={BODY_W} height={bottom - TOP + 12} fill="#d6d2c8" />
      <rect x={X0} y={TOP - 12} width={BODY_W} height="7" fill="#bfb9ad" />

      {/* gold slatted bay, lower floors */}
      <rect x={X0 + 120} y={TOP + FLOOR_H * 2.1} width="118" height={bottom - (TOP + FLOOR_H * 2.1)} fill="#e9a21c" />
      <Slats x={X0 + 120} y={TOP + FLOOR_H * 2.1} w={118} h={bottom - (TOP + FLOOR_H * 2.1)} />
      {/* the vertical STUDIO FIFTEEN sign on its east edge */}
      <rect x={X0 + 228} y={TOP + FLOOR_H * 2.2} width="13" height={bottom - (TOP + FLOOR_H * 2.2) - 6} fill="#f3f1ec" />
      <text
        x={X0 + 234.5} y={TOP + FLOOR_H * 2.2 + 11}
        fontSize="7.5" fill="#55606e" letterSpacing="1.6" fontWeight="700"
        transform={`rotate(90 ${X0 + 234.5} ${TOP + FLOOR_H * 2.2 + 11})`}
      >STUDIO FIFTEEN</text>

      {/* recessed full-height glass entry */}
      <rect x={X0 + 252} y={TOP - 12} width="44" height={bottom - TOP + 12} fill="#7f94a6" />
      <rect x={X0 + 257} y={TOP - 6} width="34" height={bottom - TOP} fill="#a9c4d4" opacity="0.8" />
      {FLOORS.map((_, i) => (
        <line key={i} x1={X0 + 252} y1={TOP + i * FLOOR_H} x2={X0 + 296} y2={TOP + i * FLOOR_H} stroke="#6f8496" strokeWidth="1.2" />
      ))}

      {/* cobalt slatted slab over the upper floors */}
      <rect x={X0 + 310} y={TOP - 6} width="150" height={FLOOR_H * 3.4} fill="#23409f" />
      <Slats x={X0 + 310} y={TOP - 6} w={150} h={FLOOR_H * 3.4} />

      {/* charcoal east wing, with its red accent panels */}
      <rect x={X0 + 476} y={TOP - 12} width={X1 - (X0 + 476)} height={bottom - TOP + 12} fill="#3a3f45" />
      {[0, 1].map((k) => (
        <rect key={k} x={X1 - 26} y={TOP + 12 + k * FLOOR_H * 1.6} width="15" height={FLOOR_H * 0.75} fill="#c8372c" />
      ))}

      {/* canted gold brise-soleil along the roofline */}
      <path d={`M ${X0 + 86} ${TOP - 16} L ${X0 + 452} ${TOP - 30} L ${X0 + 452} ${TOP - 23} L ${X0 + 86} ${TOP - 9} Z`} fill="#e9a21c" />

      {/* ── floors: fifty unit slots each ─────────────────────── */}
      {FLOORS.map((f, row) => {
        const y = TOP + row * FLOOR_H
        const active = selected === f
        const list = byFloor[f]
        return (
          <g key={f} onClick={() => onSelect && onSelect(active ? null : f)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
            <rect x={X0} y={y} width={BODY_W} height={FLOOR_H} fill={active ? '#fff' : 'transparent'} opacity={active ? 0.3 : 0} />
            {active && <rect x={X0} y={y} width={BODY_W} height={FLOOR_H} fill="none" stroke="#fff" strokeWidth="1.6" />}
            <text x={X0 - 11} y={y + FLOOR_H / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={active ? '#fff' : '#8e99a8'}>{f}</text>

            {Array.from({ length: UNITS_PER_FLOOR }).map((_, i) => {
              const u = list[i]
              const fill = slotFill(u)
              const x = X0 + i * PITCH + PITCH * 0.28
              const w = PITCH * 0.44
              return (
                <rect
                  key={i}
                  x={x} y={y + 11} width={w} height={FLOOR_H * 0.42} rx="0.8"
                  fill={fill || '#1d2733'}
                  opacity={fill ? 1 : 0.42}
                  stroke={u ? 'rgba(0,0,0,0.45)' : 'none'} strokeWidth={u ? 0.6 : 0}
                >
                  {u && <title>{`Unit ${u.number} — ${u.done ? 'complete' : `${doneCount(u)} of ${S15_STEPS.length} photos`}`}</title>}
                </rect>
              )
            })}

            {/* a couple of Juliet balconies, as on the real elevation */}
            {row > 0 && [0.19, 0.63].map((p) => (
              <rect key={p} x={X0 + BODY_W * p} y={y + 9} width="19" height="10" fill="none" stroke="#eef1f4" strokeWidth="1.1" opacity="0.85" />
            ))}
          </g>
        )
      })}

      {/* crimson fin near the west end, unbroken, stopping short of the
          ground. Drawn after the window row so it reads as one element
          rather than as three blocks with holes punched through it. */}
      <rect x={X0 + 30} y={TOP - 5} width="16" height={(bottom - TOP) * 0.74} fill="#c8372c" />
      <Slats x={X0 + 30} y={TOP - 5} w={16} h={(bottom - TOP) * 0.74} step={9} opacity={0.2} />

      {/* ── street level ──────────────────────────────────────── */}
      <rect x={X0} y={bottom} width={BODY_W} height="20" fill="#8a8178" />
      <rect x={X0} y={bottom + 20} width={BODY_W} height="12" fill="#2b3036" />
      {Array.from({ length: 22 }).map((_, i) => (
        <rect key={i} x={X0 + 8 + i * 25} y={bottom + 4} width="16" height="13" rx="1" fill="#ffd79a" opacity="0.55" />
      ))}
      <rect x={X0 - 8} y={bottom + 32} width={BODY_W + 16} height="4" fill="#4a5158" />
    </svg>
  )
}
