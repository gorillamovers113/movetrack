/* What a role is allowed to do, asked as a capability rather than a name.
 *
 * The crew genuinely do both jobs. Aaron packed on Monday and loaded on
 * Wednesday, and the only way to express that was to keep editing his role, or
 * to make him an admin, which is what actually happened: it handed him
 * timesheets and team management to solve a scheduling problem, and quietly
 * took him off the clock, because admins do not clock in.
 *
 * So there is a role that holds both. Everything that used to ask "are you a
 * packer" now asks "can you pack", which is the question it always meant, and
 * the combined role is true for both without a single site having to know it
 * exists.
 */
export const CREW = 'crew'

export function canPack(role) {
  return role === 'packer' || role === CREW
}

export function canLoad(role) {
  return role === 'mover' || role === CREW
}

export function canReceive(role) {
  return role === 'warehouse'
}

// Admin can do anything on a unit, so most call sites want this rather than
// the bare capability.
export function mayPack(role) {
  return role === 'admin' || canPack(role)
}

export function mayLoad(role) {
  return role === 'admin' || canLoad(role)
}
