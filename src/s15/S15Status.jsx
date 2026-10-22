/* Studio 15, as the property manager sees it.
 *
 * Casey, 2026-10-22: "the viewer page is a bit ugly, any way you can improve
 * on this. add some ads for other gorilla movers services. style it like
 * gorillamovers.com (view the site to see for yourself)."
 *
 * I had not viewed the site. I read its stylesheet, found an orange in it,
 * and built an orange page; the site is navy and blue, Inter at 800, white
 * body, soft blue icon tiles, a slanted edge under the hero. This is the
 * rebuild after actually looking, and it follows the site's own rhythm:
 * dark hero with the claim, trust strip, the work, then services, then a
 * call to action and the licence numbers.
 *
 * WHAT THIS PAGE IS FOR. A property manager has one question, asked twenty
 * times a day by somebody else: where are you up to. Everything here answers
 * it at a different magnification - the headline count from across a room,
 * the building to find a floor, a unit to see the apartment itself.
 *
 * READ ONLY, AND NOT JUST ON THE SCREEN. A viewer may append a note and
 * nothing else, enforced in firestore.rules, because a hidden button is not
 * a lock. The note is there because the person watching usually knows
 * something the crew does not: a lift booking, a tenant who will not be in.
 *
 * WHY IT SHOWS THE WHOLE TIMELINE. Casey: "track everyting that happens who,
 * when and where for each unit." Every write the crew makes already logs who
 * and when; this is where that becomes something a client can read. It is
 * also the honest thing to publish: a record you would only show when it
 * flatters you is not a record.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import {
  subscribeUnits, subscribeEvents, doneCount, stepTotal, stepsFor, photoCount,
  shotsFor, weArePacking, weAreUnpacking, phaseOf, addNote,
} from './s15.js'
import S15Building from './S15Building.jsx'
import Icon from './S15Icons.jsx'
import { GorillaWordmark } from '../ui.jsx'
import { T, NUM, PROOF, ADS, when, toMs } from './s15Theme.js'

const WRAP = { maxWidth: 1120, margin: '0 auto', padding: '0 24px' }

/* ── the site's building blocks ────────────────────────────────── */

/** Small blue label above a headline. The site opens every section this way. */
function Eyebrow({ children, onDark }) {
  return (
    <div style={{
      fontSize: 13, fontWeight: 700, letterSpacing: '.02em',
      color: onDark ? T.blueLight : T.blue, marginBottom: 10,
    }}>
      {children}
    </div>
  )
}

/** Two-tone headline: the site sets the second half in blue. */
function Headline({ lead, accent, onDark, size = 38 }) {
  return (
    <h2 style={{
      margin: 0, fontSize: size, lineHeight: 1.12, fontWeight: 800,
      letterSpacing: '-0.025em', color: onDark ? T.paper : T.ink, textWrap: 'balance',
    }}>
      {lead}{' '}
      <span style={{ color: onDark ? T.blueLight : T.blue }}>{accent}</span>
    </h2>
  )
}

function Stat({ value, label, hint, accent }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.13)',
      borderRadius: 14, padding: '18px 20px', minWidth: 0, flex: '1 1 160px',
      backdropFilter: 'blur(6px)',
    }}>
      <div style={{ ...NUM, fontSize: 40, fontWeight: 800, lineHeight: 1, color: accent || T.paper, letterSpacing: '-0.03em' }}>
        {value}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)', marginTop: 9 }}>
        {label}
      </div>
      {hint && <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function ProgressBar({ done, active, total }) {
  const pct = (n) => (total ? (n / total) * 100 : 0)
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.12)' }}>
        <div style={{ width: `${pct(done)}%`, background: T.green, transition: 'width .4s ease' }} />
        <div style={{ width: `${pct(active)}%`, background: T.blueLight, transition: 'width .4s ease' }} />
      </div>
      <div style={{ display: 'flex', gap: 20, marginTop: 11, flexWrap: 'wrap' }}>
        <Legend c={T.green} label={`${done} complete`} />
        <Legend c={T.blueLight} label={`${active} in progress`} />
        <Legend c="rgba(255,255,255,0.22)" label={`${Math.max(0, total - done - active)} to come`} />
      </div>
    </div>
  )
}

