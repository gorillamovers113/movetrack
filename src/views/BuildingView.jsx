import React from 'react'
import { stageOf } from '../seed.js'
import { useStore } from '../store.jsx'

// Stylized elevation of Trinity Manor: terracotta stair tower on the left,
// greige body with four stepped balcony bays, arched entrance at street level.
// 9 floors; each balcony cell is one unit, colored by its live stage. Floors are clickable.

const TOP = 92
const FLOOR_H = 44
const BAYS = [
  { x: 84, w: 58 },
  { x: 148, w: 58 },
  { x: 212, w: 54 },
  { x: 272, w: 54 },
]

function bayCounts(n) {
  const base = Math.floor(n / 4)
  const extra = n % 4
  return BAYS.map((_, i) => base + (i < extra ? 1 : 0))
}

export default function BuildingView({ selected, onSelect }) {
  const { state } = useStore()
  const floors = []
  for (let f = 9; f >= 1; f--) floors.push({ f, units: state.units.filter((u) => u.floor === f).sort((a, b) => a.number.localeCompare(b.number)) })

  const floorsBottom = TOP + floors.length * FLOOR_H // 488

  return (
    <svg viewBox="0 0 360 540" width="100%" role="img" aria-label="Trinity Manor — live progress by floor">
      <text x="200" y="66" textAnchor="middle" fontSize="9.5" letterSpacing="3.5" fill="#8a93a2" fontWeight="600">TRINITY MANOR</text>

      {/* terracotta stair tower */}
      <rect x="22" y="52" width="50" height={floorsBottom + 34 - 52} rx="2" fill="#c05b3a" />
      <rect x="22" y="52" width="50" height="8" rx="2" fill="#a84b2e" />
      {floors.map((fl, i) => (
        <rect key={fl.f} x="39" y={TOP + i * FLOOR_H + 15} width="16" height="11" rx="1.5" fill="rgba(40,20,12,0.35)" />
      ))}

      {/* main body */}
      <rect x="72" y="76" width="262" height={floorsBottom - 76} rx="2" fill="#d8d4c6" />
      <rect x="72" y="76" width="262" height="8" fill="#eceadf" />
      <rect x="326" y="84" width="8" height={floorsBottom - 84} fill="rgba(0,0,0,0.07)" />

      {/* floors */}
      {floors.map((fl, i) => {
        const y = TOP + i * FLOOR_H
        const counts = bayCounts(fl.units.length)
        let cellIdx = 0
        return (
          <g key={fl.f}>
            {BAYS.map((bay, bi) => {
              const n = counts[bi]
              if (!n) return null
              const gap = 5
              const cellW = (bay.w - gap * (n + 1)) / n
              const cells = []
              for (let c = 0; c < n; c++) {
                const u = fl.units[cellIdx++]
                if (!u) break
                cells.push(
                  <rect
                    key={c}
                    x={bay.x + gap + c * (cellW + gap)}
                    y={y + 9}
                    width={cellW}
                    height={25}
                    rx="1.5"
                    fill={stageOf(u.stage).color}
                  >
                    <title>{`Unit ${u.number} — ${u.tenant} — ${stageOf(u.stage).label}`}</title>
                  </rect>
                )
              }
              return (
                <g key={bi}>
                  {cells}
                  <rect x={bay.x + 2} y={y + 21} width={bay.w - 4} height="13" fill="rgba(255,255,255,0.32)" />
                  <rect x={bay.x - 3} y={y + 34} width={bay.w + 6} height="5" rx="1" fill="#f2f0e8" />
                </g>
              )
            })}
            <text x="62" y={y + 28} textAnchor="end" fontSize="10.5" fontWeight="700" fill={selected === fl.f ? '#171a20' : '#a8b0bc'}>{fl.f}</text>
            <rect
              className="floor-hit"
              x="72" y={y + 2} width="262" height={FLOOR_H - 4} rx="4"
              fill={selected === fl.f ? 'rgba(245,158,11,0.13)' : 'transparent'}
              stroke={selected === fl.f ? '#f59e0b' : 'transparent'}
              strokeWidth="2.5"
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(fl.f)}
            >
              <title>{`Floor ${fl.f} — tap to focus`}</title>
            </rect>
          </g>
        )
      })}

      {/* street level: arches + entrance */}
      <rect x="72" y={floorsBottom} width="262" height="34" fill="#cfcaba" />
      {[150, 190, 230].map((ax) => (
        <path key={ax} d={`M${ax} ${floorsBottom + 34}v-20a13 13 0 0 1 26 0v20z`} fill="#f2f0e8" />
      ))}
      {[150, 190, 230].map((ax) => (
        <path key={ax} d={`M${ax + 4} ${floorsBottom + 34}v-16a9 9 0 0 1 18 0v16z`} fill="#6f6a5c" />
      ))}

      {/* Gorilla Movers on-site banner */}
      <rect x="80" y={floorsBottom + 6} width="58" height="22" rx="3" fill="#f59e0b" />
      <text x="109" y={floorsBottom + 15.5} textAnchor="middle" fontSize="6.6" fontWeight="800" fill="#241500" letterSpacing="0.4">GORILLA</text>
      <text x="109" y={floorsBottom + 23.5} textAnchor="middle" fontSize="6.6" fontWeight="800" fill="#241500" letterSpacing="0.4">MOVERS</text>
      <text x="290" y={floorsBottom + 22} textAnchor="middle" fontSize="7.5" fill="#8a93a2" fontWeight="600">ON SITE</text>
    </svg>
  )
}
