import React, { useEffect, useState } from 'react'

/* "There is a newer version, tap to load it."
 *
 * A crew phone is opened once in the morning and never reloaded. After a
 * deploy it keeps running the bundle it launched with, so a fix can be live
 * for half an hour and reach nobody. On 10 Sep that meant a mover standing at
 * a sealed vault getting "Missing or insufficient permissions" from a rules
 * change that his bundle predated.
 *
 * Deliberately a prompt and not an automatic reload. Reloading out from under
 * somebody mid-form would throw away a photo they just waited on a stairwell
 * signal to upload, which is a worse day than being one version behind. The
 * one exception is a phone that has been backgrounded: coming back to the app
 * is already a fresh start, so a reload there costs nothing.
 */

// Poll rarely. This exists to close a window measured in hours, not seconds,
// and a request every few minutes from every phone on a job is rude.
const EVERY = 3 * 60 * 1000

export async function latestBuild() {
  const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`version check failed: ${res.status}`)
  const body = await res.json()
  return body && body.build
}

export default function UpdateBar() {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    // __BUILD_ID__ is injected at build time. In dev it is undefined, and
    // there is nothing to check.
    const running = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : null
    if (!running) return

    let alive = true
    let backgroundedAt = 0

    const check = async () => {
      try {
        const latest = await latestBuild()
        if (alive && latest && latest !== running) setStale(true)
      } catch {
        // Offline, or the deploy is mid-flight. Either way the next tick asks
        // again; a failed version check must never interrupt anybody.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        backgroundedAt = Date.now()
        return
      }
      // Away long enough that coming back is a fresh start anyway.
      const away = backgroundedAt && Date.now() - backgroundedAt > 10 * 60 * 1000
      latestBuild()
        .then((latest) => {
          if (!alive || !latest || latest === running) return
          if (away) window.location.reload()
          else setStale(true)
        })
        .catch(() => { /* see above */ })
    }

    check()
    const t = setInterval(check, EVERY)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!stale) return null

  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 74px)',
        zIndex: 80, display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', borderRadius: 12, border: 'none',
        background: '#111827', color: '#fff', fontFamily: 'inherit', fontSize: 14,
        boxShadow: '0 8px 24px rgba(0,0,0,.28)', cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span aria-hidden>⬆</span>
      <span style={{ flex: 1 }}>
        <b>MoveTrack has been updated.</b>
        <span style={{ display: 'block', opacity: .8, fontSize: 12.5 }}>
          Tap to load the new version. Finish what you are saving first.
        </span>
      </span>
    </button>
  )
}
