'use strict'

// ── Git deploy flow (IMPROVEMENTS 10.1 hybrid) ──────────────────────────────
// Deploying through TM1 Git: prepare (baseline status + pull plan preview) then
// execute (atomic pull + reconcile + control checks on the target). The pull
// plan is ephemeral, so execute re-creates it and runs immediately. The approval
// gate is enforced inside execute — it cannot be bypassed by any caller.

const { makeClient } = require('./adapter_registry')
const assertions = require('./assertions')
const gitIdentity = require('./git-identity')
const approvals = require('./git-approvals')

// Parse a GitPull plan operation ("Update Cubes('WFP Workforce Cost')") into the
// TM1 object it refers to, so it can be checked against a release's objects.
const PLAN_TYPE = { cubes: 'cube', dimensions: 'dimension', processes: 'process', chores: 'chore', subsets: 'subset', views: 'view' }
function parsePlanOp(op) {
    const m = String(op ?? '').match(/^(?:Create|Update|Delete|Skip)\s+([A-Za-z]+)\(['"]?([^'")]*)['"]?\)?/)
    if (!m) return null
    const type = PLAN_TYPE[m[1].toLowerCase()]
    if (!type) return null
    return { type, name: m[2] }
}

// Preview: target baseline + what the pull would change. Read-only (plan only).
async function prepare(source, target, { branch = 'dev', token, gitUser = gitIdentity.user(), ideToken, session = null } = {}) {
    const c = makeClient(target, ideToken)
    const out = { source, target, branch, ready: false, drift: 'unverified' }

    try {
        const st = await c.post('GitStatus', { Username: gitUser, Password: token })
        // The IDE-recorded deploy commit is what the target actually last received;
        // TM1's own DeployedCommit is the last git op's target (a prod-live push
        // clobbers it). Prefer the record, fall back only if there is none.
        let recorded = null
        try { recorded = require('./git-state').lastDeployed(target)?.lastDeployedCommit ?? null } catch { /* none */ }
        out.deployedCommit  = recorded ?? st?.DeployedCommit?.ID ?? null
        out.deployedIsRecorded = !!recorded
        out.deployedSummary = st?.DeployedCommit?.Summary ?? null
        out.connected       = st?.Remote?.Connected ?? false
        out.fullOverwrite   = !out.deployedCommit
    } catch (e) {
        out.error = `GitStatus failed: ${e.response?.data?.error?.message ?? e.message}`
        return out
    }

    try {
        const plan = await c.post('GitPull', { Branch: branch, ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token })
        const ops = plan.Operations ?? []
        out.plan = { targetCommit: plan.Commit?.ID ?? null, total: ops.length, ops }
        out.planByType = {}
        for (const op of ops) {
            const m = String(op).match(/^(Create|Update|Delete|Skip)\s+(.+)$/) || [null, 'Other', String(op)]
            out.planByType[m[1]] = (out.planByType[m[1]] ?? 0) + 1
        }
    } catch (e) {
        out.error = `Pull plan failed: ${e.response?.data?.error?.message ?? e.message} (a stale view or name in the source breaks the pull — run the readiness check)`
        return out
    }

    // Change-set manifest (deletes + attribute dims) for the plan display.
    if (session) {
        try { out.manifest = require('./change_log').getSessionManifest(session) } catch { /* none */ }
    }

    out.ready = true
    return out
}

