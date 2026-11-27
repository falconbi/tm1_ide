'use strict'

// ── Git deploy flow (IMPROVEMENTS 10.1 hybrid) ──────────────────────────────
// Deploying through TM1 Git: prepare (baseline status + pull plan preview) then
// execute (atomic pull + reconcile + control checks on the target). The pull
// plan is ephemeral, so execute re-creates it and runs immediately. The approval
// gate is enforced inside execute — it cannot be bypassed by any caller.

const { makeClient } = require('./adapter-registry')
const { odataKey } = require('./odata-key')
const { TM1Client } = require('./tm1-client')
const assertions = require('./assertions')
const gitIdentity = require('./git-identity')
const approvals = require('./git-approvals')
const { driftCheck } = require('./git-drift')

// Refresh the target's live snapshot (pushes live-<target>) and compare it against
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
        return { clean: entries.length === 0, entries, nonBlocking, all, deployed: d?.deployed ?? null, liveCommit: d?.liveCommit ?? null }
    } catch (e) {
        return { clean: false, entries: [], nonBlocking: [], error: e.message }
    }
}

// What a drifted Git file belongs to, in the words a person reads. Drift entries
// carry a file path, not an object, so this is the one place that turns one into
// the other — the refusal text, the "ignored" filter and the next step all use it.
function driftObject(file) {
    const f = String(file ?? '')
    let m
    if ((m = f.match(/^dimensions\/(.+?)\.hierarchies\/.+?\.subsets\/(.+?)\.json$/i))) {
        return { type: 'subset', name: m[2], label: `Subset ${m[2]} on ${m[1]}` }
    }
    if ((m = f.match(/^dimensions\/(.+?)\.hierarchies\/.+?\.json$/i))) {
        return { type: 'dimension', name: m[1], label: `Dimension ${m[1]}` }
    }
    if ((m = f.match(/^dimensions\/(.+?)\.json$/i))) {
        return { type: 'dimension', name: m[1], label: `Dimension ${m[1]}` }
    }
    if ((m = f.match(/^cubes\/(.+?)\.rules$/i))) {
        return { type: 'rule', name: m[1], label: `Rules for cube ${m[1]}` }
    }
    if ((m = f.match(/^cubes\/(.+?)\.views\/.+?\.json$/i))) {
        return { type: 'view', name: m[1], label: `View on cube ${m[1]}` }
    }
    if ((m = f.match(/^cubes\/(.+?)\.json$/i))) {
        return { type: 'cube', name: m[1], label: `Cube ${m[1]}` }
    }
    if ((m = f.match(/^processes\/(.+?)\.(?:json|ti)$/i))) {
        return { type: 'process', name: m[1], label: `Process ${m[1]}` }
    }
    if ((m = f.match(/^chores\/(.+?)\.(?:json|ti)$/i))) {
        return { type: 'chore', name: m[1], label: `Chore ${m[1]}` }
    }
    return { type: 'unknown', name: null, label: f || 'an object' }
}

// Policy: a drifted target is not reverted or promoted ad hoc. The fix is to
// re-apply the change on DEV in a change set and release it; deploys stay paused
// until drift is clean.
const driftRefusal = (target, drift) => {
    const entries = drift.entries ?? []
    const label = (e) => driftObject(e?.file).label
    const what = (e) => {
        const s = e?.summary
        if (!s) return e?.status === 'A' ? 'new on the target' : e?.status === 'D' ? 'removed on the target' : 'changed on the target'
        return s
            .replace(/^\+(\d+) element(s?):/i, '$1 new element$2:')
            .replace(/^-(\d+) element(s?):/i, '$1 element$2 no longer there:')
            .replace(/^\+(\d+) edge(s?):/i, '$1 new link$2:')
            .replace(/^-(\d+) edge(s?):/i, '$1 link$2 removed:')
    }
    const lines = entries.map(e => `— ${label(e)}: ${what(e)}`)
    const soft = (drift.nonBlocking ?? []).length
        ? `\nAlso reported, not blocking: ${(drift.nonBlocking).map(label).join(', ')}.`
        : ''
    if (!entries.length) {
        return `${target} could not be compared with its last deploy (${drift.error ?? 'unknown error'}). The deploy is waiting.${soft}`
    }
    const types = new Set(entries.map(e => driftObject(e?.file).type))
    const next = types.has('rule') || types.has('process')
        ? `What to do: put ${target}'s version of it into DEV (carry-back), then deploy it.`
        : types.has('cube')
            ? `What to do: make the same cube change on DEV in a new change set, then deploy it.`
            : `What to do: copy ${target}'s change to DEV with Sync DEV (only when no change set is open), or record it on DEV in a change set and deploy it.`
    return `${target} changed after the last deploy:\n${lines.join('\n')}\n${next} The deploy is waiting until this is fixed.${soft}`
}

