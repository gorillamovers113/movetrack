/* The card icons, drawn to match gorillamovers.com's.
 *
 * The site sets a line icon in a soft blue rounded tile above each service
 * card. These are hand-drawn rather than pulled from an icon package,
 * because the page already ships nothing and one more dependency for six
 * glyphs is not a trade worth making.
 *
 * currentColor throughout, so the tile decides the colour.
 */
import React from 'react'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }

const PATHS = {
  trash: <><path d="M3 6h18" {...S} /><path d="M8 6V4h8v2" {...S} /><path d="M6 6l1 14h10l1-14" {...S} /><path d="M10 11v5M14 11v5" {...S} /></>,
  lock: <><rect x="4" y="10" width="16" height="10" rx="2" {...S} /><path d="M8 10V7a4 4 0 0 1 8 0v3" {...S} /></>,
  box: <><path d="M3 8l9-4 9 4v8l-9 4-9-4z" {...S} /><path d="M3 8l9 4 9-4M12 12v8" {...S} /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1.5" {...S} /><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" {...S} /><path d="M10 21v-3h4v3" {...S} /></>,
  wrench: <><path d="M14.5 4.5a4.5 4.5 0 0 0 5.8 5.8l-9 9a2.8 2.8 0 1 1-4-4l9-9a4.5 4.5 0 0 0-1.8-1.8z" {...S} /></>,
  truck: <><rect x="2" y="7" width="12" height="9" rx="1.5" {...S} /><path d="M14 10h4l3 3v3h-7z" {...S} /><circle cx="7" cy="18" r="2" {...S} /><circle cx="17.5" cy="18" r="2" {...S} /></>,
  star: <><path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" {...S} /></>,
  shield: <><path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6z" {...S} /><path d="M9.2 12.2l2 2 3.6-3.8" {...S} /></>,
  clock: <><circle cx="12" cy="12" r="8.5" {...S} /><path d="M12 7v5l3.2 2" {...S} /></>,
  camera: <><path d="M3 8h3.5l1.5-2h8l1.5 2H21v11H3z" {...S} /><circle cx="12" cy="13" r="3.6" {...S} /></>,
}

export default function Icon({ name, size = 22 }) {
  const d = PATHS[name] || PATHS.box
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">{d}</svg>
  )
}
