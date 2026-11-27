'use strict'

// ── Git connection setup (first-time, guarded) ───────────────────────────────
// The guarded bodies behind POST /api/git/setup/init and
// POST /api/git/setup/first-pull. Both refuse on a read-only (PROD-posture)
// server, and firstPull additionally refuses any server that already has a
// deployed commit — a first pull overwrites the whole server, so it must only
// ever run on a fresh one.
//
// The routes delegate straight to these — the isReadOnly() check here is the
// only read-only guard for init and first-pull, so the user gets its actionable
// message (and it stays enforced, and testable, without the HTTP layer).

const { makeClient, isReadOnly } = require('./adapter-registry')
const { lastDeployed, recordDeploy } = require('./git-state')
const { firstPullAnalysis } = require('./git-readiness')
const { TM1Client } = require('./tm1-client')
const { collectAttrsFiles, writeAttrsBranch, attrsBranch } = require('./git-attrs')

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
// deployed commit yet. The analysis runs again immediately before the pull: if
// the target changed since the preview, the sentence no longer matches and the
// pull is refused. A failed analysis refuses — "couldn't check" is not safe.
async function firstPull(server, { branch = 'dev', confirm, gitUser, token, ideToken, repoUrl } = {}) {
    if (isReadOnly(server)) return { ok: false, refused: true, error: READ_ONLY_ERROR(server) }
    const state = await alreadyDeployed(server, { token, gitUser, ideToken })
    if (state.committed) return { ok: false, refused: true, error: `${server} already has a deployed commit (${state.commit}) — first-pull is only for a fresh server; use the Deploy flow instead.` }
    const analysis = await firstPullAnalysis(server, { branch, token, gitUser, ideToken, repoUrl })
    if (!analysis.complete) return { ok: false, refused: true, error: analysis.reason }
    if (String(confirm ?? '').trim() !== analysis.confirmText) return { ok: false, error: `Type exactly: ${analysis.confirmText}` }
    const c = makeClient(server, ideToken)
    const plan = await c.post('GitPull', { Branch: branch, ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token })
    const n = (plan.Operations ?? []).length
    await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
    const commit = plan?.Commit?.ID ?? plan?.NewCommit?.ID ?? null
    if (commit) {
        await recordDeploy(server, commit, plan?.Commit?.Summary ?? null, { ideToken })
    }
    return { ok: true, overwritten: n, commit, note: `First pull applied — every object on ${server} was replaced by the repo state (${n} operations).` }
}

// ── Setup (Part C) ──────────────────────────────────────────────────────────
// A target's "last received" is what the target itself wrote into Git at setup,
// not what the IDE pulled onto it. Setup therefore runs in this order:
//
//   1. link (GitInit) with the server's own label (DEV / TEST / PROD)
//   2. TM1 on the server writes its own objects into Git
//        DEV        → branch `dev`
//        TEST/PROD  → branch `live-<server>` (that target's live snapshot)
//   3. for TEST/PROD, that commit is recorded as Last Deployed
//   4. the IDE writes the attributes initialisation commit (attrs-<server>)
//
// Nothing is put ONTO the server. This replaces the old first pull for TEST and
// PROD (James, 25 Nov: "that is backward").

const normalLabel = (s) => String(s ?? '').trim().toUpperCase()

async function gitLabel(server, { token, gitUser, ideToken } = {}) {
    const st = await makeClient(server, ideToken).post('GitStatus', { Username: gitUser, Password: token })
    return { label: normalLabel(st?.Deployment), repo: st?.URL ?? null, branches: st?.Remote?.Branches ?? [] }
}

