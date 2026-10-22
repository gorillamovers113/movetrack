/* The Studio 15 status page, in gorillamovers.com's actual design language.
 *
 * Casey, 2026-10-22: "the viewer page is a bit ugly, any way you can improve
 * on this .. style it like gorillamovers.com (view the site to see for
 * yourself)."
 *
 * I had not viewed the site. I had read its stylesheet, found #f5821f in it,
 * and built an orange page. The site is BLUE: a deep navy hero, white body,
 * blue accents, Inter at weight 800 for headlines. The orange was a minor
 * accent somewhere I never saw. Reading a stylesheet is not looking at a
 * design, and this is the correction.
 *
 * Every value below was taken off the live site: the custom properties it
 * actually sets on :root, and the blues its own CSS spends most.
 */
export const T = {
  /* The site's own tokens, read from its :root. */
  ink: '#0a2540',        // headings
  text: '#425466',       // body copy
  muted: '#5d6e86',      // captions
  line: '#e6ebf1',       // hairlines
  paper: '#ffffff',

  /* The blue family its CSS spends. */
  blue: '#2a6cc4',       // primary action
  blueDeep: '#1b55a5',   // hover, pressed
  blueDark: '#123c78',   // darkest in the family
  blueLink: '#0c6b9d',   // the colour its links actually compute to
  blueLight: '#4a9ae8',  // accents on a dark ground
  blueWash: '#eaf2fb',   // the soft tile behind its card icons

  /* Dark surfaces for the hero. */
  navy: '#0a2540',
  navy2: '#0e315f',
  navyDeep: '#071a2e',

  /* Status colours, carried over from the crew app so a colour means the
   * same thing to Casey and to his client. */
  green: '#0fa968',
  amber: '#f5821f',
  red: '#d92632',
  star: '#f5b414',

  font: '"Inter","Segoe UI",system-ui,-apple-system,sans-serif',
}

/* What the site puts in front of a customer, verbatim where it matters.
 * These are claims, so they live in one place: if a number moves, it moves
 * here and not in six bits of markup. */
export const PROOF = {
  rating: '4.8',
  reviews: '353',
  bbb: 'A+',
  moves: '25,120+',
  since: '2008',
  repeat: '97.9%',
  cal: 'CAL T-192729',
  usdot: 'USDOT 3801918',
  phone: '619.600.5000',
  phoneHref: 'tel:+16196005000',
  vendorFor: 'Preferred vendor for Irvine Company, H.G. Fenton and Greystar',
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

/* THE ADVERTS.
 *
 * Casey: "add some ads for other gorilla movers services."
 *
 * Chosen for the person actually reading this page, which is a property
 * manager, not a householder: turnovers, storage gaps, their own office.
 * Written in the site's voice and pointed at its real pages - every href
 * below was checked for a 200 before it shipped, because a dead link on the
 * page a client judges us by is worse than no link.
 */
export const ADS = [
  {
    key: 'junk',
    title: 'Junk Removal & Cleanouts',
    body: 'Move out clean. Donation runs, haul-away and disposal so nothing follows a turnover into the next tenancy.',
    proof: 'Donation runs and haul-away included',
    href: 'https://gorillamovers.com/junk-hauling-removal-san-diego',
    icon: 'trash',
  },
  {
    key: 'storage',
    title: 'Storage',
    body: 'For when move-out and move-in dates refuse to line up. Wrapped, photo-inventoried and sealed in our own warehouse.',
    proof: '75,000 sq ft warehouse, 8,000 sealed vaults',
    href: 'https://gorillamovers.com/storage-services-san-diego',
    icon: 'lock',
  },
  {
    key: 'packing',
    title: 'Packing & Unpacking',
    body: 'Movers and packers in one company: pro materials, labeled by room, unpacked where it belongs.',
    proof: 'No hidden packing fees, ever',
    href: 'https://gorillamovers.com/san-diego-packing',
    icon: 'box',
  },
  {
    key: 'commercial',
    title: 'Commercial Moving',
    body: 'Retail, warehouse and industrial relocations with COIs, dock coordination and after-hours crews.',
    proof: 'After-hours and weekend crews to cut downtime',
    href: 'https://gorillamovers.com/commercial-moving-company-san-diego',
    icon: 'building',
  },
  {
    key: 'office',
    title: 'Office Moving',
    body: 'Crews who tear down and rebuild cubicles, disconnect and reconnect IT. Close Friday, open Monday.',
    proof: 'Cubicles down Friday, back up Monday',
    href: 'https://gorillamovers.com/office-moving',
    icon: 'wrench',
  },
  {
    key: 'local',
    title: 'Local Moving',
    body: 'The movers San Diego County calls for homes, condos and apartments. Worth passing to a resident who asks.',
    proof: `${PROOF.moves} San Diego moves since ${PROOF.since}`,
    href: 'https://gorillamovers.com/san-diego-local-movers',
    icon: 'truck',
  },
]
