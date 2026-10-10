'use strict'

// ── Git connection setup (first-time, guarded) ───────────────────────────────
// The guarded bodies behind POST /api/git/setup/init and
// POST /api/git/setup/first-pull. Both refuse on a read-only (PROD-posture)
// server, and firstPull additionally refuses any server that already has a
// deployed commit — a first pull overwrites the whole server, so it must only
// ever run on a fresh one.
//
// The routes call these after their own gateReadOnly() check; the isReadOnly()
// checks here are the same predicate, kept so the guard is enforced even if a
// caller goes around the HTTP layer (and testable without an HTTP server).

const { makeClient, isReadOnly } = require('./adapter_registry')
const { lastDeployed } = require('./git-state')

// Tells the caller how to get unblocked: init and first-pull only run on a
// writable server, so setup must happen BEFORE marking the server read-only.
const READ_ONLY_ERROR = (server) => `Refused: ${server} is read-only. Set it up (init + first pull) before marking it read-only — or temporarily remove it from readOnlyServers, set it up, then add it back.`

// Has this server already been deployed to? A real DeployedCommit on the server,
// or a deploy the IDE recorded (git-deploy-state), both mean first-pull must refuse.
async function alreadyDeployed(server, { token, gitUser, ideToken } = {}) {
    const c = makeClient(server, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const deployed = st?.DeployedCommit?.ID ?? null
    const recorded = (() => { try { return lastDeployed(server)?.lastDeployedCommit ?? null } catch { return null } })()
    return { committed: !!(deployed || recorded), commit: deployed || recorded }
}

// Link an existing repo (or force re-link). force bypasses the already-linked
// guard but NEVER the read-only guard.
async function init(server, { repo, deployment, force, gitUser, token, ideToken } = {}) {
    if (isReadOnly(server)) return { ok: false, refused: true, error: READ_ONLY_ERROR(server) }
    const c = makeClient(server, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    if (st?.URL && !force) return { ok: false, refused: true, error: `${server} is already linked to ${st.URL} (deployment ${st.Deployment}). Not re-running GitInit.` }
    const plan = await c.post('GitInit', { URL: repo, Deployment: String(deployment).toUpperCase(), Force: !!force, Username: gitUser, Password: token })
    if (plan?.ID) await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
    const after = await c.post('GitStatus', { Username: gitUser, Password: token })
    return { ok: true, server, repo: after?.URL ?? repo, deployment: after?.Deployment ?? String(deployment).toUpperCase(), note: 'GitInit complete.' }
}

// First pull — a FULL overwrite of the server from the repo state. Requires the
// typed confirmation, a writable (non-read-only) server, and a server with no
// deployed commit yet.
async function firstPull(server, { branch = 'dev', confirm, gitUser, token, ideToken } = {}) {
    if (isReadOnly(server)) return { ok: false, refused: true, error: READ_ONLY_ERROR(server) }
    const expected = `I understand this overwrites ${server}`
    if (String(confirm ?? '').trim() !== expected) return { ok: false, error: `Type exactly: ${expected}` }
    const state = await alreadyDeployed(server, { token, gitUser, ideToken })
    if (state.committed) return { ok: false, refused: true, error: `${server} already has a deployed commit (${state.commit}) — first-pull is only for a fresh server; use the Deploy flow instead.` }
    const c = makeClient(server, ideToken)
    const plan = await c.post('GitPull', { Branch: branch, ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token })
    const n = (plan.Operations ?? []).length
    await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
    return { ok: true, overwritten: n, note: `First pull applied — every object on ${server} was replaced by the repo state (${n} operations).` }
}

module.exports = { alreadyDeployed, init, firstPull }