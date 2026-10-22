/* One unit, as a card you can read at arm's length.
 *
 * Casey, 2026-10-22: "it should fill in the card as far as the crew is on
 * that unit, ie, if the users started unit xxxx and only did step 1 the card
 * should be a small persentage in green to show the current process?"
 *
 * So the card IS the progress bar. A fifth of the way along means one of the
 * five photographs is in. The number stays printed next to it because a bar
 * alone is a guess, and a dispatcher on the phone needs "two of five", not
 * "about a third".
 *
 * It also names who touched it last and when. "508 is in progress" is half an
 * answer; "Victoria, nine minutes ago" is the one that tells Casey whether to
 * ring somebody.
 *
 * One component for both the board and the building view, because they were
 * two copies of the same markup drifting apart already.
 */
import React from 'react'
import { doneCount, stepTotal, photoCount, shotsFor, S15_STEP_KEYS } from './s15.js'

/** The most recent photo on a unit, whichever step it belongs to. */
export function lastTouch(unit) {
  let best = null
  for (const k of S15_STEP_KEYS) {
    for (const s of shotsFor(unit, k)) {
      if (!best || (s.ts || 0) > (best.ts || 0)) best = s
    }
  }
  return best
}

function ago(ts) {
  if (!ts) return ''
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function S15UnitCard({ unit, onOpen }) {
  const n = doneCount(unit)
  const total = stepTotal(unit)
  const pct = Math.round((n / total) * 100)
  const touch = lastTouch(unit)
  const shots = photoCount(unit)
  const started = n > 0 && !unit.done

  return (
    <button
      className="tile"
      onClick={() => onOpen(unit.id)}
      style={{
        position: 'relative', overflow: 'hidden', padding: 14, textAlign: 'left',
        minHeight: 100, borderRadius: 12, cursor: 'pointer', width: '100%',
        border: started ? '1px solid #16a34a' : '1px solid var(--line, #e4e7ee)',
        background: unit.done ? '#16a34a' : '#fff',
        color: unit.done ? '#fff' : 'inherit',
      }}
    >
      {/* The fill. Sits behind the text at low opacity so a card three
          fifths done still reads as words rather than as a green block. */}
      {!unit.done && n > 0 && (
        <span
          aria-hidden
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`,
            background: '#16a34a', opacity: 0.16, pointerEvents: 'none',
          }}
        />
      )}

      <span style={{ position: 'relative' }}>
        <span style={{ display: 'block', fontSize: 21, fontWeight: 700, lineHeight: 1.1 }}>{unit.number}</span>
        <span style={{ display: 'block', fontSize: 12, opacity: unit.done ? 0.9 : 0.6, marginTop: 2 }}>
          {unit.destination ? `→ ${unit.destination}` : 'destination tbd'}
        </span>

        {/* Two numbers, because they answer different questions: how far
            through the required shots, and how many photographs exist. The
            old single line read "0 of 5 photos", which sounds like a cap -
            Casey read it that way, so the crew would have. */}
        <span style={{ display: 'block', marginTop: 8, fontSize: 12, fontWeight: 650 }}>
          {unit.done ? '✓ Complete' : `${n} of ${total} done`}
          {shots > 0 && (
            <span style={{ fontWeight: 500, opacity: unit.done ? 0.9 : 0.6 }}> · {shots} photo{shots === 1 ? '' : 's'}</span>
          )}
        </span>

        {/* Who, and how long ago. The thing that says whether anyone is
            actually standing in that apartment right now. */}
        {started && touch && (
          <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: '#15803d', fontWeight: 600 }}>
            {touch.name} · {ago(touch.ts)}
          </span>
        )}

        {unit.packers > 0 && !unit.done && (
          <span style={{ display: 'inline-block', marginTop: 6, fontSize: 11, fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '2px 7px', borderRadius: 999 }}>
            {unit.packers} packer{unit.packers === 1 ? '' : 's'}
          </span>
        )}
      </span>
    </button>
  )
}

/** The cards, in a grid. Same shape everywhere this appears. */
export function S15UnitGrid({ units, onOpen }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))', gap: 10 }}>
      {units.map((u) => <S15UnitCard key={u.id} unit={u} onOpen={onOpen} />)}
    </div>
  )
}
