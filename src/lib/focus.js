/* One apartment at a time.
 *
 * On 8 Sep Liv had 906 open from 9:16 and 902 open from 12:04, and both were
 * still open at 2:14. She photographed 902 and the app put the photo on 906,
 * because 906 was the one she happened to be inside. Nothing was wrong with
 * the app's record-keeping: it faithfully recorded a choice made on a phone
 * screen while standing in a different room.
 *
 * The fix is not a better confirmation dialog. It is refusing to let two
 * apartments be open at once, so the question never gets asked.
 *
 * DERIVED, NOT STORED. There is no "current unit" pointer anywhere, and that
 * is deliberate. A pointer can get stuck: a phone that dies mid-unit leaves a
 * packer locked out of every apartment in the building until an admin notices
 * and clears it, which on a live job is a worse day than the bug this
 * prevents. This is computed from the unit's own stage and crew, both of which
 * the finishing action already updates, so it cannot desynchronise and it
 * heals itself the moment the unit is closed out.
 *
 * Enforced in the dispatch actions and shown in the queue, not in the security
 * rules. Rules are where the security boundary lives; this is a workflow
 * constraint, and the crew are not the adversary. Putting it in rules would
 * also mean an admin could not sort out a tangle without a rules deploy.
 */
import { loadingProgress } from './mutations.js'
import { canPack, canLoad } from './roles.js'

const uidOf = (user) => user && (user.uid || user.id)

// A unit somebody has started packing and not finished. The stage IS the
// state: the first checklist item moves it to 'packing' and the last moves it
// to 'packed', so a unit sitting at 'packing' with your name on it is by
// definition unfinished work of yours.
export function openPackingUnit(units, user) {
  const uid = uidOf(user)
  if (!uid || !canPack(user.role)) return null
  return (units || []).find((u) => u
    && u.stage === 'packing'
    && ((u.crew && u.crew.packers) || []).includes(uid)) || null
}

// A unit somebody has started loading and not finished. Being credited on a
// packed unit is not enough on its own, because the mover checklist only opens
// at 'packed' and simply looking at a unit should not lock anybody out of the
// building. Having ticked something on it is the commitment.
export function openLoadingUnit(units, user) {
  const uid = uidOf(user)
  if (!uid || !canLoad(user.role)) return null
  return (units || []).find((u) => u
    && u.stage === 'packed'
    && ((u.crew && u.crew.movers) || []).includes(uid)
    && loadingProgress(u).done > 0) || null
}

/* The unit that has to be finished before this one can be touched.
 *
 * Returns null when there is nothing in the way, which is the common case:
 * no open unit, or the open unit IS the one being worked on.
 *
 * Admins are never blocked. They are the ones who sort out a tangle, and an
 * admin correcting a value on unit A does not mean they are packing it.
 */
export function blockingUnit(units, user, targetUnitId, kind) {
  if (!user || user.role === 'admin') return null
  const open = kind === 'loading' ? openLoadingUnit(units, user) : openPackingUnit(units, user)
  if (!open || open.id === targetUnitId) return null
  return open
}

export function blockedMessage(open, kind) {
  const what = kind === 'loading' ? 'loading' : 'packing'
  return `Finish unit ${open.number} first. You have it open for ${what}, and one apartment at a time is how a photo ends up on the right one.`
}
