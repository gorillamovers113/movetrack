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
  const when = media.ts ? fmtTime(media.ts) : '-'
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
            {m.userName || 'Unknown'}<br />{m.ts ? fmtTime(m.ts) : '-'}
          </div>
        </div>
      ))}
    </div>
  )
}

/* Camera first, and exactly one accept type per input.
 *
 * Android Chrome ignores `capture` when `accept` lists more than one type: it
 * cannot tell which capture intent to launch, so it quietly falls back to the
 * file picker. Widening accept to "image/*,video/*" to support video therefore
 * broke the camera on every Android phone on the job, while iOS carried on
 * working perfectly, which is why it took a day to surface.
 *
 * So each way in gets its own input with a single accept type. Photo opens the
 * camera. Video opens the video camera. Choosing something already shot is a
 * separate, quieter option rather than the thing Android drops you into.
 */
function CaptureSlot({ accept, capture, multiple, onPick, className, children }) {
  return (
    <label className={className} style={{ cursor: 'pointer', margin: 0 }}>
      <input
        type="file"
        accept={accept}
        {...(capture ? { capture: 'environment' } : {})}
        {...(multiple ? { multiple: true } : {})}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files
          if (files && files.length) onPick(files)
          e.target.value = ''
        }}
      />
      {children}
    </label>
  )
}

export function CaptureButtons({ onFiles, multiple = false, busy = false, compact = false }) {
  const size = compact ? 'btn-sm' : ''
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <CaptureSlot
        accept="image/*" capture multiple={multiple} onPick={onFiles}
        className={`btn btn-primary ${size}`}
      >
        {busy ? 'Saving…' : '📷 Photo'}
      </CaptureSlot>
      <CaptureSlot
        accept="video/*" capture multiple={multiple} onPick={onFiles}
        className={`btn btn-ghost ${size}`}
      >
        🎥 Video
      </CaptureSlot>
      {/* No capture attribute: this one is meant to open the library. */}
      <CaptureSlot
        accept="image/*,video/*" multiple={multiple} onPick={onFiles}
        className={`btn btn-ghost ${size}`}
      >
        Choose a file
      </CaptureSlot>
    </div>
  )
}

export function Uploader({ onFiles, label = 'Take a photo or video' }) {
  const [busy, setBusy] = useState(false)
  const handle = async (files) => {
    setBusy(true)
    await onFiles(files)
    setBusy(false)
  }
  return (
    <div className="dropzone" style={{ display: 'block' }}>
      <div className="muted" style={{ marginBottom: 8 }}>{busy ? 'Processing…' : label}</div>
      <CaptureButtons onFiles={handle} multiple busy={busy} />
    </div>
  )
}

export function EventRow({ e, onOpenMedia, linkUnit, linkContainer, showTarget = true }) {
  const icon = { stage: '⬢', step: '✓', media: '📷', note: '📝', flag: '⚑', system: '⚙️' }[e.type] || '•'
  const iconColor = e.type === 'flag' ? '#ef4444' : e.to ? stageOf(e.to)?.color : '#8a93a2'
  return (
    <div className="tl-item">
      <div style={{ width: 22, textAlign: 'center', fontSize: 15, color: iconColor, flexShrink: 0, paddingTop: 1 }}>{icon}</div>
      <div className="tl-body">
        <div className="tl-action">{e.action}</div>
        <div className="tl-meta">
          {/* A note written after the fact carries the day it is ABOUT as well
              as the moment it was typed. Both are shown: the timeline reads in
              the order things happened, and nothing pretends to have been
              written at a time it was not. */}
          <b>{e.userName}</b> · {e.role} · {fmtTime(e.occurredAt || e.ts)}
          {e.occurredAt
            ? <span style={{ opacity: 0.7 }}> (written {fmtTime(e.ts)})</span>
            : <span style={{ opacity: 0.7 }}> ({fmtAgo(e.ts)})</span>}
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
