import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { submitAction, SUBMIT_TIMEOUT_MS, QUEUED_MESSAGE } from '../submit.js'

// A promise that never settles, standing in for a Firestore write Promise
// stuck offline (it does not resolve until the server acknowledges).
const neverResolves = () => new Promise(() => {})

describe('submitAction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.stubGlobal('navigator', { onLine: true })
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('resolves "queued" immediately when offline, without waiting on the write', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const p = submitAction(neverResolves())
    // Only a single macrotask tick should be needed (the 0ms offline
    // budget), never the full online timeout.
    await vi.advanceTimersByTimeAsync(0)
    await expect(p).resolves.toBe('queued')
  })

  it('resolves "synced" when online and the write resolves before the timeout', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const p = submitAction(Promise.resolve('ok'))
    await expect(p).resolves.toBe('synced')
  })

  it('resolves "queued" when online but the write does not settle before the timeout (captive portal / stale navigator.onLine)', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const p = submitAction(neverResolves())
    await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS)
    await expect(p).resolves.toBe('queued')
  })

  it('rethrows when the write actually rejects while online (real failure, not a network condition)', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const err = new Error('permission-denied')
    await expect(submitAction(Promise.reject(err))).rejects.toThrow('permission-denied')
  })

  it('still rethrows a synchronous pre-write validation error even when offline', async () => {
    // Mirrors loadUnit/loadForReturn in store.jsx: dispatch() throws before
    // any Firestore call, so the rejected promise is already settled by the
    // time submitAction sees it. That must win the race against the 0ms
    // offline budget, since a macrotask timer only fires after the
    // microtask queue (where this rejection's handler lives) drains.
    vi.stubGlobal('navigator', { onLine: false })
    const err = new Error('That BigBox is no longer accepting items. Refresh and pick another container.')
    // Chained in one expression on purpose: the already-rejected promise
    // resolves through microtasks alone (no fake-timer advance needed,
    // since it wins the race before the 0ms budget timer ever fires), so
    // attaching the handler in a later statement would leave `p` briefly
    // unobserved and trip Node's unhandled-rejection detection as a test
    // artifact, not a bug in submitAction itself.
    await expect(submitAction(Promise.reject(err))).rejects.toThrow('no longer accepting items')
  })

  it('never lets a losing write reject as an unhandled rejection', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    let unhandled = false
    const onUnhandled = () => { unhandled = true }
    process.on('unhandledRejection', onUnhandled)
    try {
      let rejectLate
      const late = new Promise((_, reject) => { rejectLate = reject })
      const p = submitAction(late)
      await vi.advanceTimersByTimeAsync(0)
      await expect(p).resolves.toBe('queued')
      rejectLate(new Error('arrives after we already reported queued'))
      await vi.advanceTimersByTimeAsync(0)
      // Flush a real microtask turn so a genuine unhandledRejection (if any)
      // has a chance to fire even under fake timers.
      await Promise.resolve()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toBe(false)
  })

  it('fires toast(successMsg) on a synced write and toast(queuedMsg) on a queued one', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const toastOk = vi.fn()
    await submitAction(Promise.resolve(), { toast: toastOk, successMsg: 'Logged ✓' })
    expect(toastOk).toHaveBeenCalledWith('Logged ✓')

    vi.stubGlobal('navigator', { onLine: false })
    const toastQueued = vi.fn()
    const p = submitAction(neverResolves(), { toast: toastQueued, successMsg: 'Logged ✓' })
    await vi.advanceTimersByTimeAsync(0)
    await p
    expect(toastQueued).toHaveBeenCalledWith(QUEUED_MESSAGE)
  })
})
