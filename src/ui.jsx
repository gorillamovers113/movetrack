import React, { useEffect, useState } from 'react'
import { stageOf } from './seed.js'
import { fmtTime, fmtAgo } from './store.jsx'

// Official Gorilla Movers logo files, pulled from gorillamovers.com:
// gm-logo.png = white lettering (for dark backgrounds), gm-logo-dark.png = dark version,
// favicon.png = the standing gorilla alone.
export function GorillaWordmark({ width = 300, onDark = true }) {
  return <img src={onDark ? 'gm-logo.png' : 'gm-logo-dark.png'} width={width} alt="Gorilla Movers" style={{ display: 'block', height: 'auto' }} />
}

export function GorillaMark({ height = 26 }) {
  return <img src="favicon.png" height={height} alt="Gorilla Movers" style={{ display: 'block' }} />
}

const AV_COLORS = ['#f59e0b', '#14b8a6', '#8b5cf6', '#f97316', '#3b82f6', '#ec4899', '#22c55e', '#06b6d4', '#ef4444', '#6366f1']
export function initialsOf(name) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}
export function Avatar({ name, size = '' }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return <div className={`avatar ${size}`} style={{ background: AV_COLORS[h % AV_COLORS.length] }}>{initialsOf(name)}</div>
}

export function StagePill({ stage, short = false }) {
  const s = stageOf(stage)
  return <span className="stage-pill" style={{ background: s.color }}>{short ? s.short : s.label}</span>
}

export function Modal({ title, sub, onClose, children }) {
  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="row" style={{ marginBottom: 4 }}>
          <h3 className="grow">{title}</h3>
          <button className="btn btn-ghost btn-sm btn-icon-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </div>
  )
}

export function Lightbox({ media, onClose }) {
  if (!media) return null
  const who = media.userName || 'Unknown'
  const when = media.ts ? fmtTime(media.ts) : '—'
  return (
    <div className="lightbox" onClick={onClose}>
      {media.kind === 'video'
        ? <video src={media.url} controls autoPlay onClick={(e) => e.stopPropagation()} />
        : <img src={media.url} alt={media.label} />}
      <div className="cap">{media.label} · {who} · {when}</div>
    </div>
  )
}

export function MediaRow({ media, onOpen }) {
  if (!media || !media.length) return null
  return (
    <div className="media-row">
      {media.map((m) =>
        m.kind === 'video'
          ? <div key={m.id} className="media-video" onClick={() => onOpen(m)} title={m.label}>▶</div>
          : <img key={m.id} className="media-thumb" src={m.url} alt={m.label} onClick={() => onOpen(m)} />
      )}
    </div>
  )
}

// Thumbnail (or ▶ tile for video) with, directly beneath each one, who
// submitted it and when. Used everywhere stored media renders (Activity
// feed, unit timeline, My queue, Containers, Overflow) so per-photo
// attribution shows even when a photo's submitter differs from the event's
// row-level actor. Old media saved before attribution was added lack these
// fields, so fall back gracefully rather than ever crashing.
export function AttributedMedia({ media, onOpen }) {
  if (!media || !media.length) return null
  return (
    <div className="media-row" style={{ flexWrap: 'wrap' }}>
      {media.map((m) => (
        <div key={m.id} style={{ textAlign: 'center', width: 92 }}>
          {m.kind === 'video'
            ? <div className="media-video" onClick={() => onOpen(m)} title={m.label}>▶</div>
            : <img className="media-thumb" src={m.url} alt={m.label} onClick={() => onOpen(m)} />}
          <div className="muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.3 }}>
            {m.userName || 'Unknown'}<br />{m.ts ? fmtTime(m.ts) : '—'}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Uploader({ onFiles, label = 'Tap to add photos or videos' }) {
  const [busy, setBusy] = useState(false)
  return (
    <label className="dropzone" style={{ display: 'block' }}>
      <input
        type="file" accept="image/*,video/*" multiple capture="environment" style={{ display: 'none' }}
        onChange={async (e) => {
          if (!e.target.files.length) return
          setBusy(true)
          await onFiles(e.target.files)
          setBusy(false)
          e.target.value = ''
        }}
      />
      {busy ? 'Processing…' : <>📷 {label}</>}
    </label>
  )
}

export function EventRow({ e, onOpenMedia, linkUnit, linkContainer, showTarget = true }) {
  const icon = { stage: '⬢', media: '📷', note: '📝', flag: '⚑', system: '⚙️' }[e.type] || '•'
  const iconColor = e.type === 'flag' ? '#ef4444' : e.to ? stageOf(e.to)?.color : '#8a93a2'
  return (
    <div className="tl-item">
      <div style={{ width: 22, textAlign: 'center', fontSize: 15, color: iconColor, flexShrink: 0, paddingTop: 1 }}>{icon}</div>
      <div className="tl-body">
        <div className="tl-action">{e.action}</div>
        <div className="tl-meta">
          <b>{e.userName}</b> · {e.role} — {fmtTime(e.ts)} <span style={{ opacity: 0.7 }}>({fmtAgo(e.ts)})</span>
          {showTarget && e.unitId && linkUnit && <> · <span className="linkish" onClick={() => linkUnit(e.unitId)}>unit</span></>}
          {showTarget && e.containerId && linkContainer && <> · <span className="linkish" onClick={() => linkContainer(e.containerId)}>container</span></>}
        </div>
        <AttributedMedia media={e.media} onOpen={onOpenMedia} />
      </div>
    </div>
  )
}

export function Toast({ msg }) {
  if (!msg) return null
  return <div className="toast">{msg}</div>
}
