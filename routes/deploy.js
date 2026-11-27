'use strict'

function register(app, deps) {
    const { _GI, _GITOK, cl, deployLoadBaseline, deploySeed, fail, fs, gateReadOnly, gateWrite, gitSecrets, listServers, makeClient, path, requireTm1Admin } = deps

app.post('/api/deploy/pre-delete-check', async (req, res) => {
    try {
        const { server, dimension, element, hierarchy } = req.body
        if (!server || !dimension || !element) return res.status(400).json({ error: 'server, dimension and element required' })
        const client = makeClient(server, req.ideToken)
        res.json(await client.preDeleteElementCheck(dimension, element, hierarchy ?? dimension))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/baseline', (req, res) => {
    try {
        const snapshot = deployLoadBaseline(null, req.query.server)
        if (!snapshot) return res.json({ exists: false })
        res.json({ exists: true, ...snapshot._meta })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

function lensServerSignedIn(req, res, server) {
    const { needsServerLogin } = require('../core/adapter-registry')
    if (!needsServerLogin(server, req.ideToken)) return true
    res.status(401).json({ needsServerLogin: server, error: `Sign in to server "${server}" to use it` })
    return false
}

app.get('/api/deploy/lenses/plan', async (req, res) => {
    try {
        const { source, target } = req.query
        if (!source || !target) return res.status(400).json({ error: 'source and target required' })
        if (!lensServerSignedIn(req, res, source) || !lensServerSignedIn(req, res, target)) return
        if (!(await requireTm1Admin(req, res, source))) return
        if (!(await requireTm1Admin(req, res, target))) return
        const { planLenses } = require('../core/lens-deploy')
        res.json(await planLenses(source, target, { ideToken: req.ideToken }))
    } catch (e) { fail(res, e) }
})

app.post('/api/deploy/lenses/approve', async (req, res) => {
    try {
        const { source, target, entries, deletes, note, planHash } = req.body
        if (!source || !target) return res.status(400).json({ error: 'source and target required' })
        if (!lensServerSignedIn(req, res, source) || !lensServerSignedIn(req, res, target)) return
        if (!(await requireTm1Admin(req, res, source))) return
        if (!(await requireTm1Admin(req, res, target))) return
        const { approveLenses } = require('../core/lens-deploy')
        res.json(await approveLenses(source, target, {
            entries, deletes, note, planHash, by: req.user, ideToken: req.ideToken,
        }))
    } catch (e) { fail(res, e) }
})

app.post('/api/deploy/lenses/execute', async (req, res) => {
    try {
        const { source, target, approvalId } = req.body
        if (!source || !target) return res.status(400).json({ error: 'source and target required' })
        if (!lensServerSignedIn(req, res, source) || !lensServerSignedIn(req, res, target)) return
        if (!(await requireTm1Admin(req, res, source))) return
        if (!(await requireTm1Admin(req, res, target))) return
        const { executeLenses } = require('../core/lens-deploy')
        res.json(await executeLenses(source, target, { approvalId, by: req.user, ideToken: req.ideToken }))
    } catch (e) { fail(res, e) }
})

app.get('/api/deploy/lenses/history', async (req, res) => {
    try {
        const target = req.query.target
        if (!target) return res.status(400).json({ error: 'target required' })
        if (!lensServerSignedIn(req, res, target)) return
        if (!(await requireTm1Admin(req, res, target))) return
        const { readHistory, readApprovals } = require('../core/lens-deploy')
        const [history, approvals] = await Promise.all([
            readHistory(target, { ideToken: req.ideToken }),
            readApprovals(target, { ideToken: req.ideToken }),
        ])
        res.json({ target, history, approvals })
    } catch (e) { fail(res, e) }
})

app.get('/api/git-readiness', async (req, res) => {
    try {
        const { scan } = require('../core/git-readiness')
        const { listServers } = require('../core/adapter-registry')
        if (req.query.all === '1') {
            const results = []
            for (const s of listServers()) {
                try { results.push(await scan(s, { ideToken: req.ideToken })) }
                catch (e) { results.push({ server: s, error: e.message }) }
            }
            return res.json({ results })
        }
        if (!req.query.server) return res.status(400).json({ error: 'server or all=1 required' })
        res.json(await scan(req.query.server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/git/prepare', async (req, res) => {
    try {
        const { prepare } = require('../core/git-deploy')
        const { source, target, branch, session } = req.body
        if (!source || !target) return res.status(400).json({ error: 'source and target required' })
        res.json(await prepare(source, target, { branch, token: _GITOK(), ideToken: req.ideToken, session }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Part D — the pre-deploy check. Read-only on the target and DEV: the target
// writes its own objects into Git, the IDE writes its attributes branch, and the
// two snapshots are compared with what the target last received. It does not
// build a release or change anything on either server.
app.post('/api/deploy/pre-check', async (req, res) => {
    try {
        const { target, source, windowMinutes } = req.body ?? {}
        if (!target) return res.status(400).json({ error: 'target required' })
        const { preDeployCheck } = require('../core/pre-deploy')
        let ownAccount = null
        try { ownAccount = require('../core/paw-connect').getServerCredentials(req.ideToken, target)?.username ?? null } catch { /* unknown */ }
        res.json(await preDeployCheck(target, {
            source: source ?? null, session: req.body?.session ?? null,
            token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken,
            windowMinutes: Number(windowMinutes) || 30, ownAccount,
        }))
    } catch (e) { fail(res, e) }
})

// Part D.4 — bring PROD's version of a rule or process onto DEV, in a new
// `carry-back` change set. Writes only to DEV, through TM1's REST API.
app.post('/api/deploy/carry-back', async (req, res) => {
    try {
        const { source, target, objects, name } = req.body ?? {}
        if (!source || !target) return res.status(400).json({ error: 'source (DEV) and target required' })
        if (!gateWrite(res, source)) return
        const { bringToDev } = require('../core/carry-back')
        const r = await bringToDev({
            target, dev: source, objects: Array.isArray(objects) ? objects : [], user: req.user, name: name ?? null,
        }, { token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken })
        if (r.refused) return res.status(409).json(r)
        if (r.ok === false) return res.status(400).json(r)
        res.json(r)
    } catch (e) { fail(res, e) }
})

app.post('/api/deploy/git/execute', async (req, res) => {
    try {
        // Not gated by read-only: a recorded approval (enforced inside execute(),
        // non-optionally) is what authorises shipping to a PROD-posture target.
        const { execute } = require('../core/git-deploy')
        const { target, branch, source, session, backupAt } = req.body
        if (!target) return res.status(400).json({ error: 'target required' })
        const result = await execute(target, { branch, token: _GITOK(), ideToken: req.ideToken, source, by: req.user, session, backupAt })
        if (result?.missingSource) return res.status(400).json({ error: result.error })
        // A deploy that reached the target is recorded either way: `complete` only
        // when every after-pull step landed, `incomplete` when one did not
        // (Part I.8). The change set then says exactly that until an admin fixes it.
        if (result?.approvalSession && result?.executed) {
            try {
                const clean = !!result.controlOk
                    && !(result.incomplete?.length)
                    && !(result.subsetsViews?.errors?.length)
                    && !result.incompleteCheckError
                    && !result.needsChecking
                cl.markSessionDeployed(result.approvalSession, target, {
                    status: clean ? 'complete' : 'incomplete',
                    status_reason: clean ? null : (result.needsChecking
                        ? `Needs checking: DEV's tests on ${target} failed — ${(result.needsCheckingTests ?? []).join(', ') || 'see the deploy report'}`
                        : (result.error ?? 'one or more after-pull steps failed')),
                    release_commit: result.releaseCommit ?? null,
                    base_commit: result.baseCommit ?? null,
                    attrs_commit: result.attrsCommit ?? null,
                    backup_tag: result.backup?.tag ?? null,
                    by: req.user ?? null,
                })
            } catch { /* the deploy itself stands; the link is best-effort */ }
        }
        res.json(result)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Part Q.3 — the developer has tested by hand on the target and confirms it.
// This writes only the deploy record (never the model or security).
app.post('/api/deploy/git/signoff', async (req, res) => {
    try {
        const { target, commit, note } = req.body ?? {}
        if (!target || !commit) return res.status(400).json({ error: 'target and commit required' })
        const { updateSignoff } = require('../core/deploy-records')
        const rec = await updateSignoff(target, commit, {
            by: req.user ?? null, note: note ?? null,
        }, { ideToken: req.ideToken })
        if (!rec) return res.status(404).json({ error: `No deploy record for ${target} at ${commit}.` })
        res.json(rec)
    } catch (e) { fail(res, e) }
})

// Refresh DEV from PROD, dimensions first. The plan compares both servers live;
// the apply writes to DEV and records each dimension in the open change set, so a
// closed change set is refused rather than silently unrecorded.
app.get('/api/deploy/refresh/plan', async (req, res) => {
    try {
        const { source, target, base } = req.query
        if (!source || !target) return res.status(400).json({ error: 'source and target required' })
        // `base` is a READ-ONLY what-if: compare against another release commit
        // (the one before last, say). Admin only, and apply never accepts it — apply
        // always recomputes against the real baseline.
        if (base && !(await requireTm1Admin(req, res, target))) return
        const { planRefresh } = require('../core/refresh-dev')
        res.json(await planRefresh(source, target, { ideToken: req.ideToken, baseCommit: base || null }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/refresh/apply', async (req, res) => {
    try {
        const { source, target, session, accept, chores, covers, hierarchies } = req.body
        if (!source || !target || !session) return res.status(400).json({ error: 'source, target and session required' })
        if (!gateReadOnly(res, source)) return
        const { applyRefresh } = require('../core/refresh-dev')
        res.json(await applyRefresh(source, target, {
            ideToken: req.ideToken, session, accept: Array.isArray(accept) ? accept : [],
            chores: Array.isArray(chores) ? chores : [],
            covers: Array.isArray(covers) ? covers : [],
            hierarchies: Array.isArray(hierarchies) ? hierarchies : [], user: req.user,
        }))
    } catch (e) {
        res.status(e.refused ? 409 : 500).json({ error: e.message })
    }
})

// Is the target idle? Read-only. Three answers: running work (refuse), chores due
// soon (warn), people signed in (confirm).
app.get('/api/deploy/idle', async (req, res) => {
    try {
        const { server, window = '30' } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        const { idleCheck } = require('../core/idle-check')
        // The IDE's own connection is signed in by definition; tell the check which
        // account that is so it does not ask for a confirmation about itself.
        let ownAccount = null
        try { ownAccount = require('../core/paw-connect').getServerCredentials(req.ideToken, server)?.username ?? null } catch { /* unknown */ }
        res.json(await idleCheck(server, { ideToken: req.ideToken, windowMinutes: Number(window) || 30, ownAccount }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Per-target protection: the backup process to run before a deploy (or none, in
// which case the deploy asks when the last backup was taken).
app.get('/api/deploy/settings', async (req, res) => {
    try {
        const { server } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        res.json({ server, ...(await require('../core/deploy-settings').get(server, { ideToken: req.ideToken })) })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/settings', async (req, res) => {
    try {
        const { server, backupProcess, attributeValues } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        if (!gateReadOnly(res, server)) return
        const doc = await require('../core/deploy-settings').set(server, { backupProcess, attributeValues }, { ideToken: req.ideToken })
        res.json({ server, ...doc })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Which attributes the target's own processes write — a SUGGESTION for an admin to
// confirm into the setting. Read-only.
app.get('/api/deploy/settings/suggest', async (req, res) => {
    try {
        const { server } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        const client = makeClient(server, req.ideToken)
        const names = await client.getProcesses()
        const procs = []
        for (const name of names ?? []) {
            try { procs.push(await client.getProcess(name)) } catch { /* skip unreadable */ }
        }
        const { suggestAttributeWrites } = require('../core/refresh-dev')
        res.json({ server, suggestion: suggestAttributeWrites(procs) })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Re-apply a release's recorded DELETES to a target. Admin only, because it edits
// the target outside a deploy: the case is a deploy whose reconcile left an object
// behind (e.g. a process a chore still held). It uses the change set's own
// manifest, so it can never delete anything that release did not delete.
app.post('/api/deploy/git/reconcile-deletes', async (req, res) => {
    try {
        const { target, session } = req.body
        if (!target || !session) return res.status(400).json({ error: 'target and session required' })
        if (!(await requireTm1Admin(req, res, target))) return
        const { getSession, getSessionManifest } = require('../core/change-log')
        const sess = getSession(session)
        if (!sess) return res.status(404).json({ error: `No change set ${session}` })
        const manifest = getSessionManifest(session) ?? { deletes: [] }
        const lock = require('../core/git-lock')
        await lock.acquire(target, { by: req.user, ideToken: req.ideToken })
        try {
            const { reconcileDeletes } = require('../core/git-reconcile')
            const r = await reconcileDeletes(sess.server, target, { ideToken: req.ideToken, deletes: manifest.deletes ?? [] })
            cl.writeLog({
                server: target, action: 'DELETES_REAPPLIED', objectType: 'deploy', objectName: sess.name ?? session,
                detail: `re-applied ${manifest.deletes?.length ?? 0} recorded delete(s): ${r.deleted.length} deleted, ${r.alreadyGone.length} already gone, ${r.failed?.length ?? 0} failed`,
                user: req.user,
            })
            res.json({ target, session, deletes: manifest.deletes ?? [], ...r })
        } finally {
            await lock.release(target, { ideToken: req.ideToken }).catch(() => {})
        }
    } catch (e) {
        const status = e.refused ? 409 : 500
        res.status(status).json({ error: e.message })
    }
})

// What a built release would remove from the target. Read-only, so the one-button
// Ship can stop and show the same list Review shows before anything is approved.
app.post('/api/deploy/git/loss', async (req, res) => {
    try {
        const { target, commit } = req.body
        if (!target || !commit) return res.status(400).json({ error: 'target and commit required' })
        const { elementLossFor } = require('../core/git-deploy')
        res.json(await elementLossFor(target, commit, { token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Part J — recovery is a restore from the backup taken before the deploy, not
// "return to last release" (removed: it lost the deploy's data and took no
// backup). Admin only; chooses the backup by name; moves the release line, the
// deploy note and the attributes branch back to that backup's tag.
app.post('/api/deploy/git/restore-from-backup', async (req, res) => {
    try {
        const { target, backupName, confirm } = req.body
        if (!target) return res.status(400).json({ error: 'target required' })
        if (!(await requireTm1Admin(req, res, target))) return
        if (!String(backupName ?? '').trim()) {
            return res.status(400).json({ error: 'Choose the backup by name (the file the deploy recorded, e.g. PROD_2026-11-27_1000.zip).' })
        }
        if (String(confirm ?? '').trim() !== target) {
            return res.status(400).json({ error: `Type the target name (${target}) to confirm the restore.` })
        }
        const { restoreFromBackup } = require('../core/restore-backup')
        const r = await restoreFromBackup(target, {
            backupName, token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken, by: req.user ?? null,
        })
        if (!r.ok) return res.status(409).json({ error: r.error, ...r })
        res.json(r)
    } catch (e) { fail(res, e) }
})

app.post('/api/deploy/git/push', async (req, res) => {
    try {
        if (!gateReadOnly(res, req.body?.source)) return
        const { source, branch = 'dev', message, session } = req.body
        if (!source) return res.status(400).json({ error: 'source required' })
        const changeSet = session ? cl.getSession(session) : null
        if (changeSet?.wont_deploy_at) {
            return res.status(409).json({ error: `Change set "${changeSet.name}" is retired as a phantom change set — restore it before committing.` })
        }
        const { pushReadiness } = require('../core/git-readiness')
        const readiness = await pushReadiness(source, { ideToken: req.ideToken })
        if (!readiness.ok) {
            return res.status(409).json({
                error: `Readiness blockers must be fixed before pushing: ${readiness.blockers.join('; ')}`,
                blockers: readiness.blockers,
                readiness: readiness.readiness,
            })
        }
        const c = makeClient(source, req.ideToken)
        const gi = require('../core/git-identity')
        const creds = { Username: gi.user(), Password: _GITOK() }
        const plan = await c.post('GitPush', {
            Branch: branch, NewBranch: '', Force: false,
            Message: message || `Deploy from ${source}`,
            Author: req.user ?? gi.user(), Email: gi.email(), ...creds,
        })
        await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        if (session) try { cl.setSessionCommit(session, plan.NewCommit?.ID ?? null) } catch { /* link is best-effort */ }
        res.json({ pushed: true, commit: plan.NewCommit?.ID ?? null, summary: plan.NewCommit?.Summary ?? null, readiness: readiness.readiness })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/git/release', async (req, res) => {
    try {
        const { target, session } = req.body
        if (!target) return res.status(400).json({ error: 'target required' })
        const changeSet = session ? cl.getSession(session) : null
        if (!changeSet) return res.status(400).json({ error: 'a change set (session) is required' })
        if (changeSet.wont_deploy_at) {
            return res.status(409).json({ error: `Change set "${changeSet.name}" is retired as a phantom change set — restore it before releasing.` })
        }
        if (changeSet.kind === 'sync') {
            return res.status(409).json({ error: `"${changeSet.name}" is a sync change set — it brings PROD's changes onto DEV and is never deployed. Build a release for the change set that owns the work.` })
        }
        // Part D.4.3/4.4 — a carry-back is already on PROD. Building a release
        // for PROD is a no-op (PROD needs nothing); it deploys to TEST normally.
        if (changeSet.kind === 'carry-back') {
            const label = await require('../core/test-cycle').labelOf(target, { token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken })
            if (label === 'PROD' || (!label && /prod/i.test(String(target)))) {
                return res.json({
                    ok: true, noChange: true, alreadyOnProd: true, target,
                    reason: `"${changeSet.name}" is already on PROD — it brought PROD's own text onto DEV. PROD needs nothing; deploy it to TEST normally.`,
                })
            }
        }
        // Part A.6: a target that already received this change set needs no new
        // release. (An `incomplete` deploy may be rebuilt — the fix may be a
        // corrected release, and the pre-deploy check will see the target's own
        // corrections as its changes.)
        if (cl.hasCompleteDeploy(changeSet.id, target)) {
            return res.status(409).json({ error: `"${changeSet.name}" is already deployed to ${target} — build a release for another target, or start a new change set.` })
        }
        // Catch-up was removed: the only way to bring a server level is a normal
        // change set built from that server's own copy (step 4). An old catch-up
        // record cannot be rebuilt.
        if (changeSet.kind === 'catch-up') {
            return res.status(409).json({
                error: `Catch-up has been removed. "${changeSet.name}" is a historical record; start a normal change set and deploy it.`,
            })
        }
        const { buildRelease } = require('../core/git-release')
        const addObjects = Array.isArray(req.body.addObjects) ? req.body.addObjects : []
        // "Keep <target>'s version" at Review: the objects the approver decided
        // not to overwrite, despite both sides having changed them.
        const excludeObjects = Array.isArray(req.body.excludeObjects) ? req.body.excludeObjects : []
        const r = await buildRelease(changeSet, target, {
            token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken,
            addObjects, excludeObjects, by: req.user ?? null,
            resetIncludes: req.body.resetIncludes === true,
        })
        if (r.refused) return res.status(409).json({ error: r.error })
        // Nothing to deploy: the set is recorded as done (with the reason) and there
        // is no release commit to approve.
        if (r.noChange) return res.json(r)
        if (r.ok === false) return res.status(500).json({ error: r.error })
        cl.setSessionRelease(changeSet.id, r.releaseCommit, target, {
            addedByUser: r.addedByUser,
            addedAsDependency: r.addedAsDependency,
            excludedByUser: r.excludedByUser,
            targetNotes: r.targetNotes,
            attrsPlan: r.attributePlan,
            liveCommit: r.liveCommit,
            attrsLiveCommit: r.liveAttrsCommit,
            by: req.user ?? null,
        })
        res.json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/deploy/git/approve', async (req, res) => {
    try {
        const { source, target, commit, note } = req.body
        if (!target || !commit) return res.status(400).json({ error: 'target and commit required' })
        const approvals = require('../core/git-approvals')
        // Rule 1: only a BUILT RELEASE links to an approval (release_commit, built
        // for this exact target) — never a raw DEV commit_ref, and never a release
        // built for a different target. linkedChangeSet enforces both.
        const linkedSession = approvals.linkedChangeSet(commit, target)
        if (!linkedSession) {
            return res.status(409).json({ error: `Refused: commit ${commit} is not a release built for ${target}. Build the release first, then approve it.` })
        }
        let tests = null
        try { tests = linkedSession.close_tests ? JSON.parse(linkedSession.close_tests) : null } catch { tests = null }
        // Every release needs a recorded, clean test result. (A catch-up record has
        // none, and cannot be approved: catch-up was removed.)
        if (linkedSession.kind === 'catch-up') {
            return res.status(409).json({ error: `Catch-up has been removed — "${linkedSession.name}" cannot be approved. Start a normal change set.` })
        }
        if (!tests || tests.blocking > 0) {
            return res.status(409).json({ error: `Refused: the change set for commit ${commit} has failing block-severity tests. Fix and re-close before approving.` })
        }
        // Dependency check before approval: rules must CheckRules clean on the target
        // and processes must pass TI lint — a failed reference may belong to another
        // change set (release that change set first, then rebuild this release).
        if (linkedSession.release_commit) {
            const { checkDependencies } = require('../core/git-release')
            const dep = await checkDependencies(linkedSession.release_commit, target, { token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken })
            if (!dep.ok) {
                return res.status(409).json({ error: `Refused: the release has failing dependencies — ${(dep.blockers ?? []).map(b => `${b.object}: ${b.message}`).join(' | ') || dep.error}`, blockers: dep.blockers ?? [] })
            }
        }
        // What the person was shown and said yes to, when the Ship dialog stopped
        // for an element-loss confirmation. Recorded with the approval so the
        // report can say it was named, not merely counted.
        const lossAck = req.body.lossAck && typeof req.body.lossAck === 'object'
            ? {
                at: new Date().toISOString(),
                by: req.user ?? null,
                loss: req.body.lossAck.loss ?? null,
                elements: Array.isArray(req.body.lossAck.elements)
                    ? req.body.lossAck.elements.slice(0, 500).map(l => ({ dimension: l.dimension, hierarchy: l.hierarchy, count: l.count, sample: l.sample ?? [] }))
                    : [],
            }
            : null
        // Element type changes clear stored values; the person must have seen and
        // accepted the list, not merely a count.
        const typeAck = req.body.typeAck && typeof req.body.typeAck === 'object' && Array.isArray(req.body.typeAck.elements)
            ? {
                at: new Date().toISOString(),
                by: req.user ?? null,
                elements: req.body.typeAck.elements.slice(0, 500).map(t => ({
                    dimension: t.dimension ?? null, hierarchy: t.hierarchy ?? null,
                    element: t.element ?? null, from: t.from ?? null, to: t.to ?? null,
                })),
            }
            : null
        const parseList = (text) => { try { return text ? JSON.parse(text) : [] } catch { return [] } }
        const rec = await approvals.append({
            id: new Date().toISOString(), approved_at: new Date().toISOString(),
            approver: req.user ?? 'unknown', notes: note ?? '',
            source: source ?? null, target, commit, session: linkedSession.id, packageDir: null,
            addedByUser: parseList(linkedSession.release_added_by_user),
            addedAsDependency: parseList(linkedSession.release_added_as_dependency),
            excludedByUser: parseList(linkedSession.release_excluded_by_user),
            lossAck,
            typeAck,
        }, { ideToken: req.ideToken })
        res.json(rec)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/git/approval', async (req, res) => {
    try {
        const approvals = require('../core/git-approvals')
        res.json(await approvals.find(req.query.target, req.query.commit, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/git/drift', async (req, res) => {
    try {
        const { driftCheck } = require('../core/git-drift')
        const server = req.body?.server ?? req.query.server
        if (!server) return res.status(400).json({ error: 'server required' })
        res.json(await driftCheck(server, { token: _GITOK(), ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/git/lock', async (req, res) => {
    try {
        const { current } = require('../core/git-lock')
        const server = req.query?.server
        if (!server) return res.status(400).json({ error: 'server required' })
        res.json(await current(server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/git/lock/clear', async (req, res) => {
    try {
        const { clear } = require('../core/git-lock')
        const server = req.body?.server
        if (!server) return res.status(400).json({ error: 'server required' })
        const result = await clear(server, { by: req.user, ideToken: req.ideToken })
        res.json(result)
    } catch (e) {
        res.status(e.refused ? 409 : 500).json({ error: e.message })
    }
})

app.get('/api/git/setup/status', async (req, res) => {
    const tokenSource = gitSecrets.tokenSource()
    try {
        const server = req.query?.server
        if (!server) return res.status(400).json({ error: 'server required', tokenSource })
        const st = await makeClient(server, req.ideToken).post('GitStatus', { Username: _GI().user(), Password: _GITOK() })
        const { attrsBranch } = require('../core/git-attrs')
        const branches = st?.Remote?.Branches ?? []
        res.json({ linked: !!st?.URL, repoUrl: st?.URL ?? null, deployment: st?.Deployment ?? null, connected: st?.Remote?.Connected ?? false, branches, attrsBranch: attrsBranch(server), tokenSource })
    } catch (e) {
        res.status(502).json({
            error: `${e.message} — the token may have expired; it needs Contents: Read and write on the repo`,
            tokenSource,
        })
    }
})

app.post('/api/git/setup/token', (req, res) => {
    try {
        gitSecrets.setToken(req.body?.token)
        res.json({ ok: true, note: 'token set ✓' })   // never the token itself
    } catch (e) { res.status(e.status ?? 400).json({ error: e.message }) }
})

app.get('/api/git/setup/readiness', async (req, res) => {
    try {
        const { server } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        const { scan } = require('../core/git-readiness')
        res.json(await scan(server, { gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/git/setup/init', async (req, res) => {
    try {
        const { server, repo, deployment, force } = req.body
        if (!server || !repo || !deployment) return res.status(400).json({ error: 'server, repo and deployment required' })
        if (!/^(DEV|TEST|PROD)$/i.test(deployment)) return res.status(400).json({ error: 'deployment should be DEV, TEST or PROD' })
        const { init } = require('../core/git-setup')
        const r = await init(server, { repo, deployment, force, gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken })
        if (r.refused) return res.status(409).json({ error: r.error })
        res.json(r)
    } catch (e) { fail(res, e) }
})

app.post('/api/git/setup/first-push', async (req, res) => {
    try {
        const { server, message } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        const c = makeClient(server, req.ideToken)
        const plan = await c.post('GitPush', { Branch: 'dev', NewBranch: '', Force: false, Message: message || `Initial state of ${server}`, Author: req.user ?? _GI().user(), Email: _GI().email(), Username: _GI().user(), Password: _GITOK() })
        await c.post(`GitPlans('${encodeURIComponent(plan.ID)}')/tm1.Execute`, {})
        res.json({ ok: true, commit: plan.NewCommit?.ID ?? null, note: `First commit of ${server} pushed to the repo.` })
    } catch (e) { fail(res, e) }
})

app.get('/api/git/setup/first-pull-analysis', async (req, res) => {
    try {
        const { server, branch = 'dev' } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        const { firstPullAnalysis } = require('../core/git-readiness')
        res.json(await firstPullAnalysis(server, { branch, gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken }))
    } catch (e) { fail(res, e) }
})

app.post('/api/git/setup/first-pull', async (req, res) => {
    try {
        const { server, branch = 'dev', confirm } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        const { firstPull } = require('../core/git-setup')
        const r = await firstPull(server, { branch, confirm, gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken })
        if (r.refused) return res.status(409).json({ error: r.error })
        if (r.ok === false) return res.status(400).json({ error: r.error })
        res.json(r)
    } catch (e) { fail(res, e) }
})

// Part C — setup. Link (if needed), let TM1 write its OWN objects into Git, record
// a target's own write as Last Deployed, and write the attributes initialisation
// commit. Nothing is pulled onto the server.
app.post('/api/git/setup/start', async (req, res) => {
    try {
        const { server, repo, deployment, force, attrsOnly } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        const mod = require('../core/git-setup')
        const opts = { repo, deployment, force, gitUser: _GI().user(), token: _GITOK(), ideToken: req.ideToken, by: req.user ?? null }
        const r = attrsOnly ? await mod.startAttrs(server, opts) : await mod.setupServer(server, opts)
        if (r.refused) return res.status(409).json({ error: r.error })
        if (r.ok === false) return res.status(500).json({ error: r.error })
        res.json(r)
    } catch (e) { fail(res, e) }
})

// Part M — start again with a new repository for one server. Refuses while a
// closed, undeployed change set exists; clears the deploy note in both places.
app.post('/api/deploy/start-again', async (req, res) => {
    try {
        const { server } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        if (!(await requireTm1Admin(req, res, server))) return
        const { startAgain } = require('../core/deploy-admin')
        const r = await startAgain(server, { ideToken: req.ideToken, by: req.user ?? null })
        if (r.refused) return res.status(409).json({ error: r.error, ...r })
        res.json(r)
    } catch (e) { fail(res, e) }
})

// Part K.2 / E.6 — read-only warnings shown when the IDE connects to a server.
app.get('/api/deploy/connect-check', async (req, res) => {
    try {
        const { server } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        const { connectCheck } = require('../core/connect-check')
        res.json(await connectCheck(server, { token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken }))
    } catch (e) { fail(res, e) }
})

// Part L — the open TEST cycle and its change sets, derived from what happened.
// Read-only; the Deploy tab shows it for the selected target.
app.get('/api/deploy/test-cycle', async (req, res) => {
    try {
        const { server } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        const { deriveCycle, labelOf } = require('../core/test-cycle')
        const label = await labelOf(server, { token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken })
        res.json({ ...deriveCycle(server), server, label })
    } catch (e) { fail(res, e) }
})

// Part L.3 — TEST was re-cloned from PROD outside the IDE. Any admin may run it.
app.post('/api/deploy/reclone-test', async (req, res) => {
    try {
        const { server } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        if (!(await requireTm1Admin(req, res, server))) return
        const { recloneTest } = require('../core/deploy-admin')
        const r = await recloneTest(server, {
            token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken, by: req.user ?? null,
        })
        if (r.ok === false) return res.status(409).json({ error: r.error, ...r })
        res.json(r)
    } catch (e) { fail(res, e) }
})

// Part K.1 — prepare DEV for a restore/re-clone. Refuses while a set is open.
app.post('/api/deploy/prepare-dev-restore', async (req, res) => {
    try {
        const { server } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        if (!(await requireTm1Admin(req, res, server))) return
        const { prepareDevRestore } = require('../core/deploy-admin')
        const r = prepareDevRestore(server)
        if (r.refused) return res.status(409).json({ error: r.error, ...r })
        res.json(r)
    } catch (e) { fail(res, e) }
})

app.get('/api/git/setup/label', async (req, res) => {
    try {
        const { server } = req.query
        if (!server) return res.status(400).json({ error: 'server required' })
        const { gitLabel } = require('../core/git-setup')
        res.json({ server, ...(await gitLabel(server, { token: _GITOK(), gitUser: _GI().user(), ideToken: req.ideToken })) })
    } catch (e) { fail(res, e) }
})

// Part E — Sync DEV from PROD. Separate from a deploy: writes PROD's own changes
// onto DEV in a `sync` change set (which owns nothing and is never deployed),
// closes it, and records DEV After Close. Admin only; default is take PROD's.
app.post('/api/deploy/sync', async (req, res) => {
    try {
        const { source, target, untick } = req.body ?? {}
        if (!source || !target) return res.status(400).json({ error: 'source (DEV) and target (PROD) required' })
        if (!(await requireTm1Admin(req, res, source))) return
        if (!(await requireTm1Admin(req, res, target))) return
        const { syncDevFromProd } = require('../core/sync-dev')
        const r = await syncDevFromProd(source, target, {
            ideToken: req.ideToken, token: _GITOK(), gitUser: _GI().user(),
            by: req.user ?? null, user: req.user ?? null,
            untick: Array.isArray(untick) ? untick : [],
        })
        if (r.error && r.refused) return res.status(409).json({ error: r.error, ...r })
        res.json(r)
    } catch (e) { fail(res, e) }
})

// Preview the sync: PROD's own changes, before anything is written, so the admin
// can untick items. Read-only.
app.get('/api/deploy/sync/plan', async (req, res) => {
    try {
        const { source, target } = req.query
        if (!source || !target) return res.status(400).json({ error: 'source and target required' })
        if (!(await requireTm1Admin(req, res, source))) return
        if (!(await requireTm1Admin(req, res, target))) return
        const { planRefresh } = require('../core/refresh-dev')
        const plan = await planRefresh(source, target, { ideToken: req.ideToken })
        res.json({ source, target, ...plan })
    } catch (e) { fail(res, e) }
})

app.post('/api/deploy/seed', async (req, res) => {
    try {
        const { server, label } = req.body
        if (!server) return res.status(400).json({ error: 'server required' })
        // stamp the change-log position so releases can window on id, not timestamp
        const extraMeta = { last_entry_id: cl.getMaxEntryId(server) }
        if (label) extraMeta.label = String(label)
        const snapshot = await deploySeed(server, null, req.ideToken, extraMeta)
        res.json({ ok: true, server, seeded_at: snapshot._meta.seeded_at, last_entry_id: snapshot._meta.last_entry_id, counts: snapshot._meta.counts })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/git/history', async (req, res) => {
    try {
        const target = req.query.target
        if (!target) return res.status(400).json({ error: 'target required' })
        const state = require('../core/git-state').load()[target] ?? null
        const approvals = await require('../core/git-approvals').readFor(target, { ideToken: req.ideToken })
        // Link each approval to its change set so History can show the kind
        const enriched = approvals.map(a => {
            const session = a.session ? cl.getSession(a.session) : null
            return { ...a, sessionName: session?.name ?? null, sessionKind: session?.kind ?? null }
        })
        res.json({ target, deploy: state, approvals: enriched })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// ── Deploy reports ──────────────────────────────────────────────────────────
// The record of one deployment, keyed by (target, commit) — the same pair the
// change set, the approval and the deploy state already carry, so nothing needs
// a new link stored anywhere. A deploy from before records existed still
// answers: commit, time and summary from the deploy state, so the link never
// dead-ends.
app.get('/api/deploy/record', async (req, res) => {
    try {
        const { target, commit } = req.query
        if (!target) return res.status(400).json({ error: 'target required' })
        const { get } = require('../core/deploy-records')
        const record = commit ? await get(target, commit, { ideToken: req.ideToken }) : null
        if (record) return res.json({ target, record })
        const state = require('../core/git-state').load()[target] ?? null
        let approval = null
        try {
            const all = await require('../core/git-approvals').readFor(target, { ideToken: req.ideToken })
            const want = String(commit ?? '')
            approval = [...all].reverse().find(a => {
                const have = String(a.commit ?? '')
                if (!want || !have) return false
                return have === want || (have.length >= 7 && want.startsWith(have)) || (want.length >= 7 && have.startsWith(want))
            }) ?? null
        } catch { /* no approvals readable */ }
        res.json({ target, record: null, commit: commit ?? null, deployed: state, approval })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/records', async (req, res) => {
    try {
        const target = req.query.target
        if (!target) return res.status(400).json({ error: 'target required' })
        const { list } = require('../core/deploy-records')
        res.json({ target, records: await list(target, { ideToken: req.ideToken }) })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/archives', (req, res) => {
    try {
        const dir = path.join(__dirname, '..', 'data', 'archives')
        if (!fs.existsSync(dir)) return res.json([])
        const archives = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .sort().reverse()
            .map(f => {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
                    return { id: f.replace('.json', ''), archived_at: data.archived_at, source: data.source, target: data.target, deployer: data.deployer, approval: data.approval, deployStats: { deployed: data.deploy?.deployed, failed: data.deploy?.failed, dry_run: data.deploy?.dry_run } }
                } catch { return null }
            })
            .filter(Boolean)
        res.json(archives)
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/deploy/archives/:id', (req, res) => {
    try {
        const file = path.join(__dirname, '..', 'data', 'archives', `${req.params.id}.json`)
        if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' })
        res.json(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
}

module.exports = { register }
