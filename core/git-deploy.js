'use strict'

// ── Git deploy flow (IMPROVEMENTS 10.1 hybrid) ──────────────────────────────
// Deploying through TM1 Git: prepare (baseline status + pull plan preview) then
// execute (atomic pull + control checks on the target). The pull plan is
// ephemeral, so execute re-creates it and runs immediately. The drift gate
// (prod-live diff) needs repo access — wired with the drift view (#3); until
// then prepare reports drift as unverified.

const { makeClient } = require('./adapter_registry')
const assertions = require('./assertions')
const gitIdentity = require('./git-identity')
const approvals = require('./git-approvals')

// Preview: target baseline + what the pull would change. Read-only (plan only).
async function prepare(source, target, { branch = 'dev', token, gitUser = gitIdentity.user(), ideToken } = {}) {
    const c = makeClient(target, ideToken)
    const out = { source, target, branch, ready: false, drift: 'unverified' }

    try {
        const st = await c.post('GitStatus', { Username: gitUser, Password: token })
        out.deployedCommit  = st?.DeployedCommit?.ID ?? null
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

    out.ready = true
    return out
}

// Apply the approved state to the target and verify with control checks.
// The pull plan is re-created atomically (it expires in seconds).
async function execute(target, { branch = 'dev', token, gitUser = gitIdentity.user(), ideToken, source, requireApproval = true } = {}) {
    const c = makeClient(target, ideToken)
    const out = { target, branch }

    let plan
    try {
        plan = await c.post('GitPull', { Branch: branch, ExecutionMode: 'SingleCommit', Force: false, Username: gitUser, Password: token })
    } catch (e) {
        out.executed = false
        out.error = `Pull plan failed: ${e.response?.data?.error?.message ?? e.message}`
        return out
    }

    // Governance gate: the exact commit must be approved for this target.
    // Enforced here, server-side, so it cannot be bypassed by the client.
    out.targetCommit = plan.Commit?.ID ?? null
    if (requireApproval) {
        const approval = out.targetCommit ? approvals.find(target, out.targetCommit) : null
        if (!approval) {
            out.executed = false
            out.refused = true
            out.error = `Refused: commit ${out.targetCommit ?? '(none)'} is not approved for ${target}. Record an approval first (the Approve step), then deploy.`
            return out
        }
        out.approvedBy  = approval.approver
        out.approvedAt  = approval.approved_at
    }

    try {
        await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        out.executed = true
        // Record what we actually deployed — TM1's DeployedCommit isn't reliable
        // as "last received" (a prod-live push clobbers it).
        try {
            const { recordDeploy } = require('./git-state')
            recordDeploy(target, out.targetCommit, plan.Commit?.Summary ?? null)
        } catch { /* state is best-effort */ }
    } catch (e) {
        out.executed = false
        out.error = `Pull failed: ${e.response?.data?.error?.message ?? e.message}`
        return out
    }

    // Reconcile the gaps TM1 Git won't cover FIRST — deletes + attribute values
    // (#6) — so the control checks below run against the fully-applied state.
    // Matches the loop: TEST pulls → apply values+deletes → assertions run.
    if (source) {
        try {
            const { reconcile } = require('./git-reconcile')
            out.reconcile = await reconcile(source, target, { ideToken })
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
}

module.exports = { prepare, execute }