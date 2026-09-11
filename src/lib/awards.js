/* Recognition, kept in the app rather than in a thank-you nobody sees again.
 *
 * Aaron read the app carefully enough to write up two workflow problems the
 * crew had been working around, one of which was a genuine design mistake in
 * something shipped the day before. Finding that is worth more to a job than
 * most days of moving boxes, and it should be visible where the work is.
 *
 * Deliberately small: a mark beside a name, the reason behind it, and the date.
 * Not points, not a leaderboard, not a score anybody could game or feel
 * measured against.
 */
export const STAR = '⭐'

export function hasStar(user) {
  return !!(user && user.award && user.award.star)
}

export function starReason(user) {
  return hasStar(user) ? (user.award.reason || '') : ''
}

// Name with the mark, for the places a name is printed as plain text.
export function nameWithStar(user) {
  if (!user) return ''
  return hasStar(user) ? `${user.name} ${STAR}` : user.name || ''
}
