import React, { useEffect, useState } from 'react'
import { stageOf } from './seed.js'
import { fmtTime, fmtAgo } from './store.jsx'

// Standing-gorilla silhouette recreated from the official Gorilla Movers logo:
// knuckle-walking, facing right, head low, white back/chest highlight.
export function GorillaMark({ height = 60, body = '#171a20', highlight = '#ffffff' }) {
  return (
    <svg height={height} viewBox="0 0 220 200" aria-label="Gorilla Movers gorilla" style={{ display: 'block' }}>
      <GorillaMarkPaths body={body} highlight={highlight} />
    </svg>
  )
}

// Full wordmark: G[gorilla]RILLA / MOVERS — matches the official logo lockup.
export function GorillaWordmark({ width = 300, ink = '#171a20', highlight = '#ffffff' }) {
  return (
    <svg width={width} viewBox="0 0 560 200" aria-label="Gorilla Movers" style={{ display: 'block' }}>
      <text x="0" y="138" fontFamily="'Space Grotesk','Inter',sans-serif" fontWeight="700" fontSize="118" fill={ink} letterSpacing="-2">G</text>
      <g transform="translate(50, 8) scale(0.72)">
        <GorillaMarkPaths body={ink} highlight={highlight} />
      </g>
      <text x="178" y="138" fontFamily="'Space Grotesk','Inter',sans-serif" fontWeight="700" fontSize="118" fill={ink} letterSpacing="-2">RILLA</text>
      <text x="260" y="188" textAnchor="middle" fontFamily="'Space Grotesk','Inter',sans-serif" fontWeight="700" fontSize="42" fill={ink} letterSpacing="24">MOVERS</text>
    </svg>
  )
}

export function GorillaMarkPaths({ body, highlight }) {
  return (
    <>
      <path fill={body} d="M95 20
        C 106 20 118 24 127 26
        C 131 20 138 14 144 16
        C 154 20 163 30 168 40
        C 170 44 174 46 176 52
        C 178 58 178 64 176 68
        C 178 74 176 80 170 84
        C 174 96 178 110 180 126
        C 182 142 182 156 182 170
        L 150 170
        C 150 156 149 142 147 130
        C 145 142 144 156 144 170
        L 118 170
        C 118 154 120 136 124 122
        C 113 124 103 124 96 122
        C 96 136 95 154 93 170
        L 64 170
        C 63 156 62 142 63 130
        C 54 122 48 108 48 94
        C 48 64 66 32 95 20 Z" />
      <path fill={highlight} d="M90 32
        C 76 42 64 60 60 80
        C 57 96 60 110 68 116
        C 74 120 82 118 88 112
        C 84 98 85 78 91 60
        C 95 48 99 40 100 34
        C 97 30 93 30 90 32 Z" />
      <path fill={highlight} d="M152 42 L 170 42 C 170 47 166 50 161 50 C 156 50 152 46 152 42 Z" />
      <circle cx="167" cy="60" r="2.2" fill={highlight} opacity="0.9" />
      <path fill={highlight} opacity="0.85" d="M158 70 C 163 70 167 73 167 77 C 164 80 158 79 155 75 C 155 72 156 70 158 70 Z" />
    </>
  )
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
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </div>
  )
}

export function Lightbox({ media, onClose }) {
  if (!media) return null
  return (
    <div className="lightbox" onClick={onClose}>
      {media.kind === 'video'
        ? <video src={media.url} controls autoPlay onClick={(e) => e.stopPropagation()} />
        : <img src={media.url} alt={media.label} />}
      <div className="cap">{media.label}</div>
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
        <MediaRow media={e.media} onOpen={onOpenMedia} />
      </div>
    </div>
  )
}

export function Toast({ msg }) {
  if (!msg) return null
  return <div className="toast">{msg}</div>
}
