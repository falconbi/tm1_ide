'use strict'

// ── Git deploy flow (IMPROVEMENTS 10.1 hybrid) ──────────────────────────────
// Deploying through TM1 Git: prepare (baseline status + pull plan preview) then
// execute (atomic pull + reconcile + control checks on the target). The pull
// plan is ephemeral, so execute re-creates it and runs immediately. The approval
// gate is enforced inside execute — it cannot be bypassed by any caller.

const { makeClient } = require('./adapter-registry')
const assertions = require('./assertions')
const gitIdentity = require('./git-identity')
const approvals = require('./git-approvals')
const { driftCheck } = require('./git-drift')

// Refresh the target's live snapshot (pushes prod-live) and compare it against
// what the target last RECEIVED. Any difference is drift — deploys onto a drifted
// target get refused at Review AND at Deploy.
async function targetDrift(target, { token, gitUser = gitIdentity.user(), ideToken } = {}) {
    try {
        const d = await driftCheck(target, { token, gitUser, ideToken, lock: false })
        if (d?.error) return { clean: false, entries: [], nonBlocking: [], error: d.error }
        const all = d?.entries ?? []
        // Views and subsets are not in TM1's pull, so they are reported and not
        // blocked. Everything else is blocking: a pull would replace it.
        const entries = all.filter(e => e.blocking !== false)
        const nonBlocking = all.filter(e => e.blocking === false)
        return { clean: entries.length === 0, entries, nonBlocking, all, deployed: d?.deployed ?? null }
    } catch (e) {
        return { clean: false, entries: [], nonBlocking: [], error: e.message }
    }
}

// Policy: a drifted target is not reverted or promoted ad hoc. The fix is to
// re-apply the change on DEV in a change set and release it; deploys stay paused
// until drift is clean.
const driftRefusal = (target, drift) => {
    const objects = (drift.entries ?? []).map(e => `${e.status} ${e.file}`).join('; ')
    // Views and subsets do not block, but they are never silent either.
    const soft = (drift.nonBlocking ?? []).length
        ? ` (${drift.nonBlocking.length} view/subset change${drift.nonBlocking.length === 1 ? '' : 's'} on ${target} are reported but not blocking: ${(drift.nonBlocking).map(e => e.file).join(', ')})`
        : ''
    if (objects) {
        return `PROD has drifted: ${objects}. Re-apply the change on DEV in a change set, then release it. Deploys to this server are paused until drift is clean.${soft}`
    }
    return `PROD drift could not be checked (${drift.error ?? 'unknown error'}). Deploys to this server are paused until drift is clean.${soft}`
}

