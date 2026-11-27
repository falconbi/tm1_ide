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

// Shippable: closed, not already deployed or carried by an older release, not retired,
// and it touched something.
export function readyToRelease(sessions) {
  return (sessions ?? [])
    .filter(s =>
      s.closed_at &&
      !s.deployed_target && !s.deployed &&
      !s.covered_by &&
      !s.wont_deploy_at &&
      s.kind !== 'sync' &&
      s.kind !== 'carry-back' &&
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

// ── Per-target lists (Part A.3) ─────────────────────────────────────────────
// A change set can have reached TEST and still be waiting for PROD. `deploys`
// comes from GET /api/sessions (one row per target, newest first).

// Has this set been deployed to a target? `complete` or `incomplete` both count
// as "reached it"; `reverted`/`superseded` do not.
export function deployedTo(s, target) {
  if (!s || !target) return false
  const rows = Array.isArray(s.deploys) ? s.deploys : []
  if (rows.length) {
    // A deploy record wins over the legacy single-value column.
    const row = rows.find(d => d.target === target)
    return !!row && (row.status === 'complete' || row.status === 'incomplete')
  }
  return s.deployed_target === target
}

// "Ready for PROD" (or any target): closed, not retired, not a sync or
// carry-back set, nothing recorded as "nothing to deploy", and no deploy to
// that target yet. A set already on TEST is still ready for PROD.
export function readyForTarget(sessions, target) {
  // A carry-back is already on PROD (it copied PROD's own text onto DEV), so it
  // must never be deployed back there. It IS deployable to TEST normally (D.4.5).
  const prodTarget = /prod/i.test(String(target ?? ''))
  return (sessions ?? [])
    .filter(s =>
      s.closed_at &&
      !s.wont_deploy_at &&
      !s.covered_by &&
      !s.phantom &&
      !s.no_change_at &&
      s.kind !== 'sync' &&
      !(s.kind === 'carry-back' && prodTarget) &&
      !deployedTo(s, target) &&
      hasObjects(s))
    .sort((a, b) => (String(a.closed_at) < String(b.closed_at) ? 1 : -1))
}

// "Deployed to TEST 24 Nov — waiting for PROD" / "Deployed to PROD 24 Nov".
export function whereDeployed(s) {
  const rows = (Array.isArray(s?.deploys) ? s.deploys : [])
    .filter(d => d.status === 'complete' || d.status === 'incomplete')
  if (!rows.length) return null
  return rows.map(d => `Deployed to ${d.target}${d.status === 'incomplete' ? ' (incomplete)' : ''} ${shortDate(d.deployed_at)}`).join(' · ')
}

function shortDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) } catch { return iso ?? '' }
}

// How many change sets a screen asks for. The server defaults to 50, which made
// "Show N phantom" a page count on any model with a long history; 500 keeps the
// counts honest for realistic use while staying bounded.
export const SESSIONS_LIMIT = 500
