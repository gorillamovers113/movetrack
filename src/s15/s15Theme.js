/* The Studio 15 status page, in gorillamovers.com's own colours.
 *
 * Casey, 2026-10-22: "it would be nice to make a badass theme that matches
 * gorillamovers.com ... i want to look like a profeshinal relocation company
 * here, do a good job!!"
 *
 * These are not approximations. They were read out of the live site's
 * stylesheet on the day, so the status page a property manager opens and the
 * website they were sold from are the same brand rather than two guesses at
 * it: ORANGE is the one accent the site spends, the near-blacks are its dark
 * surfaces, and the stone is the warm neutral it sets type on.
 *
 * One accent, spent in one place. The page is almost entirely ink, bone and
 * stone, so that orange means something wherever it appears - a unit moving,
 * a number worth reading - instead of being decoration. Progress green and
 * the cobalt of the packed state are carried over from the crew app so a
 * colour means the same thing to Casey and to the property manager.
 */
export const T = {
  ink: '#0e0e14',
  ink2: '#181822',
  ink3: '#20202c',
  line: '#262634',
  orange: '#f5821f',
  orangeSoft: 'rgba(245, 130, 31, 0.14)',
  gold: '#f5b414',
  green: '#0fa968',
  cobalt: '#23409f',
  red: '#d92632',
  bone: '#f4f1e9',
  stone: '#e2ded2',
  paper: '#ffffff',
  navy: '#0a2540',
  body: '#535f66',
  muted: '#8d8da2',
  mutedLight: '#5d6e86',
  font: '"Inter","Segoe UI",system-ui,-apple-system,sans-serif',
}

/** Tabular figures, so a column of counts lines up instead of shimmying. */
export const NUM = { fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' }

/* TWO KINDS OF TIMESTAMP REACH THIS PAGE, and the first version of it put
 * "Invalid Date" in front of a client.
 *
 * Photographs carry Date.now() from the phone that took them, because the
 * shot has to appear the instant it is taken, offline, with no round trip.
 * Events carry serverTimestamp(), because the order of the record must not
 * depend on whose phone clock is wrong.
 *
 * So one is a number and the other is a Firestore Timestamp, and a
 * serverTimestamp is additionally NULL for a moment on the writer's own
 * screen, between the local write landing and the server's value coming
 * back. Everything here goes through toMs() and anything unreadable prints
 * nothing at all, which is the one safe thing to show a client. */
export function toMs(ts) {
  if (!ts) return 0
  if (typeof ts === 'number') return ts
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}

/** One date format everywhere a property manager reads one. */
export function when(ts) {
  const ms = toMs(ts)
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function dayOnly(ts) {
  const ms = toMs(ts)
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