function Legend({ c, label }) {
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: c }} />
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>{label}</span>
    </span>
  )
}

/** The slanted edge the site puts under its hero. */
function Slant({ from }) {
  return (
    <div style={{ background: from, lineHeight: 0 }}>
      <svg viewBox="0 0 1440 46" width="100%" height="46" preserveAspectRatio="none" aria-hidden>
        <path d="M0 46 L1440 0 L1440 46 Z" fill={T.paper} />
      </svg>
    </div>
  )
}

/** The trust strip. These are the site's own numbers, kept in one place. */
function TrustStrip() {
  const items = [
    { icon: 'star', big: `${PROOF.rating} ★`, small: `Google · ${PROOF.reviews} reviews` },
    { icon: 'shield', big: `${PROOF.bbb} BBB`, small: 'Accredited' },
    { icon: 'truck', big: PROOF.moves, small: `moves since ${PROOF.since}` },
    { icon: 'clock', big: PROOF.repeat, small: 'repeat & referral' },
  ]
  return (
    <div style={{ background: T.paper, borderBottom: `1px solid ${T.line}` }}>
      <div style={{ ...WRAP, display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', padding: '22px 24px' }}>
        {items.map((it) => (
          <div key={it.icon} style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
            <span style={{ color: T.blue, flexShrink: 0 }}><Icon name={it.icon} size={21} /></span>
            <span style={{ minWidth: 0 }}>
              <span style={{ ...NUM, display: 'block', fontSize: 15.5, fontWeight: 750, color: T.ink }}>{it.big}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: T.muted }}>{it.small}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── a unit, as a row ──────────────────────────────────────────── */

function UnitRow({ unit, onOpen }) {
  const n = doneCount(unit)
  const total = stepTotal(unit)
  const shots = photoCount(unit)
  const pct = total ? Math.round((n / total) * 100) : 0
  const [hover, setHover] = useState(false)

  const state = unit.done
    ? { label: 'Complete', fg: T.green, bg: 'rgba(15,169,104,0.1)' }
    : n > 0
      ? weArePacking(unit) && phaseOf(unit) === 'packing'
        ? { label: 'Packing', fg: '#92400e', bg: '#fef3c7' }
        : { label: 'In progress', fg: T.blue, bg: T.blueWash }
      : { label: 'Scheduled', fg: T.muted, bg: '#f1f4f8' }

  return (
    <button
      onClick={() => onOpen(unit.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', position: 'relative',
        background: T.paper, border: `1px solid ${hover ? T.blue : T.line}`, borderRadius: 14,
        padding: '16px 18px 16px 22px', display: 'flex', alignItems: 'center', gap: 16,
        flexWrap: 'wrap', font: 'inherit', overflow: 'hidden',
        boxShadow: hover ? '0 6px 20px -10px rgba(10,37,64,0.3)' : '0 1px 2px rgba(10,37,64,0.04)',
        transition: 'border-color .15s, box-shadow .15s',
      }}
    >
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: state.fg }} />
      <span style={{ ...NUM, fontSize: 22, fontWeight: 800, color: T.ink, minWidth: 56, letterSpacing: '-0.02em' }}>
        {unit.number}
      </span>
      <span style={{ flex: '1 1 180px', minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, color: T.text }}>
          {unit.destination ? `Moving to unit ${unit.destination}` : 'Destination to be confirmed'}
        </span>
        <span style={{ display: 'block', fontSize: 12.5, color: T.muted, marginTop: 2 }}>
          {shots > 0 ? `${shots} photo${shots === 1 ? '' : 's'} on file` : 'No photos yet'}
          {weArePacking(unit) && ' · we pack it'}
          {weAreUnpacking(unit) && ' · we unpack it'}
        </span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 62, height: 6, borderRadius: 999, background: '#eef2f7', overflow: 'hidden', display: 'inline-block' }}>
          <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: state.fg }} />
        </span>
        <span style={{ ...NUM, fontSize: 13, color: T.muted, minWidth: 34, textAlign: 'right' }}>{pct}%</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: state.fg, background: state.bg, padding: '5px 11px', borderRadius: 999 }}>
          {state.label}
        </span>
      </span>
    </button>
  )
}

