import React from 'react'
import { hasStar, starReason, STAR } from '../lib/awards.js'

/* A name, with its mark if it has earned one.
 *
 * The title carries the reason, because a star nobody can explain is just
 * decoration. Renders the bare name when there is no award, so it is safe to
 * use anywhere a name goes.
 */
export default function StarredName({ user, name, bold = false }) {
  const text = name || (user && user.name) || 'Unknown'
  if (!hasStar(user)) return bold ? <b>{text}</b> : <>{text}</>
  return (
    <span title={starReason(user)}>
      {bold ? <b>{text}</b> : text}
      <span aria-label="Awarded a star" style={{ marginLeft: 5 }}>{STAR}</span>
    </span>
  )
}