// Apply the approved state to the target and verify with control checks.
// The pull plan is re-created atomically (it expires in seconds).
// The approval gate is non-optional: it cannot be switched off by any caller.
// The reconcile scope comes from the APPROVAL's recorded change set — never from
// the client — so a missing or wrong session cannot silently skip or misapply it.
async function execute(target, { branch = 'dev', token, gitUser = gitIdentity.user(), ideToken, source, purpose = 'deploy', by, session: sessionId } = {}) {
    const c = makeClient(target, ideToken)
    const out = { target, branch }
    const lockMod = require('./git-lock')
    const cl = require('./change_log')

    // Release mode: this change set has a built release for this target. Deploy
    // branch release-<target> and gate on the RELEASE commit, not DEV's head.
    const session = sessionId ? cl.getSession(sessionId) : null
    const releaseCommit = (session?.release_commit && (!session.release_target || session.release_target === target)) ? session.release_commit : null
    if (releaseCommit) { branch = `release-${target}`; out.branch = branch; out.release = true; out.releaseCommit = releaseCommit }

    // The incoming commit is the branch head. Determine it from the SOURCE's own
    // Git state (the target's pull plan would expire while we do the governance
    // round-trips below) — then verify the plan matches before executing.
    let incomingCommit = releaseCommit
    if (!incomingCommit && source) {
        try {
            const sc = makeClient(source, ideToken)
            const sst = await sc.post('GitStatus', { Username: gitUser, Password: token })
            incomingCommit = sst?.LocalCommit?.ID ?? sst?.DeployedCommit?.ID ?? null
        } catch (e) {
            out.executed = false
            out.error = `Could not determine the incoming commit from ${source}: ${e.message}`
            return out
        }
    }

    // Governance gate: the exact incoming commit must be approved for this target.
    // Enforced here, server-side, so it cannot be bypassed by the client.
    out.targetCommit = incomingCommit
    let approval = null
    approval = incomingCommit ? await approvals.find(target, incomingCommit, { ideToken }) : null
    if (!approval) {
        out.executed = false
        out.refused = true
        out.error = purpose === 'revert'
            ? `Refused: DEV has moved on since the last deploy — reverting would ship unapproved changes (${incomingCommit}). Approve the new commit first, or redeploy the approved one.`
            : `Refused: commit ${incomingCommit ?? '(none)'} is not approved for ${target}. Record an approval first (the Approve step), then deploy.`
        return out
    }
    out.approvedBy  = approval.approver
    out.approvedAt  = approval.approved_at
    out.approvalSession = approval.session ?? null

    // Deploy lock — one deploy at a time on this target, held in the target's own
    // model. This is also the model-writability gate: if the target's model cannot
    // be written, the deploy stops here with a clear message (never silent).
    try {
        await lockMod.acquire(target, { by: by ?? approval.approver ?? 'unknown', ideToken })
        out.locked = { by: by ?? approval.approver ?? 'unknown', at: new Date().toISOString() }
    } catch (e) {
        out.executed = false
        out.refused = e.refused
        out.error = e.message
        return out
    }

    try {
        let plan
        try {
            plan = await c.post('GitPull', { Branch: branch, ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token })
        } catch (e) {
            out.executed = false
            out.error = `Pull plan failed: ${e.response?.data?.error?.message ?? e.message}`
            return out
        }
        out.targetCommit = plan.Commit?.ID ?? null
        // Fail CLOSED: if we cannot tie the approved commit to what the pull will
        // apply (either side missing), refuse — never deploy an unverifiable state.
        if (!incomingCommit || !out.targetCommit) {
            out.executed = false
            out.refused = true
            out.error = `Refused: cannot verify the commit being deployed (approved-incoming ${incomingCommit ?? '(none)'}, plan commit ${out.targetCommit ?? '(no commit on this pull)'}). Approve a specific commit and retry.`
            return out
        }
        if (incomingCommit !== out.targetCommit) {
            out.executed = false
            out.refused = true
            out.error = `Refused: the incoming commit moved (approved ${incomingCommit}, branch head is now ${out.targetCommit}). Approve the new commit before deploying.`
            return out
        }
        // Release mode: every non-Skip operation the pull will apply must be one of
        // the release's objects. Anything else means the branch carries objects the
        // approval never saw — refuse and name them.
        if (releaseCommit) {
            try {
                const repoUrl = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL
                const base = require('./git-state').lastDeployed(target)?.lastDeployedCommit ?? null
                const { changedObjects } = require('./git-release')
                const expected = await changedObjects({ from: base, to: releaseCommit, repoUrl, token, gitUser })
                const expectedKeys = new Set(expected.map(o => `${o.type}::${String(o.name).toLowerCase()}`))
                const unexpected = (plan.Operations ?? []).map(parsePlanOp).filter(Boolean)
                    .filter(o => !expectedKeys.has(`${o.type}::${String(o.name).toLowerCase()}`))
                if (unexpected.length) {
                    out.executed = false
                    out.refused = true
                    out.error = `Refused: the pull plan contains ${unexpected.length} object(s) not in this release — ${unexpected.map(o => `${o.type} ${o.name}`).join(', ')}. Rebuild the release; it must carry only the change set's objects.`
                    return out
                }
            } catch (e) {
                out.executed = false
                out.refused = true
                out.error = `Refused: could not verify the release's objects against the pull plan (${e.message}).`
                return out
            }
        }
        try {
            await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
            out.executed = true
            // Record what we actually deployed — TM1's DeployedCommit isn't reliable
            // as "last received" (a prod-live push clobbers it). Loud: if the model
            // record cannot be written, that is reported, never best-effort.
            try {
                const { recordDeploy } = require('./git-state')
                out.deployRecord = await recordDeploy(target, out.targetCommit, plan.Commit?.Summary ?? null, { ideToken })
            } catch (e) {
                out.executed = true
                out.recorded = false
                out.error = `Deploy applied, but the deploy record could not be written: ${e.message}. Investigate before the next deploy.`
            }
        } catch (e) {
            out.executed = false
            out.error = `Pull failed: ${e.response?.data?.error?.message ?? e.message}`
            return out
        }

        // Reconcile the gaps TM1 Git won't cover FIRST — deletes + attribute values
        // (#6) — so the control checks below run against the fully-applied state.
        // Scoped strictly to the change set linked to this approval (never from the
        // request body; a missing session is reported, never silently skipped).
        if (source) {
            let manifest = { deletes: [], dims: [], attrElements: [], wholesaleDims: [] }
            if (approval.session) {
                try { manifest = require('./change_log').getSessionManifest(approval.session) || manifest } catch { /* no manifest */ }
            } else {
                out.reconcileWarning = 'This approval has no linked change set — reconcile scope is unknown and was skipped (not silently).'
            }
            out.manifest = manifest
            try {
                const { reconcile } = require('./git-reconcile')
                out.reconcile = await reconcile(source, target, { ideToken, deletes: manifest.deletes, dims: manifest.dims, attrElements: manifest.attrElements })
            } catch (e) {
                out.reconcile = { error: e.message }
            }
        }

        // Control checks on the target — invariant tests, valid on any data.
        if (source) {
            try {
                const v = await assertions.run(source, { targetServer: target, kind: 'control', ideToken })
                out.verification = {
                    source, total: v.total, passed: v.passed, failed: v.failed.length,
                    failures: v.failed.map(f => ({ id: f.id, description: f.description, expected: f.expected, actual: f.actual, error: f.error ?? null })),
                    results: v.results.map(r => ({ id: r.id, description: r.description, expected: r.expected, actual: r.actual, pass: r.pass, error: r.error ?? null })),
                }
                out.controlOk = v.failed.length === 0
            } catch (e) {
                out.verification = { error: e.message }
                out.controlOk = false
            }
        }
        return out
    } finally {
        try {
            const rel = await lockMod.release(target, { ideToken })
            if (rel && rel.ok === false) out.lockReleaseError = rel.error   // surfaced, never silent
        } catch (e) { out.lockReleaseError = e.message }
    }
}

module.exports = { prepare, execute }