// Parse a GitPull plan operation ("Update Cubes('WFP Workforce Cost')",
// "Replace Dimensions('WFP Version')", "Skip Processes('X')", …) into the TM1
// object it refers to, so it can be checked against a release's objects.
// Skip operations are NOT changes — a Skip carries no object to verify.
const PLAN_TYPE = { cubes: 'cube', dimensions: 'dimension', processes: 'process', chores: 'chore', subsets: 'subset', views: 'view' }
function parsePlanOp(op) {
    const m = String(op ?? '').match(/^([A-Za-z]+)\s+([A-Za-z]+)\(['"]?([^'")]*)['"]?(?:\s*,\s*['"]?([^'")]*)['"]?)?\)?/)
    if (!m) return { unknown: true, raw: String(op ?? '') }
    if (m[1].toLowerCase() === 'skip') return null   // Skip = unchanged, not a change
    const type = PLAN_TYPE[m[2].toLowerCase()]
    if (!type) return { unknown: true, raw: String(op ?? '') }
    // Subsets are keyed by their dimension, views by their cube — the parent is the
    // op's second argument when present.
    const parent = (type === 'subset' || type === 'view') ? (m[4] ?? null) : undefined
    return { type, name: m[3], parent }
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
        out.repoUrl         = st?.URL ?? null

        // Refresh the target's live snapshot and refuse Review if it has drifted
        // from what it last received.
        const drift = await targetDrift(target, { token, gitUser, ideToken })
        out.drift = drift.clean ? 'clean' : 'drifted'
        out.driftEntries = drift.entries ?? []
        // Reported, never blocking: a pull cannot touch a view or a subset.
        out.driftNonBlocking = drift.nonBlocking ?? []
        if (!drift.clean) {
            // Do NOT return here. The plan is a read, and seeing what the pull
            // would do is exactly what tells an operator whether the drift
            // matters. Approval and deployment stay blocked: ready stays false,
            // and execute() re-checks drift and refuses on its own.
            out.ready = false
            out.blocked = true
            out.error = driftRefusal(target, drift)
        }
    } catch (e) {
        out.error = `GitStatus failed: ${e.response?.data?.error?.message ?? e.message}`
        return out
    }

    // The same conflict the deploy guard catches — but here, at Review, before
    // anyone approves. A view or subset this change set ships that ALSO changed on
    // the target would be replaced by the REST complement after the pull. The
    // change set's own log is enough to know what it ships; no extra git fetch.
    if (out.drift === 'clean' && session && (out.driftNonBlocking ?? []).length) {
        try {
            const { viewSubsetConflicts, expectedPlanKeys, objectFromFile, objectKey } = require('./git-release')
            const log = require('./change-log').getSessionLog(session)
            // Objects the approver already chose to leave alone (Review's "Keep
            // <target>'s version") are no longer shipped by the rebuilt release, so
            // they must not be reported as conflicts a second time.
            const excluded = new Set(
                ((() => { try { return JSON.parse(require('./change-log').getSession(session)?.release_excluded_by_user ?? '[]') } catch { return [] } })())
                    .map(o => objectKey(o.type, o.name, o.parent))
            )
            const shipped = (log ?? [])
                .filter(e => e.object_type === 'view' || e.object_type === 'subset')
                .map(e => ({ type: e.object_type, name: e.object_name, parent: e.detail ?? null }))
                .filter(o => !excluded.has(objectKey(o.type, o.name, o.parent)))
            const conflicts = shipped.length ? viewSubsetConflicts(out.driftNonBlocking, expectedPlanKeys(shipped)) : []
            if (conflicts.length) {
                const names = conflicts.map(c => objectFromFile(c.file)?.name ?? c.file)
                out.ready = false
                out.blocked = true
                out.driftConflicts = conflicts.map(c => c.file)
                // The same conflicts as objects, so Review can offer the other
                // choice ("keep the target's version") without re-parsing paths.
                out.driftConflictObjects = conflicts
                    .map(c => ({ ...(objectFromFile(c.file) ?? {}), file: c.file }))
                    .filter(o => o.type)
                out.error = `${target} has its own version of ${names.join(', ')}, and this release ships ${names.length === 1 ? 'it' : 'them'}. Deploying would replace ${target}'s version. Resolve it before approving: keep ${target}'s copy, or take this release's.`
            }
        } catch { /* best effort here; execute() refuses regardless */ }
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

        // What this release would REMOVE from the target's dimensions — the same
        // check the first pull and a return use, aimed at the commit this deploy
        // would land on. Reported at Review, never blocking: removing elements is
        // sometimes exactly the intent, and it is always worth seeing first.
        if (out.plan.targetCommit && out.repoUrl) {
            try {
                const { compareTargetWithRepo } = require('./git-readiness')
                const cmp = await compareTargetWithRepo(target, {
                    commit: out.plan.targetCommit, repoUrl: out.repoUrl, token, gitUser, ideToken, client: c,
                })
                out.elementLoss = cmp.elementLoss
                out.loss = cmp.loss
            } catch (e) {
                out.elementLossError = e.message
            }
        }
    } catch (e) {
        out.error = `Pull plan failed: ${e.response?.data?.error?.message ?? e.message} (a stale view or name in the source breaks the pull — run the readiness check)`
        return out
    }

    // Change-set manifest (deletes + attribute dims) for the plan display.
    if (session) {
        try { out.manifest = require('./change-log').getSessionManifest(session) } catch { /* none */ }
    }

    if (!out.blocked) out.ready = true
    return out
}

// Apply the approved state to the target and verify with control checks.
// The pull plan is re-created atomically (it expires in seconds).
// The approval gate is non-optional: it cannot be switched off by any caller.
// The reconcile scope comes from the APPROVAL's recorded change set — never from
// the client — so a missing or wrong session cannot silently skip or misapply it.
// A deploy ends by writing a report of what it did (core/deploy-records). Every
// early `return out` — refused, drifted, plan mismatch, pull failure — is a
// deployment too, and the ones that stopped are exactly the ones someone will
// want to read afterwards. So the recording wraps the whole attempt rather than
// sitting on the success path.
async function execute(target, opts = {}) {
    const startedAt = new Date().toISOString()
    const out = await runDeploy(target, opts)
    try {
        const { record } = require('./deploy-records')
        out.deployReport = await record(out, { ideToken: opts.ideToken, startedAt })
    } catch (e) {
        // Never let the report decide the deploy's fate — but never silent either.
        out.reportError = `The deploy report could not be written: ${e.message}`
    }
    return out
}

