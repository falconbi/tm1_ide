'use strict'

// ── The TEST cycle, derived (Part L.1/L.2/L.4) ───────────────────────────────
// There is no admin list of the cycle. It is read from what actually happened:
//
//   1. a re-clone of TEST ("TEST was re-cloned from PROD") starts a new cycle;
//   2. every change set deployed to TEST after that re-clone is in the cycle;
//   3. once any of them is deployed to PROD, the cycle is closed — a set outside
//      it can no longer be deployed to TEST until TEST is re-cloned again;
//   4. a set that reached TEST but never PROD may be retired (the failed-on-TEST
//      path in L.4 — rework is a new change set).
//
// Before any re-clone is recorded, the first TEST deploy starts a cycle
// implicitly, so an existing project keeps working without a migration step.

const cl = require('./change-log')

const ACTIVE = new Set(['complete', 'incomplete'])
const isActive = (row) => ACTIVE.has(row?.status)

function sessionRow(id) {
    return cl.getSession(id) ?? { id, name: id, user: null }
}

// The open or last cycle for one TEST server.
function deriveCycle(testServer) {
    const recloneAt = cl.latestTestReclone(testServer)
    const testDeploys = cl.getDeploysForTarget(testServer)
        .filter(isActive)
        .sort((a, b) => String(a.deployed_at).localeCompare(String(b.deployed_at)))
    const startAt = recloneAt ?? testDeploys[0]?.deployed_at ?? null
    if (!startAt) {
        return { testServer, open: false, startedAt: null, recloneAt: null, closedAt: null, closedBy: null, members: [], sets: [] }
    }

    const members = [...new Set(testDeploys
        .filter(r => String(r.deployed_at) >= String(startAt))
        .map(r => r.session_id))]

    // Closed by the first member that reached another server (PROD).
    let closedAt = null
    let closedBy = null
    for (const id of members) {
        for (const d of cl.getSessionDeploys(id)) {
            if (d.target === testServer || !isActive(d) || String(d.deployed_at) < String(startAt)) continue
            if (!closedAt || String(d.deployed_at) < String(closedAt)) {
                closedAt = d.deployed_at
                closedBy = { id, target: d.target }
            }
        }
    }

    return {
        testServer,
        open: !closedAt,
        startedAt: startAt,
        recloneAt,
        closedAt,
        closedBy,
        members,
        sets: members.map(sessionRow).map(s => ({
            id: s.id, name: s.name, user: s.user ?? null, closed_at: s.closed_at ?? null, kind: s.kind ?? 'change',
        })),
    }
}

// May this change set be deployed to TEST? A set already in the cycle always
// may; a new one joins an open cycle; a closed cycle refuses it and names the
// re-clone needed.
function canDeployToTest(testServer, sessionId) {
    const cycle = deriveCycle(testServer)
    if (!cycle.startedAt) return { ok: true, cycle, inCycle: false, startsCycle: true }
    if (cycle.members.includes(sessionId)) return { ok: true, cycle, inCycle: true }
    if (cycle.open) return { ok: true, cycle, inCycle: false, joinsCycle: true }
    const closedName = cycle.closedBy ? sessionRow(cycle.closedBy.id)?.name : null
    const mine = sessionRow(sessionId)?.name ?? 'this change set'
    return {
        ok: false,
        cycle,
        error: `TEST's cycle is closed: a change set in it${closedName ? ` ("${closedName}")` : ''} has been deployed to ${cycle.closedBy?.target ?? 'PROD'}. Re-clone TEST from PROD before deploying "${mine}" to TEST.`,
    }
}

// A target's label, read from TM1 Git. Null when it cannot be read — the
// caller then leaves the rule alone rather than guessing.
async function labelOf(server, { token, gitUser, ideToken } = {}) {
    try {
        const { gitLabel } = require('./git-setup')
        return (await gitLabel(server, { token, gitUser, ideToken })).label ?? null
    } catch { return null }
}

const labelFromName = (name) => /prod/i.test(String(name)) ? 'PROD' : /test/i.test(String(name)) ? 'TEST' : null

// Part L.4: retire is allowed for a set that reached TEST but never PROD. It
// still owns work on TEST, but that work has failed and rework is a new set.
async function reachedTestOnly(sessionId, { token, gitUser, ideToken, labelFn = null } = {}) {
    const targets = cl.deployTargets(sessionId)
    if (!targets.length) return false
    let sawTest = false
    for (const target of targets) {
        const label = labelFn
            ? labelFn(target)
            : ((await labelOf(target, { token, gitUser, ideToken })) ?? labelFromName(target))
        if (label === 'PROD') return false
        if (label === 'TEST') sawTest = true
    }
    return sawTest
}

module.exports = { deriveCycle, canDeployToTest, reachedTestOnly, labelOf }
