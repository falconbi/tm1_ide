'use strict'

function register(app, deps) {
    const { cl, createStartSessionRoute, gateReadOnly, gateWrite, makeClient, mayManageSession, odataKey } = deps

app.post('/api/sessions/start', createStartSessionRoute({ gateReadOnly, startSession: cl.startSession }))

app.post('/api/sessions/close', async (req, res) => {
    try {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        const sess = cl.getSession(id)
        if (!sess) return res.status(404).json({ error: `No change set ${id}` })
        if (!gateReadOnly(res, sess.server)) return
        if (!(await mayManageSession(req, sess))) {
            return res.status(403).json({ error: `Change set ${id} belongs to ${sess.user ?? 'another user'}.` })
        }
        // Run the tests server-side — do not trust the client's results. Refuse to
        // close while any block-severity assertion is failing.
        let tests = null
        try {
            const { run } = require('../core/assertions')
            const r = await run(sess.server, { ideToken: req.ideToken, scope: 'logic' })
            const blocking = r.results.filter(x => !x.pass && (x.severity ?? 'block') === 'block')
            if (blocking.length) {
                return res.status(409).json({
                    error: `Cannot close: ${blocking.length} block-severity assertion${blocking.length !== 1 ? 's' : ''} failing. Fix them, or set severity to warn.`,
                    blocking: blocking.map(b => ({ id: b.id, description: b.description, expected: b.expected, actual: b.actual, error: b.error ?? null })),
                })
            }
            tests = { passed: r.passed, total: r.total, blocking: 0 }
        } catch (e) {
            return res.status(500).json({ error: `Could not run tests to close: ${e.message}` })
        }
        // Part F.4.3/4.4 — an attribute type change (text ↔ number) or a deleted
        // object a DEV process still uses stops the close. Read-only: nothing is
        // written by the check.
        let closeCheck = null
        try {
            const { preCloseCheck } = require('../core/close-check')
            closeCheck = await preCloseCheck(sess.server, id, {
                token: require('../core/git-secrets').getToken(),
                gitUser: require('../core/git-identity').user(),
                ideToken: req.ideToken,
                acceptValues: Array.isArray(req.body?.acceptValues) ? req.body.acceptValues : [],
            })
            if (closeCheck.ok === false) {
                return res.status(409).json({
                    error: `Cannot close: ${(closeCheck.stops ?? [closeCheck.error]).join('; ')}.`,
                    stops: closeCheck.stops ?? [],
                    attributeTypeChanges: closeCheck.attributeTypeChanges ?? [],
                    deletedUsage: closeCheck.deletedUsage ?? [],
                })
            }
        } catch (e) {
            // A check that could not run is reported, not silently skipped.
            closeCheck = { ok: true, warning: `The close checks could not run: ${e.message}` }
        }
        // Write the immutable closed record to the model (loud on a migrated server —
        // a write failure fails the close, and the change set stays open). Open
        // change sets stay in the local log until this moment.
        const { closeChangeSet } = require('../core/change-set-service')
        const closed = await closeChangeSet(id, { user: req.user, tests, ideToken: req.ideToken })
        // Part F.4.5 — TM1 on DEV writes its objects into `dev` (DEV After Close),
        // the commit is recorded on the change set, and the IDE writes attrs-DEV.
        let finalized = null
        try {
            const { finalizeDevClose } = require('../core/close-check')
            finalized = await finalizeDevClose(sess.server, id, {
                token: require('../core/git-secrets').getToken(),
                gitUser: require('../core/git-identity').user(),
                ideToken: req.ideToken, user: req.user,
            })
        } catch (e) { finalized = { ok: false, error: e.message } }
        res.json({ ...closed, closeCheck, finalized })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sessions/resume', async (req, res) => {
    try {
        const { id } = req.body
        if (!id) return res.status(400).json({ error: 'id required' })
        const sess = cl.getSession(id)
        if (!sess) return res.status(404).json({ error: `No change set ${id}` })
        if (!gateReadOnly(res, sess.server)) return
        if (!(await mayManageSession(req, sess))) {
            return res.status(403).json({ error: `Change set ${id} belongs to ${sess.user ?? 'another user'}.` })
        }
        if (sess.kind === 'catch-up') {
            return res.status(409).json({ error: `Catch-up "${sess.name}" is a historical record — catch-up was removed. Start a normal change set.` })
        }
        // Reopening stays refused once a change set has reached ANY server
        // (Part A.4) — TEST counts, not just the last target.
        if (cl.hasAnyDeploy(sess.id) || sess.deployed_target) {
            const where = (cl.deployTargets(sess.id) ?? [])
            const label = where.length ? where.join(', ') : sess.deployed_target
            return res.status(409).json({ error: `Change set "${sess.name}" is already deployed to ${label}. Start a new change set instead.` })
        }
        if (sess.covered_by) {
            return res.status(409).json({ error: `Change set "${sess.name}" was carried by an older whole-server release. Start a new change set instead.` })
        }
        if (sess.wont_deploy_at) {
            return res.status(409).json({ error: `Change set "${sess.name}" is retired as a phantom and cannot be resumed.` })
        }
        res.json(cl.resumeSession(id))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Part F.4 — the close screen's read-only check: attribute values since the last
// close (with their owner), type changes and deleted objects a process still uses.
app.get('/api/sessions/:id/close-check', async (req, res) => {
    try {
        const sess = cl.getSession(req.params.id)
        if (!sess) return res.status(404).json({ error: `No change set ${req.params.id}` })
        if (!gateReadOnly(res, sess.server)) return
        const { preCloseCheck } = require('../core/close-check')
        res.json(await preCloseCheck(sess.server, sess.id, {
            token: require('../core/git-secrets').getToken(),
            gitUser: require('../core/git-identity').user(),
            ideToken: req.ideToken,
        }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

// Retire a change set: mark it "won't deploy" so it stops appearing as something
// to ship. This is the manual counterpart to automatic phantom detection, which
// only retires a set whose objects no longer exist — a set whose edits were
// reverted still exists, and used to sit in the list for ever.
app.post('/api/sessions/:id/retire', async (req, res) => {
    try {
        const sess = cl.getSession(req.params.id)
        if (!sess) return res.status(404).json({ error: `No change set ${req.params.id}` })
        if (!gateReadOnly(res, sess.server)) return
        if (!(await mayManageSession(req, sess))) {
            return res.status(403).json({ error: `Change set ${sess.name} belongs to ${sess.user ?? 'another user'}.` })
        }
        // Fix 11 — retire an OPEN set: the work is abandoned, so close it in the
        // IDE's records WITHOUT running tests and WITHOUT TM1 Git writing DEV
        // into `dev` (nothing from it will ever be deployed). The edits stay on
        // DEV; undoing them there is the developer's call.
        if (!sess.closed_at) {
            const { closeChangeSet, markWontDeploy } = require('../core/change-set-service')
            await closeChangeSet(sess.id, { user: req.user, tests: null, ideToken: req.ideToken })
            const retired = await markWontDeploy(sess.id, {
                by: req.user,
                reason: req.body?.reason ?? 'Retired while open — never ship this',
                ideToken: req.ideToken,
            })
            return res.json(retired)
        }
        // Part L.4 — a set that reached TEST but never PROD may be retired: it
        // failed on TEST, and rework is a new change set. Once it has reached any
        // other server (PROD), retirement stays refused.
        let testOnly = false
        if (cl.hasAnyDeploy(sess.id) || sess.deployed_target) {
            try {
                const { reachedTestOnly } = require('../core/test-cycle')
                testOnly = await reachedTestOnly(sess.id, {
                    token: require('../core/git-secrets').getToken(),
                    gitUser: require('../core/git-identity').user(),
                    ideToken: req.ideToken,
                })
            } catch { testOnly = false }
        }
        if ((cl.hasAnyDeploy(sess.id) || sess.deployed_target) && !testOnly) {
            const where = (cl.deployTargets(sess.id) ?? [])
            return res.status(409).json({ error: `"${sess.name}" is already deployed to ${where.length ? where.join(', ') : sess.deployed_target}.` })
        }
        if (sess.covered_by) return res.status(409).json({ error: `"${sess.name}" was carried by an older whole-server release.` })
        res.json(cl.markSessionWontDeploy(sess.id, { by: req.user, reason: req.body?.reason ?? '' }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sessions/:id/unretire', async (req, res) => {
    try {
        const sess = cl.getSession(req.params.id)
        if (!sess) return res.status(404).json({ error: `No change set ${req.params.id}` })
        if (!gateReadOnly(res, sess.server)) return
        if (!(await mayManageSession(req, sess))) {
            return res.status(403).json({ error: `Change set ${sess.name} belongs to ${sess.user ?? 'another user'}.` })
        }
        res.json(cl.unmarkSessionWontDeploy(sess.id))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions/active', (req, res) => {
    try {
        const s = cl.getActiveSession(req.query.server, req.user)
        if (!s) return res.json(null)
        res.json({ ...s, entry_count: (() => { try { return cl.changeObjectCount(cl.getSessionLog(s.id)) } catch { return 0 } })() })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions', async (req, res) => {
    try {
        const server   = req.query.server
        // The list drives counts ("Show 31 phantom"), so silently returning the
        // first 50 makes those counts a page count. Callers may ask for more;
        // the ceiling keeps a huge history from being read on every render.
        const limit    = Math.min(Math.max(Number(req.query.limit) || 50, 1), 1000)
        const sessions = cl.getSessions(server, limit)
        let phantom = new Set()
        try { phantom = await require('../core/phantom-change-set').findPhantomIds(server, sessions, { ideToken: req.ideToken }) }
        catch { /* no model read → no automatic hiding */ }
        // A session counts as "deployed" once this server's own baseline has
        // advanced past its last entry -- deployer.js re-seeds BOTH the target's
        // and the source's baseline (stamped with the source's exact change-log
        // position) after every clean deploy, whether it was a specific-session
        // deploy or a Release (which never records a session id at all, so
        // matching deploy-approvals.json's `session` field alone missed almost
        // every real deploy). A failed deploy never advances the baseline, so
        // this also can't mark a session "deployed" when it actually wasn't.
        let baselineEntryId = null
        try { baselineEntryId = require('../tools/tm1deploy/src/diff').loadBaseline(null, server)?._meta?.last_entry_id ?? null }
        catch { /* no baseline yet */ }
        // Per-target deploy records (Part A.3): each set says where it has been,
        // so the screen can show "Deployed to TEST 24 Nov — waiting for PROD".
        const deploys = cl.getDeploysForSessions(sessions.map(s => s.id))
        res.json(sessions.map(s => ({
            ...s,
            deploys: deploys[s.id] ?? [],
            deployed_targets: (deploys[s.id] ?? []).filter(d => d.status === 'complete' || d.status === 'incomplete').map(d => d.target),
            deployed: !!s.deployed_target || (baselineEntryId != null && s.max_entry_id != null && s.max_entry_id <= baselineEntryId),
            phantom: phantom.has(s.id),
        })))
    }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions/:id/log', (req, res) => {
    try { res.json(cl.getSessionLog(req.params.id)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/sessions/:id/log/verbose', (req, res) => {
    try { res.json(cl.getSessionLogVerbose(req.params.id)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.patch('/api/sessions/:id/description', async (req, res) => {
    try {
        const sess = cl.getSession(req.params.id)
        if (!sess) return res.status(404).json({ error: `No change set ${req.params.id}` })
        if (!gateReadOnly(res, sess.server)) return
        if (!(await mayManageSession(req, sess))) {
            return res.status(403).json({ error: `Change set ${req.params.id} belongs to ${sess.user ?? 'another user'}.` })
        }
        res.json(cl.updateSessionDescription(req.params.id, req.body.description))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/log/object', (req, res) => {
    try { res.json(cl.getObjectHistory(req.query.server, req.query.type, req.query.name)) }
    catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/log/rollback', async (req, res) => {
    try {
        const { entryId, server } = req.body
        if (!gateReadOnly(res, server)) return
        const entry = cl.getEntryById(entryId)
        if (!entry)              return res.status(404).json({ error: 'Entry not found' })
        if (!entry.before_state) return res.status(400).json({ error: 'No before state captured for this entry' })

        const before = entry.before_state
        const client = makeClient(server, req.ideToken)

        if (entry.object_type === 'rules') {
            await client.patch(`Cubes('${odataKey(entry.object_name)}')`, { Rules: before.text ?? '' })
        } else if (entry.object_type === 'process') {
            await client.patch(`Processes('${odataKey(entry.object_name)}')`, {
                PrologProcedure:   before.prolog   ?? '',
                MetadataProcedure: before.metadata ?? '',
                DataProcedure:     before.data     ?? '',
                EpilogProcedure:   before.epilog   ?? '',
            })
        } else if (entry.object_type === 'subset') {
            if (before.expression != null) {
                await client.saveSubset(entry.detail, entry.object_name, before.expression)
            } else if (before.elements) {
                await client.saveStaticSubset(entry.detail, entry.object_name, before.elements)
            }
        } else if (entry.object_type === 'view' && before.type === 'mdx') {
            await client.saveView(entry.detail, entry.object_name, before.mdx)
        }

        cl.writeLog({ server, action: 'ROLLED_BACK', objectType: entry.object_type, objectName: entry.object_name, detail: entry.detail, user: req.user })
        res.json({ ok: true })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

app.get('/api/assertions', async (req, res) => {
    try {
        const { list } = require('../core/assertions')
        if (!req.query.server) return res.status(400).json({ error: 'server required' })
        res.json(await list(req.query.server, { ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/assertions', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const { add } = require('../core/assertions')
        const { author: _author, changeSet: _changeSet, user: _user, createdBy: _createdBy, ...body } = req.body
        const active = cl.getActiveSession(req.query.server, req.user)
        res.json(await add(req.query.server, { ...body, author: req.user, changeSet: active?.id ?? null }, { ideToken: req.ideToken }))
    } catch (e) { res.status(e.status ?? 500).json({ error: e.message }) }
})

app.patch('/api/assertions/:id', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const { update } = require('../core/assertions')
        const { changeSet: _changeSet, user: _user, createdBy: _createdBy, ...body } = req.body
        const r = await update(req.query.server, req.params.id, body, { ideToken: req.ideToken, by: req.user })
        if (!r) return res.status(404).json({ error: `No assertion ${req.params.id}` })
        res.json(r)
    } catch (e) { res.status(e.status ?? 500).json({ error: e.message }) }
})

app.delete('/api/assertions/:id', async (req, res) => {
    try {
        if (!gateWrite(res, req.query.server)) return
        const { remove } = require('../core/assertions')
        const ok = await remove(req.query.server, req.params.id, { ideToken: req.ideToken })
        res.json({ ok })
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/assertions/run', async (req, res) => {
    try {
        const { run, runOne } = require('../core/assertions')
        if (!req.query.server) return res.status(400).json({ error: 'server required' })
        if (req.body?.id) return res.json(await runOne(req.query.server, req.body.id, { ideToken: req.ideToken }))
        res.json(await run(req.query.server, { kind: req.body?.kind, severity: req.body?.severity, tags: req.body?.tags, ideToken: req.ideToken }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})

app.get('/api/assertions/history', async (req, res) => {
    try {
        const { makeClient } = require('../core/adapter-registry')
        const { recentRuns } = require('../core/test-results')
        if (!req.query.server) return res.status(400).json({ error: 'server required' })
        const client = makeClient(req.query.server, req.ideToken)
        res.json(await recentRuns(client, { assertionId: req.query.id, limit: Number(req.query.limit) || 10 }))
    } catch (e) { res.status(500).json({ error: e.message }) }
})
}

module.exports = { register }
