/* Studio 15 on a phone.
 *
 * Casey's first requirement, and the one everything else serves: "THIS APP
 * NEEDS TO BE ULTRA SIMPLE AND EASY FOR MY MOVERS/PACKERS TO USE." They use
 * it one-handed, outdoors, standing in a corridor with a box under the other
 * arm. Nobody opens this on a desktop except Casey.
 *
 * Chrome refused to honour a window resize for the whole of the session this
 * was built in, so none of it could be confirmed by eye. These check the
 * things that make a page hostile on a phone and that a passing test suite
 * will otherwise never notice.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FILES = [
  'src/s15/S15Unit.jsx',
  'src/s15/S15Status.jsx',
  'src/s15/Studio15.jsx',
  'src/s15/S15UnitCard.jsx',
  'src/s15/S15BuildingView.jsx',
]

/** Every <input>/<select>/<textarea>, with its props, brace-aware so a ">"
 *  inside a style object does not end the tag early. */
function fields(src) {
  const out = []
  const re = /<(input|select|textarea)\b/g
  let m
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 0
    while (i < src.length) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) {
        out.push({ tag: m[1], body: src.slice(re.lastIndex, i), line: src.slice(0, m.index).split('\n').length })
        break
      }
      i++
    }
  }
  return out
}

describe('nothing on a phone makes the crew fight the page', () => {
  const all = FILES.map((f) => ({ f, src: readFileSync(f, 'utf8') }))

  it('no typeable field is under 16px, because iOS zooms the page if it is', () => {
    /* Then they have to pinch back out one-handed, on a landing, holding a
       box. Three fields were missed on the final sweep. */
    for (const { f, src } of all) {
      for (const fd of fields(src)) {
        const type = (fd.body.match(/type="(\w+)"/) || [])[1] || 'text'
        if (['checkbox', 'radio', 'file'].includes(type)) continue
        const fs = fd.body.match(/fontSize:\s*([0-9.]+)/)
        expect(fs, `${f}:${fd.line} <${fd.tag}> sets no fontSize`).toBeTruthy()
        expect(Number(fs[1]), `${f}:${fd.line} <${fd.tag}>`).toBeGreaterThanOrEqual(16)
      }
    }
  })

  it('and every one is at least 44px tall, which is a fingertip', () => {
    for (const { f, src } of all) {
      for (const fd of fields(src)) {
        const type = (fd.body.match(/type="(\w+)"/) || [])[1] || 'text'
        if (['checkbox', 'radio', 'file'].includes(type)) continue
        const mh = fd.body.match(/minHeight:\s*([0-9.]+)/)
        expect(mh, `${f}:${fd.line} <${fd.tag}> sets no minHeight`).toBeTruthy()
        expect(Number(mh[1]), `${f}:${fd.line} <${fd.tag}>`).toBeGreaterThanOrEqual(44)
      }
    }
  })

  it('no grid floor can push the page sideways on a small phone', () => {
    /* A 320px handset leaves about 272px of content. A bare
       minmax(290px, 1fr) track cannot shrink below 290 and forces a
       horizontal scroll; min(290px, 100%) lets it collapse to the column. */
    for (const { f, src } of all) {
      const bare = src.match(/minmax\((\d+)px,/g) || []
      expect(bare, `${f} has a minmax floor that cannot collapse: ${bare}`).toHaveLength(0)
    }
  })

  it('and no fixed width exceeds a small phone', () => {
    for (const { f, src } of all) {
      for (const m of src.matchAll(/\bwidth:\s*(\d+)[,}]/g)) {
        expect(Number(m[1]), `${f} has width: ${m[1]}`).toBeLessThanOrEqual(272)
      }
    }
  })

  it('the camera buttons are big, because they are the whole job', () => {
    const unit = readFileSync('src/s15/S15Unit.jsx', 'utf8')
    expect(unit).toContain("capture=\"environment\"")
    expect(unit).toMatch(/minHeight: (5[0-9]|[6-9][0-9])/)
  })
})

/* ── Casey's copy rule ──────────────────────────────────────────────
 *
 * Standing instruction: no em dashes in shipped copy, metadata or comments.
 * He reads them as an AI tell. Three had got into crew-facing strings by the
 * final sweep, in the phase banner and the building tooltip.
 */
describe('no em dashes anywhere in Studio 15', () => {
  it('not in any source file in the module', () => {
    const files = [
      'src/s15/s15.js', 'src/s15/s15Theme.js', 'src/s15/S15Unit.jsx',
      'src/s15/S15Status.jsx', 'src/s15/Studio15.jsx', 'src/s15/S15UnitCard.jsx',
      'src/s15/S15Building.jsx', 'src/s15/S15BuildingView.jsx', 'src/s15/S15Icons.jsx',
    ]
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const i = src.indexOf('—')
      const where = i < 0 ? '' : ` near: ${src.slice(Math.max(0, i - 50), i + 50)}`
      expect(i, `${f} contains an em dash${where}`).toBe(-1)
    }
  })
})
