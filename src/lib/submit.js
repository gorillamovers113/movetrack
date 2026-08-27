// Offline-aware wrapper around a Firestore write dispatch.
//
// Firestore has offline persistence on (src/firebase.js), so a write queues
// in the local cache and the UI updates immediately through onSnapshot even
// with no signal. But the write's own Promise (updateDoc/setDoc/writeBatch
// commit, all of which is what store.jsx's dispatch() ultimately awaits)
// does NOT resolve while offline. It resolves only once the server
// acknowledges. A raw `await dispatch(...)` in a dead zone therefore hangs
// forever: no toast, the confirm button stays busy, the modal never closes.
// That is worse than useless for a crew working a spotty-signal high-rise.
//
// submitAction() fixes this by never actually waiting on the network:
//   - offline: don't await the write. Resolve 'queued' right away so the
//     caller can toast "saved, will sync" and close the modal. The write
//     itself keeps running in the background and lands once back online.
//   - online: race the write against a timeout. The write winning means a
//     normal server-acknowledged success ('synced'). The timeout winning
//     (captive portal, navigator.onLine lying, a very slow network) is
//     treated the same as offline ('queued') so the UI still never hangs.
//   - a write that actually rejects (rules denial, a real error while
//     online) rethrows so the caller's existing catch shows the error and
//     leaves the form open for a retry.
//
// One deliberate wrinkle: some dispatch actions (loadUnit, loadForReturn)
// throw synchronously, before any Firestore call, when client-side state
// says the picked container can no longer accept the load. That is a real
// validation error, not a network condition, and it needs to surface even
// when offline (client-side checks work fine from cache). Rather than
// special-case that, the "offline" path below still races the write, just
// against a 0ms budget instead of the online timeout. A promise that is
// already rejected (or rejects on the next tick, like that synchronous
// throw) always wins a race against a fresh 0ms timer, since a macrotask
// timer only fires after the microtask queue (where that rejection's
// handler lives) has fully drained. A write that is genuinely pending on
// the network never resolves within that same tick, so it loses the race
// and we report 'queued' exactly as if we hadn't awaited it at all. Net
// effect: still "don't wait on the network", but pre-write validation
// errors keep working exactly like they did before this pass.

export const SUBMIT_TIMEOUT_MS = 7000
export const QUEUED_MESSAGE = "Saved on your phone. It will sync when you're back online."

function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

// submitAction(dispatchPromise, opts?) -> Promise<'synced' | 'queued'>
// (throws if the write actually rejects while online)
//
// opts:
//   toast       - optional. If given, submitAction fires it itself:
//                 successMsg on 'synced', queuedMsg (default QUEUED_MESSAGE)
//                 on 'queued'. Callers with extra post-write logic (mismatch
//                 flags, per-row messages, etc) can omit toast and branch on
//                 the returned status themselves instead.
//   successMsg  - toast text for a synced (online, server-acknowledged) write.
//   queuedMsg   - toast text for a queued (offline, or the write timed out)
//                 write. Defaults to QUEUED_MESSAGE.
//   timeoutMs   - online-only race budget. Defaults to SUBMIT_TIMEOUT_MS.
export async function submitAction(dispatchPromise, opts = {}) {
  const { toast, successMsg, queuedMsg = QUEUED_MESSAGE, timeoutMs = SUBMIT_TIMEOUT_MS } = opts

  // Whatever happens below, make sure a later rejection on the original
  // write promise never surfaces as an unhandled rejection.
  dispatchPromise.catch(() => {})

  const budgetMs = isOnline() ? timeoutMs : 0
  const QUEUED = Symbol('submitAction queued')
  let timer
  const budget = new Promise((resolve) => { timer = setTimeout(() => resolve(QUEUED), budgetMs) })

  let status
  try {
    const winner = await Promise.race([dispatchPromise, budget])
    status = winner === QUEUED ? 'queued' : 'synced'
  } finally {
    clearTimeout(timer)
  }

  if (toast) toast(status === 'synced' ? (successMsg ?? 'Saved ✓') : queuedMsg)
  return status
}