// Drift entries for objects the pull plan does not write at all. A Skip op means
// the target's copy is left exactly as it is, so a change there cannot be lost,
// replaced or blocked by this deploy.
function unshippedDrift(entries = [], ops = []) {
    if (!(entries ?? []).length) return []
    const touched = new Set()
    let parsed = 0
    for (const op of ops ?? []) {
        const m = String(op ?? '').match(/^([A-Za-z]+)\s+[A-Za-z]+\(['"]?([^'")]*)['"]?/)
        if (!m) continue
        parsed++
        // Skip is the only verb that writes nothing. Everything else writes the object.
        if (m[1].toLowerCase() === 'skip') continue
        touched.add(String(m[2]).toLowerCase())
    }
    // A plan we cannot read tells us nothing, and "nothing is written" is never a
    // safe assumption to filter drift on. An all-Skip plan, by contrast, is exact.
    if (!parsed) return []
    return (entries ?? []).filter(e => {
        if (e?.blocking === false) return false          // already reported, never blocking
        const name = String(e?.object ?? driftObject(e?.file).name ?? '').toLowerCase()
        if (!name) return false                          // unclassified: keep it visible
        return !touched.has(name)
    })
}

// Elements this change set deliberately deletes, per dimension. A deliberate
// delete is not drift-loss: the target still has the element, and the release is
// meant to remove it.
function recordedElementDeletes(session) {
    if (!session) return null
    try {
        const { recordedChanges } = require('./recorded-changes')
        const cl = require('./change-log')
        const rec = recordedChanges(cl.getSessionLogVerbose(session))
        const byDim = new Map()
        for (const [dim, r] of rec.dimensions ?? []) {
            const names = new Set((r.elements ?? []).filter(o => o.action === 'delete').map(o => String(o.name).toLowerCase()))
            if (names.size) byDim.set(String(dim).toLowerCase(), names)
        }
        if (!byDim.size) return null
        return (dim, name) => byDim.get(String(dim).toLowerCase())?.has(String(name).toLowerCase()) ?? false
    } catch { return null }
}

// A dimension the release already carries every element of does not block; one
// whose elements it would remove does.
function partitionCarriedDrift(entries = [], elementLoss) {
    // 'carried' is only knowable when the comparison actually ran. A failed
    // comparison must never be read as "nothing to lose".
    const lossKnown = Array.isArray(elementLoss)
    const lostDimensions = new Set((lossKnown ? elementLoss : []).map(l => String(l.dimension).toLowerCase()))
    const dimOf = (file) => {
        const m = String(file ?? '').match(/^dimensions\/([^/]+?)(?:\.hierarchies\/.*)?\.json$/)
        return m ? m[1] : null
    }
    const blocking = []
    const carried = []
    for (const e of entries ?? []) {
        if (e?.blocking === false) { carried.push(e); continue }   // views/subsets: already reported
        // A DELETE on the target is never "carried": the object is absent, so there
        // are no elements to lose, and having nothing to lose is not the same as
        // having everything. It blocks, whatever the release says it shipped.
        if (String(e?.status ?? '').toUpperCase() === 'D') { blocking.push(e); continue }
        const dim = dimOf(e?.file)
        if (lossKnown && dim && !lostDimensions.has(dim.toLowerCase())) {
            carried.push({ ...e, carried: true, reason: 'the release carries what the target changed here' })
        } else {
            blocking.push(e)
        }
    }
    return { blocking, carried }
}

// The OData path that proves each shipped object exists on the target, deduped by
// object. A process is two files and a view two, so the change set's object list
// repeats; the check must not.
function shippedTargetPaths(objects = []) {
    const seen = new Set()
    const out = []
    for (const o of objects ?? []) {
        if (!o?.type || !o?.name) continue
        // A deletion is supposed to leave nothing behind.
        if (o.action === 'D' || /DELETED/i.test(String(o.action ?? ''))) continue
        const key = `${o.type}|${o.name}|${o.parent ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        const path =
            o.type === 'dimension' ? `Dimensions('${odataKey(o.name)}')`
            : o.type === 'cube' ? `Cubes('${odataKey(o.name)}')`
            : o.type === 'view' ? `Cubes('${odataKey(o.parent)}')/Views('${odataKey(o.name)}')`
            : o.type === 'subset' ? `Dimensions('${odataKey(o.parent)}')/Hierarchies('${odataKey(o.parent)}')/Subsets('${odataKey(o.name)}')`
            : o.type === 'process' ? `Processes('${odataKey(o.name)}')`
            : o.type === 'chore' ? `Chores('${odataKey(o.name)}')`
            : null
        if (path) out.push({ label: `${o.type} ${o.name}`, path })
    }
    return out
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
        // TM1's own DeployedCommit is the last git op's target (a live-<target> push
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
    if ((out.driftEntries ?? []).length === 0 && session && (out.driftNonBlocking ?? []).length) {
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
                const rel = session ? require('./change-log').getSession(session) : null
                const cmpCommit = rel?.release_commit ?? out.plan.targetCommit
                const cmp = await compareTargetWithRepo(target, {
                    commit: cmpCommit, repoUrl: out.repoUrl, token, gitUser, ideToken, client: c,
                    ignoreElements: recordedElementDeletes(session),
                })
                out.elementLoss = cmp.elementLoss
                out.loss = cmp.loss
                out.typeChanges = cmp.typeChanges ?? []
            } catch (e) {
                out.elementLossError = e.message
            }
        }

        // Anything the target changed on an object this pull does not write is
        // irrelevant here: the plan Skips it, so nothing can be overwritten.
        const untouched = unshippedDrift(out.driftEntries, ops)
        if (untouched.length) {
            out.driftIgnored = untouched
            out.driftEntries = (out.driftEntries ?? []).filter(e => !untouched.includes(e))
        }

        // Drift on a dimension the release already carries does not block here any
        // more — report it instead. Anything else still blocks.
        if ((out.driftEntries ?? []).length) {
            const { blocking, carried } = partitionCarriedDrift(out.driftEntries, out.elementLoss ?? [])
            out.driftEntries = blocking
            if (carried.length) {
                out.driftCarried = carried
                out.driftNonBlocking = [...(out.driftNonBlocking ?? []), ...carried]
            }
            if (blocking.length === 0) {
                out.blocked = false
                out.error = null
            } else if (out.drift === 'drifted') {
                out.blocked = true
                out.error = driftRefusal(target, { entries: blocking, nonBlocking: out.driftNonBlocking })
            }
        } else if (out.blocked) {
            // Every change the target made sits in an object this deploy leaves
            // alone, so nothing about it can block or be lost.
            out.blocked = false
            out.error = null
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

async function runDeploy(target, { branch = 'dev', token, gitUser = gitIdentity.user(), ideToken, source, purpose = 'deploy', by, session: sessionId, backupAt: _backupAt = null } = {}) {
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
    // The loss confirmation recorded at approval time (who, when, what was shown).
    out.lossAck = approval.lossAck ?? null
    out.typeAck = approval.typeAck ?? null

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

    // Part L.2/L.3 — TEST's cycle is derived, not listed. Once a set in it has
    // reached PROD, a set outside the cycle cannot be deployed to TEST until the
    // re-clone is recorded. The label is read from TM1 Git; an unreadable label
    // does not invent a refusal.
    const cycleSessionId = sessionId ?? approval.session
    if (cycleSessionId) {
        try {
            const st = await c.post('GitStatus', { Username: gitUser, Password: token })
            if (String(st?.Deployment ?? '').toUpperCase() === 'TEST') {
                const { canDeployToTest } = require('./test-cycle')
                const cyc = canDeployToTest(target, cycleSessionId)
                if (!cyc.ok) {
                    out.executed = false
                    out.refused = true
                    out.error = cyc.error
                    out.testCycle = cyc.cycle
                    return out
                }
            }
        } catch { /* label unknown — do not block on a guess */ }
    }

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
                // The action matters: an object this change set DELETES is expected
                // to be absent afterwards, and must not be read as "missing".
                .map(e => ({ type: e.object_type, name: e.object_name, parent: e.detail ?? null, action: e.action ?? null }))
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

    // The release's recorded attribute plan (Part G.7), built at Build Release.
    let attrsPlan
    try {
        const relSession = linkedSession?.id ? cl.getSession(linkedSession.id) : null
        attrsPlan = relSession?.release_attrs ? JSON.parse(relSession.release_attrs) : null
    } catch { attrsPlan = null }

    try {
        // Refresh the target's live snapshot and refuse if it has drifted from what
        // it last received — never deploy onto a drifted target. The lock is
        // released by the finally below either way.
        const drift = await targetDrift(target, { token, gitUser, ideToken })
        out.drift = drift.clean ? 'clean' : 'drifted'
        out.driftEntries = drift.entries ?? []
        // Reported, never blocking: a pull cannot touch a view or a subset.
        out.driftNonBlocking = drift.nonBlocking ?? []
        // Refusal waits until the release's own element-loss is known: a dimension
        // the release carries does not block.

        // Part I.2 — the target must not have changed since Build Release. Build
        // recorded the Live commit it started from; anything different now (an
        // element, a value) means the release no longer describes this target, and
        // it must be rebuilt and approved again.
        const sessionLive = (session ?? linkedSession)?.release_live_commit ?? null
        if (sessionLive && drift.liveCommit) {
            const { sameCommit } = require('./git-approvals')
            if (!sameCommit(sessionLive, drift.liveCommit)) {
                try {
                    const repoUrl = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL
                    const { changedObjects } = require('./git-release')
                    const changedSinceBuild = await changedObjects({ from: sessionLive, to: drift.liveCommit, repoUrl, token, gitUser })
                    if (changedSinceBuild.length) {
                        out.executed = false
                        out.refused = true
                        out.error = `Refused: ${target} changed after the release was built (${changedSinceBuild.slice(0, 5).map(o => `${o.type} ${o.name}`).join(', ')}${changedSinceBuild.length > 5 ? '…' : ''}). Run Build Release again and approve the new release.`
                        return out
                    }
                } catch (e) {
                    out.executed = false
                    out.refused = true
                    out.error = `Refused: could not check whether ${target} changed after Build Release (${e.message}). Run Build Release again.`
                    return out
                }
            }
        }

        // Part I.2 — attribute values must not have moved either. Build recorded
        // the attrs-<target> commit it used; writing the target's attributes now
        // returns that same commit when nothing changed, or a new one when a value
        // moved after the build — in which case the release no longer describes it.
        const attrsLiveStored = (session ?? linkedSession)?.release_attrs_live ?? null
        if (attrsLiveStored) {
            try {
                const repoUrl = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL
                const { collectAttrsFiles, writeAttrsBranch } = require('./git-attrs')
                const tm1Now = new TM1Client(target, makeClient(target, ideToken))
                const files = await collectAttrsFiles(tm1Now)
                const w = await writeAttrsBranch(target, { repoUrl, token, gitUser, files, message: `Pre-deploy attributes of ${target}` })
                const { sameCommit } = require('./git-approvals')
                if (w?.ok === false) throw new Error(w.error)
                if (w?.commit && !sameCommit(attrsLiveStored, w.commit)) {
                    out.executed = false
                    out.refused = true
                    out.error = `Refused: an attribute value on ${target} changed after the release was built. Run Build Release again and approve the new release.`
                    return out
                }
            } catch (e) {
                out.executed = false
                out.refused = true
                out.error = `Refused: could not check ${target}'s attributes for changes since Build Release (${e.message}). Run Build Release again.`
                return out
            }
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
                const { viewSubsetConflicts, objectKey: okey } = require('./git-release')
                // What the change set actually owns. A subset it does not own is in
                // the release because Build carried the target's own copy, so the
                // step applies the same content back: no conflict, nothing to ask.
                let ownedKeys = null
                try {
                    const sid = approval.session ?? session
                    const log = sid ? require('./change-log').getSessionLog(sid) : []
                    ownedKeys = new Set((log ?? [])
                        .filter(e => e.object_type === 'subset' || e.object_type === 'view')
                        .map(e => okey(e.object_type, e.object_name, e.detail)))
                } catch { ownedKeys = null }
                const conflicts = viewSubsetConflicts(out.driftNonBlocking, expectedKeys, ownedKeys)
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
        // never have run (the two-phase flow always shows it, the old one-button
        // path did not).
        try {
            const { compareTargetWithRepo } = require('./git-readiness')
            // repoUrl is scoped to the release block above; read it again here.
            const lossRepoUrl = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL
            if (lossRepoUrl && out.targetCommit) {
                const cmp = await compareTargetWithRepo(target, {
                    commit: out.releaseCommit ?? out.targetCommit, repoUrl: lossRepoUrl, token, gitUser, ideToken, client: c,
                    ignoreElements: recordedElementDeletes(session?.id ?? session),
                })
                out.elementLoss = cmp.elementLoss
                out.loss = cmp.loss
                out.typeChanges = cmp.typeChanges ?? []
            }
        } catch (e) { out.elementLossError = e.message }

        // Type changes clear stored values, exactly like deleting the element. The
        // approval must carry the person's "yes" for them, recorded when they were
        // shown the list — a count is not a confirmation.
        if ((out.typeChanges ?? []).length) {
            const ack = approval.typeAck
            const covered = ack && Array.isArray(ack.elements) && ack.elements.length >= out.typeChanges.length
            if (!covered) {
                out.executed = false
                out.refused = true
                out.error = `Refused: this release changes the type of ${out.typeChanges.length} element${out.typeChanges.length === 1 ? '' : 's'} (${out.typeChanges.slice(0, 5).map(t => `${t.dimension}.${t.element}: ${t.from} → ${t.to}`).join('; ')}${out.typeChanges.length > 5 ? '…' : ''}), and TM1 clears the values stored against them. Approve it again at Review, where the list is shown.`
                return out
            }
        }

        // Objects this pull does not write cannot be affected by it.
        const untouchedExec = unshippedDrift(out.driftEntries, plan?.Operations ?? [])
        if (untouchedExec.length) {
            out.driftIgnored = untouchedExec
            out.driftEntries = (out.driftEntries ?? []).filter(e => !untouchedExec.includes(e))
        }

        // Now that this release's own loss is known: a dimension whose elements the
        // release carries does not block; anything else still does.
        if ((out.driftEntries ?? []).length) {
            const { blocking, carried } = partitionCarriedDrift(out.driftEntries, out.elementLoss ?? [])
            out.driftEntries = blocking
            if (carried.length) {
                out.driftCarried = carried
                out.driftNonBlocking = [...(out.driftNonBlocking ?? []), ...carried]
            }
            if (blocking.length) {
                out.executed = false
                out.refused = true
                out.error = driftRefusal(target, { entries: blocking, nonBlocking: out.driftNonBlocking })
                return out
            }
        }

        // ── Protect what the deploy is about to overwrite ───────────────────
        // Under the lock, immediately before the pull: write the target's data to
        // disk, then either run the site's backup process or confirm — with a
        // time — when the last backup was taken. A failure stops the deploy
        // before anything is replaced.
        const tm1 = new TM1Client(target, makeClient(target, ideToken))
        const saveAt = new Date().toISOString()
        try {
            await tm1.saveDataAll()
            out.saveData = { ok: true, at: saveAt }
        } catch (e) {
            out.executed = false
            out.refused = true
            out.error = `Refused: Save Data failed on ${target} (${e.message}). Nothing was sent.`
            return out
        }

        // A backup is REQUIRED, not stated (Part I.3). The IDE's own process is
        // the default, so a target is never deployable without a backup because
        // nobody configured one. The typed-in time is gone: it proved nothing.
        let protection = { backupProcess: null }
        try { protection = await require('./deploy-settings').get(target, { ideToken }) } catch { /* no setting */ }
        const { DEFAULT_BACKUP_PROCESS, backupFileName } = require('./deploy-backup')
        const backupProcess = protection.backupProcess || DEFAULT_BACKUP_PROCESS
        const backupName = backupFileName(target)
        const at = new Date().toISOString()
        try {
            if (backupProcess === DEFAULT_BACKUP_PROCESS) {
                // Installs }IDE.Backup on demand and passes the exact name this
                // deploy records. The process fails when its archive is missing.
                const r = await tm1.backupData({ fileName: backupName })
                out.backup = { kind: 'process', process: backupProcess, fileName: backupName, ok: true, at, status: r?.status ?? null }
            } else {
                const r = await tm1.executeProcess(backupProcess, [])
                const status = r?.ProcessExecuteStatusCode
                const ok = status === undefined || status === 0 || status === 'CompletedSuccessfully' || status === 'HasMinorErrors'
                if (!ok) throw new Error(`the process returned ${status}`)
                out.backup = { kind: 'process', process: backupProcess, fileName: backupName, ok: true, at }
            }
        } catch (e) {
            out.executed = false
            out.refused = true
            out.error = `Refused: the backup process "${backupProcess}" failed on ${target} (${e.message}). Nothing was sent. Set a backup process on the target, or fix }IDE.Backup.`
            return out
        }

        try {
            await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
            out.executed = true
            // The base for apply/verify is what the target HAD before this deploy —
            // capture it before recordDeploy rewrites lastDeployed.
            const preDeployBase = require('./git-state').lastDeployed(target)?.lastDeployedCommit ?? null
            // Record what we actually deployed — TM1's DeployedCommit isn't reliable
            // as "last received" (a live-<target> push clobbers it). Loud: if the model
            // record cannot be written, that is reported, never best-effort.
            try {
                const { recordDeploy } = require('./git-state')
                out.deployRecord = await recordDeploy(target, out.targetCommit, plan.Commit?.Summary ?? null, { ideToken })
            } catch (e) {
                out.executed = true
                out.recorded = false
                out.error = `Deploy applied, but the deploy record could not be written: ${e.message}. Investigate before the next deploy.`
            }
            // Restore point (Part I.4): tag the commit the target held BEFORE this
            // deploy and the matching attributes commit with the backup's name.
            // Best-effort: a tag that cannot be pushed is reported, and never
            // undoes a pull that already landed.
            try {
                const tagRepo = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL
                let attrsCommit = null
                try { attrsCommit = require('./git-attrs').attrsHead(tagRepo, target, { token, gitUser }) } catch { attrsCommit = null }
                out.restorePoint = await require('./deploy-backup').tagRestorePoint(tagRepo, {
                    backupName, releaseCommit: preDeployBase, attrsCommit, token, gitUser,
                })
                if (out.backup) out.backup.tag = out.restorePoint?.release ?? null
            } catch (e) {
                out.restorePoint = { ok: false, error: e.message }
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

                    // Part Q.1 — reprocess feeders for every cube whose rules this
                    // release changed, after the pull and BEFORE verify. A failure
                    // makes the deploy incomplete and names the cube.
                    const { cubesWithChangedRules, reprocessFeeders } = require('./after-deploy')
                    const feederCubes = cubesWithChangedRules(out.shippedObjects)
                    const feeders = await reprocessFeeders(tm1, feederCubes)
                    out.feeders = feeders
                    out.incomplete = (feeders.failed ?? []).map(f => `feeders on ${f.cube}: ${f.error}`)
                    if (feeders.failed?.length) out.feederFailures = feeders.failed

                    out.incomplete = [
                        ...(out.incomplete ?? []),
                        ...(await verifyRelease(target, { base: preDeployBase, releaseCommit, repoUrl, token, gitUser, ideToken })),
                    ]
                } catch (e) {
                    out.incompleteCheckError = e.message
                    out.incomplete = []
                }

                // Part G.7 / I.6: the attribute definitions and values this change
                // set recorded. Applied through REST after the pull, before verify.
                if (attrsPlan && ((attrsPlan.defs?.length ?? 0) + (attrsPlan.values?.length ?? 0))) {
                    try {
                        const { applyAttributePlan } = require('./apply-attrs')
                        out.attributePlan = await applyAttributePlan(tm1, attrsPlan)
                        if (out.attributePlan.errors.length) {
                            out.incomplete = [...(out.incomplete ?? []), ...out.attributePlan.errors.map(e => `${e.type} ${e.dim}.${e.name ?? `${e.element}.${e.attribute}`}`)]
                        }
                    } catch (e) { out.attributePlan = { applied: [], errors: [{ error: e.message }] } }
                }

                // Part I.7: Last Deployed attributes are the target's own attributes
                // READ BACK from the server, never what the IDE meant to write.
                try {
                    const repoUrl2 = (await c.post('GitStatus', { Username: gitUser, Password: token }))?.URL
                    if (repoUrl2) {
                        const { collectAttrsFiles, writeAttrsBranch } = require('./git-attrs')
                        const files = await collectAttrsFiles(tm1)
                        const w = await writeAttrsBranch(target, { repoUrl: repoUrl2, token, gitUser, files, message: `Last Deployed attributes of ${target}` })
                        if (w?.ok === false) out.attrsError = w.error
                        else out.attrsCommit = w?.commit ?? null
                    }
                } catch (e) { out.attrsError = e.message }

                // Every object this change set claims must be on the target when the
                // deploy ends — including one the release inherited from its base and
                // therefore never listed as "changed". A recorded delivery that is
                // not there is the state that silently poisons later deploys.
                const missing = []
                for (const { label, path } of shippedTargetPaths(out.shippedObjects)) {
                    try { await c.get(path, { $select: 'Name' }) } catch { missing.push(label) }
                }
                if (missing.length) {
                    out.missingShipped = missing
                    out.controlOk = false
                    if (!out.error) out.error = `Deployed, but these are missing on ${target}: ${missing.join(', ')}`
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
            // Catch-up was removed; an old approval for one cannot be executed.
            out.executed = false
            out.refused = true
            out.error = 'Refused: catch-up has been removed. Start a normal change set and deploy that.'
            return out
        } else if (approval.session) {
            try { manifest = require('./change-log').getSessionManifest(approval.session) || manifest } catch { /* no manifest */ }
        } else {
            out.reconcileWarning = 'This approval has no linked change set — reconcile scope is unknown and was skipped (not silently).'
        }
        out.manifest = manifest
        try {
            const { reconcile } = require('./git-reconcile')
            // A release carries its own recorded attribute plan (Part G.7). Where one
            // exists the old manifest-driven value copy is NOT used: that path copied
            // a whole dimension when only "attribute changed" was known, overwriting
            // the target's own values (Sarah).
            const hasPlan = !!attrsPlan && ((attrsPlan.defs?.length ?? 0) + (attrsPlan.values?.length ?? 0)) > 0
            out.reconcile = await reconcile(source, target, {
                ideToken, deletes: manifest.deletes,
                dims: hasPlan ? [] : manifest.dims,
                attrElements: hasPlan ? [] : manifest.attrElements,
            })
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
        // A failed delete leaves the target wrong: say so as a failure, not a skip.
        for (const x of out.reconcile?.deletes?.failed ?? []) controlReasons.push(`delete FAILED: ${x.type} ${x.name} — ${x.error}`)
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

        // Part Q.2 — DEV's tests run against the target, read-only, straight after
        // the deploy. A failure never undoes anything; it marks the deploy "needs
        // checking" and names the test.
        try {
            const { runDevTestsOnTarget } = require('./after-deploy')
            out.devTests = await runDevTestsOnTarget(source, target, { ideToken })
            if (!out.devTests.error && out.devTests.failed > 0) {
                out.needsChecking = true
                out.needsCheckingTests = (out.devTests.failures ?? []).map(f => f.description ?? f.id)
            }
        } catch (e) {
            out.devTests = { error: e.message }
        }
        return out
    } finally {
        try {
            const rel = await lockMod.release(target, { ideToken })
            if (rel && rel.ok === false) out.lockReleaseError = rel.error   // surfaced, never silent
        } catch (e) { out.lockReleaseError = e.message }
    }
}

// What a specific release commit would remove from the target. Small, read-only,
// and shared by Review (via prepare), the one-button Ship (which never shows
// Review) and execute's record — one implementation of the comparison.
async function elementLossFor(target, commit, { token, gitUser = gitIdentity.user(), ideToken } = {}) {
    if (!commit) return { loss: { elements: 0, dimensions: 0 }, elementLoss: [] }
    const c = makeClient(target, ideToken)
    const st = await c.post('GitStatus', { Username: gitUser, Password: token })
    const repoUrl = st?.URL
    if (!repoUrl) throw new Error(`${target} is not linked to a repo.`)
    const { compareTargetWithRepo } = require('./git-readiness')
    const cmp = await compareTargetWithRepo(target, { commit, repoUrl, token, gitUser, ideToken, client: c })
    return { loss: cmp.loss, elementLoss: cmp.elementLoss, targetOnly: cmp.targetOnly }
}

module.exports = { prepare, execute, elementLossFor, partitionCarriedDrift, shippedTargetPaths, driftRefusal, unshippedDrift, driftObject }