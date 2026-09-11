/* Telling the server the app is open, and which screen is showing.
 *
 * Everything interesting about a session is decided server side: the IP,
 * because a browser cannot know its own, and the identity, because a browser
 * could lie about it. This end sends only what the server genuinely cannot
 * see, which is which screen is in front of somebody.
 *
 * Bounded to the app on purpose. No location, nothing outside MoveTrack, and
 * the full user-agent stays in the request rather than being stored: a coarse
 * "iPhone · Safari" is what somebody reading a log actually wants.
 *
 * Failures are swallowed. A session that does not get logged is a gap in a
 * report; a session that throws is a crew member who cannot work.
 */
let call = null
let sessionId = null
let lastSent = 0
let lastView = null

// One id per tab per launch. Reloading starts a new session, which is the
// honest reading: it is a new launch of the app.
function idFor() {
  if (sessionId) return sessionId
  const rand = Math.random().toString(36).slice(2, 10)
  sessionId = `${Date.now().toString(36)}-${rand}`
  return sessionId
}

// Rate limit. A crew member hopping between screens should not generate a
// write per tap, and the server only stores a change of view anyway.
const MIN_GAP = 20 * 1000

export function resetTelemetry() {
  call = null; sessionId = null; lastSent = 0; lastView = null
}

export async function recordSession(view, { force = false } = {}) {
  try {
    if (typeof window === 'undefined') return
    const now = Date.now()
    const changed = view !== lastView
    if (!force && !changed && now - lastSent < MIN_GAP) return
    lastSent = now
    lastView = view

    if (!call) {
      const [{ getFunctions, httpsCallable }, { app }] = await Promise.all([
        import('firebase/functions'),
        import('../firebase.js'),
      ])
      call = httpsCallable(getFunctions(app), 'recordSession')
    }
    await call({
      sessionId: idFor(),
      view: view || null,
      screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      build: document.querySelector('script[src*="assets/index-"]')?.getAttribute('src')?.split('/').pop() || null,
    })
  } catch {
    // See above: a gap in a report beats a crew member who cannot work.
  }
}