/* ── one unit, in full ─────────────────────────────────────────── */

function SectionTitle({ children }) {
  return (
    <h3 style={{
      fontSize: 13, fontWeight: 750, letterSpacing: '.07em', textTransform: 'uppercase',
      color: T.muted, margin: '0 0 14px',
    }}>{children}</h3>
  )
}

function UnitDetail({ unit, events, onBack, user, toast }) {
  const steps = stepsFor(unit)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const notes = [...(unit.notes || [])].sort((a, b) => toMs(b.ts) - toMs(a.ts))
  const log = events.filter((e) => e.unitId === unit.id)

  async function send() {
    const t = note.trim()
    if (!t) return
    setBusy(true)
    try { await addNote(unit, t, user); setNote(''); toast('Note added.') }
    catch (e) { toast(e.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ ...WRAP, paddingTop: 36, paddingBottom: 60 }}>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: T.blue, fontWeight: 650, fontSize: 14.5, padding: 0, marginBottom: 20 }}
      >
        ← All units
      </button>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ ...NUM, margin: 0, fontSize: 44, fontWeight: 800, color: T.ink, letterSpacing: '-0.03em' }}>
          Unit {unit.number}
        </h1>
        {unit.done && (
          <span style={{ fontSize: 12.5, fontWeight: 750, color: T.green, background: 'rgba(15,169,104,0.1)', padding: '6px 13px', borderRadius: 999 }}>
            ✓ Complete
          </span>
        )}
      </div>
      <p style={{ color: T.text, marginTop: 8, fontSize: 15.5, maxWidth: 640 }}>
        {unit.destination ? `Moving to unit ${unit.destination}.` : 'Destination to be confirmed.'}
        {weArePacking(unit) && ' Gorilla Movers packed this unit.'}
        {weAreUnpacking(unit) && ' Gorilla Movers unpacked it.'}
      </p>

      {steps.map((s) => {
        const shots = shotsFor(unit, s.key)
        if (!shots.length) return null
        return (
          <section key={s.key} style={{ marginTop: 34 }}>
            <SectionTitle>{s.label}</SectionTitle>
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))' }}>
              {shots.map((sh, i) => (
                <a
                  key={i}
                  href={sh.url}
                  target="_blank"
                  rel="noopener"
                  style={{ display: 'block', borderRadius: 14, overflow: 'hidden', border: `1px solid ${T.line}`, background: T.paper, textDecoration: 'none', boxShadow: '0 1px 2px rgba(10,37,64,0.04)' }}
                >
                  <img src={sh.url} alt={s.label} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
                  <span style={{ display: 'block', padding: '9px 12px', fontSize: 12, color: T.muted }}>
                    {sh.name || 'someone'} · {when(sh.ts)}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )
      })}

      <section style={{ marginTop: 40 }}>
        <SectionTitle>Notes</SectionTitle>
        <div style={{ background: T.paper, border: `1px solid ${T.line}`, borderRadius: 16, padding: 18 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send() }}
              placeholder="Anything the crew should know about this unit"
              style={{ flex: '1 1 260px', minHeight: 48, fontSize: 16, padding: '0 15px', borderRadius: 11, border: `1px solid ${T.line}`, font: 'inherit', color: T.ink, outlineColor: T.blue }}
            />
            <button
              onClick={send}
              disabled={busy || !note.trim()}
              style={{
                minHeight: 48, padding: '0 22px', borderRadius: 11, border: 'none',
                cursor: note.trim() ? 'pointer' : 'default',
                background: note.trim() ? T.blue : '#eef2f7',
                color: note.trim() ? '#fff' : T.muted,
                fontWeight: 700, font: 'inherit', fontSize: 15,
              }}
            >
              {busy ? 'Adding…' : 'Add note'}
            </button>
          </div>
          {notes.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '18px 0 0', padding: 0, display: 'grid', gap: 14 }}>
              {notes.map((nt, i) => (
                <li key={i} style={{ borderTop: `1px solid ${T.line}`, paddingTop: 14 }}>
                  <div style={{ fontSize: 15, color: T.ink }}>{nt.text}</div>
                  {/* The data layer stores this as `name`; reading `by`
                      printed a bare "· Oct 22, 12:13 PM" with nobody against
                      it, on the one page where who said it is the point. */}
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
                    {nt.name || nt.by || 'someone'} · {when(nt.ts)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* THE RECORD. Published in full, corrections included, because a
          record you would only show when it flatters you is not a record. */}
      <section style={{ marginTop: 40 }}>
        <SectionTitle>Everything that happened</SectionTitle>
        {log.length === 0 ? (
          <p style={{ color: T.muted, fontSize: 14.5 }}>Nothing recorded on this unit yet.</p>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: `2px solid ${T.line}` }}>
            {log.map((e) => (
              <li key={e.id} style={{ position: 'relative', padding: '0 0 20px 22px' }}>
                <span style={{ position: 'absolute', left: -5, top: 6, width: 8, height: 8, borderRadius: 999, background: T.blue }} />
                <div style={{ fontSize: 15, color: T.ink }}>{e.action}</div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>{e.name} · {when(e.ts)}</div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

/* ── the adverts ───────────────────────────────────────────────── */

function AdCard({ ad }) {
  const [hover, setHover] = useState(false)
  return (
    <a
      href={ad.href}
      target="_blank"
      rel="noopener"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        /* A column, so "Learn more" can be pushed to the bottom. Without
           it the cards ragged out: Storage runs to four lines and its link
           sat a row below its neighbours', which reads as a broken grid on
           the page a client judges us by. */
        display: 'flex', flexDirection: 'column', height: '100%',
        textDecoration: 'none', background: T.paper,
        border: `1px solid ${hover ? T.blue : T.line}`, borderRadius: 16, padding: 24,
        boxShadow: hover ? '0 10px 28px -14px rgba(10,37,64,0.35)' : '0 1px 2px rgba(10,37,64,0.04)',
        transition: 'border-color .15s, box-shadow .15s, transform .15s',
        transform: hover ? 'translateY(-2px)' : 'none',
      }}
    >
      <span style={{
        display: 'inline-flex', width: 44, height: 44, borderRadius: 12,
        background: T.blueWash, color: T.blue, alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={ad.icon} size={22} />
      </span>
      <h3 style={{ margin: '16px 0 8px', fontSize: 18, fontWeight: 750, color: T.ink, letterSpacing: '-0.01em' }}>
        {ad.title}
      </h3>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: T.text }}>{ad.body}</p>
      <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 14, marginBottom: 'auto' }}>
        <span style={{ color: T.blue, fontWeight: 800, fontSize: 13, lineHeight: 1.4 }}>✓</span>
        <span style={{ fontSize: 13, fontWeight: 650, color: T.blue, lineHeight: 1.4 }}>{ad.proof}</span>
      </div>
      <div style={{ paddingTop: 18, fontSize: 14.5, fontWeight: 650, color: T.ink }}>
        Learn more <span style={{ color: T.blue }}>→</span>
      </div>
    </a>
  )
}

function Services() {
  return (
    <section style={{ background: '#f7f9fc', borderTop: `1px solid ${T.line}`, padding: '58px 0' }}>
      <div style={WRAP}>
        <Eyebrow>Services</Eyebrow>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
          <Headline lead="Whatever else the property needs," accent="one accountable crew." />
          <a
            href="https://gorillamovers.com/services"
            target="_blank"
            rel="noopener"
            style={{ fontSize: 15, fontWeight: 650, color: T.blue, textDecoration: 'none', whiteSpace: 'nowrap' }}
          >
            All services →
          </a>
        </div>
        <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(min(290px, 100%), 1fr))', alignItems: 'stretch', marginTop: 34 }}>
          {ADS.map((ad) => <AdCard key={ad.key} ad={ad} />)}
        </div>
        <p style={{ marginTop: 26, fontSize: 14, color: T.muted, maxWidth: 760 }}>
          Plus single-item and small moves, appliance and piano moving, lab and medical relocations, FF&E installation and pallet racking.{' '}
          <a href="https://gorillamovers.com/partners" target="_blank" rel="noopener" style={{ color: T.blue, fontWeight: 650, textDecoration: 'none' }}>
            See the property manager programme →
          </a>
        </p>
      </div>
    </section>
  )
}

function CallToAction() {
  return (
    <section style={{ background: T.navy, color: T.paper, padding: '52px 0' }}>
      <div style={{ ...WRAP, display: 'flex', gap: 28, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 260, flex: '1 1 380px' }}>
          <Headline lead="Another building, another turnover?" accent="One number to call." onDark size={30} />
          <p style={{ margin: '12px 0 0', color: 'rgba(255,255,255,0.72)', fontSize: 15.5, maxWidth: 520 }}>
            {PROOF.vendorFor}.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a
            href={PROOF.phoneHref}
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: 52, padding: '0 26px', borderRadius: 12, background: T.blue, color: '#fff', fontWeight: 750, fontSize: 16, textDecoration: 'none' }}
          >
            {PROOF.phone}
          </a>
          <a
            href="https://gorillamovers.com/quote"
            target="_blank"
            rel="noopener"
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: 52, padding: '0 26px', borderRadius: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', fontWeight: 700, fontSize: 16, textDecoration: 'none' }}
          >
            Get a quote →
          </a>
        </div>
      </div>
    </section>
  )
}

