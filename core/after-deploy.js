'use strict'

// ── After the deploy (Part Q) ────────────────────────────────────────────────
// Three things happen once the release has landed on the target:
//
//   Q.1 Reprocess feeders for every cube whose rules the release changed. TM1 v11
//       has no REST call, so the IDE runs }IDE.ReprocessFeeders per cube.
//   Q.2 Run DEV's tests against the target, read-only. A failure does not undo
//       the deploy; it marks it "needs checking" and names the test.
//   Q.3 The developer signs off by hand on PROD ("tested on PROD", name and
//       time). Until then the deploy shows "awaiting sign-off".
//
// Nothing here writes security (Q.4).

const REPROCESS = require('../ti-processes/reprocess-feeders/process.json')

// Cubes whose rules changed in a release. `objects` is what changedObjects()
// returned for the release (each has { type, name, kind, action }).
function cubesWithChangedRules(objects = []) {
    const out = new Set()
    for (const o of objects ?? []) {
        if (o?.type !== 'cube' || o?.kind !== 'rules') continue
        if (o.action === 'D') continue
        if (o.name) out.add(o.name)
    }
    return [...out]
}

// Install (on demand) and run the feeder process once per cube, timing each run
// on the IDE's clock so the report can show the cost per cube.
async function reprocessFeeders(tm1, cubes = [], { deps = {} } = {}) {
    const done = []
    const failed = []
    if (!cubes.length) return { cubes: done, failed, totalMs: 0 }
    const ensure = deps.ensureProcess ?? (async () => {
        const existing = await tm1.getProcess(REPROCESS.name).catch(e => {
            if (e.response?.status === 404) return null
            throw e
        })
        if (!existing) await tm1.createOrReplaceProcess(REPROCESS)
    })
    try { await ensure() }
    catch (e) { return { cubes: done, failed: cubes.map(cube => ({ cube, error: `the feeder process could not be installed: ${e.message}` })), totalMs: 0 } }

    const run = deps.runProcess ?? ((cube) => tm1.executeProcess(REPROCESS.name, [{ Name: 'pCube', Value: cube }]))
    const startedAll = Date.now()
    for (const cube of cubes) {
        const started = Date.now()
        try {
            const r = await run(cube)
            const status = r?.ProcessExecuteStatusCode
            const ok = status === undefined || status === 0 || status === 'CompletedSuccessfully' || status === 'HasMinorErrors'
            if (!ok) throw new Error(`the process returned ${status}`)
            done.push({ cube, ms: Date.now() - started })
        } catch (e) {
            failed.push({ cube, ms: Date.now() - started, error: e.response?.data?.error?.message ?? e.message })
        }
    }
    return { cubes: done, failed, totalMs: Date.now() - startedAll, process: REPROCESS.name }
}

// Q.2 — run DEV's tests against the target. All kinds (behaviour and control):
// this is the developer's own test set, not just the deploy's safety checks.
async function runDevTestsOnTarget(source, target, { ideToken, deps = {} } = {}) {
    const run = deps.runAssertions ?? ((s, o) => require('./assertions').run(s, o))
    try {
        const v = await run(source, { targetServer: target, ideToken })
        return {
            source, target, total: v.total, passed: v.passed, failed: v.failed.length,
            failures: v.failed.map(f => ({ id: f.id, description: f.description, expected: f.expected, actual: f.actual, error: f.error ?? null })),
        }
    } catch (e) {
        return { source, target, error: e.message }
    }
}

module.exports = { cubesWithChangedRules, reprocessFeeders, runDevTestsOnTarget, REPROCESS }