async function runDeploy(target, { branch = 'dev', token, gitUser = gitIdentity.user(), ideToken, source, purpose = 'deploy', by, session: sessionId } = {}) {
    const c = makeClient(target, ideToken)
    const out = { target, branch }
    const lockMod = require('./git-lock')
    const cl = require('./change-log')

    // What the target held BEFORE this deploy — the base the report reads from,
    // and the base the reconcile/complement steps use. Captured here so a refused
    // deploy still has it.
    try { out.baseCommit = require('./git-state').lastDeployed(target)?.lastDeployedCommit ?? null } catch { /* none */ }
    out.source = source ?? null

    // Release mode: this change set has a built release for this target. Deploy
    // branch release-<target> and gate on the RELEASE commit, not DEV's head.
    const session = sessionId ? cl.getSession(sessionId) : null
    const releaseCommit = (session?.release_commit && (!session.release_target || session.release_target === target)) ? session.release_commit : null
    if (releaseCommit) { branch = `release-${target}`; out.branch = branch; out.release = true; out.releaseCommit = releaseCommit }
    // Rule 1 on the server: a deploy always ships a built release — never whatever
    // happens to be on DEV. The first-time setup (first-pull) is the only
    // whole-model path.
    if (!releaseCommit) {
        out.executed = false
        out.refused = true
        out.error = `Build a release first — deploys ship only a change set\u2019s objects. First-time setup (first-pull) is the only whole-model path.`
        return out
    }

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
    const approval = incomingCommit ? await approvals.find(target, incomingCommit, { ideToken }) : null
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
    out.approvalNote = approval.note ?? null

    // The approval's linked change set is the authoritative source. If the approval
    // has no linked change set (release mode), the caller must supply the source.
    const linkedSession = approval.session ? cl.getSession(approval.session) : null
    const approvedSource = linkedSession?.server ?? null
    if (approvedSource) {
        if (source && source !== approvedSource) {
            out.executed = false
            out.refused = true
            out.error = 'source does not match the approved change set'
            return out
        }
        source = approvedSource
        out.source = source
    } else if (!source) {
        out.executed = false
        out.refused = true
        out.missingSource = true
        out.error = 'source is required when the approval has no linked change set'
        return out
    }
    out.source = source

    // What this deployment is FOR, and a first approximation of what it ships —
    // the change set's own log. The release's object list (below) is authoritative
    // and replaces this when it can be read; this keeps a refused deploy's report
    // from saying it shipped nothing.
    if (linkedSession) {
        out.changeSetName = linkedSession.name ?? null
        out.changeSetId = linkedSession.id ?? null
        try {
            out.shippedObjects = (cl.getSessionLog(linkedSession.id) ?? [])
                .filter(e => e.object_type)
                .map(e => ({ type: e.object_type, name: e.object_name, parent: e.detail ?? null }))
        } catch { /* report shows none */ }
    }

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
        // Refresh the target's live snapshot and refuse if it has drifted from what
        // it last received — never deploy onto a drifted target. The lock is
        // released by the finally below either way.
        const drift = await targetDrift(target, { token, gitUser, ideToken })
        out.drift = drift.clean ? 'clean' : 'drifted'
        out.driftEntries = drift.entries ?? []
        // Reported, never blocking: a pull cannot touch a view or a subset.
        out.driftNonBlocking = drift.nonBlocking ?? []
        if (!drift.clean) {
            out.executed = false
            out.refused = true
            out.error = driftRefusal(target, drift)
            return out
        }

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
        if (!approvals.sameCommit(incomingCommit, out.targetCommit)) {
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
                const { changedObjects, objectKey, expectedPlanKeys } = require('./git-release')
                const expected = await changedObjects({ from: base, to: releaseCommit, repoUrl, token, gitUser })
                const expectedKeys = expectedPlanKeys(expected)
                // The authoritative "what this release ships" — for the report.
                out.shippedObjects = expected

                // Views and subsets do not block drift (TM1's pull never touches
                // them) — but the IDE applies them over REST afterwards, and that
                // REPLACES. So if one changed on the target AND this release ships
                // it, the deploy would silently overwrite the target's version.
                // Refuse and name it; Review resolves this by choosing a side.
                const { viewSubsetConflicts } = require('./git-release')
                const conflicts = viewSubsetConflicts(out.driftNonBlocking, expectedKeys)
                if (conflicts.length) {
                    out.executed = false
                    out.refused = true
                    out.error = `Refused: ${conflicts.map(e => e.file).join(', ')} changed on ${target} and is also in this release. The view/subset step would replace the target's version. Resolve it at Review (keep ${target}'s, or take the release's).`
                    return out
                }
                const parsedOps = (plan.Operations ?? []).map(parsePlanOp).filter(Boolean)
                const unknownOps = parsedOps.filter(o => o.unknown)
                if (unknownOps.length) {
                    out.executed = false
                    out.refused = true
                    out.error = `Refused: the pull plan contains ${unknownOps.length} operation(s) this deploy cannot classify — ${unknownOps.map(o => o.raw).join('; ')}. Rebuild or inspect the release before deploying.`
                    return out
                }
                const unexpected = parsedOps.filter(o => !expectedKeys.has(objectKey(o.type, o.name, o.parent)))
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
        // The same loss figure the Review showed, captured with the deployment so
        // the report can say what was removed — computed here because Review may
        // never have run (the one-button path skips it).
        try {
            const { compareTargetWithRepo } = require('./git-readiness')
            // repoUrl is scoped to the release block above; read it again here.
            const lossRepoUrl = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL
            if (lossRepoUrl && out.targetCommit) {
                const cmp = await compareTargetWithRepo(target, {
                    commit: out.targetCommit, repoUrl: lossRepoUrl, token, gitUser, ideToken, client: c,
                })
                out.elementLoss = cmp.elementLoss
                out.loss = cmp.loss
            }
        } catch (e) { out.elementLossError = e.message }

        try {
            await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
            out.executed = true
            // The base for apply/verify is what the target HAD before this deploy —
            // capture it before recordDeploy rewrites lastDeployed.
            const preDeployBase = require('./git-state').lastDeployed(target)?.lastDeployedCommit ?? null
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
            // Apply subsets/views over REST (TM1 Git's pull never applies them), then
            // verify every included object actually landed on the target — a skip must
            // never look like a clean deploy.
            if (releaseCommit) {
                try {
                    const { applyReleaseComplement, verifyRelease } = require('./git-release')
                    const repoUrl = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL
                    const applied = await applyReleaseComplement(target, { base: preDeployBase, releaseCommit, repoUrl, token, gitUser, ideToken })
                    out.subsetsViews = applied
                    out.incomplete = await verifyRelease(target, { base: preDeployBase, releaseCommit, repoUrl, token, gitUser, ideToken })
                } catch (e) {
                    out.incompleteCheckError = e.message
                    out.incomplete = []
                }
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
        let manifest = { deletes: [], dims: [], attrElements: [], wholesaleDims: [] }
        if (linkedSession?.kind === 'catch-up') {
            // A catch-up has no change-set delete log. Its approved target-only
            // delete list is the scope; nothing else is inferred from DEV.
            manifest.deletes = Array.isArray(approval.deletes) ? approval.deletes : []
        } else if (approval.session) {
            try { manifest = require('./change-log').getSessionManifest(approval.session) || manifest } catch { /* no manifest */ }
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

        // Control checks on the target — invariant tests, valid on any data.
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
        const controlReasons = []
        if (out.reconcile?.error) controlReasons.push(`reconcile: ${out.reconcile.error}`)
        if (out.reconcile?.deletes?.error) controlReasons.push(`reconcile deletes: ${out.reconcile.deletes.error}`)
        for (const x of out.reconcile?.deletes?.flagged ?? []) controlReasons.push(`delete skipped: ${x.type} ${x.name} — ${x.error}`)
        if (out.reconcile?.attributeValues?.error) controlReasons.push(`reconcile attribute values: ${out.reconcile.attributeValues.error}`)
        for (const x of out.reconcile?.attributeValues?.errors ?? []) controlReasons.push(`attribute sync ${x.dim}: ${x.error}`)
        for (const x of out.reconcile?.attributeValues?.flagged ?? []) controlReasons.push(`attribute sync ${x.dim}: ${x.error}`)
        if (controlReasons.length) {
            out.controlOk = false
            out.controlReasons = controlReasons
        }
        // A deploy's own signals override the assertion verdict: a subset/view apply
        // that failed, an object that did not land, or an errored verification is
        // never a "control ok" deploy, even if every invariant still passed.
        if ((out.subsetsViews?.errors?.length ?? 0) > 0 || (out.incomplete?.length ?? 0) > 0 || out.incompleteCheckError) {
            out.controlOk = false
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