/* ── the page ──────────────────────────────────────────────────── */

export default function S15Status({ toast }) {
  const { currentUser } = useStore()
  const [units, setUnits] = useState([])
  const [events, setEvents] = useState([])
  const [openId, setOpenId] = useState(null)
  const [floor, setFloor] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!currentUser || currentUser.status !== 'active') return undefined
    return subscribeUnits(setUnits, (e) => setErr(e.message || 'Could not load the board.'))
  }, [currentUser && currentUser.uid, currentUser && currentUser.status])

  useEffect(() => {
    if (!currentUser || currentUser.status !== 'active') return undefined
    return subscribeEvents(setEvents, () => {})
  }, [currentUser && currentUser.uid, currentUser && currentUser.status])

  const open = useMemo(() => (openId ? units.find((u) => u.id === openId) : null), [openId, units])

  const stats = useMemo(() => {
    const done = units.filter((u) => u.done).length
    const active = units.filter((u) => !u.done && doneCount(u) > 0).length
    const photos = units.reduce((n, u) => n + photoCount(u), 0)
    const packing = units.filter((u) => weArePacking(u)).length
    /* The newest event by the server's clock, not by whatever order the
       subscription happened to deliver them in. */
    const lastTs = events.reduce((best, e) => Math.max(best, toMs(e.ts)), 0) || null
    return { done, active, photos, packing, total: units.length, lastTs }
  }, [units, events])

  const shown = useMemo(() => {
    const list = [...units].sort((a, b) =>
      String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))
    if (!floor) return list
    return list.filter((u) => String(u.number).startsWith(String(floor)))
  }, [units, floor])

  return (
    <div style={{ font: `16px/1.55 ${T.font}`, color: T.text, background: T.paper, minHeight: '100vh' }}>
      <header style={{ background: `linear-gradient(135deg, ${T.navyDeep} 0%, ${T.navy} 45%, ${T.navy2} 100%)`, color: T.paper, paddingTop: 40 }}>
        <div style={WRAP}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 260, flex: '1 1 420px' }}>
              {/* The app's own wordmark, which is drawn for a dark ground.
                  The site has no white logo file - /brand/whitelogo4.0.webp
                  is a 404 - and inverting the black one produced a grey
                  smudge the first time round. */}
              <GorillaWordmark width={200} onDark />
              <div style={{ marginTop: 18 }}><Eyebrow onDark>Live project status</Eyebrow></div>
              <h1 style={{ margin: 0, fontSize: 52, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.03 }}>
                Studio 15
              </h1>
              <p style={{ margin: '10px 0 0', color: 'rgba(255,255,255,0.72)', fontSize: 16.5 }}>
                1475 Imperial Avenue, San Diego. Unit to unit, inside the building.
              </p>
            </div>
            <div style={{ textAlign: 'right', minWidth: 170 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
                Last activity
              </div>
              <div style={{ fontSize: 15.5, marginTop: 6, color: T.paper, fontWeight: 600 }}>
                {stats.lastTs ? when(stats.lastTs) : 'Not started yet'}
              </div>
              <div style={{ display: 'inline-flex', gap: 7, alignItems: 'center', marginTop: 10, fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: T.green }} />
                Updating live
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, marginTop: 32, flexWrap: 'wrap' }}>
            <Stat value={stats.done} label="Units complete" accent="#6ee7a8" hint={`of ${stats.total} on this job`} />
            <Stat value={stats.active} label="In progress" accent={T.blueLight} hint="being worked right now" />
            <Stat value={stats.photos} label="Photographs" hint="every unit, before and after" />
            <Stat value={stats.packing} label="We pack" hint="units our crew packs" />
          </div>

          <ProgressBar done={stats.done} active={stats.active} total={stats.total} />
          <div style={{ height: 34 }} />
        </div>
        <Slant from="transparent" />
      </header>

      <TrustStrip />

      {err && (
        <div style={{ ...WRAP, paddingTop: 20 }}>
          <div style={{ background: '#fff5f5', border: `1px solid ${T.red}`, color: T.red, borderRadius: 12, padding: 14 }}>{err}</div>
        </div>
      )}

      {open ? (
        <UnitDetail
          unit={open}
          events={events}
          user={currentUser}
          toast={toast}
          onBack={() => setOpenId(null)}
        />
      ) : (
        <>
          <section style={{ ...WRAP, paddingTop: 46 }}>
            <Eyebrow>The building</Eyebrow>
            <Headline lead="Fifty units a floor," accent="five floors, one crew." size={32} />
            <div style={{ background: T.navy, borderRadius: 18, padding: 16, marginTop: 24, overflow: 'hidden' }}>
              <S15Building units={units} selected={floor} onSelect={setFloor} />
            </div>
            <p style={{ fontSize: 14, color: T.muted, marginTop: 12 }}>
              {floor ? `Showing floor ${floor}. Tap it again for the whole building.` : 'Tap a floor to filter the list below.'}
            </p>
          </section>

          <section style={{ ...WRAP, paddingTop: 40, paddingBottom: 56 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
              <div>
                <Eyebrow>{floor ? `Floor ${floor}` : 'Every unit'}</Eyebrow>
                <Headline lead="The work," accent="unit by unit." size={32} />
              </div>
              <span style={{ fontSize: 14, color: T.muted }}>Tap a unit for photographs and its full record</span>
            </div>

            {shown.length === 0 ? (
              <p style={{ color: T.muted }}>No units on this job yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {shown.map((u) => <UnitRow key={u.id} unit={u} onOpen={setOpenId} />)}
              </div>
            )}
          </section>

          <Services />
          <CallToAction />
        </>
      )}

      <footer style={{ background: '#f7f9fc', borderTop: `1px solid ${T.line}`, padding: '30px 0' }}>
        <div style={{ ...WRAP, display: 'flex', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 750, color: T.ink, fontSize: 15 }}>Gorilla Movers of San Diego</div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>
              Licensed and insured · {PROOF.cal} · {PROOF.usdot}
            </div>
          </div>
          <div style={{ fontSize: 13, color: T.muted, maxWidth: 430 }}>
            Every unit is photographed before and after. Every action on this page is recorded with a name and a time.
          </div>
        </div>
      </footer>
    </div>
  )
}
