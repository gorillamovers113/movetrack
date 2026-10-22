/* Which jobs a person is allowed to see.
 *
 * Casey, 2026-10-22: "i need the super admin, me casey to have the ability to
 * set what each user can see and use. ie. for one user i want him to only see
 * trinity mannor but a different user to only see studio 15 and yet a
 * different user i want them to see none and lastly i want a user to see
 * both."
 *
 * So access is a list on the user document: `projects: ['studio15']`. Four
 * states, all expressible: one job, the other, both, or none at all.
 *
 * ABSENT IS NOT EMPTY, and the difference is the whole design.
 *
 *   projects: ['trinity']   -> Trinity only
 *   projects: []            -> nothing, deliberately
 *   projects: undefined     -> everything
 *
 * The last one is back-compatibility, not laziness. Every crew member on the
 * app today predates this field, and a default of "none" would have locked
 * the entire Trinity Manor crew out of a live job the moment these rules
 * deployed. Absent means "nobody has decided yet", and until Casey decides,
 * the answer stays what it was yesterday. Once he sets a list, the list wins,
 * including when it is empty.
 *
 * Mirrored in firestore.rules. The client copy decides what to DRAW; the
 * rules decide what can be read. A hidden tile is not access control.
 */

export const PROJECT_KEYS = ['trinity', 'studio15']

/** The jobs this person may open. An admin always sees everything: the
 *  person who hands out access cannot be locked out of it. */
export function allowedProjects(user) {
  if (!user || user.status !== 'active') return []
  if (user.role === 'admin') return [...PROJECT_KEYS]
  const list = user.projects
  if (!Array.isArray(list)) return [...PROJECT_KEYS]
  return list.filter((k) => PROJECT_KEYS.includes(k))
}

export function canSeeProject(user, key) {
  return allowedProjects(user).includes(key)
}

/** True once somebody has actually decided for this user, which is what the
 *  Team page shows as "set" rather than "inherited". */
export function accessIsExplicit(user) {
  return Array.isArray(user && user.projects)
}
