export const STAGES = ['not_started', 'packing', 'packed', 'loaded', 'picked_up', 'at_warehouse']

export function nextStage(stage) {
  const i = STAGES.indexOf(stage)
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null
}

export function boxMismatch(expected, counted) {
  return typeof expected === 'number' && typeof counted === 'number' && expected !== counted
}

export function makeEvent(user, type, action, extra = {}) {
  return { ts: Date.now(), uid: user.uid, userName: user.userName || user.name || 'Unknown', role: user.role || 'pending', type, action, ...extra }
}
