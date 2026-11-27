'use strict'

// ── Deploy administration: start again, re-clone TEST, prepare DEV (Parts M, L, K)
// These are the few deliberate, admin-only resets around the normal flow:
//
//   Start again (Part M)      clear this IDE's deploy note for a server, refuse
//                             while a closed, undeployed change set exists, leave
//                             the old repository as the archive.
//   TEST was re-cloned        TEST's own write becomes TEST Last Deployed; the
//     from PROD (Part L.3)    attributes branch is written; every TEST deploy that
//                             never reached another target is superseded, so those
//                             change sets wait for TEST again.
//   Prepare DEV for restore   refuse while any change set is open (Part K.1).

const cl = require('./change-log')

// A change set that is finished but has not reached a server and is not retired:
// starting again would silently strand it, so setup waits until it is deployed or
// retired. Open sets do not block (their work is still on DEV).
function undeployedClosed(server) {
    return cl.getSessions(server, 1000)
        .filter(s => s.closed_at && !s.wont_deploy_at && !s.covered_by && !s.no_change_at && !cl.hasAnyDeploy(s.id))
}

async function startAgain(server, { ideToken, by = null, deps = {} } = {}) {
    const blocked = undeployedClosed(server)
    if (blocked.length) {
        return {
            ok: false, refused: true,
            error: `Deploy or retire these change sets first: ${blocked.map(s => `"${s.name}"`).join(', ')}. Starting again would strand their work.`,
            blocked: blocked.map(s => ({ id: s.id, name: s.name })),
        }
    }
    const clear = deps.clearDeployState ?? ((s, o) => require('./git-state').clearDeployState(s, o))
    const cleared = await clear(server, { ideToken })
    return {
        ok: true, server, cleared, by,
        note: `${server}'s deploy note was cleared${cleared.model ? ' (local file and model)' : ''}. The old repository is left as the archive; run setup to link the new one.`,
    }
}

// TEST was re-cloned from PROD (outside the IDE). TM1 on TEST writes its own
// objects into Git as TEST Last Deployed; the IDE writes attrs-TEST; every TEST
// deploy not yet on another target is superseded.
async function recloneTest(testServer, { token, gitUser, ideToken, by = null, deps = {} } = {}) {
    const pushState = deps.pushServerState ?? require('./git-setup').pushServerState
    const record = deps.recordDeploy ?? ((s, commit, summary, opts) => require('./git-state').recordDeploy(s, commit, summary, opts))
    const initialise = deps.initialiseAttrs ?? require('./git-setup').initialiseAttrs
    const setStatus = deps.setDeployStatus ?? ((id, target, status, reason) => cl.setSessionDeployStatus(id, target, status, reason))
    const startCycle = deps.recordTestReclone ?? ((s, o) => cl.recordTestReclone(s, o))

    let pushed
    try { pushed = await pushState(testServer, `live-${testServer}`, { token, gitUser, ideToken }) }
    catch (e) { return { ok: false, error: `TEST could not write its own objects to Git: ${e.message}` } }

    let deployNote
    try { deployNote = await record(testServer, pushed.commit, 'TEST was re-cloned from PROD', { ideToken }) }
    catch (e) { return { ok: false, error: `TEST's write could not be recorded as Last Deployed: ${e.message}` } }

    let attrs
    try { attrs = await initialise(testServer, { token, gitUser, ideToken, by }) }
    catch (e) { attrs = { ok: false, error: e.message } }

    // Part L.1 — this re-clone starts a new cycle. Recorded only now: the cycle
    // must not restart if the server could not write its own objects.
    await startCycle(testServer, { by })

    const superseded = []
    for (const row of cl.getDeploysForTarget(testServer)) {
        if (row.status !== 'complete' && row.status !== 'incomplete') continue
        const targets = cl.deployTargets(row.session_id)
        // Reached any other server → it is already on PROD (or heading there), so
        // its TEST record stays as history rather than being superseded.
        const elsewhere = targets.some(t => t !== testServer)
        if (elsewhere) continue
        setStatus(row.session_id, testServer, 'superseded', 'TEST was re-cloned from PROD')
        superseded.push(row.session_id)
    }

    return {
        ok: true, server: testServer, commit: pushed.commit, deployNote,
        attrsCommit: attrs?.commit ?? null, attrsError: attrs?.ok === false ? attrs.error : null,
        superseded,
        note: `TEST's own write is now TEST Last Deployed. ${superseded.length} TEST deploy${superseded.length === 1 ? ' is' : 's are'} superseded and wait for TEST again.`,
    }
}

// Part K.1 — re-cloning DEV accepts that undeployed work is redone, so every
// change set must be closed or retired first.
function prepareDevRestore(server) {
    const open = cl.getSessions(server, 1000).filter(s => !s.closed_at)
    if (open.length) {
        return {
            ok: false, refused: true,
            error: `Close or retire every open change set first: ${open.map(s => `"${s.name}"`).join(', ')}. The restore happens outside the IDE, and an open set would be lost.`,
            open: open.map(s => ({ id: s.id, name: s.name })),
        }
    }
    return {
        ok: true, server,
        note: `${server} has no open change sets. Keep its own }git.ctx when the server is replaced (Part C.5 checks the label on reconnect).`,
    }
}

module.exports = { startAgain, recloneTest, prepareDevRestore, undeployedClosed }
