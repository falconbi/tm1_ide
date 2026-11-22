// What "ready to release" and "in progress" mean for a change set. One
// definition, so the Release screen, the Deploy tab badge and anything else
// that counts change sets cannot disagree — the drift between surface counts
// (panel said 3, header said 2, Review said 2 objects) was the symptom of each
// screen deciding for itself.

// Touched at least one object. A set with no objects has nothing to ship.
function hasObjects(s) {
  return (s?.entry_count ?? 0) > 0
}

// Still being built: open, and it has something in it.
export function inProgress(sessions) {
  return (sessions ?? [])
    .filter(s => !s.closed_at && !s.wont_deploy_at && hasObjects(s))
    .sort((a, b) => (String(a.started_at) < String(b.started_at) ? 1 : -1))
}

// Shippable: closed, not already deployed or carried by a catch-up, not retired,
// and it touched something.
export function readyToRelease(sessions) {
  return (sessions ?? [])
    .filter(s =>
      s.closed_at &&
      !s.deployed_target && !s.deployed &&
      !s.covered_by &&
      !s.wont_deploy_at &&
      // A phantom's objects no longer exist, so there is nothing to ship even
      // when it still has log entries (oldets sets can carry dozens).
      !s.phantom &&
      // Recorded "nothing to deploy, done": it is finished. Leaving it on the list
      // asks the person to ship something that has already been decided.
      !s.no_change_at &&
      hasObjects(s))
    .sort((a, b) => (String(a.closed_at) < String(b.closed_at) ? 1 : -1))
}

export const readyCount = sessions => readyToRelease(sessions).length

// How many change sets a screen asks for. The server defaults to 50, which made
// "Show N phantom" a page count on any model with a long history; 500 keeps the
// counts honest for realistic use while staying bounded.
export const SESSIONS_LIMIT = 500