// TM1 on `server` writes its own objects into a branch. NewBranch on first push;
// Branch once it exists (a push to an existing branch is a normal forward commit).
async function pushServerState(server, branch, { token, gitUser, ideToken } = {}) {
    const c = makeClient(server, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const exists = (st?.Remote?.Branches ?? []).includes(branch)
    const plan = await c.post('GitPush', exists
        ? { Branch: branch, NewBranch: '', Force: false, Message: `Setup: ${server} writes its own state`, Author: gitUser, Email: require('./git-identity').email(), Username: gitUser, Password: token }
        : { Branch: '', NewBranch: branch, Force: false, Message: `Setup: ${server} writes its own state`, Author: gitUser, Email: require('./git-identity').email(), Username: gitUser, Password: token })
    if (plan?.ID) await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
    return { commit: plan?.NewCommit?.ID ?? plan?.Commit?.ID ?? null, created: !exists }
}

// Write the attributes initialisation commit for a server. Safe to call again:
// an unchanged snapshot writes no commit.
async function initialiseAttrs(server, { token, gitUser, ideToken, repoUrl, by = null } = {}) {
    const client = new TM1Client(server, makeClient(server, ideToken))
    if (!repoUrl) {
        try { repoUrl = (await makeClient(server, ideToken).post('GitStatus', { Username: gitUser, Password: token }))?.URL } catch { repoUrl = null }
    }
    if (!repoUrl) return { ok: false, error: `${server} is not linked to a repo.` }
    const files = await collectAttrsFiles(client)
    return writeAttrsBranch(server, {
        repoUrl, token, gitUser, files, by,
        message: `Attributes of ${server} (initialisation)`,
    })
}

// Full setup for one server. `repo`/`deployment` are only needed when the server
// is not linked yet. The label TM1 reports wins: a DEV server linked as PROD is
// refused rather than silently treated as DEV (C.5).
async function setupServer(server, { repo, deployment, force, gitUser, token, ideToken, by = null } = {}) {
    // No read-only refusal: setup writes nothing ONTO the server. It asks TM1 to
    // write its own objects into Git and writes the attributes branch from a
    // read — both safe on a PROD-posture target.
    const wanted = normalLabel(deployment)

    let st
    try { st = await makeClient(server, ideToken).post('GitStatus', { Username: gitUser, Password: token }) } catch { st = null }
    if (!st?.URL) {
        if (!repo || !wanted) return { ok: false, refused: true, error: 'repo and deployment (DEV, TEST or PROD) are required to link a server.' }
        const linked = await init(server, { repo, deployment: wanted, force, gitUser, token, ideToken })
        if (!linked.ok) return linked
        st = await makeClient(server, ideToken).post('GitStatus', { Username: gitUser, Password: token })
    }

    const label = normalLabel(st?.Deployment)
    if (label && wanted && label !== wanted) {
        return {
            ok: false, refused: true,
            error: `${server} is linked as ${label}, not ${wanted}. Refusing to set it up under the wrong label — a server copied with another server's }git.ctx is the usual cause. Re-link it with the correct label, or link the copy under its own.`,
        }
    }
    const effective = label || wanted || 'DEV'
    const repoUrl = st?.URL
    if (!repoUrl) return { ok: false, refused: true, error: `${server} is not linked to a repository.` }

    // 2 — TM1 writes its own state. DEV keeps the working branch; a target keeps
    // its own live branch so two targets never collide.
    const branch = effective === 'DEV' ? 'dev' : `live-${server}`
    let pushed
    try {
        pushed = await pushServerState(server, branch, { token, gitUser, ideToken })
    } catch (e) {
        return { ok: false, error: `TM1 on ${server} could not write its objects to ${branch}: ${e.message}` }
    }

    // 3 — a target's own write is its Last Deployed.
    if (effective !== 'DEV' && pushed.commit) {
        try { await recordDeploy(server, pushed.commit, `Setup: ${server} wrote its own objects`, { ideToken }) } catch { /* recorded below */ }
    }

    // 4 — attributes initialisation commit (IDE-written, never pulled by TM1).
    let attrs
    try { attrs = await initialiseAttrs(server, { token, gitUser, ideToken, repoUrl, by }) }
    catch (e) { attrs = { ok: false, error: e.message } }

    return {
        ok: true, server, label: effective, repo: repoUrl,
        branch, commit: pushed.commit, lastDeployed: effective === 'DEV' ? null : pushed.commit,
        attrsCommit: attrs?.commit ?? null, attrsBranch: attrsBranch(server),
        attrsError: attrs?.ok === false ? attrs.error : null,
        note: effective === 'DEV'
            ? `DEV wrote its own objects to ${branch}; nothing was pulled onto it. Attributes are on ${attrsBranch(server)}.`
            : `${effective} wrote its own objects to ${branch}, recorded as Last Deployed; nothing was put onto the server. Attributes are on ${attrsBranch(server)}.`,
    }
}

// Part C.3 — a server already in use: write its attributes initialisation commit
// without touching its objects or its deploy history.
async function startAttrs(server, opts = {}) {
    return initialiseAttrs(server, opts)
}

module.exports = { alreadyDeployed, init, firstPull, setupServer, startAttrs, gitLabel, pushServerState, initialiseAttrs }